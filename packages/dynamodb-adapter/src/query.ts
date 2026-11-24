import {
  QueryValidationError,
  normalizeAdapterQuery,
  splitResourceName,
  type AdapterColumn,
  type AdapterFilter,
  type AdapterOrderBy,
  type AdapterQuery,
} from "@dash/core";
import { scalarToAttribute, type AttributeValue } from "./values.ts";

const MAX_IN = 100;
const MAX_LIKE = 200;
const DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface TableKeys {
  hash: string;
  hashType: string;
  range?: string;
  rangeType?: string;
}

export interface CompiledRead {
  tableName: string;
  operation: "Query" | "Scan";
  body: Record<string, unknown>;
  residual: AdapterFilter[];
  /** Set when DynamoDB already returns matches in this single-column order. */
  nativeOrder: "asc" | "desc" | null;
  columns: string[] | undefined;
  limit: number;
  offset: number;
  orderBy: AdapterOrderBy[];
  /** A key filter cannot match any item, so the read can skip the network. */
  empty: boolean;
}

type LikeShape =
  | { kind: "exact"; text: string }
  | { kind: "prefix"; text: string }
  | { kind: "contains"; text: string }
  | { kind: "all" }
  | { kind: "residual" };

interface Names {
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
  nameFor(column: string): string;
  valueFor(attribute: AttributeValue): string;
}

export function dynamoTableName(resource: string): string {
  const parts = splitResourceName(resource);
  if (parts.catalog || parts.namespace) {
    throw new QueryValidationError("DynamoDB resource must be a table name");
  }
  if (parts.name.length < 3 || parts.name.length > 255) {
    throw new QueryValidationError("Invalid DynamoDB table name");
  }
  return parts.name;
}

export function compileRead(input: AdapterQuery, keys: TableKeys): CompiledRead {
  const normalized = normalizeAdapterQuery(input);
  const tableName = dynamoTableName(normalized.resource);
  const columns = normalized.columns ? unique(normalized.columns) : undefined;
  const orderBy = normalized.orderBy ?? [];
  const names = createNames();
  const residual: AdapterFilter[] = [];
  const pushed: AdapterFilter[] = [];
  let empty = false;
  for (const filter of normalized.filters ?? []) {
    const outcome = screenKeyFilter(filter, keys);
    if (outcome === "drop") {
      continue;
    }
    if (outcome === "empty") {
      empty = true;
      break;
    }
    const usable = outcome === "strip-null" && Array.isArray(filter.value)
      ? { ...filter, value: filter.value.filter((entry) => entry !== null) }
      : filter;
    if (isResidual(usable)) {
      residual.push(usable);
    } else {
      pushed.push(usable);
    }
  }
  if (empty) {
    return {
      tableName,
      operation: "Scan",
      body: { TableName: tableName },
      residual: [],
      nativeOrder: null,
      columns,
      limit: normalized.limit ?? 1000,
      offset: normalized.offset ?? 0,
      orderBy,
      empty: true,
    };
  }

  const hashFilter = pushed.find(
    (filter) =>
      filter.column === keys.hash &&
      filter.op === "eq" &&
      (typeof filter.value === "string" || typeof filter.value === "number"),
  );
  const keyParts: string[] = [];
  const filterParts: string[] = [];
  let consumed = new Set<AdapterFilter>();
  if (hashFilter) {
    keyParts.push(equal(names, keys.hash, scalarToAttribute(hashFilter.value as string | number)));
    consumed.add(hashFilter);
    const rangeFilter = rangeKeyFilter(pushed, keys.range, keys.rangeType, consumed);
    if (rangeFilter && keys.range) {
      keyParts.push(rangeExpression(names, keys.range, rangeFilter));
      consumed.add(rangeFilter);
    }
  }
  for (const filter of pushed) {
    if (!consumed.has(filter)) {
      filterParts.push(predicate(names, filter));
    }
  }

  const nativeOrder =
    hashFilter &&
    residual.length === 0 &&
    keys.range &&
    orderBy.length === 1 &&
    orderBy[0]?.column === keys.range
      ? orderBy[0].direction
      : null;
  const body: Record<string, unknown> = { TableName: tableName };
  const keyExpression = andJoin(keyParts);
  const filterExpression = andJoin(filterParts);
  if (keyExpression) {
    body.KeyConditionExpression = keyExpression;
  }
  if (filterExpression) {
    body.FilterExpression = filterExpression;
  }
  if (nativeOrder) {
    body.ScanIndexForward = nativeOrder === "asc";
  }
  const inMemoryOrder = orderBy.length > 0 && !nativeOrder;
  if (columns && columns.length > 0 && residual.length === 0 && !inMemoryOrder) {
    body.ProjectionExpression = columns.map((column) => names.nameFor(column)).join(", ");
  }
  if (Object.keys(names.names).length > 0) {
    body.ExpressionAttributeNames = names.names;
  }
  if (Object.keys(names.values).length > 0) {
    body.ExpressionAttributeValues = names.values;
  }
  return {
    tableName,
    operation: hashFilter ? "Query" : "Scan",
    body,
    residual,
    nativeOrder,
    columns,
    limit: normalized.limit ?? 1000,
    offset: normalized.offset ?? 0,
    orderBy,
    empty: false,
  };
}

export function matchesResidual(
  row: Record<string, unknown>,
  filters: readonly AdapterFilter[],
): boolean {
  return filters.every((filter) => matchesLike(row[filter.column] ?? null, filter));
}

/** Items DynamoDB should return for this page when Limit is applied before filters. */
export function boundedPageLimit(compiled: CompiledRead, matched: number): number | undefined {
  const needsComplete =
    compiled.residual.length > 0 || (compiled.orderBy.length > 0 && !compiled.nativeOrder);
  if (needsComplete || compiled.body.FilterExpression !== undefined) {
    return undefined;
  }
  const remaining = compiled.offset + compiled.limit + 1 - matched;
  return remaining > 0 ? remaining : undefined;
}

/** Evaluated items this read may touch. A limited page may read one extra item. */
export function evaluatedItemCeiling(compiled: CompiledRead, cap: number): number {
  return boundedPageLimit(compiled, 0) === undefined ? cap : cap + 1;
}

/**
 * The next page limit.
 * Undefined means DynamoDB applies no Limit.
 */
export function requestLimit(
  compiled: CompiledRead,
  matched: number,
  scanned: number,
  cap: number,
): number | undefined {
  const wanted = boundedPageLimit(compiled, matched);
  if (wanted === undefined) {
    return undefined;
  }
  const room = evaluatedItemCeiling(compiled, cap) - scanned;
  if (room <= 0) {
    return undefined;
  }
  return Math.min(wanted, room);
}

export function exceedsUnfilteredWindow(compiled: CompiledRead, cap: number): boolean {
  const needsComplete =
    compiled.residual.length > 0 || (compiled.orderBy.length > 0 && !compiled.nativeOrder);
  return (
    !needsComplete &&
    compiled.body.FilterExpression === undefined &&
    compiled.offset + compiled.limit > cap
  );
}

export function compareRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  orderBy: readonly AdapterOrderBy[],
): number {
  for (const entry of orderBy) {
    const compared = compareValues(left[entry.column] ?? null, right[entry.column] ?? null);
    if (compared !== 0) {
      return entry.direction === "desc" ? -compared : compared;
    }
  }
  return 0;
}

export function resultColumns(
  rows: readonly Record<string, unknown>[],
  requested: readonly string[] | undefined,
): AdapterColumn[] {
  const names =
    requested && requested.length > 0
      ? requested
      : rows.reduce<string[]>((collected, row) => {
          for (const key of Object.keys(row)) {
            if (!collected.includes(key)) {
              collected.push(key);
            }
          }
          return collected;
        }, []);
  return names.map((name) => ({ name, type: "unknown", nullable: true }));
}

export function projectRow(
  row: Record<string, unknown>,
  columns: readonly string[] | undefined,
): Record<string, unknown> {
  if (!columns || columns.length === 0) {
    return row;
  }
  const selected = Object.create(null) as Record<string, unknown>;
  for (const column of columns) {
    selected[column] = Object.hasOwn(row, column) ? row[column] : null;
  }
  return selected;
}

function createNames(): Names {
  const names = Object.create(null) as Record<string, string>;
  const values = Object.create(null) as Record<string, AttributeValue>;
  const columns = new Map<string, string>();
  let valueIndex = 0;
  return {
    names,
    values,
    nameFor(column: string): string {
      const existing = columns.get(column);
      if (existing) {
        return existing;
      }
      const placeholder = `#c${columns.size}`;
      columns.set(column, placeholder);
      names[placeholder] = column;
      return placeholder;
    },
    valueFor(attribute: AttributeValue): string {
      const placeholder = `:v${valueIndex}`;
      valueIndex += 1;
      values[placeholder] = attribute;
      return placeholder;
    },
  };
}

function isResidual(filter: AdapterFilter): boolean {
  if (filter.op !== "like" && filter.op !== "ilike") {
    return false;
  }
  if (typeof filter.value !== "string") {
    throw new QueryValidationError("Filter operators `like` and `ilike` require a string");
  }
  if (filter.op === "ilike" && !isCaseBlind(filter.value)) {
    return true;
  }
  const shape = likeShape(filter.value);
  return shape.kind === "residual";
}

function isCaseBlind(pattern: string): boolean {
  return pattern.toLowerCase() === pattern.toUpperCase();
}

function likeShape(pattern: string): LikeShape {
  if (pattern.length > MAX_LIKE) {
    throw new QueryValidationError("Filter pattern is too long");
  }
  if (!pattern.includes("%") && !pattern.includes("_")) {
    return { kind: "exact", text: pattern };
  }
  if (pattern.includes("_")) {
    return { kind: "residual" };
  }
  const inner = pattern.replace(/^%+/, "").replace(/%+$/, "");
  if (inner.includes("%") || (pattern.startsWith("%") && !pattern.endsWith("%"))) {
    return { kind: "residual" };
  }
  if (inner.length === 0) {
    return { kind: "all" };
  }
  if (pattern.startsWith("%") && pattern.endsWith("%")) {
    return { kind: "contains", text: inner };
  }
  if (pattern.endsWith("%")) {
    return { kind: "prefix", text: inner };
  }
  return { kind: "exact", text: pattern };
}

function screenKeyFilter(
  filter: AdapterFilter,
  keys: TableKeys,
): "ok" | "drop" | "empty" | "strip-null" {
  const keyType = filter.column === keys.hash ? keys.hashType : filter.column === keys.range ? keys.rangeType : undefined;
  if (!keyType) {
    return "ok";
  }
  if (filter.op === "eq" && filter.value === null) {
    return "empty";
  }
  if (filter.op === "neq" && filter.value === null) {
    return "drop";
  }
  if (
    (filter.op === "gt" || filter.op === "gte" || filter.op === "lt" || filter.op === "lte") &&
    filter.value === null
  ) {
    return "empty";
  }
  if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      return "ok";
    }
    const present = filter.value.filter((entry) => entry !== null);
    if (present.length === 0) {
      return "empty";
    }
    if (present.some((entry) => !scalarMatchesKey(entry, keyType))) {
      throw new QueryValidationError("Filter value does not match the DynamoDB key type");
    }
    return filter.value.some((entry) => entry === null) ? "strip-null" : "ok";
  }
  if (filter.op === "like" || filter.op === "ilike") {
    if (keyType !== "string" || typeof filter.value !== "string") {
      throw new QueryValidationError("Filter value does not match the DynamoDB key type");
    }
    return "ok";
  }
  if (!scalarMatchesKey(filter.value, keyType)) {
    throw new QueryValidationError("Filter value does not match the DynamoDB key type");
  }
  return "ok";
}

function scalarMatchesKey(value: unknown, keyType: string): boolean {
  if (keyType === "string") {
    return typeof value === "string";
  }
  if (keyType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return false;
}

function rangeKeyFilter(
  filters: readonly AdapterFilter[],
  range: string | undefined,
  rangeType: string | undefined,
  consumed: ReadonlySet<AdapterFilter>,
): AdapterFilter | undefined {
  if (!range) {
    return undefined;
  }
  const candidates = filters.filter(
    (filter) => !consumed.has(filter) && canBeRangeKey(filter, range, rangeType),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function canBeRangeKey(filter: AdapterFilter, range: string, rangeType: string | undefined): boolean {
  if (filter.column !== range || !rangeType) {
    return false;
  }
  if (
    (filter.op === "eq" || filter.op === "lt" || filter.op === "lte" || filter.op === "gt" || filter.op === "gte") &&
    scalarMatchesKey(filter.value, rangeType)
  ) {
    return true;
  }
  return (
    rangeType === "string" &&
    filter.op === "like" &&
    typeof filter.value === "string" &&
    likeShape(filter.value).kind === "prefix"
  );
}

function rangeExpression(names: Names, column: string, filter: AdapterFilter): string {
  if (filter.op === "like" && typeof filter.value === "string") {
    const shape = likeShape(filter.value);
    if (shape.kind === "prefix") {
      return beginsWith(names, column, shape.text);
    }
  }
  if (typeof filter.value !== "string" && typeof filter.value !== "number") {
    throw new QueryValidationError("filter value must be a string, number, boolean, or null");
  }
  const attribute = scalarToAttribute(filter.value);
  if (filter.op === "eq") {
    return equal(names, column, attribute);
  }
  const operator = filter.op === "gt" ? ">" : filter.op === "gte" ? ">=" : filter.op === "lt" ? "<" : "<=";
  return compare(names, column, operator, attribute);
}

function predicate(names: Names, filter: AdapterFilter): string {
  switch (filter.op) {
    case "eq":
      return filter.value === null
        ? isNull(names, filter.column)
        : equal(names, filter.column, scalar(filter.value));
    case "neq":
      return filter.value === null
        ? isNotNull(names, filter.column)
        : notEqual(names, filter.column, scalar(filter.value));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (filter.value === null) {
        return never(names, filter.column);
      }
      const operator = filter.op === "gt" ? ">" : filter.op === "gte" ? ">=" : filter.op === "lt" ? "<" : "<=";
      return compare(names, filter.column, operator, scalar(filter.value));
    }
    case "in":
      return membership(names, filter);
    case "like":
    case "ilike":
      return likePredicate(names, filter);
    default:
      throw new QueryValidationError(`Unsupported filter operator: ${String(filter.op)}`);
  }
}

function likePredicate(names: Names, filter: AdapterFilter): string {
  if (typeof filter.value !== "string") {
    throw new QueryValidationError("Filter operators `like` and `ilike` require a string");
  }
  const shape = likeShape(filter.value);
  switch (shape.kind) {
    case "exact":
      return equal(names, filter.column, { S: shape.text });
    case "prefix":
      return beginsWith(names, filter.column, shape.text);
    case "contains":
      return contains(names, filter.column, shape.text);
    case "all":
      return isString(names, filter.column);
    case "residual":
      throw new QueryValidationError("Filter pattern cannot be compiled");
  }
}

function membership(names: Names, filter: AdapterFilter): string {
  if (!Array.isArray(filter.value)) {
    throw new QueryValidationError("Filter operator `in` requires an array value");
  }
  if (filter.value.length === 0) {
    throw new QueryValidationError("Filter operator `in` requires a non-empty array");
  }
  if (filter.value.length > MAX_IN) {
    throw new QueryValidationError(`Filter operator \`in\` accepts at most ${MAX_IN} values`);
  }
  const values: AttributeValue[] = [];
  let includeNull = false;
  for (const entry of filter.value) {
    if (entry === null) {
      includeNull = true;
      continue;
    }
    values.push(scalar(entry));
  }
  const parts: string[] = [];
  if (values.length > 0) {
    const placeholder = names.nameFor(filter.column);
    const list = values.map((value) => names.valueFor(value));
    parts.push(`${placeholder} IN (${list.join(", ")})`);
  }
  if (includeNull) {
    parts.push(isNull(names, filter.column));
  }
  return andUnwrap(parts);
}

function scalar(value: unknown): AttributeValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return scalarToAttribute(value);
  }
  throw new QueryValidationError("filter value must be a string, number, boolean, or null");
}

function equal(names: Names, column: string, attribute: AttributeValue): string {
  return `${names.nameFor(column)} = ${names.valueFor(attribute)}`;
}

function compare(
  names: Names,
  column: string,
  operator: ">" | ">=" | "<" | "<=",
  attribute: AttributeValue,
): string {
  return `${names.nameFor(column)} ${operator} ${names.valueFor(attribute)}`;
}

function beginsWith(names: Names, column: string, text: string): string {
  return `begins_with(${names.nameFor(column)}, ${names.valueFor({ S: text })})`;
}

function contains(names: Names, column: string, text: string): string {
  return `contains(${names.nameFor(column)}, ${names.valueFor({ S: text })})`;
}

function isNull(names: Names, column: string): string {
  const placeholder = names.nameFor(column);
  return `(attribute_not_exists(${placeholder}) OR ${placeholder} = ${names.valueFor({ NULL: true })})`;
}

function isNotNull(names: Names, column: string): string {
  const placeholder = names.nameFor(column);
  return `(attribute_exists(${placeholder}) AND NOT (${placeholder} = ${names.valueFor({ NULL: true })}))`;
}

function notEqual(names: Names, column: string, attribute: AttributeValue): string {
  const placeholder = names.nameFor(column);
  return `(attribute_exists(${placeholder}) AND NOT (${placeholder} = ${names.valueFor({ NULL: true })}) AND ${placeholder} <> ${names.valueFor(attribute)})`;
}

function never(names: Names, column: string): string {
  const placeholder = names.nameFor(column);
  return `(attribute_exists(${placeholder}) AND attribute_not_exists(${placeholder}))`;
}

function isString(names: Names, column: string): string {
  const placeholder = names.nameFor(column);
  return `(attribute_exists(${placeholder}) AND attribute_type(${placeholder}, ${names.valueFor({ S: "S" })}))`;
}

function andJoin(parts: string[]): string | undefined {
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return parts.map((part) => `(${part})`).join(" AND ");
}

function andUnwrap(parts: string[]): string {
  if (parts.length === 1) {
    return parts[0]!;
  }
  return `(${parts.join(" OR ")})`;
}

function unique(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }
  return result;
}

function matchesLike(value: unknown, filter: AdapterFilter): boolean {
  if (typeof value !== "string" || typeof filter.value !== "string") {
    return false;
  }
  const insensitive = filter.op === "ilike";
  return matchLike(
    insensitive ? value.toLowerCase() : value,
    insensitive ? filter.value.toLowerCase() : filter.value,
  );
}

function matchLike(text: string, pattern: string): boolean {
  let textIndex = 0;
  let patternIndex = 0;
  let star = -1;
  let mark = 0;
  while (textIndex < text.length) {
    const token = pattern[patternIndex];
    if (patternIndex < pattern.length && (token === "_" || token === text[textIndex])) {
      textIndex += 1;
      patternIndex += 1;
      continue;
    }
    if (patternIndex < pattern.length && token === "%") {
      star = patternIndex;
      mark = textIndex;
      patternIndex += 1;
      continue;
    }
    if (star !== -1) {
      patternIndex = star + 1;
      mark += 1;
      textIndex = mark;
      continue;
    }
    return false;
  }
  while (pattern[patternIndex] === "%") {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  if (typeof left === "string" && typeof right === "string") {
    const decimal = compareDecimal(left, right);
    if (decimal !== undefined) {
      return decimal;
    }
    return compareStrings(left, right);
  }
  return compareStrings(String(left), String(right));
}

function compareDecimal(left: string, right: string): number | undefined {
  if (!DECIMAL_TEXT.test(left) || !DECIMAL_TEXT.test(right)) {
    return undefined;
  }
  const leftNegative = left.startsWith("-");
  const rightNegative = right.startsWith("-");
  const compared = compareAbsoluteDecimal(
    leftNegative ? left.slice(1) : left,
    rightNegative ? right.slice(1) : right,
  );
  if (compared === 0) {
    return 0;
  }
  if (leftNegative !== rightNegative) {
    return leftNegative ? -1 : 1;
  }
  return leftNegative ? -compared : compared;
}

function compareAbsoluteDecimal(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const leftWhole = leftParts[0] ?? "0";
  const rightWhole = rightParts[0] ?? "0";
  const leftFraction = leftParts[1] ?? "";
  const rightFraction = rightParts[1] ?? "";
  if (leftWhole.length !== rightWhole.length) {
    return leftWhole.length - rightWhole.length;
  }
  if (leftWhole !== rightWhole) {
    return leftWhole < rightWhole ? -1 : 1;
  }
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftDigits = leftFraction.padEnd(width, "0");
  const rightDigits = rightFraction.padEnd(width, "0");
  if (leftDigits === rightDigits) {
    return 0;
  }
  return leftDigits < rightDigits ? -1 : 1;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
