import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  assertIdentifier,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";

export interface CompiledCql {
  text: string;
  values: CqlValue[];
  offset: number;
  limit: number;
}

export type CqlValue = string | number | boolean | bigint | Date;

const MAX_PAGE_SPAN = 10_000;

function quoteIdent(name: string): string {
  assertIdentifier(name, "identifier");
  return `"${name}"`;
}

function qualifyResource(resource: string): string {
  const parts = splitResourceName(resource);
  if (parts.catalog) {
    throw new QueryValidationError("Cassandra resource must be keyspace.table");
  }
  return parts.namespace
    ? `${quoteIdent(parts.namespace)}.${quoteIdent(parts.name)}`
    : quoteIdent(parts.name);
}

function assertScalar(value: unknown): CqlValue {
  if (value === null || value === undefined) {
    throw new QueryValidationError("Cassandra filter values cannot be null");
  }
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new QueryValidationError("Cassandra filter values must be finite numbers");
    }
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  throw new QueryValidationError("Cassandra filter values must be scalar values or dates");
}

function compileFilter(filter: AdapterFilter, values: CqlValue[]): string {
  const column = quoteIdent(filter.column);
  switch (filter.op) {
    case "eq":
      values.push(assertScalar(filter.value));
      return `${column} = ?`;
    case "neq":
      throw new QueryValidationError("Cassandra does not support neq");
    case "gt":
      values.push(assertScalar(filter.value));
      return `${column} > ?`;
    case "gte":
      values.push(assertScalar(filter.value));
      return `${column} >= ?`;
    case "lt":
      values.push(assertScalar(filter.value));
      return `${column} < ?`;
    case "lte":
      values.push(assertScalar(filter.value));
      return `${column} <= ?`;
    case "like":
      throw new QueryValidationError("Cassandra does not support like");
    case "ilike":
      throw new QueryValidationError("Cassandra does not support ilike");
    case "in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      const placeholders = filter.value.map((entry) => {
        values.push(assertScalar(entry));
        return "?";
      });
      return `${column} IN (${placeholders.join(", ")})`;
    }
  }
}

export function compileSelect(input: AdapterQuery): CompiledCql {
  const query = normalizeAdapterQuery(input);
  const limit = query.limit ?? 1;
  const offset = query.offset ?? 0;
  const span = offset + limit;
  if (!Number.isSafeInteger(span) || span > MAX_PAGE_SPAN) {
    throw new QueryValidationError("Cassandra reads at most 10000 rows for one page");
  }
  const values: CqlValue[] = [];
  const projection =
    query.columns && query.columns.length > 0 ? query.columns.map(quoteIdent).join(", ") : "*";
  const from = qualifyResource(query.resource);
  const where =
    query.filters && query.filters.length > 0
      ? ` WHERE ${query.filters.map((filter) => compileFilter(filter, values)).join(" AND ")}`
      : "";
  const order =
    query.orderBy && query.orderBy.length > 0
      ? ` ORDER BY ${query.orderBy
          .map((entry) => `${quoteIdent(entry.column)} ${entry.direction === "desc" ? "DESC" : "ASC"}`)
          .join(", ")}`
      : "";
  values.push(span);
  const filterClause = where ? " ALLOW FILTERING" : "";
  const text = `SELECT ${projection} FROM ${from}${where}${order} LIMIT ?${filterClause}`;
  return { text, values, offset, limit };
}
