import {
  type AdapterFilter,
  type AdapterQuery,
  QueryValidationError,
  normalizeAdapterQuery,
  splitResourceName,
} from "@dash/core";

export interface CompiledSql {
  text: string;
  params: Record<string, string | number | boolean>;
}

export interface ClickHouseSqlContext {
  /** Database the connection is pinned to. Other databases are rejected. */
  database: string;
  /**
   * Bind limit + 1 so the caller can tell a full page from a short one,
   * including when the page is already at the 10000-row cap.
   */
  extraRow?: boolean;
}

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;
const IN_LIST_CAP = 1000;

function quoteIdent(name: string): string {
  // Identifiers cannot be bound as parameters. Reject invalid names at the SQL
  // boundary instead of removing characters and silently changing the name.
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
    throw new QueryValidationError("Invalid ClickHouse identifier");
  }
  return "`" + name + "`";
}

function compileDirection(direction: string): string {
  switch (direction) {
    case "asc":
      return "ASC";
    case "desc":
      return "DESC";
    default:
      throw new QueryValidationError("Invalid ClickHouse order direction");
  }
}

function qualifyResource(resource: string, database: string): string {
  const parts = splitResourceName(resource);
  if (parts.catalog) {
    throw new QueryValidationError("ClickHouse resource must be database.table");
  }
  if (parts.namespace && parts.namespace !== database) {
    throw new QueryValidationError("ClickHouse resource must be in the connected database");
  }
  // Always qualify. The HTTP client omits database=default, so an unqualified
  // name would follow the user's profile database instead of this connection.
  return `${quoteIdent(database)}.${quoteIdent(parts.name)}`;
}

function formatDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new QueryValidationError("Invalid ClickHouse datetime");
  }
  const pad = (part: number, width = 2) => String(part).padStart(width, "0");
  return (
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ` +
    `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.` +
    `${pad(value.getUTCMilliseconds(), 3)}`
  );
}

function bindValue(
  value: unknown,
  params: Record<string, string | number | boolean>,
  type?: string,
): string {
  let stored: string | number | boolean;
  let clickHouseType = type;
  if (typeof value === "string") {
    stored = value;
    clickHouseType ??= "String";
  } else if (typeof value === "boolean") {
    stored = value;
    clickHouseType ??= "Bool";
  } else if (typeof value === "bigint") {
    if (value < INT64_MIN || value > INT64_MAX) {
      throw new QueryValidationError("ClickHouse integer values must fit in Int64");
    }
    stored = value.toString();
    clickHouseType ??= "Int64";
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new QueryValidationError("ClickHouse numeric values must be finite");
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new QueryValidationError("ClickHouse integer values must be safe integers");
      }
      stored = value;
      clickHouseType ??= "Int64";
    } else {
      stored = value;
      clickHouseType ??= "Float64";
    }
  } else if (value instanceof Date) {
    stored = formatDateTime(value);
    clickHouseType ??= "DateTime64(3, 'UTC')";
  } else {
    throw new QueryValidationError(
      "ClickHouse filter values must be scalar values or dates",
    );
  }
  const name = `p${Object.keys(params).length}`;
  params[name] = stored;
  return `{${name}:${clickHouseType}}`;
}

function compileFilter(
  filter: AdapterFilter,
  params: Record<string, string | number | boolean>,
): string {
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
  const next = () => bindValue(filter.value, params);

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
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new QueryValidationError("Filter operator `in` requires a non-empty array");
      }
      if (filter.value.length > IN_LIST_CAP) {
        throw new QueryValidationError(`Filter operator \`in\` accepts at most ${IN_LIST_CAP} values`);
      }
      if (filter.value.some((entry) => entry === null)) {
        throw new QueryValidationError("Filter operator `in` does not accept null");
      }
      const placeholders = filter.value.map((entry) => bindValue(entry, params));
      return `${column} IN (${placeholders.join(", ")})`;
    }
    default:
      throw new QueryValidationError(`Unsupported filter operator: ${String(filter.op)}`);
  }
}

export function compileSelect(input: AdapterQuery, context: ClickHouseSqlContext): CompiledSql {
  const query = normalizeAdapterQuery(input);
  const params: Record<string, string | number | boolean> = {};
  const projection =
    query.columns && query.columns.length > 0
      ? query.columns.map(quoteIdent).join(", ")
      : "*";
  const from = qualifyResource(query.resource, context.database);
  const where =
    query.filters && query.filters.length > 0
      ? ` WHERE ${query.filters.map((filter) => compileFilter(filter, params)).join(" AND ")}`
      : "";
  const order =
    query.orderBy && query.orderBy.length > 0
      ? ` ORDER BY ${query.orderBy
          .map((entry) => `${quoteIdent(entry.column)} ${compileDirection(entry.direction)}`)
          .join(", ")}`
      : "";
  const limit = bindValue((query.limit ?? 0) + (context.extraRow ? 1 : 0), params, "UInt64");
  const offset = bindValue(query.offset, params, "UInt64");
  const text = `SELECT ${projection} FROM ${from}${where}${order} LIMIT ${limit} OFFSET ${offset}`;
  return { text, params };
}

const INTROSPECT_SQL = `
SELECT
  c.database AS namespace,
  c.table AS name,
  t.engine AS table_type,
  c.name AS column_name,
  c.type AS data_type
FROM system.columns AS c
INNER JOIN system.tables AS t
  ON t.database = c.database AND t.name = c.table
WHERE c.database = {db:String}
  AND t.is_temporary = 0
  AND NOT startsWith(t.name, '.')
ORDER BY c.database, c.table, c.position
LIMIT 10001
`;

export function introspectQuery(database: string): CompiledSql {
  quoteIdent(database);
  return { text: INTROSPECT_SQL, params: { db: database } };
}
