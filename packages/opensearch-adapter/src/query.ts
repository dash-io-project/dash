import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  normalizeAdapterQuery,
} from "@dash/core";

const MAX_STRING = 10_000;
const MAX_IN = 100;
const MAX_LIKE = 200;
const MAX_WINDOW = 10_000;
const INDEX = /^[a-z][a-z0-9_-]{0,254}$/;
const BANNED = new Set(["__proto__", "constructor", "prototype"]);

export interface CompiledSearch {
  index: string;
  body: {
    query: Record<string, unknown>;
    _source?: string[] | false;
    sort?: Record<string, unknown>[];
    size: number;
    from: number;
  };
}

/** Maps a validated field to the OpenSearch field that term queries use. */
export type FieldTarget = (field: string) => string;

function identity(field: string): string {
  return field;
}

function emptyRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function assertSafeField(name: string): void {
  if (BANNED.has(name) || (name.startsWith("_") && name !== "_id")) {
    throw new QueryValidationError(`Invalid column: ${name}`);
  }
}

export function indexName(resource: string): string {
  if (typeof resource !== "string" || !INDEX.test(resource)) {
    const shown = typeof resource === "string" ? resource.slice(0, 80) : "";
    throw new QueryValidationError(`Invalid resource name: ${shown}`);
  }
  return resource;
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

function fieldQuery(
  kind: "term" | "terms" | "range" | "wildcard",
  field: string,
  value: unknown,
): Record<string, unknown> {
  const inner = emptyRecord();
  inner[field] = value;
  const clause = emptyRecord();
  clause[kind] = inner;
  return clause;
}

function missing(field: string): Record<string, unknown> {
  return { bool: { must_not: [{ exists: { field } }] } };
}

function matchNothing(): Record<string, unknown> {
  return { bool: { must_not: [{ match_all: {} }] } };
}

function likePattern(pattern: string): string {
  if (pattern.length > MAX_LIKE) {
    throw new QueryValidationError("Filter pattern is too long");
  }
  let out = "";
  for (const character of pattern) {
    if (character === "%") {
      out += "*";
      continue;
    }
    if (character === "_") {
      out += "?";
      continue;
    }
    if (character === "\\" || character === "*" || character === "?") {
      out += `\\${character}`;
      continue;
    }
    out += character;
  }
  return out;
}

function wildcard(field: string, pattern: string, caseInsensitive: boolean): Record<string, unknown> {
  const spec = emptyRecord();
  spec.value = pattern;
  spec.case_insensitive = caseInsensitive;
  return fieldQuery("wildcard", field, spec);
}

function notEqual(field: string, queryField: string, value: string | number | boolean | null): Record<string, unknown> {
  if (value === null) {
    return { exists: { field } };
  }
  return {
    bool: {
      filter: [{ exists: { field } }, { bool: { must_not: [fieldQuery("term", queryField, value)] } }],
    },
  };
}

function compileFilter(filter: AdapterFilter, target: FieldTarget): Record<string, unknown> {
  assertSafeField(filter.column);
  const field = filter.column;
  const queryField = target(field);
  switch (filter.op) {
    case "eq": {
      const value = assertScalar(filter.value, "filter value");
      return value === null ? missing(field) : fieldQuery("term", queryField, value);
    }
    case "neq":
      return notEqual(field, queryField, assertScalar(filter.value, "filter value"));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const value = assertScalar(filter.value, "filter value");
      if (value === null) {
        return matchNothing();
      }
      const bounds = emptyRecord();
      bounds[filter.op] = value;
      return fieldQuery("range", queryField, bounds);
    }
    case "in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      if (filter.value.length > MAX_IN) {
        throw new QueryValidationError(`Filter operator \`in\` accepts at most ${MAX_IN} values`);
      }
      const values = filter.value.map((entry) => assertScalar(entry, "filter value"));
      const nonNull = values.filter((entry) => entry !== null);
      const clauses: Record<string, unknown>[] = [];
      if (nonNull.length > 0) {
        clauses.push(fieldQuery("terms", queryField, nonNull));
      }
      if (nonNull.length !== values.length) {
        clauses.push(missing(field));
      }
      if (clauses.length === 1) {
        return clauses[0]!;
      }
      return { bool: { should: clauses, minimum_should_match: 1 } };
    }
    case "like":
    case "ilike": {
      if (typeof filter.value !== "string") {
        throw new QueryValidationError("Filter operators `like` and `ilike` require a string");
      }
      return wildcard(queryField, likePattern(filter.value), filter.op === "ilike");
    }
  }
}

function compileSort(
  orderBy: AdapterQuery["orderBy"],
  target: FieldTarget,
): Record<string, unknown>[] | undefined {
  if (!orderBy || orderBy.length === 0) {
    return undefined;
  }
  return orderBy.map((entry) => {
    assertSafeField(entry.column);
    const clause = emptyRecord();
    clause[target(entry.column)] = entry.direction;
    return clause;
  });
}

/**
 * Compiles a structured query into an OpenSearch search body.
 * The index name and each field name are validated identifiers.
 * Filter values are JSON scalars. An object is rejected.
 * `like` and `ilike` become escaped wildcard patterns.
 */
export function compileSearch(input: AdapterQuery, target: FieldTarget = identity): CompiledSearch {
  const index = indexName(input.resource);
  const query = normalizeAdapterQuery({ ...input, resource: "index" });
  for (const column of query.columns ?? []) {
    assertSafeField(column);
  }
  const filters = query.filters!.map((filter) => compileFilter(filter, target));
  let clause: Record<string, unknown> = { match_all: {} };
  if (filters.length === 1) {
    clause = filters[0]!;
  } else if (filters.length > 1) {
    clause = { bool: { filter: filters } };
  }
  // normalizeAdapterQuery always sets limit and offset.
  const limit = query.limit as number;
  const offset = query.offset as number;
  if (offset + limit > MAX_WINDOW) {
    throw new QueryValidationError(`OpenSearch reads at most ${MAX_WINDOW} rows from the start`);
  }
  const columns = query.columns && query.columns.length > 0 ? query.columns : undefined;
  const body: CompiledSearch["body"] = {
    query: clause,
    size: limit,
    from: offset,
  };
  if (columns) {
    const source = columns.filter((column) => column !== "_id");
    body._source = source.length > 0 ? source : false;
  }
  const sort = compileSort(query.orderBy, target);
  if (sort) {
    body.sort = sort;
  }
  return { index, body };
}
