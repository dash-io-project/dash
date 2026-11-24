import { types } from "cassandra-driver";

function positionNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof types.Long) {
    return value.toNumber();
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function columnPosition(value: unknown): number {
  return positionNumber(value);
}

export function normalizeValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof types.Long || value instanceof types.BigDecimal || value instanceof types.Integer) {
    return value.toString();
  }
  if (
    value instanceof types.Uuid ||
    value instanceof types.InetAddress ||
    value instanceof types.LocalDate ||
    value instanceof types.LocalTime ||
    value instanceof types.Duration
  ) {
    return value.toString();
  }
  if (value instanceof types.Tuple) {
    return value.values().map((entry) => normalizeValue(entry));
  }
  if (value instanceof types.Vector) {
    return [...value.elements].map((entry) => normalizeValue(entry));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => normalizeValue(entry));
  }
  if (value instanceof Map) {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of value) {
      record[String(normalizeValue(key))] = normalizeValue(entry);
    }
    return record;
  }
  return value;
}
