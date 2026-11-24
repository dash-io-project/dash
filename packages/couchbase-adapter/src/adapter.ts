import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type CouchbaseConnectionConfig,
  type DataAdapter,
  QueryValidationError,
  assertIdentifier,
} from "@dash/core";
import { connect, type Cluster } from "couchbase";
import {
  couchbaseErrorMessage,
  couchbaseTarget,
  scrubSecrets,
  type CouchbaseTarget,
} from "./connection.ts";
import { inferColumns, queryColumns, recordRows } from "./schema.ts";
import { compileSelect, quoteIdent } from "./sql.ts";

const SAMPLE_ROWS = 50;
const MAX_COLLECTIONS = 200;
const QUERY_TIMEOUT_MS = 10_000;

interface QueryRows {
  rows: Record<string, unknown>[];
  signature: unknown;
}

export class CouchbaseAdapter implements DataAdapter {
  readonly kind = "couchbase" as const;
  #target: CouchbaseTarget;
  #opening: Promise<Cluster> | undefined;
  #closed = false;

  constructor(target: CouchbaseTarget) {
    this.#target = target;
  }

  static fromConfig(config: CouchbaseConnectionConfig): CouchbaseAdapter {
    return new CouchbaseAdapter(couchbaseTarget(config));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#run("SELECT 1 AS ok", []);
      const found = await this.#run(
        "SELECT b.`name` AS name FROM system:buckets AS b WHERE b.`name` = $1 LIMIT 1",
        [this.#target.bucket],
      );
      if (found.rows.length === 0) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: "Couchbase bucket was not found",
        };
      }
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to Couchbase",
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
    const listed = await this.#run(
      "SELECT k.`name` AS name, k.`scope` AS ns FROM system:keyspaces AS k WHERE k.`bucket` = $1 AND k.`namespace_id` = $2",
      [this.#target.bucket, "default"],
    );
    const resources: AdapterSchema["resources"] = [];
    const seen = new Set<string>();
    for (const row of listed.rows) {
      if (resources.length >= MAX_COLLECTIONS) {
        break;
      }
      const name = typeof row.name === "string" ? row.name : "";
      const namespace = typeof row.ns === "string" ? row.ns : "";
      if (!safeIdent(name) || !safeIdent(namespace)) {
        continue;
      }
      const key = `${namespace}.${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const sample = await this.#run(
        `SELECT d.* FROM ${quoteIdent(this.#target.bucket)}.${quoteIdent(namespace)}.${quoteIdent(name)} AS d LIMIT $1`,
        [SAMPLE_ROWS],
      );
      resources.push({
        name,
        namespace,
        kind: "collection",
        columns: inferColumns(sample.rows),
      });
    }
    resources.sort((left, right) => {
      const scope = (left.namespace ?? "").localeCompare(right.namespace ?? "");
      return scope || left.name.localeCompare(right.name);
    });
    return { kind: "couchbase", resources };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const compiled = compileSelect(input, {
      bucket: this.#target.bucket,
      scope: this.#target.scope,
    });
    const result = await this.#run(compiled.text, compiled.values);
    return {
      columns: queryColumns(result.rows, result.signature, input.columns),
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.rows.length === compiled.limit,
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    const opening = this.#opening;
    this.#opening = undefined;
    if (!opening) {
      return;
    }
    try {
      const cluster = await opening;
      await cluster.close();
    } catch {
      // Connect failed, so there is no cluster to close.
    }
  }

  async #open(): Promise<Cluster> {
    if (this.#closed) {
      throw new Error("Couchbase adapter is closed");
    }
    if (!this.#opening) {
      let slot: Promise<Cluster>;
      slot = connect(this.#target.connectionString, {
        username: this.#target.user,
        password: this.#target.password,
        timeouts: {
          connectTimeout: QUERY_TIMEOUT_MS,
          bootstrapTimeout: QUERY_TIMEOUT_MS,
          kvTimeout: QUERY_TIMEOUT_MS,
          queryTimeout: QUERY_TIMEOUT_MS,
        },
      }).then(
        (cluster) => cluster,
        (error: unknown) => {
          if (this.#opening === slot) {
            this.#opening = undefined;
          }
          throw error;
        },
      );
      this.#opening = slot;
    }
    return this.#opening;
  }

  async #run(text: string, values: readonly unknown[]): Promise<QueryRows> {
    let cluster: Cluster;
    try {
      cluster = await this.#open();
    } catch (error) {
      throw this.#wrap(error);
    }
    try {
      const result = await cluster.query(text, {
        parameters: [...values],
        readOnly: true,
        timeout: QUERY_TIMEOUT_MS,
      });
      return {
        rows: recordRows(result.rows),
        signature: result.meta?.signature,
      };
    } catch (error) {
      throw this.#wrap(error);
    }
  }

  #wrap(error: unknown): Error {
    if (error instanceof QueryValidationError) {
      return error;
    }
    return new Error(scrubSecrets(couchbaseErrorMessage(error), [this.#target.password]));
  }
}

function safeIdent(name: string): boolean {
  try {
    assertIdentifier(name, "identifier");
    return true;
  } catch {
    return false;
  }
}

export function createCouchbaseAdapter(config: CouchbaseConnectionConfig): CouchbaseAdapter {
  return CouchbaseAdapter.fromConfig(config);
}
