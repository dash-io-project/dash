import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { toPlain } from "./values.ts";

describe("toPlain", () => {
  it("converts driver values to JSON data", () => {
    expect(toPlain(null)).toBeNull();
    expect(toPlain(undefined)).toBeNull();
    expect(toPlain("paid")).toBe("paid");
    expect(toPlain(true)).toBe(true);
    expect(toPlain(1.5)).toBe(1.5);
    expect(toPlain(Number.NaN)).toBeNull();
    expect(toPlain(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toPlain(10n)).toBe(10);
    expect(toPlain(9223372036854775807n)).toBe("9223372036854775807");
    expect(toPlain(neo4j.int(10))).toBe(10);
    expect(toPlain(neo4j.int("9223372036854775807"))).toBe("9223372036854775807");
    expect(toPlain([neo4j.int(1), "a"])).toEqual([1, "a"]);

    const date = new Date("2026-01-15T00:00:00.000Z");
    expect(toPlain(date)).toBe("2026-01-15T00:00:00.000Z");
    const graphDate = new neo4j.types.Date(2026, 1, 15);
    expect(toPlain(graphDate)).toBe(graphDate.toString());
    const graphTime = new neo4j.types.LocalTime(1, 2, 3, 0);
    expect(toPlain(graphTime)).toBe(graphTime.toString());
    const graphDuration = new neo4j.types.Duration(1, 2, 3, 4);
    expect(toPlain(graphDuration)).toBe(graphDuration.toString());
    const graphDateTime = new neo4j.types.DateTime(2026, 1, 15, 1, 2, 3, 0, 0);
    expect(toPlain(graphDateTime)).toBe(graphDateTime.toString());
    const point = new neo4j.types.Point(4326, 1, 2);
    expect(toPlain(point)).toBe(point.toString());
  });

  it("drops unsafe keys and unwraps graph elements", () => {
    const raw = JSON.parse('{"name":"Ada","__proto__":{"admin":true},"constructor":1}') as Record<
      string,
      unknown
    >;
    const plain = toPlain(raw) as Record<string, unknown>;
    expect(plain.name).toBe("Ada");
    expect(Object.hasOwn(plain, "__proto__")).toBe(false);
    expect(Object.hasOwn(plain, "constructor")).toBe(false);
    expect(plain.admin).toBeUndefined();

    const node = new neo4j.types.Node(neo4j.int(1), ["orders"], { id: neo4j.int(4), note: null });
    expect(toPlain(node)).toEqual({ id: 4, note: null });
    const relationship = new neo4j.types.Relationship(
      neo4j.int(2),
      neo4j.int(1),
      neo4j.int(3),
      "PLACED",
      { amount: neo4j.int(10) },
    );
    expect(toPlain(relationship)).toEqual({ amount: 10 });
    expect(toPlain(Symbol("x"))).toBe("Symbol(x)");
  });
});
