import { type AdapterQuery, QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { compileSelect } from "./sql.ts";

describe("compileSelect", () => {
  it.each(["id\"", "id; SELECT 1", "id--", "id/*comment*/", "id\u0000", "id\n"])(
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

  it("preserves legitimate punctuation in bound filter values", () => {
    const value = "O'Reilly; -- \\ books";
    const compiled = compileSelect({
      resource: "orders",
      filters: [{ column: "note", op: "eq", value }],
    });
    expect(compiled.text).toBe(
      'SELECT * FROM "ORDERS" WHERE "NOTE" = :p0 ORDER BY NULL OFFSET :p1 ROWS FETCH NEXT :p2 ROWS ONLY',
    );
    expect(compiled.values).toEqual([value, 0, 1000]);
  });

  it.each<Partial<AdapterQuery>>([
    { resource: "orders;drop table users" },
    { resource: "catalog.schema.orders" },
    { columns: ['id", 1 --'] },
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
      'SELECT * FROM "ORDERS" WHERE "STATUS" = :p0 AND "STATUS" IN (:p1, :p2) ORDER BY NULL OFFSET :p3 ROWS FETCH NEXT :p4 ROWS ONLY',
    );
    expect(compiled.values).toEqual([payload, payload, "open", 0, 1000]);
  });

  it("parameterizes filters, limit, and offset", () => {
    const compiled = compileSelect({
      resource: "DASH.orders",
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
      'SELECT "ID", "TOTAL" FROM "DASH"."ORDERS" WHERE "STATUS" = :p0 AND "TOTAL" >= :p1 AND "ID" IN (:p2, :p3, :p4) ORDER BY "TOTAL" DESC OFFSET :p5 ROWS FETCH NEXT :p6 ROWS ONLY',
    );
    expect(compiled.values).toEqual(["paid", 10, 1, 2, 3, 10, 50]);
  });

  it("compiles null comparisons without binding null", () => {
    const compiled = compileSelect({
      resource: "orders",
      columns: ["id"],
      filters: [
        { column: "region", op: "eq", value: null },
        { column: "note", op: "neq", value: null },
      ],
      limit: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "ID" FROM "ORDERS" WHERE "REGION" IS NULL AND "NOTE" IS NOT NULL ORDER BY NULL OFFSET :p0 ROWS FETCH NEXT :p1 ROWS ONLY',
    );
    expect(compiled.values).toEqual([0, 10]);
  });

  it("rejects an empty string because Oracle stores it as null", () => {
    expect(() =>
      compileSelect({
        resource: "orders",
        filters: [{ column: "status", op: "eq", value: "" }],
      }),
    ).toThrow(/empty string/);
  });

  it("compiles ilike with LOWER because Oracle has no ILIKE", () => {
    const compiled = compileSelect({
      resource: "orders",
      columns: ["id"],
      filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }],
      limit: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "ID" FROM "ORDERS" WHERE LOWER("REGION") LIKE LOWER(:p0) ORDER BY NULL OFFSET :p1 ROWS FETCH NEXT :p2 ROWS ONLY',
    );
    expect(compiled.values).toEqual(["%EUROPE%", 0, 10]);
  });

  it("compiles like with a binary collation so it stays case-sensitive", () => {
    const compiled = compileSelect({
      resource: "orders",
      columns: ["id"],
      filters: [{ column: "status", op: "like", value: "p%" }],
      limit: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "ID" FROM "ORDERS" WHERE "STATUS" COLLATE BINARY_CS LIKE :p0 ORDER BY NULL OFFSET :p1 ROWS FETCH NEXT :p2 ROWS ONLY',
    );
    expect(compiled.values).toEqual(["p%", 0, 10]);
  });

  it("quotes identifiers and rejects injection in the resource name", () => {
    expect(() => compileSelect({ resource: "orders;drop table users" })).toThrow(
      QueryValidationError,
    );
    const compiled = compileSelect({ resource: "monthly_revenue" });
    expect(compiled.text.startsWith('SELECT * FROM "MONTHLY_REVENUE"')).toBe(true);
  });
});
