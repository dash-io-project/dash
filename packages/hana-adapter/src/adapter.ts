import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type HanaConnectionConfig,
} from "@dash/core";
import { createHanaClient, type SqlClient } from "./client.ts";
import { hanaSession } from "./connection.ts";
import { INTROSPECT_SQL, TEST_CONNECTION_SQL, compileSelect } from "./sql.ts";

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

function isNullable(value: unknown): boolean {
  const text = String(value ?? "").toUpperCase();
  return text === "TRUE" || text === "YES" || text === "1";
}

export class HanaAdapter implements DataAdapter {
  readonly kind = "hana" as const;
  #client: SqlClient;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  static fromConfig(config: HanaConnectionConfig): HanaAdapter {
    return new HanaAdapter(createHanaClient(hanaSession(config)));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.query(TEST_CONNECTION_SQL);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to SAP HANA",
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
      const namespace = cell(row, "namespace");
      const name = cell(row, "name");
      const columnName = cell(row, "column_name");
      if (namespace == null || name == null || columnName == null) {
        continue;
      }
      const key = `${String(namespace)}.${String(name)}`;
      let resource = resources.get(key);
      if (!resource) {
        const tableType = String(cell(row, "table_type") ?? "TABLE");
        resource = {
          name: String(name),
          namespace: String(namespace),
          kind: tableType.toUpperCase().includes("VIEW") ? "view" : "table",
          columns: [],
        };
        resources.set(key, resource);
      }
      resource.columns.push({
        name: String(columnName),
        type: String(cell(row, "data_type") ?? "unknown"),
        nullable: isNullable(cell(row, "is_nullable")),
      });
    }
    return { kind: "hana", resources: [...resources.values()] };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const compiled = compileSelect(input);
    const result = await this.#client.query(compiled.text, compiled.values);
    const columns =
      result.fields?.map((field) => ({
        name: field.name,
        type: field.type ?? "unknown",
        nullable: field.nullable ?? true,
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

export function createHanaAdapter(config: HanaConnectionConfig): HanaAdapter {
  return HanaAdapter.fromConfig(config);
}
