import { type AdapterQuery, QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { INTROSPECT_SQL, compileSelect } from "./sql.ts";

describe("compileSelect", () => {
  it("parameterizes filters, offset, and limit", () => {
    const compiled = compileSelect({
      resource: "DASH.ORDERS",
      columns: ["ID", "TOTAL"],
      filters: [
        { column: "STATUS", op: "eq", value: "paid" },
        { column: "TOTAL", op: "gte", value: 10 },
        { column: "ID", op: "in", value: [1, 2, 3] },
      ],
      orderBy: [{ column: "TOTAL", direction: "desc" }],
      limit: 50,
      offset: 10,
    });
    expect(compiled.text).toBe(
      'SELECT "ID", "TOTAL" FROM "DASH"."ORDERS" WHERE "STATUS" = ? AND "TOTAL" >= ? AND "ID" IN (?, ?, ?) ORDER BY "TOTAL" DESC OFFSET ? ROWS FETCH FIRST ? ROWS ONLY',
    );
    expect(compiled.values).toEqual(["paid", 10, 1, 2, 3, 10, 50]);
    expect(compiled.limit).toBe(50);
  });

  it("compiles each comparison and qualifies an unqualified name", () => {
    const compiled = compileSelect(
      {
        resource: "ORDERS",
        columns: ["ID"],
        filters: [
          { column: "STATUS", op: "neq", value: "open" },
          { column: "TOTAL", op: "gt", value: 1 },
          { column: "TOTAL", op: "lt", value: 5 },
          { column: "TOTAL", op: "lte", value: 4 },
          { column: "NOTE", op: "like", value: "p%" },
          { column: "REGION", op: "ilike", value: "%EUROPE%" },
        ],
        orderBy: [{ column: "ID", direction: "asc" }],
        limit: 10,
      },
      "DASH",
    );
    expect(compiled.text).toBe(
      'SELECT "ID" FROM "DASH"."ORDERS" WHERE "STATUS" <> ? AND "TOTAL" > ? AND "TOTAL" < ? AND "TOTAL" <= ? AND "NOTE" LIKE ? AND UPPER("REGION") LIKE UPPER(?) ORDER BY "ID" ASC OFFSET ? ROWS FETCH FIRST ? ROWS ONLY',
    );
    expect(compiled.values).toEqual(["open", 1, 5, 4, "p%", "%EUROPE%", 0, 10]);
  });

  it("keeps an explicit schema and does not inline filter text", () => {
    const payload = "paid' OR 1=1; -- ";
    const compiled = compileSelect(
      {
        resource: "OTHER.ORDERS",
        filters: [
          { column: "STATUS", op: "eq", value: payload },
          { column: "STATUS", op: "in", value: [payload, "open"] },
        ],
      },
      "DASH",
    );
    expect(compiled.text).toBe(
      'SELECT * FROM "OTHER"."ORDERS" WHERE "STATUS" = ? AND "STATUS" IN (?, ?) OFFSET ? ROWS FETCH FIRST ? ROWS ONLY',
    );
    expect(compiled.values).toEqual([payload, payload, "open", 0, 1000]);
    expect(compiled.text).not.toContain(payload);
  });

  it.each(["ID`", "ID; SELECT 1", "ID/*comment*/", "ID\u0000", "ID\n", "1ID"])(
    "rejects an invalid identifier without a change to the name: %j",
    (column) => {
      for (const input of [
        { columns: [column] },
        { filters: [{ column, op: "eq" as const, value: "paid" }] },
        { orderBy: [{ column, direction: "asc" as const }] },
      ]) {
        expect(() => compileSelect({ resource: "ORDERS", ...input })).toThrow(QueryValidationError);
      }
    },
  );

  it.each<Partial<AdapterQuery>>([
    { resource: 'ORDERS" WHERE 1=1 --' },
    { resource: "CATALOG.DASH.ORDERS" },
    { columns: ["ID`, SLEEP(1) --"] },
    { filters: [{ column: "STATUS` OR 1=1 --", op: "eq", value: "paid" }] },
    { filters: [{ column: "ID", op: "in", value: [] }] },
    { orderBy: [{ column: "ID` --", direction: "asc" }] },
    { orderBy: [{ column: "ID", direction: "desc; SELECT 1" as "desc" }] },
    { limit: "1; DROP TABLE ORDERS" as unknown as number },
    { offset: "0 OR 1=1" as unknown as number },
  ])("rejects SQL syntax in structural input: %j", (input) => {
    expect(() => compileSelect({ resource: "ORDERS", ...input })).toThrow(QueryValidationError);
  });

  it("rejects an identifier longer than 128 characters", () => {
    const column = "A".repeat(129);
    expect(() => compileSelect({ resource: "ORDERS", columns: [column] })).toThrow(
      "Invalid Db2 identifier",
    );
    expect(() => compileSelect({ resource: "ORDERS", columns: ["A".repeat(128)] })).not.toThrow();
  });

  it("rejects a default schema that is not an identifier", () => {
    expect(() => compileSelect({ resource: "ORDERS" }, "DASH;DROP")).toThrow(QueryValidationError);
  });

  it("quotes a hyphenated name and selects every column by default", () => {
    const compiled = compileSelect({ resource: "monthly-revenue", columns: ["ID--"] });
    expect(compiled.text.startsWith('SELECT "ID--" FROM "monthly-revenue"')).toBe(true);
  });
});

describe("INTROSPECT_SQL", () => {
  it("reads the catalog with fixed identifiers", () => {
    expect(INTROSPECT_SQL).toContain('AS "namespace"');
    expect(INTROSPECT_SQL).toContain("'SYSIBM'");
    expect(INTROSPECT_SQL).not.toContain("${");
  });
});
