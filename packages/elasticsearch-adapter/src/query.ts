import {
  type AdapterColumn,
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  normalizeAdapterQuery,
} from "@dash/core";

export interface CompiledSearch {
  index: string;
  body: Record<string, unknown>;
  /** Rows returned to the caller. `body.size` may be one larger. */
  limit: number;
  /** True when the search reads one extra hit so an exact page is not marked truncated. */
  lookAhead: boolean;
}

const MAX_STRING = 10_000;
const MAX_IN = 100;
const MAX_LIKE = 200;
const MAX_WINDOW = 10_000;
const INDEX_NAME = /^[a-z][a-z0-9_-]{0,254}$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function emptyRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function assertField(name: string): void {
  if (BANNED_KEYS.has(name) || (name.startsWith("_") && name !== "_id")) {
    throw new QueryValidationError(`Invalid column: ${name}`);
  }
}

function assertScalar(value: unknown, label: string): string | number | boolean | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING) {
      throw new QueryValidationError(`${label} is too long`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new QueryValidationError(`${label} must be a finite number`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new QueryValidationError(`${label} must be a string, number, boolean, or null`);
}

function fieldQuery(kind: "term" | "range" | "terms" | "wildcard", field: string, value: unknown): Record<string, unknown> {
  const inner = emptyRecord();
  inner[field] = value;
  const clause = emptyRecord();
  clause[kind] = inner;
  return clause;
}

function existsClause(field: string): Record<string, unknown> {
  const inner = emptyRecord();
  inner.field = field;
  const clause = emptyRecord();
  clause.exists = inner;
  return clause;
}

function boolClause(key: "filter" | "must_not" | "should", clauses: Record<string, unknown>[]): Record<string, unknown> {
  const bool = emptyRecord();
  bool[key] = clauses;
  if (key === "should") {
    bool.minimum_should_match = 1;
  }
  const clause = emptyRecord();
  clause.bool = bool;
  return clause;
}

function matchNone(): Record<string, unknown> {
  const clause = emptyRecord();
  clause.match_none = emptyRecord();
  return clause;
}

function matchAll(): Record<string, unknown> {
  const clause = emptyRecord();
  clause.match_all = emptyRecord();
  return clause;
}

/**
 * A string value is matched on the field and on `field.keyword`.
 * `term` hits a keyword field. A text field stores the original value on
 * the `.keyword` multi-field, so the same clause still matches it.
 */
function stringClause(
  kind: "term" | "terms" | "wildcard",
  field: string,
  value: unknown,
): Record<string, unknown> {
  return boolClause("should", [
    fieldQuery(kind, field, value),
    fieldQuery(kind, `${field}.keyword`, value),
  ]);
}

function wildcardSpec(pattern: string, caseInsensitive: boolean): Record<string, unknown> {
  const spec = emptyRecord();
  spec.value = pattern;
  if (caseInsensitive) {
    spec.case_insensitive = true;
  }
  return spec;
}

/** A missing field. Elasticsearch stores JSON null as a missing field. */
function absentClause(field: string): Record<string, unknown> {
  return boolClause("must_not", [existsClause(field)]);
}

function presentAnd(field: string, clause: Record<string, unknown>): Record<string, unknown> {
  return boolClause("filter", [existsClause(field), clause]);
}

const WILDCARD_SPECIAL = /[\\*?]/g;

/**
 * SQL `%` and `_` become Elasticsearch `*` and `?`.
 * `\`, `*`, and `?` in the pattern stay literal.
 */
export function likeToWildcard(pattern: string): string {
  if (pattern.length > MAX_LIKE) {
    throw new QueryValidationError("Filter pattern is too long");
  }
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "%") {
      while (pattern[index + 1] === "%") {
        index += 1;
      }
      source += "*";
      continue;
    }
    if (character === "_") {
      source += "?";
      continue;
    }
    source += character.replace(WILDCARD_SPECIAL, "\\$&");
  }
  return source;
}

function compileFilter(filter: AdapterFilter): Record<string, unknown> {
  assertField(filter.column);
  const field = filter.column;
  switch (filter.op) {
    case "eq": {
      const value = assertScalar(filter.value, "filter value");
      if (value === null) {
        return absentClause(field);
      }
      return typeof value === "string" ? stringClause("term", field, value) : fieldQuery("term", field, value);
    }
    case "neq": {
      const value = assertScalar(filter.value, "filter value");
      if (value === null) {
        return existsClause(field);
      }
      const term =
        typeof value === "string" ? stringClause("term", field, value) : fieldQuery("term", field, value);
      return presentAnd(field, boolClause("must_not", [term]));
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const value = assertScalar(filter.value, "filter value");
      if (value === null) {
        return matchNone();
      }
      const bound = emptyRecord();
      bound[filter.op] = value;
      return fieldQuery("range", field, bound);
    }
    case "in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      if (filter.value.length > MAX_IN) {
        throw new QueryValidationError(`Filter operator \`in\` accepts at most ${MAX_IN} values`);
      }
      const values = filter.value.map((entry) => assertScalar(entry, "filter value"));
      const nonNull = values.filter((entry): entry is string | number | boolean => entry !== null);
      const strings = nonNull.filter((entry): entry is string => typeof entry === "string");
      const others = nonNull.filter((entry) => typeof entry !== "string");
      const clauses: Record<string, unknown>[] = [];
      if (strings.length > 0) {
        clauses.push(stringClause("terms", field, strings));
      }
      if (others.length > 0) {
        clauses.push(fieldQuery("terms", field, others));
      }
      if (nonNull.length !== values.length) {
        clauses.push(absentClause(field));
      }
      if (clauses.length === 1) {
        return clauses[0]!;
      }
      return boolClause("should", clauses);
    }
    case "like":
    case "ilike": {
      if (typeof filter.value !== "string") {
        throw new QueryValidationError("Filter operators `like` and `ilike` require a string");
      }
      const pattern = likeToWildcard(filter.value);
      const insensitive = filter.op === "ilike";
      return stringClause("wildcard", field, wildcardSpec(pattern, insensitive));
    }
    default:
      throw new QueryValidationError(`Unsupported filter operator: ${String(filter.op)}`);
  }
}

function assertIndex(resource: string): string {
  if (typeof resource !== "string" || !INDEX_NAME.test(resource)) {
    throw new QueryValidationError(`Invalid resource name: ${String(resource)}`);
  }
  return resource;
}

/**
 * Compiles a structured query into an Elasticsearch `_search` body.
 * The resource is one index or alias name. Field names are validated
 * identifiers used as query keys. Filter values are scalars, so a client
 * cannot inject Query DSL. `like` and `ilike` become escaped wildcard
 * patterns. A string comparison matches the field and its `.keyword` subfield.
 */
export function compileSearch(input: AdapterQuery): CompiledSearch {
  const index = assertIndex(input.resource);
  const query = normalizeAdapterQuery({ ...input, resource: index });
  for (const column of query.columns ?? []) {
    assertField(column);
  }
  for (const entry of query.orderBy ?? []) {
    assertField(entry.column);
  }

  const limit = query.limit ?? 1000;
  const from = query.offset ?? 0;
  if (from + limit > MAX_WINDOW) {
    throw new QueryValidationError(
      `offset + limit must be at most ${MAX_WINDOW}`,
    );
  }
  const lookAhead = from + limit < MAX_WINDOW;

  const filters = (query.filters ?? []).map((filter) => compileFilter(filter));
  let compiledQuery = matchAll();
  if (filters.length === 1) {
    compiledQuery = filters[0]!;
  } else if (filters.length > 1) {
    compiledQuery = boolClause("filter", filters);
  }

  const body = emptyRecord();
  body.query = compiledQuery;
  body.size = lookAhead ? limit + 1 : limit;
  body.from = from;
  body.track_total_hits = false;

  if (query.columns && query.columns.length > 0) {
    const source = query.columns.filter((column) => column !== "_id");
    body._source = source.length === query.columns.length ? source : source.length > 0 ? source : false;
  }
  if (query.orderBy && query.orderBy.length > 0) {
    body.sort = query.orderBy.map((entry) => {
      const order = emptyRecord();
      order.order = entry.direction;
      const clause = emptyRecord();
      clause[entry.column] = order;
      return clause;
    });
  }

  return { index, body, limit, lookAhead };
}

const NUMBER_TYPES = new Set([
  "long",
  "integer",
  "short",
  "byte",
  "unsigned_long",
  "double",
  "float",
  "half_float",
  "scaled_float",
]);
const STRING_TYPES = new Set([
  "keyword",
  "text",
  "match_only_text",
  "wildcard",
  "constant_keyword",
  "ip",
]);

export function mapFieldType(type: string | undefined): string {
  if (!type) {
    return "object";
  }
  if (NUMBER_TYPES.has(type)) {
    return "number";
  }
  if (STRING_TYPES.has(type)) {
    return "string";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "date" || type === "date_nanos") {
    return "date";
  }
  if (type === "object" || type === "nested" || type === "flattened") {
    return "object";
  }
  if (type === "binary") {
    return "binary";
  }
  return /^[a-z0-9_]+$/.test(type) ? type : "unknown";
}

/** Top-level mapping properties, plus `_id`. Names that cannot be queried are omitted. */
export function columnsFromProperties(properties: Record<string, unknown> | undefined): AdapterColumn[] {
  const names = Object.keys(properties ?? {})
    .filter((name) => FIELD_NAME.test(name) && !BANNED_KEYS.has(name) && !name.startsWith("_"))
    .sort();
  const columns: AdapterColumn[] = [{ name: "_id", type: "string", nullable: false }];
  for (const name of names) {
    const spec = properties?.[name];
    const type =
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? (spec as { type?: unknown }).type
        : undefined;
    columns.push({
      name,
      type: mapFieldType(typeof type === "string" ? type : undefined),
      nullable: true,
    });
  }
  return columns;
}

export function isListedIndex(name: string): boolean {
  return INDEX_NAME.test(name) && !name.startsWith(".");
}
