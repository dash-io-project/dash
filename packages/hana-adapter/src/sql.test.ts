import { type AdapterQuery, QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { INTROSPECT_SQL, TEST_CONNECTION_SQL, compileSelect } from "./sql.ts";

describe("compileSelect", () => {
  it.each(["id\"", "id; SELECT 1", "id/*comment*/", "id\u0000", "id\n"])(
    "rejects invalid identifiers without cleaning them: %j",
    (column) => {
      for (const input of [
        { columns: [column] },
        { filters: [{ column, op: "eq" as const, value: "paid" }] },
        { orderBy: [{ column, direction: "asc" as const }] },
      ]) {
        expect(() => compileSelect({ resource: "orders", ...input })).toThrow(QueryValidationError);
      }
    },
  );

  it("preserves punctuation in bound filter values", () => {
    const value = "O'Reilly; -- \\ books";
    const compiled = compileSelect({
      resource: "orders",
      filters: [{ column: "note", op: "eq", value }],
    });
    expect(compiled.text).toBe('SELECT * FROM "orders" WHERE "note" = ? LIMIT ? OFFSET ?');
    expect(compiled.values).toEqual([value, 1000, 0]);
    expect(compiled.text).not.toContain("O'Reilly");
  });

  it.each<Partial<AdapterQuery>>([
    { resource: 'orders" WHERE 1=1 --' },
    { columns: ['id", SLEEP(1) --'] },
    { filters: [{ column: 'status" OR 1=1 --', op: "eq", value: "paid" }] },
    { orderBy: [{ column: 'id" --', direction: "asc" }] },
    { orderBy: [{ column: "id", direction: "desc; SELECT 1" as "desc" }] },
    { limit: "1; DROP TABLE orders" as unknown as number },
    { offset: "0 OR 1=1" as unknown as number },
  ])("rejects SQL syntax in structural input: %j", (input) => {
    expect(() => compileSelect({ resource: "orders", ...input })).toThrow(QueryValidationError);
  });

  it("keeps injection payloads out of SQL text, including IN values", () => {
    const payload = "paid' OR 1=1; -- ";
    const compiled = compileSelect({
      resource: "orders",
      filters: [
        { column: "status", op: "eq", value: payload },
        { column: "status", op: "in", value: [payload, "open"] },
      ],
    });
    expect(compiled.text).toBe(
      'SELECT * FROM "orders" WHERE "status" = ? AND "status" IN (?, ?) LIMIT ? OFFSET ?',
    );
    expect(compiled.values).toEqual([payload, payload, "open", 1000, 0]);
    expect(compiled.text).not.toContain(payload);
  });

  it("keeps an object filter value out of the SQL text", () => {
    const value = { $gt: 1 };
    const compiled = compileSelect({
      resource: "orders",
      filters: [{ column: "status", op: "eq", value }],
    });
    expect(compiled.text).not.toContain("$gt");
    expect(compiled.values[0]).toBe(value);
  });

  it("parameterizes filters, limit, and offset", () => {
    const compiled = compileSelect({
      resource: "analytics.orders",
      columns: ["id", "total"],
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "total", op: "neq", value: 0 },
        { column: "total", op: "gt", value: 1 },
        { column: "total", op: "gte", value: 10 },
        { column: "total", op: "lt", value: 100 },
        { column: "total", op: "lte", value: 50 },
        { column: "id", op: "in", value: [1, 2, 3] },
      ],
      orderBy: [{ column: "total", direction: "desc" }],
      limit: 50,
      offset: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "id", "total" FROM "analytics"."orders" WHERE "status" = ? AND "total" <> ? AND "total" > ? AND "total" >= ? AND "total" < ? AND "total" <= ? AND "id" IN (?, ?, ?) ORDER BY "total" DESC LIMIT ? OFFSET ?',
    );
    expect(compiled.values).toEqual(["paid", 0, 1, 10, 100, 50, 1, 2, 3, 50, 10]);
    expect(compiled.text).not.toContain(" 50");
  });

  it("quotes a hyphen, including a double hyphen, inside the identifier", () => {
    const compiled = compileSelect({
      resource: "orders",
      columns: ["id--"],
    });
    expect(compiled.text.startsWith('SELECT "id--" FROM "orders"')).toBe(true);
    expect(compiled.text).not.toContain("-- FROM");
  });

  it("quotes a hyphenated identifier and compiles ascending order", () => {
    const compiled = compileSelect({
      resource: "monthly_revenue",
      columns: ["month-total"],
      orderBy: [{ column: "month-total", direction: "asc" }],
    });
    expect(compiled.text).toBe(
      'SELECT "month-total" FROM "monthly_revenue" ORDER BY "month-total" ASC LIMIT ? OFFSET ?',
    );
  });

  it("uses star when the column list is empty", () => {
    const compiled = compileSelect({ resource: "orders", columns: [] });
    expect(compiled.text.startsWith('SELECT * FROM "orders"')).toBe(true);
  });

  it("compiles like as case-sensitive and ilike with LOWER", () => {
    const like = compileSelect({
      resource: "orders",
      columns: ["id"],
      filters: [{ column: "status", op: "like", value: "p%" }],
      limit: 10,
    });
    expect(like.text).toBe('SELECT "id" FROM "orders" WHERE "status" LIKE ? LIMIT ? OFFSET ?');
    expect(like.values).toEqual(["p%", 10, 0]);

    const ilike = compileSelect({
      resource: "orders",
      columns: ["id"],
      filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }],
      limit: 10,
    });
    expect(ilike.text).toBe(
      'SELECT "id" FROM "orders" WHERE LOWER("region") LIKE LOWER(?) LIMIT ? OFFSET ?',
    );
    expect(ilike.values).toEqual(["%EUROPE%", 10, 0]);
  });

  it("rejects a catalog.schema.table name and an empty IN list", () => {
    expect(() => compileSelect({ resource: "catalog.analytics.orders" })).toThrow(
      /schema\.table/,
    );
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "id", op: "in", value: [] }],
      }),
    ).toThrow(/non-empty array/);
  });
});

describe("static SQL", () => {
  it("keeps introspection and the connection test free of placeholders", () => {
    expect(INTROSPECT_SQL).toContain("SYS.TABLE_COLUMNS");
    expect(INTROSPECT_SQL).toContain("SYS.VIEW_COLUMNS");
    expect(INTROSPECT_SQL).toContain('AS "namespace"');
    expect(INTROSPECT_SQL).not.toContain("?");
    expect(INTROSPECT_SQL).not.toContain("${");
    expect(TEST_CONNECTION_SQL).toBe('SELECT 1 AS "ok" FROM DUMMY');
  });
});
