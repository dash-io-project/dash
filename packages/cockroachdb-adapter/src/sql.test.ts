import { QueryValidationError, type AdapterFilter } from "@dash/core";
import { describe, expect, it } from "vitest";
import { INTROSPECT_SQL, compileSelect } from "./sql.ts";

describe("compileSelect", () => {
  it("parameterizes filters, limit, and offset", () => {
    const compiled = compileSelect({
      resource: "public.orders",
      columns: ["id", "total"],
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "total", op: "gte", value: 10 },
        { column: "id", op: "in", value: [1, 2, 3] },
        { column: "region", op: "ilike", value: "%europe%" },
        { column: "note", op: "like", value: "f%" },
        { column: "total", op: "gt", value: 1 },
        { column: "total", op: "lt", value: 100 },
        { column: "total", op: "lte", value: 40 },
        { column: "status", op: "neq", value: "void" },
      ],
      orderBy: [{ column: "total", direction: "desc" }],
      limit: 50,
      offset: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "id", "total" FROM "public"."orders" WHERE "status" = $1 AND "total" >= $2 AND "id" IN ($3, $4, $5) AND "region" ILIKE $6 AND "note" LIKE $7 AND "total" > $8 AND "total" < $9 AND "total" <= $10 AND "status" <> $11 ORDER BY "total" DESC LIMIT $12 OFFSET $13',
    );
    expect(compiled.values).toEqual(["paid", 10, 1, 2, 3, "%europe%", "f%", 1, 100, 40, "void", 50, 10]);
    expect(compiled.text).not.toContain("paid");
  });

  it("quotes a three-part name and a hyphenated name", () => {
    expect(compileSelect({ resource: "other.public.extra" }).text).toContain(
      'FROM "other"."public"."extra"',
    );
    expect(compileSelect({ resource: "analytics.order-items" }).text).toContain(
      '"analytics"."order-items"',
    );
    const plain = compileSelect({ resource: "monthly_revenue", columns: [], orderBy: [] });
    expect(plain.text.startsWith('SELECT * FROM "monthly_revenue"')).toBe(true);
    expect(plain.values).toEqual([1000, 0]);
  });

  it("rejects an identifier and does not repeat it", () => {
    expect(() => compileSelect({ resource: "orders;drop table users" })).toThrow(
      /Invalid CockroachDB identifier/,
    );
    expect(() => compileSelect({ resource: "a.b.c.d" })).toThrow(/Invalid CockroachDB identifier/);
    expect(() => compileSelect({ resource: "orders", columns: ["id;drop"] })).toThrow(
      /Invalid CockroachDB identifier/,
    );
    try {
      compileSelect({ resource: "orders;drop table users" });
    } catch (error) {
      expect(error).toBeInstanceOf(QueryValidationError);
      expect(error instanceof Error ? error.message : "").not.toContain("drop");
    }
  });

  it("rejects a bad order direction and a bad operator without repeating them", () => {
    expect(() =>
      compileSelect({
        resource: "orders",
        orderBy: [{ column: "id", direction: "sideways" as "asc" }],
      }),
    ).toThrow(/Invalid CockroachDB order direction/);
    const filter = { column: "id", op: "nope", value: 1 } as unknown as AdapterFilter;
    expect(() => compileSelect({ resource: "orders", filters: [filter] })).toThrow(
      /Unsupported CockroachDB filter operator/,
    );
    try {
      compileSelect({ resource: "orders", filters: [filter] });
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain("nope");
    }
  });

  it("compiles null comparisons without binding null", () => {
    const compiled = compileSelect({
      resource: "orders",
      columns: ["id"],
      filters: [
        { column: "note", op: "eq", value: null },
        { column: "region", op: "neq", value: null },
      ],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 5,
    });
    expect(compiled.text).toContain('"note" IS NULL');
    expect(compiled.text).toContain('"region" IS NOT NULL');
    expect(compiled.text).toContain("ASC");
    expect(compiled.values).toEqual([5, 0]);
  });

  it("rejects null for a comparison and rejects an empty or huge in list", () => {
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "total", op: "gt", value: null }],
      }),
    ).toThrow(/does not accept null/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: [] }],
      }),
    ).toThrow(/non-empty array/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: "1,2" }],
      }),
    ).toThrow(/requires an array/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: [1, null] }],
      }),
    ).toThrow(/does not accept null/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: [1, undefined] }],
      }),
    ).toThrow(/does not accept null/);
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: Array.from({ length: 1001 }, (_, index) => index) }],
      }),
    ).toThrow(/at most 1000/);
    const accepted = compileSelect({
      resource: "orders",
      filters: [{ column: "id", op: "in", value: Array.from({ length: 1000 }, (_, index) => index) }],
      limit: 1,
    });
    expect(accepted.values).toHaveLength(1002);
  });

  it("keeps CockroachDB system schemas and hidden columns out of introspection", () => {
    expect(INTROSPECT_SQL).toContain("crdb_sql_type");
    expect(INTROSPECT_SQL).toContain("is_hidden = 'NO'");
    expect(INTROSPECT_SQL).toContain("table_catalog");
    expect(INTROSPECT_SQL).toContain("'pg_catalog'");
    expect(INTROSPECT_SQL).toContain("'information_schema'");
    expect(INTROSPECT_SQL).toContain("'crdb_internal'");
    expect(INTROSPECT_SQL).toContain("'pg_extension'");
    expect(INTROSPECT_SQL).toContain("LIMIT 10001");
  });
});
