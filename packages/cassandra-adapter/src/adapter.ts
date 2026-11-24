import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type CassandraConnectionConfig,
  type ConnectionTestResult,
  type DataAdapter,
} from "@dash/core";
import { Client, type ClientOptions, types } from "cassandra-driver";
import { compileSelect } from "./cql.ts";
import { cassandraSession } from "./connection.ts";
import { columnPosition, normalizeValue } from "./values.ts";

const COLUMNS_CQL = `
SELECT keyspace_name, table_name, column_name, type, kind, position
FROM system_schema.columns
`;

const VIEWS_CQL = `
SELECT keyspace_name, view_name
FROM system_schema.views
`;

const KIND_ORDER: Record<string, number> = {
  partition_key: 0,
  clustering: 1,
  static: 2,
  regular: 3,
};

interface SchemaColumn {
  name: string;
  type: string;
  kind: string;
  position: number;
}

function clientOptions(config: CassandraConnectionConfig): ClientOptions {
  const session = cassandraSession(config);
  const options: ClientOptions = {
    contactPoints: session.contactPoints,
    localDataCenter: session.localDataCenter,
    protocolOptions: { port: session.port },
    socketOptions: { connectTimeout: 10_000, readTimeout: 30_000 },
    queryOptions: { prepare: true, isIdempotent: true },
  };
  if (session.keyspace) {
    options.keyspace = session.keyspace;
  }
  if (session.user) {
    options.credentials = { username: session.user, password: session.password ?? "" };
  }
  if (session.ssl) {
    options.sslOptions = { rejectUnauthorized: true };
  }
  return options;
}

function isSystemKeyspace(name: string): boolean {
  const keyspace = name.toLowerCase();
  return keyspace === "system" || keyspace.startsWith("system_");
}

function cell(row: types.Row, name: string): unknown {
  return row.get(name);
}

function toRecord(row: types.Row): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of row.keys()) {
    record[key] = normalizeValue(row.get(key));
  }
  return record;
}

export class CassandraAdapter implements DataAdapter {
  readonly kind = "cassandra" as const;
  #client: Client;
  #closed = false;

  constructor(client: Client) {
    this.#client = client;
  }

  static fromConfig(config: CassandraConnectionConfig): CassandraAdapter {
    return new CassandraAdapter(new Client(clientOptions(config)));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.execute("SELECT release_version FROM system.local", [], { prepare: true });
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to Apache Cassandra",
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
    const [columns, views] = await Promise.all([
      this.#client.execute(COLUMNS_CQL, [], { prepare: true }),
      this.#client.execute(VIEWS_CQL, [], { prepare: true }),
    ]);
    const viewNames = new Set<string>();
    for (const row of views.rows) {
      const namespace = String(cell(row, "keyspace_name"));
      const name = String(cell(row, "view_name"));
      if (isSystemKeyspace(namespace)) {
        continue;
      }
      viewNames.add(`${namespace}.${name}`);
    }
    const grouped = new Map<string, { namespace: string; name: string; columns: SchemaColumn[] }>();
    for (const row of columns.rows) {
      const namespace = String(cell(row, "keyspace_name"));
      const name = String(cell(row, "table_name"));
      if (isSystemKeyspace(namespace)) {
        continue;
      }
      const key = `${namespace}.${name}`;
      let resource = grouped.get(key);
      if (!resource) {
        resource = { namespace, name, columns: [] };
        grouped.set(key, resource);
      }
      resource.columns.push({
        name: String(cell(row, "column_name")),
        type: String(cell(row, "type")),
        kind: String(cell(row, "kind")),
        position: columnPosition(cell(row, "position")),
      });
    }
    const resources = [...grouped.values()]
      .map((resource) => {
        const columns = [...resource.columns].sort((left, right) => {
          const kind = (KIND_ORDER[left.kind] ?? 9) - (KIND_ORDER[right.kind] ?? 9);
          if (kind !== 0) {
            return kind;
          }
          if (left.position !== right.position) {
            return left.position - right.position;
          }
          return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
        });
        return {
          name: resource.name,
          namespace: resource.namespace,
          kind: viewNames.has(`${resource.namespace}.${resource.name}`)
            ? ("view" as const)
            : ("table" as const),
          columns: columns.map((column) => ({
            name: column.name,
            type: column.type,
            nullable: column.kind !== "partition_key" && column.kind !== "clustering",
          })),
        };
      })
      .sort((left, right) => {
        const namespace = left.namespace.localeCompare(right.namespace);
        if (namespace !== 0) {
          return namespace;
        }
        return left.name.localeCompare(right.name);
      });
    return { kind: "cassandra", resources };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const compiled = compileSelect(input);
    // CQL has no OFFSET. Read offset + limit rows, then return the page.
    const result = await this.#client.execute(compiled.text, compiled.values, {
      prepare: true,
      fetchSize: compiled.offset + compiled.limit,
      autoPage: true,
      isIdempotent: true,
    });
    const rows = result.rows
      .slice(compiled.offset, compiled.offset + compiled.limit)
      .map((row) => toRecord(row));
    const columns =
      result.columns && result.columns.length > 0
        ? result.columns.map((column) => ({
            name: column.name,
            type: "unknown",
            nullable: true,
          }))
        : rows[0]
          ? Object.keys(rows[0]).map((name) => ({
              name,
              type: "unknown",
              nullable: true,
            }))
          : [];
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length === compiled.limit,
    };
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#client.shutdown();
  }
}

export function createCassandraAdapter(config: CassandraConnectionConfig): CassandraAdapter {
  return CassandraAdapter.fromConfig(config);
}
