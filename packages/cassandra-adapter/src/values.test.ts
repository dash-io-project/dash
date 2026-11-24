import { types } from "cassandra-driver";
import { describe, expect, it } from "vitest";
import { columnPosition, normalizeValue } from "./values.ts";

describe("normalizeValue", () => {
  it("turns driver values into JSON-safe data", () => {
    const long = types.Long.fromString("9007199254740993");
    const uuid = types.Uuid.fromString("123e4567-e89b-12d3-a456-426614174000");
    const when = new Date("2026-01-15T12:00:00.000Z");
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue("paid")).toBe("paid");
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue(10)).toBe(10);
    expect(normalizeValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeValue(9007199254740993n)).toBe("9007199254740993");
    expect(normalizeValue(when)).toBe("2026-01-15T12:00:00.000Z");
    expect(normalizeValue(Buffer.from("hi"))).toBe("aGk=");
    expect(normalizeValue(long)).toBe("9007199254740993");
    expect(normalizeValue(types.BigDecimal.fromString("12.50"))).toBe("12.50");
    expect(normalizeValue(types.Integer.fromString("42"))).toBe("42");
    expect(normalizeValue(uuid)).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(normalizeValue(types.InetAddress.fromString("127.0.0.1"))).toBe("127.0.0.1");
    expect(normalizeValue(types.LocalDate.fromString("2026-01-15"))).toBe("2026-01-15");
    expect(normalizeValue(types.LocalTime.fromString("12:00:00"))).toBe("12:00:00");
    expect(normalizeValue(types.Duration.fromString("1h"))).toBe("1h");
    expect(normalizeValue(types.Tuple.fromArray([1, "paid"]))).toEqual([1, "paid"]);
    expect(normalizeValue(new types.Vector([1, 2], "float"))).toEqual([1, 2]);
    expect(normalizeValue([1, long])).toEqual([1, "9007199254740993"]);
    expect(normalizeValue(new Set(["a"]))).toEqual(["a"]);
    expect(normalizeValue(new Map([["k", 2]]))).toEqual({ k: 2 });
    expect(normalizeValue({ extra: 1 })).toEqual({ extra: 1 });
  });
});

describe("columnPosition", () => {
  it("reads a number, a long, or an empty position", () => {
    expect(columnPosition(null)).toBe(0);
    expect(columnPosition(2)).toBe(2);
    expect(columnPosition(types.Long.fromInt(-1))).toBe(-1);
    expect(columnPosition("nope")).toBe(0);
  });
});
