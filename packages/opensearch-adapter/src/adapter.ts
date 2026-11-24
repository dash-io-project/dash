import {
  type AdapterColumn,
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type OpenSearchConnectionConfig,
  QueryValidationError,
} from "@dash/core";
import { type API, type Client } from "@opensearch-project/opensearch";
import {
  createOpenSearchClient,
  openSearchSecrets,
  openSearchSession,
  scrubSecrets,
  type OpenSearchSession,
} from "./connection.ts";
import { compileSearch, type FieldTarget } from "./query.ts";

const MAX_INDICES = 200;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const BANNED = new Set(["__proto__", "constructor", "prototype"]);

interface FieldMeta {
  type: string;
  keyword: boolean;
}

interface SearchHit {
  _id?: unknown;
  _source?: unknown;
}

function isSafeColumn(name: string): boolean {
  return IDENTIFIER.test(name) && !BANNED.has(name) && (!name.startsWith("_") || name === "_id");
}

export function fieldsFromMapping(body: unknown): Map<string, FieldMeta> {
  const fields = new Map<string, FieldMeta>();
  if (!body || typeof body !== "object") {
    return fields;
  }
  for (const entry of Object.values(body as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const properties = (entry as { mappings?: { properties?: unknown } }).mappings?.properties;
    if (!properties || typeof properties !== "object") {
      continue;
    }
    for (const [name, spec] of Object.entries(properties as Record<string, unknown>)) {
      if (!isSafeColumn(name) || !spec || typeof spec !== "object") {
        continue;
      }
      const type = (spec as { type?: unknown }).type;
      if (typeof type !== "string" || type.length === 0 || type === "object" || type === "nested") {
        continue;
      }
      const keyword = (spec as { fields?: { keyword?: { type?: unknown } } }).fields?.keyword?.type === "keyword";
      fields.set(name, { type, keyword });
    }
  }
  return fields;
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
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry));
  }
  if (typeof value === "object") {
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (BANNED.has(key)) {
        continue;
      }
      output[key] = toPlain((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return null;
}

function readHits(body: unknown): SearchHit[] {
  if (!body || typeof body !== "object") {
    throw new Error("OpenSearch search response is invalid");
  }
  const hits = (body as { hits?: { hits?: unknown } }).hits?.hits;
  if (!Array.isArray(hits)) {
    throw new Error("OpenSearch search response is invalid");
  }
  return hits as SearchHit[];
}

function sourceRecord(value: unknown): Record<string, unknown> {
  const plain = toPlain(value);
  if (!plain || typeof plain !== "object" || Array.isArray(plain)) {
    return Object.create(null) as Record<string, unknown>;
  }
  return plain as Record<string, unknown>;
}

function rowFromHit(hit: SearchHit, columns: string[] | undefined): Record<string, unknown> {
  const source = sourceRecord(hit._source);
  const names =
    columns && columns.length > 0
      ? columns
      : ["_id", ...Object.keys(source).filter((key) => isSafeColumn(key) && key !== "_id")];
  const row = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    if (name === "_id") {
      row._id = typeof hit._id === "string" ? hit._id : null;
      continue;
    }
    row[name] = Object.hasOwn(source, name) ? source[name] : null;
  }
  return row;
}

function columnType(name: string, rows: Record<string, unknown>[], fields: Map<string, FieldMeta>): string {
  if (name === "_id") {
    return "keyword";
  }
  const mapped = fields.get(name);
  if (mapped) {
    return mapped.type;
  }
  for (const row of rows) {
    const value = row[name];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return typeof value;
    }
    if (Array.isArray(value)) {
      return "array";
    }
    return "object";
  }
  return "unknown";
}

function columnsFor(
  rows: Record<string, unknown>[],
  requested: string[] | undefined,
  fields: Map<string, FieldMeta>,
): AdapterColumn[] {
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
  return names.map((name) => ({
    name,
    type: columnType(name, rows, fields),
    nullable: true,
  }));
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { meta?: { statusCode?: unknown } }).meta?.statusCode;
  return typeof status === "number" ? status : undefined;
}

function readReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return "OpenSearch request failed";
  }
  const body = (error as { meta?: { body?: unknown } }).meta?.body;
  if (typeof body === "string" && body.trim()) {
    return body;
  }
  if (body && typeof body === "object") {
    const reason = (body as { error?: { reason?: unknown } | string }).error;
    if (typeof reason === "string" && reason.trim()) {
      return reason;
    }
    if (reason && typeof reason === "object") {
      const text = (reason as { reason?: unknown }).reason;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }
  return error.message || "OpenSearch request failed";
}

export class OpenSearchAdapter implements DataAdapter {
  readonly kind = "opensearch" as const;
  #client: Client;
  #session: OpenSearchSession;
  #secrets: readonly string[];
  #fields = new Map<string, Map<string, FieldMeta>>();
  #closed = false;

  constructor(client: Client, session: OpenSearchSession, secrets: readonly string[]) {
    this.#client = client;
    this.#session = session;
    this.#secrets = secrets;
  }

  static fromConfig(config: OpenSearchConnectionConfig): OpenSearchAdapter {
    const session = openSearchSession(config);
    return new OpenSearchAdapter(createOpenSearchClient(session), session, openSearchSecrets(config));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      if (this.#session.service === "aoss") {
        const response = await this.#client.transport.request({
          method: "POST",
          path: "/_search",
          body: { size: 0 },
        });
        const status = response.statusCode;
        if (status !== null && status >= 300) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            message: "OpenSearch ping failed",
          };
        }
      } else {
        const response = await this.#client.ping();
        const status = response.statusCode;
        if (response.body === false || (status !== null && status >= 300)) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            message: "OpenSearch ping failed",
          };
        }
      }
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to OpenSearch",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: this.#message(error),
      };
    }
  }

  async introspectSchema(): Promise<AdapterSchema> {
    try {
      const response = await this.#client.indices.getMapping({ index: "*", expand_wildcards: "open" });
      return { kind: "opensearch", resources: this.#resourcesFrom(response.body) };
    } catch (error) {
      if (statusOf(error) === 404) {
        return { kind: "opensearch", resources: [] };
      }
      throw this.#publicError(error);
    }
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    try {
      const preview = compileSearch(input);
      const fields = await this.#fieldsFor(preview.index);
      const target: FieldTarget = (field) => (fields.get(field)?.keyword ? `${field}.keyword` : field);
      const compiled = compileSearch(input, target);
      const response = await this.#client.search({
        index: compiled.index,
        body: compiled.body as API.Search_RequestBody,
      });
      const rows = readHits(response.body).map((hit) => rowFromHit(hit, input.columns));
      return {
        columns: columnsFor(rows, input.columns, fields),
        rows,
        rowCount: rows.length,
        truncated: rows.length === compiled.body.size,
      };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#client.close();
  }

  async #fieldsFor(index: string): Promise<Map<string, FieldMeta>> {
    const cached = this.#fields.get(index);
    if (cached) {
      return cached;
    }
    try {
      const response = await this.#client.indices.getMapping({ index });
      const fields = fieldsFromMapping(response.body);
      this.#fields.set(index, fields);
      return fields;
    } catch (error) {
      if (statusOf(error) === 404) {
        return new Map();
      }
      throw error;
    }
  }

  #resourcesFrom(body: unknown): AdapterSchema["resources"] {
    if (!body || typeof body !== "object") {
      return [];
    }
    const names = Object.keys(body as Record<string, unknown>)
      .filter((name) => !name.startsWith(".") && /^[a-z][a-z0-9_-]{0,254}$/.test(name))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_INDICES);
    const resources: AdapterSchema["resources"] = [];
    for (const name of names) {
      const entry = (body as Record<string, unknown>)[name];
      const fields = fieldsFromMapping({ [name]: entry });
      this.#fields.set(name, fields);
      resources.push({
        name,
        kind: "table",
        columns: [...fields.entries()].map(([column, meta]) => ({
          name: column,
          type: meta.type,
          nullable: true,
        })),
      });
    }
    return resources;
  }

  #message(error: unknown): string {
    return scrubSecrets(readReason(error), this.#secrets);
  }

  #publicError(error: unknown): Error {
    if (error instanceof QueryValidationError) {
      return error;
    }
    return new Error(this.#message(error));
  }
}

export function createOpenSearchAdapter(config: OpenSearchConnectionConfig): OpenSearchAdapter {
  return OpenSearchAdapter.fromConfig(config);
}
