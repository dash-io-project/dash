import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { compileSelect, introspectQuery } from "./sql.ts";

function compile(
  input: Parameters<typeof compileSelect>[0],
  database = "analytics",
) {
  return compileSelect(input, { database });
}

describe("compileSelect", () => {
  it("parameterizes filters, limit, and offset", () => {
    const compiled = compile({
      resource: "analytics.orders",
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
    expect(compiled.text).toBe(
      "SELECT `id`, `total` FROM `analytics`.`orders` WHERE `status` = {p0:String} AND `total` >= {p1:Int64} AND `id` IN ({p2:Int64}, {p3:Int64}, {p4:Int64}) ORDER BY `total` DESC LIMIT {p5:UInt64} OFFSET {p6:UInt64}",
    );
    expect(compiled.params).toEqual({
      p0: "paid",
      p1: 10,
      p2: 1,
      p3: 2,
      p4: 3,
      p5: 50,
      p6: 10,
    });
  });

  it("quotes identifiers and rejects injection in the resource name", () => {
    expect(() => compile({ resource: "orders;drop table users" })).toThrow(QueryValidationError);
    const compiled = compile({ resource: "monthly_revenue" });
    expect(compiled.text.startsWith("SELECT * FROM `analytics`.`monthly_revenue`")).toBe(true);
    expect(compile({ resource: "analytics.order-items" }).text).toContain(
      "`analytics`.`order-items`",
    );
  });

  it("rejects a catalog-qualified resource and a different database", () => {
    expect(() => compile({ resource: "dev.analytics.orders" })).toThrow(
      /ClickHouse resource must be database\.table/,
    );
    expect(() => compile({ resource: "system.users" })).toThrow(/connected database/);
    expect(compile({ resource: "orders" }, "default").text).toContain("`default`.`orders`");
  });

  it("keeps introspection inside the connected database", () => {
    const introspection = introspectQuery("analytics");
    expect(introspection.text).toContain("{db:String}");
    expect(introspection.text).not.toContain("currentDatabase()");
    expect(introspection.params).toEqual({ db: "analytics" });
    expect(introspection.text).toContain("is_temporary = 0");
    expect(introspection.text).toContain("LIMIT 10001");
    expect(introspection.text).not.toContain("system.databases");
    expect(() => introspectQuery("system.users")).toThrow(QueryValidationError);
  });

  it("requests one row past the maximum page", () => {
    const compiled = compileSelect(
      { resource: "orders", limit: 10_000 },
      { database: "analytics", extraRow: true },
    );
    expect(compiled.params).toEqual({ p0: 10_001, p1: 0 });
  });

  it("compiles null comparisons without binding null", () => {
    const compiled = compile({
      resource: "orders",
      columns: ["id"],
      filters: [
        { column: "note", op: "eq", value: null },
        { column: "region", op: "neq", value: null },
      ],
      limit: 5,
    });
    expect(compiled.text).toContain("`note` IS NULL");
    expect(compiled.text).toContain("`region` IS NOT NULL");
    expect(compiled.params).toEqual({ p0: 5, p1: 0 });
  });

  it("types strings, floats, booleans, and dates without putting them in the SQL", () => {
    const when = new Date("2026-01-02T03:04:05.006Z");
    const compiled = compile({
      resource: "orders",
      filters: [
        { column: "status", op: "ilike", value: "%paid%" },
        { column: "total", op: "gt", value: 1.5 },
        { column: "flag", op: "eq", value: true },
        { column: "created", op: "eq", value: when },
      ],
      limit: 1,
    });
    expect(compiled.text).toContain("`status` ILIKE {p0:String}");
    expect(compiled.text).toContain("`total` > {p1:Float64}");
    expect(compiled.text).toContain("`flag` = {p2:Bool}");
    expect(compiled.text).toContain("`created` = {p3:DateTime64(3, 'UTC')}");
    expect(compiled.text).not.toContain("%paid%");
    expect(compiled.params.p0).toBe("%paid%");
    expect(compiled.params.p1).toBe(1.5);
    expect(compiled.params.p2).toBe(true);
    expect(compiled.params.p3).toBe("2026-01-02 03:04:05.006");
  });

  it("rejects an in list past the cap and an in list that contains null", () => {
    expect(() =>
      compile({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: Array.from({ length: 1001 }, (_, index) => index) }],
      }),
    ).toThrow(/at most 1000/);
    expect(() =>
      compile({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: [1, null] }],
      }),
    ).toThrow(/null/);
  });
});
