import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type DocumentDbConnectionConfig,
  QueryValidationError,
} from "@dash/core";
import {
  MongoClient,
  type Document,
  type Filter,
  type Sort,
} from "mongodb";
import { documentDbSecrets, resolveDocumentDbTarget } from "./connection.ts";
import { compileFind, inferColumns, isListedCollection, resolveCollection } from "./query.ts";

const SAMPLE_DOCUMENTS = 50;
const MAX_COLLECTIONS = 200;

export function scrubSecrets(message: string, secrets: readonly string[]): string {
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 3))];
  unique.sort((left, right) => right.length - left.length);
  let text = message;
  for (const secret of unique) {
    text = text.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && encoded.length >= 3) {
      text = text.split(encoded).join("[redacted]");
    }
  }
  return text.slice(0, 500);
}

function plainRecord(): Record<string, unknown> {
  return {};
}

function assignPlain(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry));
  }
  if (typeof value === "object") {
    const kind = (value as { _bsontype?: unknown })._bsontype;
    const text = (value as { toString?: () => string }).toString;
    if (kind === "ObjectId") {
      const hex = (value as { toHexString?: () => string }).toHexString;
      if (typeof hex === "function") {
        return hex.call(value);
      }
    }
    if (kind === "Double") {
      const rendered = typeof text === "function" ? text.call(value) : String(value);
      const numeric = Number(rendered);
      return Number.isFinite(numeric) ? numeric : rendered;
    }
    if (kind === "Decimal128" || kind === "Long" || kind === "Int32" || kind === "Timestamp") {
      const rendered = typeof text === "function" ? text.call(value) : String(value);
      if (kind === "Decimal128" && !/^-?\d+$/.test(rendered)) {
        return rendered;
      }
      if (/^-?\d+$/.test(rendered)) {
        const numeric = Number(rendered);
        if (Number.isSafeInteger(numeric) && String(numeric) === rendered) {
          return numeric;
        }
      }
      return rendered;
    }
    if (typeof kind === "string" && kind !== "Object" && typeof text === "function") {
      const rendered = text.call(value);
      if (rendered !== "[object Object]") {
        return rendered;
      }
    }
    const output = plainRecord();
    for (const key of Object.keys(value as Record<string, unknown>)) {
      assignPlain(output, key, toPlain((value as Record<string, unknown>)[key]));
    }
    return output;
  }
  return String(value);
}

function columnsFor(
  rows: Record<string, unknown>[],
  requested: string[] | undefined,
): AdapterQueryResult["columns"] {
  const names =
    requested && requested.length > 0
      ? requested
      : rows.reduce<string[]>((collected, row) => {
          for (const key of Object.keys(row)) {
            if (!collected.includes(key)) {
              collected.push(key);
            }
          }
          return collected;
        }, []);
  return names.map((name) => ({ name, type: "unknown", nullable: true }));
}

export class DocumentDbAdapter implements DataAdapter {
  readonly kind = "documentdb" as const;
  #client: MongoClient;
  #database: string;
  #secrets: readonly string[];
  #columnTypes = new Map<string, Map<string, string>>();

  constructor(client: MongoClient, database: string, secrets: readonly string[] = []) {
    this.#client = client;
    this.#database = database;
    this.#secrets = secrets;
  }

  static fromConfig(config: DocumentDbConnectionConfig): DocumentDbAdapter {
    const target = resolveDocumentDbTarget(config);
    return new DocumentDbAdapter(
      new MongoClient(target.uri, target.options),
      target.database,
      documentDbSecrets(config),
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#client.db(this.#database).command({ ping: 1 });
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to Amazon DocumentDB.",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: scrubSecrets(
          error instanceof Error ? error.message : "Connection failed.",
          this.#secrets,
        ),
      };
    }
  }

  async introspectSchema(): Promise<AdapterSchema> {
    try {
      const database = this.#client.db(this.#database);
      const listed = await database.listCollections({}, { nameOnly: false }).toArray();
      const selected = listed
        .filter((entry) => isListedCollection(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MAX_COLLECTIONS);
      const resources: AdapterSchema["resources"] = [];
      for (const entry of selected) {
        const documents = await database
          .collection(entry.name)
          .find({}, { limit: SAMPLE_DOCUMENTS })
          .toArray();
        const columns = inferColumns(documents as Record<string, unknown>[]);
        this.#columnTypes.set(
          entry.name,
          new Map(columns.map((column) => [column.name, column.type])),
        );
        resources.push({
          name: entry.name,
          namespace: this.#database,
          kind: entry.type === "view" ? "view" : "collection",
          columns,
        });
      }
      return { kind: "documentdb", resources };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    try {
      const database = this.#client.db(this.#database);
      let literalCollectionExists = false;
      const stripped = resolveCollection(input.resource, this.#database);
      if (stripped !== input.resource) {
        const cursor = database.listCollections({ name: input.resource }, { nameOnly: true });
        try {
          literalCollectionExists = await cursor.hasNext();
        } finally {
          await cursor.close();
        }
      }
      const compiled = compileFind(input, this.#database, {
        columnTypes: this.#columnTypes,
        literalCollectionExists,
      });
      const documents = await database
        .collection(compiled.collection)
        .find(compiled.filter as Filter<Document>, {
          projection: compiled.projection,
          sort: compiled.sort as Sort | undefined,
          limit: compiled.limit,
          skip: compiled.skip,
        })
        .toArray();
      const rows = documents.map((document) => toPlain(document) as Record<string, unknown>);
      return {
        columns: columnsFor(rows, input.columns),
        rows,
        rowCount: rows.length,
        truncated: rows.length === compiled.limit,
      };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  #publicError(error: unknown): Error {
    if (error instanceof QueryValidationError) {
      return error;
    }
    return new Error(
      scrubSecrets(
        error instanceof Error ? error.message : "The DocumentDB request failed.",
        this.#secrets,
      ),
    );
  }
}

export function createDocumentDbAdapter(config: DocumentDbConnectionConfig): DocumentDbAdapter {
  return DocumentDbAdapter.fromConfig(config);
}
