import { QueryValidationError } from "@dash/core";

const MAX_STRING = 10_000;
const MAX_DEPTH = 32;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INTEGER = /^-?(?:0|[1-9]\d*)$/;

export type AttributeValue =
  | { S: string }
  | { N: string }
  | { BOOL: boolean }
  | { NULL: true }
  | { B: string }
  | { L: AttributeValue[] }
  | { M: Record<string, AttributeValue> }
  | { SS: string[] }
  | { NS: string[] }
  | { BS: string[] };

export function writeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new QueryValidationError("filter value must be a finite number");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  if (Number.isSafeInteger(value)) {
    return String(value);
  }
  const text = String(value);
  if (!DECIMAL.test(text)) {
    throw new QueryValidationError("filter value is not a DynamoDB decimal");
  }
  return text;
}

export function readNumber(text: string): number | string {
  if (!DECIMAL.test(text)) {
    return text;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return text;
  }
  if (INTEGER.test(text)) {
    return Number.isSafeInteger(value) && String(value) === text ? value : text;
  }
  return String(value) === text ? value : text;
}

export function scalarToAttribute(value: string | number | boolean | null): AttributeValue {
  if (value === null) {
    return { NULL: true };
  }
  if (typeof value === "boolean") {
    return { BOOL: value };
  }
  if (typeof value === "number") {
    return { N: writeNumber(value) };
  }
  if (value.length > MAX_STRING) {
    throw new QueryValidationError("filter value is too long");
  }
  return { S: value };
}

function plain(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function unexpected(): never {
  throw new Error("DynamoDB returned an unexpected response");
}

export function rawAttributeType(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return "unknown";
  }
  switch (keys[0]) {
    case "S":
      return "string";
    case "N":
      return "number";
    case "BOOL":
      return "boolean";
    case "NULL":
      return "null";
    case "B":
      return "binary";
    case "L":
      return "list";
    case "M":
      return "map";
    case "SS":
      return "stringset";
    case "NS":
      return "numberset";
    case "BS":
      return "binaryset";
    default:
      return "unknown";
  }
}

export function readAttribute(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    unexpected();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    unexpected();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) {
    unexpected();
  }
  const key = keys[0]!;
  const inner = record[key];
  switch (key) {
    case "S":
    case "B":
      if (typeof inner !== "string") {
        unexpected();
      }
      return inner;
    case "N":
      if (typeof inner !== "string") {
        unexpected();
      }
      return readNumber(inner);
    case "BOOL":
      if (typeof inner !== "boolean") {
        unexpected();
      }
      return inner;
    case "NULL":
      if (inner !== true) {
        unexpected();
      }
      return null;
    case "SS":
    case "BS":
      if (!Array.isArray(inner) || inner.some((entry) => typeof entry !== "string")) {
        unexpected();
      }
      return inner;
    case "NS":
      if (!Array.isArray(inner) || inner.some((entry) => typeof entry !== "string")) {
        unexpected();
      }
      return inner.map((entry) => readNumber(entry));
    case "L":
      if (!Array.isArray(inner)) {
        unexpected();
      }
      return inner.map((entry) => readAttribute(entry, depth + 1));
    case "M":
      if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
        unexpected();
      }
      return readMap(inner as Record<string, unknown>, depth + 1);
    default:
      unexpected();
  }
}

function readMap(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const output = plain();
  for (const key of Object.keys(value)) {
    output[key] = readAttribute(value[key], depth);
  }
  return output;
}

export function unmarshallItem(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    unexpected();
  }
  return readMap(value as Record<string, unknown>, 0);
}
