import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type MariadbConnectionConfig,
  QueryValidationError,
} from "@dash/core";
import { createPool, type FieldInfo, type Pool, type PoolConfig } from "mariadb";
import { INTROSPECT_SQL, compileSelect } from "./sql.ts";
import { mariadbTls } from "./tls.ts";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  fields?: Array<{ name: string }>;
}

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}

export interface ParsedMariadbUri {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

const MAX_URI_LENGTH = 2048;

type PreparedRows = Record<string, unknown>[] & { meta?: FieldInfo[] };

function sslFromSearch(params: URLSearchParams): boolean | undefined {
  const raw = params.get("ssl") ?? params.get("ssl-mode") ?? params.get("sslMode");
  if (raw == null || raw === "") {
    return undefined;
  }
  const normalized = raw.trim().toUpperCase();
  if (
    normalized === "FALSE" ||
    normalized === "0" ||
    normalized === "DISABLED" ||
    normalized === "DISABLE"
  ) {
    return false;
  }
  if (
    normalized === "TRUE" ||
    normalized === "1" ||
    normalized === "REQUIRED" ||
    normalized === "PREFERRED" ||
    normalized === "VERIFY_CA" ||
    normalized === "VERIFY_IDENTITY"
  ) {
    return true;
  }
  throw new Error("Invalid MariaDB SSL option");
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`MariaDB ${label} is invalid`);
  }
}

export function parseMariadbConnectionString(connectionString: string): ParsedMariadbUri {
  if (!connectionString || connectionString.length > MAX_URI_LENGTH) {
    throw new Error("MariaDB connection string is invalid");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Invalid MariaDB connection string");
  }
  if (url.protocol !== "mariadb:") {
    throw new Error("MariaDB connection string must use the mariadb:// scheme");
  }
  const pathname = url.pathname.replace(/^\//, "");
  if (pathname.includes("/")) {
    throw new Error("MariaDB connection string can include one database");
  }
  let database: string | undefined;
  if (pathname) {
    database = decodePart(pathname, "database name");
  }
  const port = url.port ? Number(url.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("MariaDB port is invalid");
  }
  return {
    host: url.hostname || undefined,
    port,
    database: database || undefined,
    user: url.username ? decodePart(url.username, "user name") : undefined,
    password: url.password ? decodePart(url.password, "password") : undefined,
    ssl: sslFromSearch(url.searchParams),
  };
}

function usesSsl(config: MariadbConnectionConfig, parsed?: ParsedMariadbUri): boolean {
  return Boolean(config.ssl || parsed?.ssl);
}

function toPoolConfig(config: MariadbConnectionConfig): PoolConfig {
  const parsed = config.connectionString
    ? parseMariadbConnectionString(config.connectionString)
    : undefined;
  const host = parsed?.host ?? config.host;
  return {
    host,
    port: parsed?.port ?? config.port ?? 3306,
    database: parsed?.database ?? config.database,
    user: parsed?.user ?? config.user,
    password: parsed?.password ?? config.password,
    connectionLimit: 5,
    connectTimeout: 10_000,
    acquireTimeout: 10_000,
    dateStrings: true,
    timezone: "Z",
    multipleStatements: false,
    permitLocalInfile: false,
    namedPlaceholders: false,
    permitSetMultiParamEntries: false,
    debug: false,
    trace: false,
    logParam: false,
    ssl: mariadbTls(usesSsl(config, parsed), host),
  };
}

function isScalarBind(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    value instanceof Date ||
    value instanceof Uint8Array
  );
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber) && BigInt(asNumber) === value) {
      return asNumber;
    }
    return value.toString();
  }
  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = normalizeValue(value);
  }
  return out;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    parts.push(current.message);
    current = current.cause;
  }
  return parts.length > 0 ? parts.join("\n") : "Connection failed";
}

function asDriverError(error: unknown): Error {
  const message = errorText(error);
  if (error instanceof Error && error.message === message) {
    return error;
  }
  const wrapped = new Error(message);
  if (error instanceof Error) {
    wrapped.cause = error;
  }
  return wrapped;
}

type PoolWithError = Pool & {
  removeListener(event: "error", listener: (error: unknown) => void): void;
};

function executePrepared(pool: Pool, text: string, binds: unknown[]): Promise<PreparedRows> {
  // The pool reports a connection failure on the error event.
  // The query wait can hide that failure until the acquire time ends.
  // Return the connection failure when the driver reports it.
  const emitter = pool as PoolWithError;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, rows?: PreparedRows) => {
      if (settled) {
        return;
      }
      settled = true;
      emitter.removeListener("error", onError);
      if (error !== undefined) {
        reject(asDriverError(error));
        return;
      }
      resolve(rows as PreparedRows);
    };
    const onError = (error: unknown) => finish(error);
    emitter.on("error", onError);
    try {
      emitter.execute(text, binds).then(
        (rows) => finish(undefined, rows as PreparedRows),
        (error: unknown) => finish(error),
      );
    } catch (error) {
      finish(error);
    }
  });
}

function wrapPool(pool: Pool): SqlClient {
  return {
    async query(text, values) {
      // Send values with a server prepared statement.
      // Do not escape them into the SQL text.
      const binds = (values ?? []).map((value) => {
        if (!isScalarBind(value)) {
          throw new QueryValidationError(
            "MariaDB filter values must be scalar values, dates, or binary data",
          );
        }
        return value;
      });
      const rows = await executePrepared(pool, text, binds);
      if (!Array.isArray(rows)) {
        throw new Error("MariaDB query did not return rows");
      }
      return {
        rows: rows.map((row) => normalizeRow(row)),
        fields: rows.meta?.map((field) => ({ name: field.name() })),
      };
    },
    async end() {
      await pool.end();
    },
  };
}

export class MariadbAdapter implements DataAdapter {
  readonly kind = "mariadb" as const;
  #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  static fromConfig(config: MariadbConnectionConfig): MariadbAdapter {
    return new MariadbAdapter(wrapPool(createPool(toPoolConfig(config))));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.query("SELECT 1 AS ok");
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to MariaDB",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  async introspectSchema(): Promise<AdapterSchema> {
    const result = await this.#client.query(INTROSPECT_SQL);
    const resources = new Map<string, AdapterSchema["resources"][number]>();
    for (const row of result.rows) {
      const namespace = String(row.namespace);
      const name = String(row.name);
      const key = `${namespace}.${name}`;
      let resource = resources.get(key);
      if (!resource) {
        const tableType = String(row.table_type ?? "BASE TABLE");
        resource = {
          name,
          namespace,
          kind: tableType.includes("VIEW") ? "view" : "table",
          columns: [],
        };
        resources.set(key, resource);
      }
      resource.columns.push({
        name: String(row.column_name),
        type: String(row.data_type),
        nullable: String(row.is_nullable).toUpperCase() === "YES",
      });
    }
    return { kind: "mariadb", resources: [...resources.values()] };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const compiled = compileSelect(input);
    const result = await this.#client.query(compiled.text, compiled.values);
    const columns =
      result.fields?.map((field) => ({
        name: field.name,
        type: "unknown",
        nullable: true,
      })) ??
      (result.rows[0]
        ? Object.keys(result.rows[0]).map((name) => ({
            name,
            type: "unknown",
            nullable: true,
          }))
        : []);
    return {
      columns,
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.rows.length === (input.limit ?? 1000),
    };
  }

  async close(): Promise<void> {
    await this.#client.end();
  }
}

export function createMariadbAdapter(config: MariadbConnectionConfig): MariadbAdapter {
  return MariadbAdapter.fromConfig(config);
}
