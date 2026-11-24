import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  assertIdentifier,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";

export interface CompiledSql {
  text: string;
  values: unknown[];
  limit: number;
}

export interface CouchbaseSqlContext {
  bucket: string;
  scope: string;
}

export function quoteIdent(name: string): string {
  const valid = assertIdentifier(name, "identifier");
  return "`" + valid.replaceAll("`", "``") + "`";
}

function compileDirection(direction: string): string {
  if (direction === "asc") {
    return "ASC";
  }
  if (direction === "desc") {
    return "DESC";
  }
  throw new QueryValidationError("Invalid order direction");
}

function qualifyResource(resource: string, context: CouchbaseSqlContext): string {
  const parts = splitResourceName(resource);
  const bucket = parts.catalog ?? context.bucket;
  const scope = parts.catalog ? parts.namespace : (parts.namespace ?? context.scope);
  if (!bucket || !scope) {
    throw new QueryValidationError("Couchbase bucket and scope are required");
  }
  return `${quoteIdent(bucket)}.${quoteIdent(scope)}.${quoteIdent(parts.name)}`;
}

function compileFilter(filter: AdapterFilter, values: unknown[]): string {
  const column = quoteIdent(filter.column);
  const next = () => {
    values.push(filter.value);
    return `$${values.length}`;
  };

  switch (filter.op) {
    case "eq":
      if (filter.value === null) {
        return `${column} IS NULL`;
      }
      return `${column} = ${next()}`;
    case "neq":
      if (filter.value === null) {
        return `${column} IS NOT NULL`;
      }
      return `${column} <> ${next()}`;
    case "gt":
      return `${column} > ${next()}`;
    case "gte":
      return `${column} >= ${next()}`;
    case "lt":
      return `${column} < ${next()}`;
    case "lte":
      return `${column} <= ${next()}`;
    case "like":
      return `${column} LIKE ${next()}`;
    case "ilike":
      return `LOWER(${column}) LIKE LOWER(${next()})`;
    case "in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      const placeholders = filter.value.map((entry) => {
        values.push(entry);
        return `$${values.length}`;
      });
      return `${column} IN [${placeholders.join(", ")}]`;
    }
    default:
      throw new QueryValidationError(`Unsupported filter operator: ${String(filter.op)}`);
  }
}

export function compileSelect(input: AdapterQuery, context: CouchbaseSqlContext): CompiledSql {
  quoteIdent(context.bucket);
  quoteIdent(context.scope);
  const query = normalizeAdapterQuery(input);
  const values: unknown[] = [];
  const columns = query.columns ?? [];
  const star = columns.length === 0;
  const projection = star ? "d.*" : columns.map(quoteIdent).join(", ");
  const from = qualifyResource(query.resource, context);
  const relation = star ? `${from} AS d` : from;
  const where =
    query.filters && query.filters.length > 0
      ? ` WHERE ${query.filters.map((filter) => compileFilter(filter, values)).join(" AND ")}`
      : "";
  const order =
    query.orderBy && query.orderBy.length > 0
      ? ` ORDER BY ${query.orderBy
          .map((entry) => `${quoteIdent(entry.column)} ${compileDirection(entry.direction)}`)
          .join(", ")}`
      : "";
  values.push(query.limit);
  const limitPlaceholder = `$${values.length}`;
  values.push(query.offset);
  const offsetPlaceholder = `$${values.length}`;
  const text = `SELECT ${projection} FROM ${relation}${where}${order} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
  return { text, values, limit: query.limit ?? 1000 };
}
