import {
  type AdapterQuery,
  QueryValidationError,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";
import { isSafeKey } from "./values.ts";

export interface CompiledCypher {
  text: string;
  parameters: Record<string, unknown>;
}

const MAX_FILTERS = 32;
const MAX_ORDER = 8;
const MAX_IN = 100;
const MAX_STRING = 10_000;
const MAX_LIKE = 200;
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function filterClause(index: number, op: string): string {
  const property = `entity[$c${index}]`;
  const value = `$v${index}`;
  switch (op) {
    case "eq":
      return `${property} = ${value}`;
    case "neq":
      return `${property} <> ${value}`;
    case "gt":
      return `${property} > ${value}`;
    case "gte":
      return `${property} >= ${value}`;
    case "lt":
      return `${property} < ${value}`;
    case "lte":
      return `${property} <= ${value}`;
    case "in":
      return `${property} IN ${value}`;
    case "like":
    case "ilike":
      return `toString(${property}) =~ ${value}`;
    default:
      throw new QueryValidationError(`Unsupported filter operator: ${op}`);
  }
}

function assertSafeIdentifier(name: string, label: string): string {
  if (!isSafeKey(name)) {
    throw new QueryValidationError(`Invalid ${label}: ${name}`);
  }
  return name;
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

/**
 * Convert a SQL LIKE pattern to a Java regex.
 * `%` is any text. `_` is one character. `\` escapes the next character.
 */
export function likeToRegex(pattern: string, ignoreCase: boolean): string {
  let body = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) {
      break;
    }
    if (char === "\\") {
      const next = pattern[index + 1];
      if (next === undefined) {
        body += "\\\\";
      } else {
        body += next.replace(REGEX_META, "\\$&");
        index += 1;
      }
      continue;
    }
    if (char === "%") {
      body += ".*";
      continue;
    }
    if (char === "_") {
      body += ".";
      continue;
    }
    body += char.replace(REGEX_META, "\\$&");
  }
  return `${ignoreCase ? "(?is)" : "(?s)"}^${body}$`;
}

function filterValue(op: string, value: unknown): unknown {
  if (op === "like" || op === "ilike") {
    if (typeof value !== "string") {
      throw new QueryValidationError(`Filter operator \`${op}\` requires a string`);
    }
    if (value.length > MAX_LIKE) {
      throw new QueryValidationError("Filter pattern is too long");
    }
    return likeToRegex(value, op === "ilike");
  }
  if (op === "in") {
    if (!Array.isArray(value) || value.length === 0) {
      throw new QueryValidationError("Filter operator `in` requires a non-empty array");
    }
    if (value.length > MAX_IN) {
      throw new QueryValidationError(`Filter operator \`in\` accepts at most ${MAX_IN} values`);
    }
    return value.map((entry) => assertScalar(entry, "Filter value"));
  }
  return assertScalar(value, "Filter value");
}

/**
 * Compile a structured query to Cypher.
 * Labels, relationship types, property names, and literals are parameters.
 */
export function compileRead(input: AdapterQuery): CompiledCypher {
  const query = normalizeAdapterQuery(input);
  const parts = splitResourceName(query.resource);
  if (parts.catalog || (parts.namespace !== "node" && parts.namespace !== "relationship")) {
    throw new QueryValidationError("Neo4j resource must be node.Label or relationship.Type");
  }
  const name = assertSafeIdentifier(parts.name, "resource");
  for (const column of query.columns ?? []) {
    assertSafeIdentifier(column, "column");
  }
  const filters = query.filters ?? [];
  if (filters.length > MAX_FILTERS) {
    throw new QueryValidationError(`A query accepts at most ${MAX_FILTERS} filters`);
  }
  const orderBy = query.orderBy ?? [];
  if (orderBy.length > MAX_ORDER) {
    throw new QueryValidationError(`A query accepts at most ${MAX_ORDER} sorts`);
  }

  const parameters: Record<string, unknown> = plainParameters();
  parameters.name = name;
  parameters.columns = query.columns && query.columns.length > 0 ? query.columns : null;
  parameters.skip = query.offset ?? 0;
  parameters.limit = query.limit;

  const filterText =
    filters.length > 0
      ? ` AND ${filters
          .map((filter, index) => {
            assertSafeIdentifier(filter.column, "filter column");
            parameters[`c${index}`] = filter.column;
            parameters[`v${index}`] = filterValue(filter.op, filter.value);
            return `(${filterClause(index, filter.op)})`;
          })
          .join(" AND ")}`
      : "";

  const orderText =
    orderBy.length > 0
      ? `${orderBy
          .map((entry, index) => {
            assertSafeIdentifier(entry.column, "order column");
            parameters[`o${index}`] = entry.column;
            parameters[`d${index}`] = entry.direction;
            return `CASE WHEN $d${index} = 'asc' THEN entity[$o${index}] END ASC, CASE WHEN $d${index} = 'desc' THEN entity[$o${index}] END DESC`;
          })
          .join(", ")}, `
      : "";

  const match =
    parts.namespace === "node"
      ? "MATCH (entity)\nWHERE $name IN labels(entity)"
      : "MATCH ()-[entity]->()\nWHERE type(entity) = $name";

  const text = [
    match + filterText,
    "WITH entity",
    `ORDER BY ${orderText}elementId(entity) ASC`,
    "SKIP $skip",
    "LIMIT $limit",
    "RETURN CASE WHEN $columns IS NULL THEN properties(entity) ELSE [key IN $columns | entity[key]] END AS row",
  ].join("\n");

  return { text, parameters };
}

function plainParameters(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}
