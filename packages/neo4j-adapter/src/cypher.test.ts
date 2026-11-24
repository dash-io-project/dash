import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { compileRead, likeToRegex } from "./cypher.ts";

describe("compileRead", () => {
  it("binds the label, the property, and the literal", () => {
    const compiled = compileRead({
      resource: "node.orders",
      columns: ["id", "status"],
      filters: [
        { column: "status", op: "eq", value: "paid' OR 1=1" },
        { column: "total", op: "gte", value: 10 },
        { column: "id", op: "in", value: [1, 2] },
      ],
      orderBy: [{ column: "total", direction: "desc" }],
      limit: 50,
      offset: 10,
    });
    expect(compiled.text).toContain("MATCH (entity)");
    expect(compiled.text).toContain("$name IN labels(entity)");
    expect(compiled.text).toContain("entity[$c0]");
    expect(compiled.text).toContain("SKIP $skip");
    expect(compiled.text).toContain("LIMIT $limit");
    expect(compiled.text).not.toContain("orders");
    expect(compiled.text).not.toContain("status");
    expect(compiled.text).not.toContain("total");
    expect(compiled.text).not.toContain("paid");
    expect(compiled.text).toContain(" AND ");
    expect(compiled.text).toContain("$o0");
    expect(compileRead({ resource: "node.orders", columns: [] }).parameters.columns).toBeNull();
    expect(
      compileRead({
        resource: "node.orders",
        filters: [
          { column: "open", op: "eq", value: true },
          { column: "note", op: "eq", value: null },
        ],
      }).parameters,
    ).toMatchObject({ v0: true, v1: null });
    expect(compiled.parameters).toMatchObject({
      name: "orders",
      columns: ["id", "status"],
      skip: 10,
      limit: 50,
      c0: "status",
      v0: "paid' OR 1=1",
      c1: "total",
      v1: 10,
      c2: "id",
      v2: [1, 2],
      o0: "total",
      d0: "desc",
    });
  });

  it("binds a relationship type and returns every property when columns are omitted", () => {
    const compiled = compileRead({ resource: "relationship.PLACED" });
    expect(compiled.text).toContain("MATCH ()-[entity]->()");
    expect(compiled.text).toContain("type(entity) = $name");
    expect(compiled.text).not.toContain("PLACED");
    expect(compiled.parameters.name).toBe("PLACED");
    expect(compiled.parameters.columns).toBeNull();
    expect(compiled.parameters.limit).toBe(1000);
    expect(compiled.parameters.skip).toBe(0);
  });

  it("rejects names and values that must not reach the server", () => {
    expect(() => compileRead({ resource: "orders" })).toThrow(QueryValidationError);
    expect(() => compileRead({ resource: "node.orders; DROP" })).toThrow(QueryValidationError);
    expect(() => compileRead({ resource: "db.node.orders" })).toThrow(QueryValidationError);
    expect(() => compileRead({ resource: "node.constructor" })).toThrow(/invalid resource/i);
    expect(() =>
      compileRead({ resource: "node.orders", columns: ["__proto__"] }),
    ).toThrow(/invalid column/i);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "status", op: "eq", value: { $gt: "" } }],
      }),
    ).toThrow(/string, number, boolean, or null/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "id", op: "in", value: [] }],
      }),
    ).toThrow(/non-empty array/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "status", op: "like", value: 12 }],
      }),
    ).toThrow(/like/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "region", op: "ilike", value: 1 }],
      }),
    ).toThrow(/ilike/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "note", op: "like", value: "x".repeat(201) }],
      }),
    ).toThrow(/too long/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "id", op: "in", value: Array.from({ length: 101 }, (_, index) => index) }],
      }),
    ).toThrow(/at most 100/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: Array.from({ length: 33 }, () => ({ column: "id", op: "eq" as const, value: 1 })),
      }),
    ).toThrow(/at most 32/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        orderBy: Array.from({ length: 9 }, () => ({ column: "id", direction: "asc" as const })),
      }),
    ).toThrow(/at most 8/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        filters: [{ column: "total", op: "gt", value: Number.NaN }],
      }),
    ).toThrow(/finite number/);
    expect(() =>
      compileRead({
        resource: "node.orders",
        orderBy: [{ column: "id", direction: "sideways" as "asc" }],
      }),
    ).toThrow(QueryValidationError);
  });
});

describe("likeToRegex", () => {
  it("maps SQL LIKE wildcards and escapes regex text", () => {
    expect(likeToRegex("p%", false)).toBe("(?s)^p.*$");
    expect(likeToRegex("%EUROPE%", true)).toBe("(?is)^.*EUROPE.*$");
    expect(likeToRegex("a_c", false)).toBe("(?s)^a.c$");
    expect(likeToRegex("a.b", false)).toBe("(?s)^a\\.b$");
    expect(likeToRegex("100\\%", false)).toBe("(?s)^100%$");
    expect(likeToRegex("a\\_b", false)).toBe("(?s)^a_b$");
    expect(likeToRegex("end\\", false)).toBe("(?s)^end\\\\$");
  });
});
