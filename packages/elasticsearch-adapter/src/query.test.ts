import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { columnsFromProperties, compileSearch, likeToWildcard } from "./query.ts";

describe("compileSearch", () => {
  it("builds a search body from scalars and validated names", () => {
    const compiled = compileSearch({
      resource: "orders",
      columns: ["id", "total"],
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "total", op: "gte", value: 10 },
        { column: "id", op: "in", value: [1, 2, 3] },
      ],
      orderBy: [{ column: "total", direction: "desc" }],
      limit: 50,
      offset: 10,
    });
    expect(compiled.index).toBe("orders");
    expect(compiled.limit).toBe(50);
    expect(compiled.lookAhead).toBe(true);
    expect(compiled.body.size).toBe(51);
    expect(compiled.body.from).toBe(10);
    expect(compiled.body._source).toEqual(["id", "total"]);
    expect(compiled.body.sort).toEqual([{ total: { order: "desc" } }]);
    expect(compiled.body.query).toEqual({
      bool: {
        filter: [
          {
            bool: {
              should: [{ term: { status: "paid" } }, { term: { "status.keyword": "paid" } }],
              minimum_should_match: 1,
            },
          },
          { range: { total: { gte: 10 } } },
          { terms: { id: [1, 2, 3] } },
        ],
      },
    });
  });

  it("turns like patterns into escaped wildcards", () => {
    expect(likeToWildcard("100%")).toBe("100*");
    expect(likeToWildcard("a.b_c")).toBe("a.b?c");
    expect(likeToWildcard("100*")).toBe("100\\*");
    expect(likeToWildcard("a\\b")).toBe("a\\\\b");
    const compiled = compileSearch({
      resource: "orders",
      filters: [
        { column: "note", op: "like", value: "100%" },
        { column: "region", op: "ilike", value: "%EUROPE%" },
      ],
    });
    expect(compiled.body.query).toEqual({
      bool: {
        filter: [
          {
            bool: {
              should: [
                { wildcard: { note: { value: "100*" } } },
                { wildcard: { "note.keyword": { value: "100*" } } },
              ],
              minimum_should_match: 1,
            },
          },
          {
            bool: {
              should: [
                { wildcard: { region: { value: "*EUROPE*", case_insensitive: true } } },
                { wildcard: { "region.keyword": { value: "*EUROPE*", case_insensitive: true } } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    });
  });

  it("treats null as a missing field and excludes nulls from inequality", () => {
    const equalNull = compileSearch({
      resource: "orders",
      filters: [{ column: "note", op: "eq", value: null }],
    });
    expect(equalNull.body.query).toEqual({
      bool: { must_not: [{ exists: { field: "note" } }] },
    });

    const notEqual = compileSearch({
      resource: "orders",
      filters: [{ column: "note", op: "neq", value: "first" }],
    });
    expect(notEqual.body.query).toEqual({
      bool: {
        filter: [
          { exists: { field: "note" } },
          {
            bool: {
              must_not: [
                {
                  bool: {
                    should: [{ term: { note: "first" } }, { term: { "note.keyword": "first" } }],
                    minimum_should_match: 1,
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const notEqualNull = compileSearch({
      resource: "orders",
      filters: [{ column: "note", op: "neq", value: null }],
    });
    expect(notEqualNull.body.query).toEqual({ exists: { field: "note" } });

    const rangeNull = compileSearch({
      resource: "orders",
      filters: [{ column: "total", op: "gt", value: null }],
    });
    expect(rangeNull.body.query).toEqual({ match_none: {} });
  });

  it("includes null in an `in` list as a missing field", () => {
    const compiled = compileSearch({
      resource: "orders",
      filters: [{ column: "note", op: "in", value: ["first", null] }],
    });
    expect(compiled.body.query).toEqual({
      bool: {
        should: [
          {
            bool: {
              should: [{ terms: { note: ["first"] } }, { terms: { "note.keyword": ["first"] } }],
              minimum_should_match: 1,
            },
          },
          { bool: { must_not: [{ exists: { field: "note" } }] } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it("requests only the document id when that is the selected column", () => {
    const compiled = compileSearch({
      resource: "orders",
      columns: ["_id"],
    });
    expect(compiled.body._source).toBe(false);
    expect(compiled.body.query).toEqual({ match_all: {} });
  });

  it("rejects a qualified name, an operator object, and a window past 10000", () => {
    expect(() => compileSearch({ resource: "dash.orders" })).toThrow(QueryValidationError);
    expect(() => compileSearch({ resource: "Orders" })).toThrow(QueryValidationError);
    expect(() =>
      compileSearch({
        resource: "orders",
        filters: [{ column: "status", op: "eq", value: { term: "paid" } }],
      }),
    ).toThrow(QueryValidationError);
    expect(() =>
      compileSearch({
        resource: "orders",
        filters: [{ column: "constructor", op: "eq", value: 1 }],
      }),
    ).toThrow(QueryValidationError);
    expect(() => compileSearch({ resource: "orders", limit: 1000, offset: 9001 })).toThrow(
      /10000/,
    );
  });

  it("stops at the result window instead of reading one extra hit", () => {
    const edge = compileSearch({ resource: "orders", limit: 10, offset: 9990 });
    expect(edge.lookAhead).toBe(false);
    expect(edge.body.size).toBe(10);
    const full = compileSearch({ resource: "orders", limit: 10000 });
    expect(full.lookAhead).toBe(false);
    expect(full.body.size).toBe(10000);
  });
});

describe("columnsFromProperties", () => {
  it("maps Elasticsearch field types and skips names that cannot be queried", () => {
    const columns = columnsFromProperties({
      status: { type: "keyword" },
      total: { type: "integer" },
      note: { type: "text" },
      "user.name": { type: "keyword" },
      constructor: { type: "keyword" },
    });
    expect(columns).toEqual([
      { name: "_id", type: "string", nullable: false },
      { name: "note", type: "string", nullable: true },
      { name: "status", type: "string", nullable: true },
      { name: "total", type: "number", nullable: true },
    ]);
  });
});
