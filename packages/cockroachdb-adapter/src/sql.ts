import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  isFilterOperator,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";

export interface CompiledSql {
  text: string;
  values: unknown[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const IN_LIST_CAP = 1000;

function quoteIdent(name: string): string {
  // A name cannot be a bound parameter. Reject a name that is not an identifier.
  // Do not remove characters. Removal would change the name.
  // The message does not repeat the name.
  if (typeof name !== "string" || !IDENT.test(name)) {
    throw new QueryValidationError("Invalid CockroachDB identifier");
  }
  return `"${name}"`;
}

function compileDirection(direction: string): string {
  if (direction === "asc") {
    return "ASC";
  }
  if (direction === "desc") {
    return "DESC";
  }
  throw new QueryValidationError("Invalid CockroachDB order direction");
}

function qualifyResource(resource: string): string {
  if (typeof resource !== "string" || !/^([A-Za-z_][A-Za-z0-9_-]*)(\.[A-Za-z_][A-Za-z0-9_-]*){0,2}$/.test(resource)) {
    throw new QueryValidationError("Invalid CockroachDB identifier");
  }
  const parts = splitResourceName(resource);
  const names = [parts.catalog, parts.namespace, parts.name].filter(
    (part): part is string => part !== undefined,
  );
  return names.map(quoteIdent).join(".");
}

function compileFilter(filter: AdapterFilter, values: unknown[]): string {
  const column = quoteIdent(filter.column);
  if (filter.value === null) {
    if (filter.op === "eq") {
      return `${column} IS NULL`;
    }
    if (filter.op === "neq") {
      return `${column} IS NOT NULL`;
    }
    throw new QueryValidationError(`Filter operator \`${filter.op}\` does not accept null`);
  }
  const next = () => {
    values.push(filter.value);
    return `$${values.length}`;
  };

  switch (filter.op) {
    case "eq":
      return `${column} = ${next()}`;
    case "neq":
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
      return `${column} ILIKE ${next()}`;
    case "in": {
      const entries = filter.value as unknown[];
      if (entries.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      if (entries.some((entry) => entry === null || entry === undefined)) {
        throw new QueryValidationError("Filter operator `in` does not accept null");
      }
      if (entries.length > IN_LIST_CAP) {
        throw new QueryValidationError("Filter operator `in` accepts at most 1000 values");
      }
      const placeholders = entries.map((entry) => {
        values.push(entry);
        return `$${values.length}`;
      });
      return `${column} IN (${placeholders.join(", ")})`;
    }
  }
}

export function compileSelect(input: AdapterQuery): CompiledSql {
  // Validate names before normalizeAdapterQuery. Its errors repeat the raw name.
  qualifyResource(input.resource);
  for (const column of input.columns ?? []) {
    quoteIdent(column);
  }
  for (const filter of input.filters ?? []) {
    quoteIdent(filter.column);
    if (!isFilterOperator(filter.op)) {
      throw new QueryValidationError("Unsupported CockroachDB filter operator");
    }
    if (filter.op === "in" && !Array.isArray(filter.value)) {
      throw new QueryValidationError("Filter operator `in` requires an array");
    }
  }
  for (const entry of input.orderBy ?? []) {
    quoteIdent(entry.column);
    compileDirection(entry.direction);
  }
  const query = normalizeAdapterQuery(input);
  const values: unknown[] = [];
  const columns = input.columns ?? [];
  const filters = input.filters ?? [];
  const orderBy = input.orderBy ?? [];
  const projection = columns.length > 0 ? columns.map(quoteIdent).join(", ") : "*";
  const from = qualifyResource(query.resource);
  const where =
    filters.length > 0
      ? ` WHERE ${filters.map((filter) => compileFilter(filter, values)).join(" AND ")}`
      : "";
  const order =
    orderBy.length > 0
      ? ` ORDER BY ${orderBy
          .map((entry) => `${quoteIdent(entry.column)} ${compileDirection(entry.direction)}`)
          .join(", ")}`
      : "";
  values.push(query.limit);
  const limitPlaceholder = `$${values.length}`;
  values.push(query.offset);
  const offsetPlaceholder = `$${values.length}`;
  const text = `SELECT ${projection} FROM ${from}${where}${order} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
  return { text, values };
}

export const INTROSPECT_SQL = `
SELECT
  c.table_schema AS namespace,
  c.table_name AS name,
  t.table_type AS table_type,
  c.column_name AS column_name,
  c.crdb_sql_type AS data_type,
  c.is_nullable AS is_nullable
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_catalog = c.table_catalog
 AND t.table_schema = c.table_schema
 AND t.table_name = c.table_name
WHERE c.table_schema NOT IN (
  'pg_catalog',
  'information_schema',
  'crdb_internal',
  'pg_extension'
)
  AND c.is_hidden = 'NO'
ORDER BY c.table_schema, c.table_name, c.ordinal_position
LIMIT 10001
`;
