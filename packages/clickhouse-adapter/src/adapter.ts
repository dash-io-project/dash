import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ClickHouseConnectionConfig,
  type ConnectionTestResult,
  type DataAdapter,
  normalizeAdapterQuery,
} from "@dash/core";
import { clickhouseEndpoint, clickhouseSession } from "./connection.ts";
import { compileSelect, introspectQuery } from "./sql.ts";

const QUERY_TIMEOUT_MS = 60_000;
const MAX_PAGE = 10_000;
const INTROSPECT_CAP = 10_000;

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  columns?: Array<{ name: string; type: string }>;
}

export interface SqlClient {
  query(text: string, params?: Record<string, string | number | boolean>): Promise<SqlQueryResult>;
  close(): Promise<void>;
}

function columnNullable(type: string): boolean {
  let current = type.trim();
  for (let depth = 0; depth < 4; depth += 1) {
    if (current.startsWith("LowCardinality(") && current.endsWith(")")) {
      current = current.slice("LowCardinality(".length, -1).trim();
      continue;
    }
    const aggregate = /^SimpleAggregateFunction\([^,]+,\s*([\s\S]*)\)$/.exec(current);
    if (aggregate?.[1]) {
      current = aggregate[1].trim();
      continue;
    }
    break;
  }
  return current.startsWith("Nullable(");
}

function isView(engine: string): boolean {
  return engine.toLowerCase().includes("view");
}

function wrapClient(client: ClickHouseClient): SqlClient {
  // The HTTP client opens a new socket after close. This flag blocks a later call.
  let closed = false;
  return {
    async query(text, params) {
      if (closed) {
        throw new Error("ClickHouse connection is closed");
      }
      const result = await client.query({
        query: text,
        ...(params && Object.keys(params).length > 0 ? { query_params: params } : {}),
        format: "JSON",
      });
      const payload = await result.json<Record<string, unknown>>();
      const rows = payload.data;
      const columns = payload.meta?.map((column) => ({
        name: column.name,
        type: column.type,
      }));
      return { rows, ...(columns ? { columns } : {}) };
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await client.close();
    },
  };
}

function clientFromSession(session: ReturnType<typeof clickhouseSession>): ClickHouseClient {
  return createClient({
    url: clickhouseEndpoint(session),
    username: session.user,
    password: session.password ?? "",
    database: session.database,
    application: "dash",
    request_timeout: QUERY_TIMEOUT_MS,
    clickhouse_settings: {
      readonly: "1",
      max_execution_time: 60,
      cancel_http_readonly_queries_on_client_close: 1,
    },
  });
}

export class ClickHouseAdapter implements DataAdapter {
  readonly kind = "clickhouse" as const;
  #client: SqlClient;
  #database: string;

  constructor(client: SqlClient, database: string) {
    this.#client = client;
    this.#database = database;
  }

  static fromConfig(config: ClickHouseConnectionConfig): ClickHouseAdapter {
    const session = clickhouseSession(config);
    return new ClickHouseAdapter(wrapClient(clientFromSession(session)), session.database);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.query("SELECT 1 AS ok");
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to ClickHouse",
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
    const introspection = introspectQuery(this.#database);
    const result = await this.#client.query(introspection.text, introspection.params);
    if (result.rows.length > INTROSPECT_CAP) {
      throw new Error("ClickHouse schema introspection exceeded 10000 columns");
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
          kind: isView(String(row.table_type ?? "")) ? "view" : "table",
          columns: [],
        };
        resources.set(key, resource);
      }
      const type = String(row.data_type);
      resource.columns.push({
        name: String(row.column_name),
        type,
        nullable: columnNullable(type),
      });
    }
    return { kind: "clickhouse", resources: [...resources.values()] };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const normalized = normalizeAdapterQuery(input);
    const limit = normalized.limit ?? MAX_PAGE;
    const compiled = compileSelect(
      {
        ...input,
        limit,
        offset: normalized.offset,
      },
      { database: this.#database, extraRow: true },
    );
    const result = await this.#client.query(compiled.text, compiled.params);
    const extra = result.rows.length > limit;
    const rows = extra ? result.rows.slice(0, limit) : result.rows;
    const columns =
      result.columns?.map((column) => ({
        name: column.name,
        type: column.type,
        nullable: columnNullable(column.type),
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
      truncated: extra,
    };
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export function createClickHouseAdapter(config: ClickHouseConnectionConfig): ClickHouseAdapter {
  return ClickHouseAdapter.fromConfig(config);
}
