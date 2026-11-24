import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { compileSearch, indexName } from "./query.ts";

describe("compileSearch", () => {
  it("builds a search body from scalars and validated names", () => {
    const compiled = compileSearch(
      {
        resource: "dash_orders",
        columns: ["id", "total"],
        filters: [
          { column: "status", op: "eq", value: "paid" },
          { column: "total", op: "gte", value: 10 },
          { column: "id", op: "in", value: [1, 2, 3] },
        ],
        orderBy: [{ column: "total", direction: "desc" }],
        limit: 50,
        offset: 10,
      },
      (field) => (field === "status" ? "status.keyword" : field),
    );
    expect(compiled.index).toBe("dash_orders");
    expect(compiled.body.size).toBe(50);
    expect(compiled.body.from).toBe(10);
    expect(compiled.body._source).toEqual(["id", "total"]);
    expect(compiled.body.sort).toEqual([{ "total": "desc" }]);
    expect(compiled.body.query).toEqual({
      bool: {
        filter: [
          { term: { "status.keyword": "paid" } },
          { range: { total: { gte: 10 } } },
          { terms: { id: [1, 2, 3] } },
        ],
      },
    });
  });

  it("escapes like patterns and anchors them to the whole term", () => {
    const compiled = compileSearch({
      resource: "dash_orders",
      filters: [
        { column: "note", op: "like", value: "100%" },
        { column: "note", op: "ilike", value: "a.b_c" },
        { column: "note", op: "like", value: "a*b?c\\d" },
      ],
    });
    expect(compiled.body.query).toEqual({
      bool: {
        filter: [
          { wildcard: { note: { value: "100*", case_insensitive: false } } },
          { wildcard: { note: { value: "a.b?c", case_insensitive: true } } },
          { wildcard: { note: { value: "a\\*b\\?c\\\\d", case_insensitive: false } } },
        ],
      },
    });
  });

  it("matches SQL null comparisons", () => {
    const equalNull = compileSearch({
      resource: "dash_orders",
      filters: [{ column: "note", op: "eq", value: null }],
    });
    expect(equalNull.body.query).toEqual({
      bool: { must_not: [{ exists: { field: "note" } }] },
    });

    const notEqual = compileSearch({
      resource: "dash_orders",
      filters: [{ column: "note", op: "neq", value: "Alpha" }],
    });
    expect(notEqual.body.query).toEqual({
      bool: {
        filter: [
          { exists: { field: "note" } },
          { bool: { must_not: [{ term: { note: "Alpha" } }] } },
        ],
      },
    });

    const notEqualNull = compileSearch({
      resource: "dash_orders",
      filters: [{ column: "note", op: "neq", value: null }],
    });
    expect(notEqualNull.body.query).toEqual({ exists: { field: "note" } });

    const compared = compileSearch({
      resource: "dash_orders",
      filters: [{ column: "total", op: "gt", value: null }],
    });
    expect(compared.body.query).toEqual({ bool: { must_not: [{ match_all: {} }] } });
  });

  it("treats null inside an in-list as a missing field", () => {
    const compiled = compileSearch({
      resource: "dash_orders",
      filters: [{ column: "note", op: "in", value: ["beta", null] }],
    });
    expect(compiled.body.query).toEqual({
      bool: {
        should: [
          { terms: { note: ["beta"] } },
          { bool: { must_not: [{ exists: { field: "note" } }] } },
        ],
        minimum_should_match: 1,
      },
    });

    const onlyNull = compileSearch({
      resource: "dash_orders",
      filters: [{ column: "note", op: "in", value: [null] }],
    });
    expect(onlyNull.body.query).toEqual({ bool: { must_not: [{ exists: { field: "note" } }] } });
  });

  it("keeps _id out of _source and still requests the other columns", () => {
    const compiled = compileSearch({
      resource: "dash_orders",
      columns: ["_id", "status"],
      orderBy: [{ column: "_id", direction: "asc" }],
    });
    expect(compiled.body._source).toEqual(["status"]);
    expect(compiled.body.sort).toEqual([{ _id: "asc" }]);
    expect(compiled.body.query).toEqual({ match_all: {} });
  });

  it("returns no source fields when the only column is _id", () => {
    const compiled = compileSearch({
      resource: "dash_orders",
      columns: ["_id"],
    });
    expect(compiled.body._source).toBe(false);
  });

  it("accepts a boolean and an empty column list", () => {
    const compiled = compileSearch({
      resource: "dash_orders",
      columns: [],
      filters: [{ column: "flag", op: "eq", value: true }],
    });
    expect(compiled.body._source).toBeUndefined();
    expect(compiled.body.query).toEqual({ term: { flag: true } });
  });

  it("rejects names and values that could change the query", () => {
    expect(() => indexName(1 as unknown as string)).toThrow(QueryValidationError);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "note", op: "eq", value: "a".repeat(10_001) }],
      }),
    ).toThrow(/too long/);
    expect(() => indexName("Dash_Orders")).toThrow(QueryValidationError);
    expect(() => indexName("*")).toThrow(QueryValidationError);
    expect(() => indexName("dash_orders,other")).toThrow(QueryValidationError);
    expect(() => indexName(".hidden")).toThrow(QueryValidationError);
    expect(() => compileSearch({ resource: "orders.paid" })).toThrow(QueryValidationError);
    expect(() =>
      compileSearch({ resource: "dash_orders", columns: ["__proto__"] }),
    ).toThrow(QueryValidationError);
    expect(() =>
      compileSearch({ resource: "dash_orders", columns: ["_source"] }),
    ).toThrow(QueryValidationError);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "status", op: "eq", value: { gt: 1 } }],
      }),
    ).toThrow(/string, number, boolean, or null/);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "note", op: "like", value: 1 }],
      }),
    ).toThrow(/string/);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "status", op: "in", value: [] }],
      }),
    ).toThrow(/non-empty array/);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "status", op: "in", value: Array.from({ length: 101 }, (_, i) => i) }],
      }),
    ).toThrow(/at most 100/);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "note", op: "like", value: "a".repeat(201) }],
      }),
    ).toThrow(/too long/);
    expect(() =>
      compileSearch({
        resource: "dash_orders",
        filters: [{ column: "total", op: "gt", value: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow(/finite number/);
    expect(() => compileSearch({ resource: "dash_orders", limit: 1, offset: 10_000 })).toThrow(
      /10000/,
    );
  });
});
