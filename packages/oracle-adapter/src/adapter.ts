import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type OracleConnectionConfig,
  QueryValidationError,
} from "@dash/core";
import oracledb from "oracledb";
import { type OracleSession, oracleSession } from "./connection.ts";
import { INTROSPECT_SQL, compileSelect } from "./sql.ts";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  fields?: Array<{ name: string }>;
}

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}

const SESSION_SQL =
  "ALTER SESSION SET TIME_ZONE = 'UTC' NLS_DATE_FORMAT = 'YYYY-MM-DD' NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD\"T\"HH24:MI:SS.FF'";

type ColumnKind = "date" | "number";

export function oracleDriverConfig(session: OracleSession): oracledb.PoolAttributes {
  return {
    user: session.user,
    password: session.password,
    connectString: session.connectString,
    poolMin: 0,
    poolMax: 5,
    poolIncrement: 1,
    poolTimeout: 30,
    connectTimeout: 10,
    stmtCacheSize: 0,
  };
}

function bindValue(value: unknown): string | number | bigint | boolean | Date | Buffer | null {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    value instanceof Date
  ) {
    return value;
  }
  throw new QueryValidationError(
    "Oracle filter values must be scalar values, dates, or binary data",
  );
}

function normalizeNumber(value: string): number | string {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    return value;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  if (Number.isSafeInteger(numeric) && /^-?\d+(?:\.0+)?$/.test(value)) {
    return numeric;
  }
  if (numeric.toString() === value) {
    return numeric;
  }
  return value;
}

function calendarDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${String(value.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

function normalizeDate(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : calendarDate(value);
  }
  if (typeof value !== "string") {
    return value;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

function normalizeCell(value: unknown, kind: ColumnKind | undefined): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (kind === "number" && typeof value === "string") {
    return normalizeNumber(value);
  }
  if (kind === "date") {
    return normalizeDate(value);
  }
  return value;
}

function scrub(error: unknown, secret: string): Error {
  const message = error instanceof Error ? error.message : "Connection failed";
  if (secret.length >= 3 && message.includes(secret)) {
    return new Error(message.split(secret).join("***"));
  }
  return error instanceof Error ? error : new Error(message);
}

function readLob(value: unknown): Promise<Buffer | string | null> {
  if (value === null || value === undefined) {
    return Promise.resolve(null);
  }
  if (typeof value !== "object" || !("getData" in value) || typeof value.getData !== "function") {
    throw new QueryValidationError("Oracle binary value could not be read");
  }
  return (value.getData as () => Promise<Buffer | string>)();
}

function wrapPool(attributes: oracledb.PoolAttributes): SqlClient {
  let pool: Promise<oracledb.Pool> | undefined;
  let closed = false;
  const secret = attributes.password ?? "";
  const open = () => {
    if (closed) {
      throw new Error("Oracle connection is closed");
    }
    pool ??= oracledb.createPool(attributes).catch((error: unknown) => {
      pool = undefined;
      throw error;
    });
    return pool;
  };
  return {
    async query(text, values) {
      const binds: Record<string, string | number | bigint | boolean | Date | Buffer | null> = {};
      for (const [index, value] of (values ?? []).entries()) {
        binds[`p${index}`] = bindValue(value);
      }
      let connection: oracledb.Connection | undefined;
      try {
        const ready = await open();
        connection = await ready.getConnection();
        connection.callTimeout = 30_000;
        await connection.execute(SESSION_SQL);
        const kinds = new Map<string, ColumnKind>();
        const result = await connection.execute(text, binds, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchTypeHandler(metaData) {
            if (metaData.dbType === oracledb.DB_TYPE_DATE) {
              kinds.set(metaData.name, "date");
              // Thin mode ignores NLS_DATE_FORMAT. A VARCHAR fetch uses Date.toString().
              // The converter keeps the calendar date in the application time zone.
              return { converter: normalizeDate };
            }
            if (metaData.dbType === oracledb.DB_TYPE_NUMBER) {
              kinds.set(metaData.name, "number");
              return { type: oracledb.DB_TYPE_VARCHAR };
            }
            if (
              metaData.dbType === oracledb.DB_TYPE_CLOB ||
              metaData.dbType === oracledb.DB_TYPE_NCLOB
            ) {
              return { type: oracledb.DB_TYPE_VARCHAR };
            }
            if (metaData.dbType === oracledb.DB_TYPE_BLOB) {
              return { type: oracledb.DB_TYPE_LONG_RAW };
            }
            if (metaData.dbType === oracledb.DB_TYPE_BFILE) {
              return { converter: readLob };
            }
            return undefined;
          },
        });
        const rows = ((result.rows ?? []) as Array<Record<string, unknown>>).map((row) => {
          const next: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            next[key] = normalizeCell(value, kinds.get(key));
          }
          return next;
        });
        const fields = (result.metaData ?? []).map((field) => ({ name: field.name }));
        return { rows, fields };
      } catch (error) {
        throw scrub(error, secret);
      } finally {
        await connection?.close().catch(() => undefined);
      }
    },
    async end() {
      closed = true;
      const pending = pool;
      pool = undefined;
      if (!pending) {
        return;
      }
      try {
        const ready = await pending;
        await ready.close(0);
      } catch {
        // The pool never finished opening.
      }
    },
  };
}

function cell(row: Record<string, unknown>, name: string): unknown {
  if (name in row) {
    return row[name];
  }
  const match = Object.keys(row).find((key) => key.toLowerCase() === name);
  return match ? row[match] : undefined;
}

function nullableFlag(value: unknown): boolean {
  const flag = String(value ?? "").toUpperCase();
  return flag === "Y" || flag === "YES";
}

export class OracleAdapter implements DataAdapter {
  readonly kind = "oracle" as const;
  #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  static fromConfig(config: OracleConnectionConfig): OracleAdapter {
    return new OracleAdapter(wrapPool(oracleDriverConfig(oracleSession(config))));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.query('SELECT 1 AS "ok" FROM dual');
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to Oracle",
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
      const namespace = String(cell(row, "namespace"));
      const name = String(cell(row, "name"));
      const key = `${namespace}.${name}`;
      let resource = resources.get(key);
      if (!resource) {
        const tableType = String(cell(row, "table_type") ?? "TABLE");
        resource = {
          name,
          namespace,
          kind: tableType.toUpperCase().includes("VIEW") ? "view" : "table",
          columns: [],
        };
        resources.set(key, resource);
      }
      resource.columns.push({
        name: String(cell(row, "column_name")),
        type: String(cell(row, "data_type")).toLowerCase(),
        nullable: nullableFlag(cell(row, "is_nullable")),
      });
    }
    return { kind: "oracle", resources: [...resources.values()] };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const compiled = compileSelect(input);
    const result = await this.#client.query(compiled.text, compiled.values);
    const columns =
      result.fields && result.fields.length > 0
        ? result.fields.map((field) => ({
            name: field.name,
            type: "unknown",
            nullable: true,
          }))
        : result.rows[0]
          ? Object.keys(result.rows[0]).map((name) => ({
              name,
              type: "unknown",
              nullable: true,
            }))
          : [];
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

export function createOracleAdapter(config: OracleConnectionConfig): OracleAdapter {
  return OracleAdapter.fromConfig(config);
}
