import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";

export interface CompiledSql {
  text: string;
  values: unknown[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IN_LIST_CAP = 1000;

function quoteIdent(name: string): string {
  if (typeof name !== "string" || !IDENT.test(name)) {
    throw new QueryValidationError("Invalid Oracle identifier");
  }
  // Unquoted Oracle names are stored in uppercase. Quoting the folded form
  // makes `orders` match a normal ORDERS table.
  return `"${name.toUpperCase()}"`;
}

function compileDirection(direction: string): string {
  switch (direction) {
    case "asc":
      return "ASC";
    case "desc":
      return "DESC";
    default:
      throw new QueryValidationError("Invalid Oracle order direction");
  }
}

function qualifyResource(resource: string): string {
  const parts = splitResourceName(resource);
  if (parts.catalog) {
    throw new QueryValidationError("Oracle resource must be schema.table");
  }
  return parts.namespace
    ? `${quoteIdent(parts.namespace)}.${quoteIdent(parts.name)}`
    : quoteIdent(parts.name);
}

function placeholder(values: unknown[], value: unknown): string {
  const name = `:p${values.length}`;
  values.push(value);
  return name;
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
  if (filter.value === "") {
    throw new QueryValidationError("Oracle treats an empty string as null");
  }
  const next = () => placeholder(values, filter.value);

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
      return `${column} COLLATE BINARY_CS LIKE ${next()}`;
    case "ilike":
      return `LOWER(${column}) LIKE LOWER(${next()})`;
    case "in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      if (filter.value.length > IN_LIST_CAP) {
        throw new QueryValidationError(
          `Filter operator \`in\` accepts at most ${IN_LIST_CAP} values`,
        );
      }
      if (filter.value.some((entry) => entry === null || entry === "")) {
        throw new QueryValidationError("Filter operator `in` does not accept null");
      }
      const placeholders = filter.value.map((entry) => placeholder(values, entry));
      return `${column} IN (${placeholders.join(", ")})`;
    }
    default:
      throw new QueryValidationError(`Unsupported filter operator: ${String(filter.op)}`);
  }
}

export function compileSelect(input: AdapterQuery): CompiledSql {
  const query = normalizeAdapterQuery(input);
  const values: unknown[] = [];
  const projection =
    query.columns && query.columns.length > 0
      ? query.columns.map(quoteIdent).join(", ")
      : "*";
  const from = qualifyResource(query.resource);
  const where =
    query.filters && query.filters.length > 0
      ? ` WHERE ${query.filters.map((filter) => compileFilter(filter, values)).join(" AND ")}`
      : "";
  const order =
    query.orderBy && query.orderBy.length > 0
      ? ` ORDER BY ${query.orderBy
          .map((entry) => `${quoteIdent(entry.column)} ${compileDirection(entry.direction)}`)
          .join(", ")}`
      : " ORDER BY NULL";
  const offset = placeholder(values, query.offset);
  const limit = placeholder(values, query.limit);
  const text = `SELECT ${projection} FROM ${from}${where}${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  return { text, values };
}

export const INTROSPECT_SQL = `
SELECT
  c.owner AS "namespace",
  c.table_name AS "name",
  CASE WHEN v.view_name IS NOT NULL THEN 'VIEW' ELSE 'TABLE' END AS "table_type",
  c.column_name AS "column_name",
  c.data_type AS "data_type",
  c.nullable AS "is_nullable"
FROM all_tab_columns c
LEFT JOIN all_views v
  ON v.owner = c.owner
 AND v.view_name = c.table_name
WHERE c.owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
  AND c.table_name NOT LIKE 'BIN$%'
ORDER BY c.owner, c.table_name, c.column_id
`;
