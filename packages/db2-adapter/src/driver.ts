import { QueryValidationError } from "@dash/core";
import { db2ConnectionString, type Db2Session } from "./connection.ts";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  fields?: Array<{ name: string; type?: string }>;
}

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}

interface Db2Result {
  getColumnMetadataSync(): Array<{ SQL_DESC_NAME?: string; SQL_DESC_TYPE_NAME?: string }>;
  fetchAll(): Promise<unknown>;
  close(): Promise<unknown>;
}

interface Db2Statement {
  setAttr?(attribute: number, value: number): Promise<unknown>;
  execute(params?: unknown[]): Promise<unknown>;
  close(): Promise<unknown>;
}

interface Db2Connection {
  prepare(sql: string): Promise<Db2Statement>;
  close(): Promise<unknown>;
}

interface Db2Pool {
  setMaxPoolSize(size: number): void;
  open(connectionString: string): Promise<Db2Connection>;
  close(): Promise<unknown>;
}

interface Db2Api {
  Pool: new () => Db2Pool;
  SQL_ATTR_QUERY_TIMEOUT?: number;
}

const POOL_SIZE = 5;

function assertBind(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint" || value instanceof Date) {
    return value;
  }
  throw new QueryValidationError(
    "Db2 filter values must be scalar values, dates, or big integers",
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return "Connection failed";
}

export function scrubDb2Error(error: unknown, password: string | undefined): Error {
  let message = errorText(error);
  if (password) {
    message = message.split(password).join("[redacted]");
  }
  message = message.replace(/PWD=\{(?:[^}]|}})*\}/gi, "PWD=[redacted]");
  message = message.replace(/PWD=[^;]*/gi, "PWD=[redacted]");
  if (!message.trim()) {
    message = "Connection failed";
  }
  return new Error(message);
}

function resultOf(value: unknown): Db2Result {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as Db2Result).fetchAll !== "function"
  ) {
    throw new Error("Db2 query failed");
  }
  return candidate as Db2Result;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error("Db2 query failed");
  }
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Db2 query failed");
    }
    return row as Record<string, unknown>;
  });
}

function fieldsFrom(
  metadata: unknown,
  rows: Record<string, unknown>[],
): Array<{ name: string; type?: string }> {
  if (Array.isArray(metadata)) {
    const fields: Array<{ name: string; type?: string }> = [];
    for (const entry of metadata) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as { SQL_DESC_NAME?: unknown; SQL_DESC_TYPE_NAME?: unknown };
      if (typeof record.SQL_DESC_NAME !== "string" || record.SQL_DESC_NAME.trim() === "") {
        continue;
      }
      const type =
        typeof record.SQL_DESC_TYPE_NAME === "string" && record.SQL_DESC_TYPE_NAME.trim() !== ""
          ? record.SQL_DESC_TYPE_NAME.trim()
          : "unknown";
      fields.push({ name: record.SQL_DESC_NAME.trim(), type });
    }
    if (fields.length > 0) {
      return fields;
    }
  }
  const first = rows[0];
  if (!first) {
    return [];
  }
  return Object.keys(first).map((name) => ({ name, type: "unknown" }));
}

async function closeQuiet(resource: { close?: () => Promise<unknown> } | undefined): Promise<void> {
  if (!resource || typeof resource.close !== "function") {
    return;
  }
  try {
    await resource.close();
  } catch {
    // Keep the query error. A close error is secondary.
  }
}

async function loadApi(): Promise<Db2Api> {
  const loaded = (await import("ibm_db")) as unknown as { default?: Db2Api };
  const api = loaded.default;
  if (!api || typeof api.Pool !== "function") {
    throw new Error("Db2 driver is unavailable");
  }
  return api;
}

export function createDb2Client(session: Db2Session): SqlClient {
  const connectionString = db2ConnectionString(session);
  let pool: Db2Pool | undefined;
  let opening: Promise<Db2Pool> | undefined;
  let closed = false;

  async function ready(): Promise<Db2Pool> {
    if (closed) {
      throw new Error("Db2 connection is closed");
    }
    if (pool) {
      return pool;
    }
    if (!opening) {
      opening = loadApi()
        .then((api) => {
          const created = new api.Pool();
          created.setMaxPoolSize(POOL_SIZE);
          pool = created;
          return created;
        })
        .catch((error: unknown) => {
          opening = undefined;
          throw error;
        });
    }
    return opening;
  }

  return {
    async query(text, values) {
      const binds = (values ?? []).map(assertBind);
      let conn: Db2Connection | undefined;
      let stmt: Db2Statement | undefined;
      let result: Db2Result | undefined;
      try {
        const current = await ready();
        if (closed) {
          throw new Error("Db2 connection is closed");
        }
        conn = await current.open(connectionString);
        stmt = await conn.prepare(text);
        const executed = binds.length > 0 ? await stmt.execute(binds) : await stmt.execute();
        result = resultOf(executed);
        const metadata = result.getColumnMetadataSync();
        const rows = asRows(await result.fetchAll());
        return { rows, fields: fieldsFrom(metadata, rows) };
      } catch (error) {
        throw scrubDb2Error(error, session.password);
      } finally {
        await closeQuiet(result);
        await closeQuiet(stmt);
        await closeQuiet(conn);
      }
    },
    async end() {
      closed = true;
      const current = pool ?? (opening ? await opening.catch(() => undefined) : undefined);
      pool = undefined;
      opening = undefined;
      if (current) {
        await current.close();
      }
    },
  };
}
