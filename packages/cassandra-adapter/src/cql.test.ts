import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { compileSelect } from "./cql.ts";

describe("compileSelect", () => {
  it("binds filters and limit and keeps offset out of the statement", () => {
    const compiled = compileSelect({
      resource: "dash.orders",
      columns: ["id", "total"],
      filters: [
        { column: "status", op: "eq", value: "paid'; DROP TABLE orders; --" },
        { column: "total", op: "gte", value: 10 },
        { column: "id", op: "in", value: [1, 2, 3] },
      ],
      orderBy: [{ column: "id", direction: "desc" }],
      limit: 50,
      offset: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "id", "total" FROM "dash"."orders" WHERE "status" = ? AND "total" >= ? AND "id" IN (?, ?, ?) ORDER BY "id" DESC LIMIT ? ALLOW FILTERING',
    );
    expect(compiled.text).not.toContain("DROP");
    expect(compiled.values).toEqual(["paid'; DROP TABLE orders; --", 10, 1, 2, 3, 60]);
    expect(compiled.offset).toBe(10);
    expect(compiled.limit).toBe(50);

    const dated = compileSelect({
      resource: "samples",
      filters: [
        { column: "seen", op: "eq", value: new Date("2026-01-15T12:00:00.000Z") },
        { column: "big", op: "eq", value: 9007199254740993n },
      ],
      limit: 1,
    });
    expect(dated.text).toBe(
      'SELECT * FROM "samples" WHERE "seen" = ? AND "big" = ? LIMIT ? ALLOW FILTERING',
    );
    expect(dated.text).not.toContain("2026");
    expect(dated.values[0]).toEqual(new Date("2026-01-15T12:00:00.000Z"));
    expect(dated.values[1]).toBe(9007199254740993n);
  });

  it("quotes a table and rejects unsafe queries", () => {
    const compiled = compileSelect({ resource: "monthly_revenue" });
    expect(compiled.text).toBe('SELECT * FROM "monthly_revenue" LIMIT ?');
    expect(compiled.values).toEqual([1000]);

    expect(() => compileSelect({ resource: "orders; DROP TABLE users" })).toThrow(QueryValidationError);
    expect(() => compileSelect({ resource: "catalog.dash.orders" })).toThrow(
      /keyspace\.table/,
    );
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "status", op: "neq", value: "open" }],
      }),
    ).toThrow(/does not support neq/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "status", op: "like", value: "p%" }],
      }),
    ).toThrow(/does not support like/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "status", op: "ilike", value: "%paid%" }],
      }),
    ).toThrow(/does not support ilike/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: [] }],
      }),
    ).toThrow(/non-empty array/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "note", op: "eq", value: null }],
      }),
    ).toThrow(/cannot be null/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "total", op: "eq", value: Number.NaN }],
      }),
    ).toThrow(/finite numbers/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "status", op: "eq", value: { bad: true } }],
      }),
    ).toThrow(/scalar values/);
    expect(() => compileSelect({ resource: "orders", limit: 10_000, offset: 1 })).toThrow(
      /10000 rows/,
    );
  });
});
