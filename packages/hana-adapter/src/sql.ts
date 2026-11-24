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

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function quoteIdent(name: string): string {
  // Identifiers cannot be bound. Reject a bad name. Do not strip characters.
  if (typeof name !== "string" || !IDENT.test(name)) {
    throw new QueryValidationError("Invalid SAP HANA identifier");
  }
  return `"${name}"`;
}

function compileDirection(direction: string): "ASC" | "DESC" {
  switch (direction) {
    case "asc":
      return "ASC";
    case "desc":
      return "DESC";
    default:
      throw new QueryValidationError("Invalid SAP HANA order direction");
  }
}

function qualifyResource(resource: string): string {
  const parts = splitResourceName(resource);
  if (parts.catalog) {
    throw new QueryValidationError("SAP HANA resource must be schema.table");
  }
  return parts.namespace
    ? `${quoteIdent(parts.namespace)}.${quoteIdent(parts.name)}`
    : quoteIdent(parts.name);
}

function compileFilter(filter: AdapterFilter, values: unknown[]): string {
  const column = quoteIdent(filter.column);
  const next = () => {
    values.push(filter.value);
    return "?";
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
      // SAP HANA has no ILIKE. LOWER keeps the match case-insensitive.
      return `LOWER(${column}) LIKE LOWER(${next()})`;
    case "in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      const placeholders = filter.value.map((entry) => {
        values.push(entry);
        return "?";
      });
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
      : "";
  values.push(query.limit);
  values.push(query.offset);
  // SQL text comes from validated identifiers and fixed operators.
  // Values stay in the bind list for the prepared statement.
  const text = `SELECT ${projection} FROM ${from}${where}${order} LIMIT ? OFFSET ?`;
  return { text, values };
}

const SCHEMA_FILTER = `
  SCHEMA_NAME NOT IN ('SYS', 'SYSTEM')
  AND SUBSTRING(SCHEMA_NAME, 1, 4) <> '_SYS'
  AND SUBSTRING(SCHEMA_NAME, 1, 4) <> 'SYS_'
`;

/** Fixed introspection SQL. It contains no client text and no placeholders. */
export const INTROSPECT_SQL = `
SELECT
  c.SCHEMA_NAME AS "namespace",
  c.TABLE_NAME AS "name",
  'TABLE' AS "table_type",
  c.COLUMN_NAME AS "column_name",
  c.DATA_TYPE_NAME AS "data_type",
  c.IS_NULLABLE AS "is_nullable",
  c.POSITION AS "position"
FROM SYS.TABLE_COLUMNS AS c
WHERE ${SCHEMA_FILTER}
UNION ALL
SELECT
  c.SCHEMA_NAME AS "namespace",
  c.VIEW_NAME AS "name",
  'VIEW' AS "table_type",
  c.COLUMN_NAME AS "column_name",
  c.DATA_TYPE_NAME AS "data_type",
  c.IS_NULLABLE AS "is_nullable",
  c.POSITION AS "position"
FROM SYS.VIEW_COLUMNS AS c
WHERE ${SCHEMA_FILTER}
ORDER BY "namespace", "name", "position"
`;

export const TEST_CONNECTION_SQL = 'SELECT 1 AS "ok" FROM DUMMY';
