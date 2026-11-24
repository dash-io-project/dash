import { describe, expect, it } from "vitest";
import { inferColumns, queryColumns, recordRows } from "./schema.ts";

describe("inferColumns", () => {
  it("marks null and missing keys as nullable and collapses mixed types", () => {
    expect(
      inferColumns([
        { id: 1, note: "first", region: "Europe" },
        { id: 2, note: null, extra: true },
        { id: "x", note: "third" },
      ]),
    ).toEqual([
      { name: "extra", type: "boolean", nullable: true },
      { name: "id", type: "unknown", nullable: false },
      { name: "note", type: "string", nullable: true },
      { name: "region", type: "string", nullable: true },
    ]);
  });
});

describe("queryColumns", () => {
  it("keeps requested names in order and otherwise uses row keys or the signature", () => {
    expect(queryColumns([{ amount: 1, month: "2026-01" }], undefined, ["month", "amount"])).toEqual([
      { name: "month", type: "unknown", nullable: true },
      { name: "amount", type: "unknown", nullable: true },
    ]);
    expect(queryColumns([{ id: 1, status: "paid" }], { other: "json" }, undefined)).toEqual([
      { name: "id", type: "unknown", nullable: true },
      { name: "status", type: "unknown", nullable: true },
    ]);
    expect(queryColumns([], { id: "json", "*": "json" }, undefined)).toEqual([
      { name: "id", type: "unknown", nullable: true },
    ]);
  });
});

describe("recordRows", () => {
  it("keeps objects and rejects a primitive row", () => {
    expect(recordRows([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(() => recordRows([1])).toThrow(/unexpected row/);
    expect(() => recordRows([null])).toThrow(/unexpected row/);
    expect(() => recordRows([["id"]])).toThrow(/unexpected row/);
  });
});
