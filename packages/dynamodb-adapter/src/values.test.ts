import { describe, expect, it } from "vitest";
import { readAttribute, readNumber, unmarshallItem } from "./values.ts";

describe("DynamoDB values", () => {
  it("keeps integers that do not fit a safe number as strings", () => {
    expect(readNumber("10")).toBe(10);
    expect(readNumber("9007199254740993")).toBe("9007199254740993");
    expect(readNumber("10.5")).toBe(10.5);
  });

  it("does not let a map key change Object.prototype", () => {
    const map = Object.create(null) as Record<string, unknown>;
    map.__proto__ = { S: "x" };
    const value = readAttribute({ M: map }) as Record<string, unknown>;
    expect(value["__proto__"]).toBe("x");
    expect(({} as { x?: string }).x).toBeUndefined();
  });

  it("unmarshalls an item to plain values", () => {
    expect(
      unmarshallItem({
        id: { N: "1" },
        status: { S: "paid" },
        note: { NULL: true },
        flags: { L: [{ BOOL: true }] },
      }),
    ).toEqual({ id: 1, status: "paid", note: null, flags: [true] });
  });
});
