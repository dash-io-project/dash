import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";
import { assertDb2Identifier } from "./connection.ts";

export interface CompiledSql {
  text: string;
  values: unknown[];
  limit: number;
}

function quoteIdent(name: string): string {
  return `"${assertDb2Identifier(name)}"`;
}

function compileDirection(direction: "asc" | "desc"): string {
  return direction === "asc" ? "ASC" : "DESC";
}

function qualifyResource(resource: string, schema: string | undefined): string {
  const parts = splitResourceName(resource);
  if (parts.catalog) {
    throw new QueryValidationError("Db2 resource must be schema.table");
  }
  if (parts.namespace) {
    return `${quoteIdent(parts.namespace)}.${quoteIdent(parts.name)}`;
  }
  return schema
    ? `${quoteIdent(schema)}.${quoteIdent(parts.name)}`
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
      return `UPPER(${column}) LIKE UPPER(${next()})`;
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
  }
}

export function compileSelect(input: AdapterQuery, schema?: string): CompiledSql {
  const query = normalizeAdapterQuery(input);
  const qualifier = schema && schema.length > 0 ? assertDb2Identifier(schema) : undefined;
  const values: unknown[] = [];
  const projection =
    query.columns && query.columns.length > 0
      ? query.columns.map(quoteIdent).join(", ")
      : "*";
  const from = qualifyResource(query.resource, qualifier);
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
  // normalizeAdapterQuery sets limit and offset.
  const offset = query.offset as number;
  const limit = query.limit as number;
  values.push(offset);
  values.push(limit);
  const text = `SELECT ${projection} FROM ${from}${where}${order} OFFSET ? ROWS FETCH FIRST ? ROWS ONLY`;
  return { text, values, limit };
}

export const INTROSPECT_SQL = `
SELECT
  C.TABSCHEMA AS "namespace",
  C.TABNAME AS "name",
  T.TYPE AS "table_type",
  C.COLNAME AS "column_name",
  C.TYPENAME AS "data_type",
  C.NULLS AS "is_nullable"
FROM SYSCAT.COLUMNS C
INNER JOIN SYSCAT.TABLES T
  ON T.TABSCHEMA = C.TABSCHEMA AND T.TABNAME = C.TABNAME
WHERE T.TYPE IN ('T', 'V')
  AND T.TABSCHEMA NOT IN (
    'SYSIBM',
    'SYSCAT',
    'SYSSTAT',
    'SYSIBMADM',
    'SYSTOOLS',
    'SYSPUBLIC',
    'SYSIBMTS',
    'SQLJ',
    'SYSFUN',
    'SYSPROC',
    'SYSIBMINTERNAL'
  )
ORDER BY C.TABSCHEMA, C.TABNAME, C.COLNO
`;
