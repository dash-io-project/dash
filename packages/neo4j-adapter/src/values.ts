import neo4j from "neo4j-driver";

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function plainRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

export function assignPlain(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function isSafeKey(name: string): boolean {
  return SAFE_KEY.test(name) && !BANNED_KEYS.has(name);
}

function temporalText(value: object): string | undefined {
  if (
    neo4j.isDate(value) ||
    neo4j.isDateTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isDuration(value) ||
    neo4j.isPoint(value) ||
    neo4j.isPath(value)
  ) {
    return String(value);
  }
  return undefined;
}

/** Turn a driver value into JSON data. Unsafe keys are dropped. */
export function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry));
  }
  if (typeof value === "object") {
    if (neo4j.isNode(value) || neo4j.isRelationship(value)) {
      return toPlain(value.properties);
    }
    const text = temporalText(value);
    if (text !== undefined) {
      return text;
    }
    const output = plainRecord();
    for (const key of Object.keys(value)) {
      if (!isSafeKey(key)) {
        continue;
      }
      assignPlain(output, key, toPlain((value as Record<string, unknown>)[key]));
    }
    return output;
  }
  return String(value);
}
