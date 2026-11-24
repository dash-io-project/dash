import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type CockroachConnectionConfig,
  type ConnectionTestResult,
  type DataAdapter,
  QueryValidationError,
  normalizeAdapterQuery,
} from "@dash/core";
import pg from "pg";
import { type CockroachTlsMode, cockroachSession } from "./connection.ts";
import { INTROSPECT_SQL, compileSelect } from "./sql.ts";

const QUERY_TIMEOUT_MS = 60_000;
const MAX_PAGE = 10_000;
const INTROSPECT_CAP = 10_000;

const TYPE_NAMES: Record<number, string> = {
  16: "bool",
  17: "bytes",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "string",
  700: "float4",
  701: "float",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  1700: "decimal",
  2950: "uuid",
  3802: "jsonb",
};

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  fields?: Array<{ name: string; dataTypeID?: number }>;
}

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}

/** Parse an INT8 value. Return a number when the value is a safe integer. */
export function parseInt8Text(value: string): number | string {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) {
    return value;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return value;
  }
  return parsed;
}

/**
 * Handle an idle pool error.
 * Node stops the process when this error has no listener.
 */
export function listenForPoolErrors(pool: pg.Pool): void {
  pool.on("error", () => undefined);
}

function tlsOptions(mode: CockroachTlsMode, ca: string | undefined): pg.PoolConfig["ssl"] {
  if (mode === "off") {
    return undefined;
  }
  const secure = {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2" as const,
    ...(ca !== undefined ? { ca } : {}),
  };
  if (mode === "verify-full") {
    return secure;
  }
  return { ...secure, checkServerIdentity: () => undefined };
}

function typeParsers(): pg.CustomTypesConfig {
  const overrides = new pg.TypeOverrides();
  const keepText = (value: string) => value;
  for (const oid of [
    pg.types.builtins.DATE,
    pg.types.builtins.TIME,
    pg.types.builtins.TIMETZ,
    pg.types.builtins.TIMESTAMP,
    pg.types.builtins.TIMESTAMPTZ,
    pg.types.builtins.INTERVAL,
    pg.types.builtins.BYTEA,
  ]) {
    overrides.setTypeParser(oid, keepText);
  }
  overrides.setTypeParser(pg.types.builtins.INT8, parseInt8Text);
  return {
    getTypeParser: (oid, format) => overrides.getTypeParser(oid, format),
  };
}

function toPoolConfig(config: CockroachConnectionConfig): pg.PoolConfig {
  const session = cockroachSession(config);
  return {
    host: session.host,
    port: session.port,
    database: session.database,
    user: session.user,
    ...(session.password !== undefined ? { password: session.password } : {}),
    ...(session.cluster !== undefined ? { options: `--cluster=${session.cluster}` } : {}),
    ssl: tlsOptions(session.tls, session.sslCa),
    max: 5,
    connectionTimeoutMillis: 10_000,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    application_name: "dash",
    types: typeParsers(),
  };
}

function columnType(dataTypeID?: number): string {
  if (dataTypeID === undefined) {
    return "unknown";
  }
  return TYPE_NAMES[dataTypeID] ?? "unknown";
}

function assertBind(value: unknown): unknown {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (value instanceof Date && !Number.isNaN(value.getTime())) ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new QueryValidationError(
    "CockroachDB filter values must be scalar values, dates, or binary data",
  );
}

function wrapPool(pool: pg.Pool): SqlClient {
  return {
    async query(text, values) {
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], fields: result.fields };
    },
    async end() {
      await pool.end();
    },
  };
}

function resourceKind(tableType: string): "table" | "view" {
  return tableType.toUpperCase().includes("VIEW") ? "view" : "table";
}

export class CockroachAdapter implements DataAdapter {
  readonly kind = "cockroachdb" as const;
  #client: SqlClient;
  #closed = false;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  static fromConfig(config: CockroachConnectionConfig): CockroachAdapter {
    const pool = new pg.Pool(toPoolConfig(config));
    listenForPoolErrors(pool);
    return new CockroachAdapter(wrapPool(pool));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.query("SELECT 1 AS ok");
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to CockroachDB",
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
    if (result.rows.length > INTROSPECT_CAP) {
      throw new Error("CockroachDB schema introspection exceeded 10000 columns");
    }
    const resources = new Map<string, AdapterSchema["resources"][number]>();
    for (const row of result.rows) {
      const namespace = String(row.namespace);
      const name = String(row.name);
      const key = `${namespace}.${name}`;
      let resource = resources.get(key);
      if (!resource) {
        resource = {
          name,
          namespace,
          kind: resourceKind(String(row.table_type ?? "BASE TABLE")),
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
    return { kind: "cockroachdb", resources: [...resources.values()] };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const normalized = normalizeAdapterQuery(input);
    const limit = normalized.limit as number;
    const lookAhead = limit < MAX_PAGE;
    const compiled = compileSelect({
      ...input,
      limit: lookAhead ? limit + 1 : limit,
      offset: normalized.offset,
    });
    const result = await this.#client.query(
      compiled.text,
      compiled.values.map((value) => assertBind(value)),
    );
    const extra = lookAhead && result.rows.length > limit;
    const rows = extra ? result.rows.slice(0, limit) : result.rows;
    const columns =
      result.fields?.map((field) => ({
        name: field.name,
        type: columnType(field.dataTypeID),
        nullable: true,
      })) ??
      (rows[0]
        ? Object.keys(rows[0]).map((name) => ({
            name,
            type: "unknown",
            nullable: true,
          }))
        : []);
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: extra || (!lookAhead && rows.length === limit),
    };
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#client.end();
  }
}

export function createCockroachAdapter(config: CockroachConnectionConfig): CockroachAdapter {
  return CockroachAdapter.fromConfig(config);
}
