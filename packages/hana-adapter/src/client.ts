import { QueryValidationError } from "@dash/core";
import * as hana from "@sap/hana-client";
import type { HanaDriverOptions, HanaSession } from "./connection.ts";
import { hanaDriverOptions } from "./connection.ts";

export interface SqlField {
  name: string;
  type?: string;
  nullable?: boolean;
}

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  fields?: SqlField[];
}

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}

interface HanaColumnInfo {
  columnName?: string;
  typeName?: string;
  nullable?: number;
}

interface HanaStatement {
  exec(params: unknown[], callback: (error: Error | null, rows?: unknown) => void): void;
  drop(callback?: (error?: Error | null) => void): void;
  getColumnInfo(): HanaColumnInfo[];
  setTimeout(timeout: number): void;
}

interface HanaConnection {
  prepare(sql: string, callback: (error: Error | null, statement?: HanaStatement) => void): void;
  disconnect(callback?: (error?: Error | null) => void): void;
}

interface HanaPool {
  getConnection(callback: (error: Error | null, connection?: HanaConnection) => void): void;
  clear(callback?: (error?: Error | null) => void): void;
}

interface HanaApi {
  createPool(options: HanaDriverOptions, pool: Record<string, unknown>): HanaPool;
}

const POOL_OPTIONS = {
  maxConnectedOrPooled: 5,
  maxPooledIdleTime: 60,
  pingCheck: false,
};

const STATEMENT_TIMEOUT_MS = 60_000;

function readKey(record: object, key: string): unknown {
  // A module namespace throws when the name is not exported. Treat that as absent.
  try {
    return (record as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function driverApi(moduleValue: unknown): HanaApi {
  if (moduleValue && typeof moduleValue === "object") {
    const named = readKey(moduleValue, "createPool");
    if (typeof named === "function") {
      return { createPool: named as HanaApi["createPool"] };
    }
    const fallback = readKey(moduleValue, "default");
    if (fallback && typeof fallback === "object") {
      const createPool = readKey(fallback, "createPool");
      if (typeof createPool === "function") {
        return { createPool: createPool as HanaApi["createPool"] };
      }
    }
  }
  throw new Error("SAP HANA driver did not load");
}

function loadDriver(): HanaApi {
  return driverApi(hana);
}

function redactSecret(message: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) {
    return message;
  }
  return message.split(secret).join("[redacted]");
}

function redactError(error: unknown, secret: string | undefined): Error {
  const message = error instanceof Error ? error.message : "SAP HANA request failed";
  const wrapped = new Error(redactSecret(message, secret));
  wrapped.name = error instanceof Error ? error.name : "Error";
  return wrapped;
}

function assertBinds(values: unknown[] | undefined): unknown[] {
  const binds = values ?? [];
  if (binds.length > 10_002) {
    throw new QueryValidationError("SAP HANA query has too many parameters");
  }
  return binds.map((value) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new QueryValidationError("SAP HANA filter values must be finite numbers");
      }
      return value;
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new QueryValidationError("SAP HANA filter values must be valid dates");
      }
      return value;
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }
    throw new QueryValidationError(
      "SAP HANA filter values must be scalar values, dates, or binary data",
    );
  });
}

function asRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) {
    throw new Error("SAP HANA query did not return rows");
  }
  return result.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("SAP HANA query returned an invalid row");
    }
    return row as Record<string, unknown>;
  });
}

function readFields(statement: HanaStatement): SqlField[] | undefined {
  try {
    const info = statement.getColumnInfo();
    if (!Array.isArray(info) || info.length === 0) {
      return undefined;
    }
    return info.map((column) => ({
      name: String(column.columnName ?? ""),
      type: column.typeName ? String(column.typeName) : "unknown",
      nullable: Number(column.nullable) !== 0,
    }));
  } catch {
    return undefined;
  }
}

function getConnection(pool: HanaPool): Promise<HanaConnection> {
  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
        return;
      }
      if (!connection) {
        reject(new Error("SAP HANA pool returned no connection"));
        return;
      }
      resolve(connection);
    });
  });
}

function prepare(connection: HanaConnection, sql: string): Promise<HanaStatement> {
  return new Promise((resolve, reject) => {
    connection.prepare(sql, (error, statement) => {
      if (error) {
        reject(error);
        return;
      }
      if (!statement) {
        reject(new Error("SAP HANA did not prepare the statement"));
        return;
      }
      resolve(statement);
    });
  });
}

function exec(statement: HanaStatement, values: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    statement.exec(values, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function drop(statement: HanaStatement): Promise<void> {
  return new Promise((resolve, reject) => {
    statement.drop((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function disconnect(connection: HanaConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.disconnect((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function clearPool(pool: HanaPool): Promise<void> {
  return new Promise((resolve, reject) => {
    pool.clear((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function releaseAll(
  statement: HanaStatement | undefined,
  connection: HanaConnection,
): Promise<void> {
  let first: unknown;
  if (statement) {
    try {
      await drop(statement);
    } catch (error) {
      first = error;
    }
  }
  try {
    await disconnect(connection);
  } catch (error) {
    first ??= error;
  }
  if (first) {
    throw first;
  }
}

export function createHanaClient(session: HanaSession): SqlClient {
  const driver = loadDriver();
  const pool = driver.createPool(hanaDriverOptions(session), { ...POOL_OPTIONS });
  let closed = false;

  return {
    async query(text, values) {
      if (closed) {
        throw new Error("SAP HANA connection is closed");
      }
      const binds = assertBinds(values);
      let connection: HanaConnection;
      try {
        connection = await getConnection(pool);
      } catch (error) {
        throw redactError(error, session.password);
      }
      let statement: HanaStatement | undefined;
      let released = false;
      const releaseOnce = async () => {
        if (released) {
          return;
        }
        released = true;
        await releaseAll(statement, connection);
      };
      try {
        statement = await prepare(connection, text);
        statement.setTimeout(STATEMENT_TIMEOUT_MS);
        const fields = readFields(statement);
        const rows = asRows(await exec(statement, binds));
        await releaseOnce();
        return { rows, ...(fields ? { fields } : {}) };
      } catch (error) {
        try {
          await releaseOnce();
        } catch {
          // Keep the query error. The release error is secondary.
        }
        throw redactError(error, session.password);
      }
    },
    async end() {
      if (closed) {
        return;
      }
      closed = true;
      await clearPool(pool);
    },
  };
}
