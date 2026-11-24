import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type ElasticsearchConnectionConfig,
  QueryValidationError,
} from "@dash/core";
import { elasticsearchSession, type ElasticsearchSession } from "./connection.ts";
import { elasticsearchRequest, scrub } from "./http.ts";
import { columnsFromProperties, compileSearch, isListedIndex } from "./query.ts";

const MAX_RESOURCES = 200;
const MAX_MAPPING_BATCH = 40;
const MAX_MAPPING_PATH = 3_500;
const CAT_INDICES = "/_cat/indices?format=json&h=index&expand_wildcards=open";
const CAT_ALIASES = "/_cat/aliases?format=json&h=alias,index&expand_wildcards=open,hidden";

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
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry));
  }
  if (typeof value === "object") {
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
  const names: string[] = [];
  if (requested && requested.length > 0) {
    names.push(...requested);
  } else {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        names.push(key);
      }
    }
  }
  const types = new Map<string, string>();
  for (const row of rows) {
    for (const name of names) {
      const kind = valueType(row[name]);
      if (!kind) {
        continue;
      }
      const current = types.get(name);
      if (!current) {
        types.set(name, kind);
      } else if (current !== kind) {
        const widened =
          (current === "integer" && kind === "number") || (current === "number" && kind === "integer");
        types.set(name, widened ? "number" : "unknown");
      }
    }
  }
  return names.map((name) => ({ name, type: types.get(name) ?? "unknown", nullable: true }));
}

function valueType(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") {
    return /^-?\d+$/.test(value) && value.length > 15 ? "integer" : "string";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return "unknown";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function propertiesOf(mapping: Record<string, unknown>, index: string): Record<string, unknown> | undefined {
  const entry = mapping[index];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  const mappings = (entry as { mappings?: unknown }).mappings;
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    return undefined;
  }
  const properties = (mappings as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return undefined;
  }
  return properties as Record<string, unknown>;
}

function mergeColumns(groups: ReturnType<typeof columnsFromProperties>[]): AdapterSchema["resources"][number]["columns"] {
  const fields = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const column of group) {
      if (column.name === "_id") {
        continue;
      }
      let types = fields.get(column.name);
      if (!types) {
        types = new Set();
        fields.set(column.name, types);
      }
      types.add(column.type);
    }
  }
  const columns: AdapterSchema["resources"][number]["columns"] = [
    { name: "_id", type: "string", nullable: false },
  ];
  for (const name of [...fields.keys()].sort()) {
    const types = [...(fields.get(name) ?? [])].sort();
    columns.push({
      name,
      type: types.length === 1 ? (types[0] ?? "unknown") : types.join("|"),
      nullable: true,
    });
  }
  return columns;
}

export class ElasticsearchAdapter implements DataAdapter {
  readonly kind = "elasticsearch" as const;
  #session: ElasticsearchSession;
  #fetch: typeof fetch;
  #closed = false;

  constructor(session: ElasticsearchSession, fetchImpl: typeof fetch = fetch) {
    this.#session = session;
    this.#fetch = fetchImpl;
  }

  static fromConfig(config: ElasticsearchConnectionConfig): ElasticsearchAdapter {
    return new ElasticsearchAdapter(elasticsearchSession(config));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    if (this.#closed) {
      return { ok: false, latencyMs: 0, message: "Elasticsearch client is closed" };
    }
    try {
      const payload = await elasticsearchRequest(this.#session, "/", {
        method: "GET",
        fetchImpl: this.#fetch,
      });
      const tagline =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as { tagline?: unknown }).tagline
          : undefined;
      if (tagline !== "You Know, for Search") {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: "Elasticsearch returned an unexpected response",
        };
      }
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to Elasticsearch",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: this.#publicMessage(error),
      };
    }
  }

  async introspectSchema(): Promise<AdapterSchema> {
    this.#assertOpen();
    try {
      const [indicesBody, aliasesBody] = await Promise.all([
        elasticsearchRequest(this.#session, CAT_INDICES, { method: "GET", fetchImpl: this.#fetch }),
        elasticsearchRequest(this.#session, CAT_ALIASES, { method: "GET", fetchImpl: this.#fetch }),
      ]);
      const indices = records(indicesBody, "index list");
      const aliases = records(aliasesBody, "alias list");
      const indexNames = new Set<string>();
      for (const entry of indices) {
        const name = stringField(entry, "index");
        if (name && isListedIndex(name)) {
          indexNames.add(name);
        }
      }
      const aliasTargets = new Map<string, string[]>();
      for (const entry of aliases) {
        const alias = stringField(entry, "alias");
        const index = stringField(entry, "index");
        if (!alias || !index || !isListedIndex(alias) || indexNames.has(alias) || !isListedIndex(index)) {
          continue;
        }
        const targets = aliasTargets.get(alias) ?? [];
        if (!targets.includes(index)) {
          targets.push(index);
        }
        aliasTargets.set(alias, targets);
      }
      const selected = [...indexNames, ...aliasTargets.keys()]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, MAX_RESOURCES);
      const needed = new Set<string>();
      for (const name of selected) {
        if (indexNames.has(name)) {
          needed.add(name);
          continue;
        }
        for (const target of aliasTargets.get(name) ?? []) {
          needed.add(target);
        }
      }
      const mapping = plainRecord();
      const bodies = await Promise.all(
        mappingPaths([...needed].sort()).map((path) =>
          elasticsearchRequest(this.#session, path, { method: "GET", fetchImpl: this.#fetch }),
        ),
      );
      for (const body of bodies) {
        readMapping(body, mapping);
      }
      const resources: AdapterSchema["resources"] = [];
      for (const name of selected) {
        if (indexNames.has(name)) {
          resources.push({
            name,
            kind: "collection",
            columns: columnsFromProperties(propertiesOf(mapping, name)),
          });
          continue;
        }
        resources.push({
          name,
          kind: "view",
          columns: mergeColumns(
            (aliasTargets.get(name) ?? []).map((target) =>
              columnsFromProperties(propertiesOf(mapping, target)),
            ),
          ),
        });
      }
      return { kind: "elasticsearch", resources };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    this.#assertOpen();
    try {
      const compiled = compileSearch(input);
      const payload = await elasticsearchRequest(this.#session, `/${compiled.index}/_search`, {
        method: "POST",
        body: compiled.body,
        fetchImpl: this.#fetch,
      });
      const hits = readHits(payload);
      const page =
        compiled.lookAhead && hits.length > compiled.limit ? hits.slice(0, compiled.limit) : hits;
      const requested = input.columns;
      const projected =
        requested && requested.length > 0 ? requested.filter((name) => name !== "_id") : undefined;
      const includeId = !requested || requested.length === 0 || requested.includes("_id");
      const rows = page.map((hit) => this.#row(hit, includeId, projected));
      return {
        columns: columnsFor(rows, requested),
        rows,
        rowCount: rows.length,
        truncated: compiled.lookAhead ? hits.length > compiled.limit : rows.length === compiled.limit,
      };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  #row(
    hit: Record<string, unknown>,
    includeId: boolean,
    projected: string[] | undefined,
  ): Record<string, unknown> {
    const sourceValue = hit._source;
    const source =
      sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
        ? (sourceValue as Record<string, unknown>)
        : {};
    const row = plainRecord();
    if (includeId) {
      assignPlain(row, "_id", typeof hit._id === "string" ? hit._id : null);
    }
    if (projected) {
      for (const name of projected) {
        row[name] = toPlain(source[name]);
      }
      return row;
    }
    for (const name of Object.keys(source)) {
      assignPlain(row, name, toPlain(source[name]));
    }
    return row;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("Elasticsearch client is closed");
    }
  }

  #publicMessage(error: unknown): string {
    return scrub(error instanceof Error ? error.message : "Elasticsearch request failed", this.#session.secrets);
  }

  #publicError(error: unknown): Error {
    if (error instanceof QueryValidationError) {
      return error;
    }
    return new Error(this.#publicMessage(error));
  }
}

function mappingPaths(names: readonly string[]): string[] {
  const paths: string[] = [];
  let batch: string[] = [];
  for (const name of names) {
    if (!isListedIndex(name)) {
      throw new Error("Elasticsearch request failed");
    }
    const candidate = batch.length === 0 ? [name] : [...batch, name];
    const path = `/${candidate.join(",")}/_mapping`;
    if (batch.length > 0 && (batch.length >= MAX_MAPPING_BATCH || path.length > MAX_MAPPING_PATH)) {
      paths.push(`/${batch.join(",")}/_mapping`);
      batch = [name];
      continue;
    }
    batch = candidate;
  }
  if (batch.length > 0) {
    paths.push(`/${batch.join(",")}/_mapping`);
  }
  return paths;
}

function readMapping(body: unknown, into: Record<string, unknown>): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Elasticsearch returned an unexpected mapping");
  }
  for (const key of Object.keys(body)) {
    if (!isListedIndex(key)) {
      continue;
    }
    assignPlain(into, key, (body as Record<string, unknown>)[key]);
  }
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`Elasticsearch returned an unexpected ${label}`);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Elasticsearch returned an unexpected ${label}`);
    }
    return entry as Record<string, unknown>;
  });
}

function readHits(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Elasticsearch returned an unexpected response");
  }
  const hits = (payload as { hits?: unknown }).hits;
  if (!hits || typeof hits !== "object" || Array.isArray(hits)) {
    throw new Error("Elasticsearch returned an unexpected response");
  }
  const rows = (hits as { hits?: unknown }).hits;
  if (!Array.isArray(rows)) {
    throw new Error("Elasticsearch returned an unexpected response");
  }
  return rows.map((hit) => {
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) {
      throw new Error("Elasticsearch returned an unexpected response");
    }
    return hit as Record<string, unknown>;
  });
}

export function createElasticsearchAdapter(config: ElasticsearchConnectionConfig): ElasticsearchAdapter {
  return ElasticsearchAdapter.fromConfig(config);
}
