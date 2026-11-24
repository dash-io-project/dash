import type { AdapterColumn } from "@dash/core";

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return typeof value;
    case "object":
      return value === null ? "unknown" : "object";
    default:
      return "unknown";
  }
}

export function recordRows(rows: readonly unknown[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Couchbase query returned an unexpected row");
    }
    return row as Record<string, unknown>;
  });
}

/** Column names and types from a sample of documents. */
export function inferColumns(rows: readonly Record<string, unknown>[]): AdapterColumn[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      names.add(name);
    }
  }
  return [...names].sort().map((name) => {
    const types = new Set<string>();
    let nullable = false;
    for (const row of rows) {
      if (!Object.prototype.hasOwnProperty.call(row, name) || row[name] === null) {
        nullable = true;
        continue;
      }
      types.add(valueType(row[name]));
    }
    const type = types.size === 1 ? [...types][0]! : "unknown";
    return { name, type, nullable };
  });
}

function signatureNames(signature: unknown): string[] {
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    return [];
  }
  return Object.keys(signature).filter((name) => name !== "*");
}

/**
 * Column list for a query result. Requested names keep their order.
 * A star query uses row keys, then the engine signature.
 */
export function queryColumns(
  rows: readonly Record<string, unknown>[],
  signature: unknown,
  requested: readonly string[] | undefined,
): AdapterColumn[] {
  if (requested && requested.length > 0) {
    return requested.map((name) => ({ name, type: "unknown", nullable: true }));
  }
  const fromRows = rows[0] ? Object.keys(rows[0]) : [];
  const names = fromRows.length > 0 ? fromRows : signatureNames(signature);
  return names.map((name) => ({ name, type: "unknown", nullable: true }));
}
