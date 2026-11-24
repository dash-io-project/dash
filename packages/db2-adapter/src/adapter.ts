import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type Db2ConnectionConfig,
} from "@dash/core";
import { db2Session } from "./connection.ts";
import { createDb2Client, type SqlClient, type SqlQueryResult } from "./driver.ts";
import { INTROSPECT_SQL, compileSelect } from "./sql.ts";

const INTROSPECT_CAP = 10_000;

function columnsFor(
  fields: SqlQueryResult["fields"],
  rows: Record<string, unknown>[],
): AdapterQueryResult["columns"] {
  const listed = (fields ?? []).filter((field) => field.name.trim() !== "");
  if (listed.length > 0) {
    return listed.map((field) => ({
      name: field.name.trim(),
      type: field.type && field.type.trim() !== "" ? field.type.trim() : "unknown",
      nullable: true,
    }));
  }
  const first = rows[0];
  if (!first) {
    return [];
  }
  return Object.keys(first).map((name) => ({
    name,
    type: "unknown",
    nullable: true,
  }));
}

function cell(row: Record<string, unknown>, key: string): unknown {
  if (key in row) {
    return row[key];
  }
  const upper = key.toUpperCase();
  if (upper in row) {
    return row[upper];
  }
  return undefined;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = cell(row, key);
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

export class Db2Adapter implements DataAdapter {
  readonly kind = "db2" as const;
  #client: SqlClient;
  #schema?: string;

  constructor(client: SqlClient, schema?: string) {
    this.#client = client;
    this.#schema = schema;
  }

  static fromConfig(config: Db2ConnectionConfig): Db2Adapter {
    const session = db2Session(config);
    return new Db2Adapter(createDb2Client(session), session.schema);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.query('SELECT 1 AS "ok" FROM SYSIBM.SYSDUMMY1');
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to IBM Db2",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error && error.message ? error.message : "Connection failed",
      };
    }
  }

  async introspectSchema(): Promise<AdapterSchema> {
    const result = await this.#client.query(INTROSPECT_SQL);
    if (result.rows.length > INTROSPECT_CAP) {
      throw new Error("Db2 schema introspection exceeded 10000 columns");
    }
    const resources = new Map<string, AdapterSchema["resources"][number]>();
    for (const row of result.rows) {
      const namespace = text(row, "namespace");
      const name = text(row, "name");
      const columnName = text(row, "column_name");
      if (!namespace || !name || !columnName) {
        continue;
      }
      const key = `${namespace}.${name}`;
      let resource = resources.get(key);
      if (!resource) {
        const tableType = text(row, "table_type").toUpperCase();
        resource = {
          name,
          namespace,
          kind: tableType === "V" || tableType === "VIEW" ? "view" : "table",
          columns: [],
        };
        resources.set(key, resource);
      }
      const nullable = text(row, "is_nullable").toUpperCase();
      resource.columns.push({
        name: columnName,
        type: text(row, "data_type"),
        nullable: nullable === "Y" || nullable === "YES",
      });
    }
    return { kind: "db2", resources: [...resources.values()] };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const compiled = compileSelect(input, this.#schema);
    const result = await this.#client.query(compiled.text, compiled.values);
    const rows =
      result.rows.length > compiled.limit ? result.rows.slice(0, compiled.limit) : result.rows;
    return {
      columns: columnsFor(result.fields, rows),
      rows,
      rowCount: rows.length,
      truncated: result.rows.length >= compiled.limit,
    };
  }

  async close(): Promise<void> {
    await this.#client.end();
  }
}

export function createDb2Adapter(config: Db2ConnectionConfig): Db2Adapter {
  return Db2Adapter.fromConfig(config);
}
