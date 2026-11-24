import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import { compileSelect } from "./sql.ts";

const context = { bucket: "dash", scope: "analytics" };

describe("compileSelect", () => {
  it("parameterizes filters, limit, and offset", () => {
    const compiled = compileSelect(
      {
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
      },
      context,
    );
    expect(compiled.text).toBe(
      "SELECT `id`, `total` FROM `dash`.`analytics`.`orders` WHERE `status` = $1 AND `total` >= $2 AND `id` IN [$3, $4, $5] ORDER BY `total` DESC LIMIT $6 OFFSET $7",
    );
    expect(compiled.values).toEqual(["paid", 10, 1, 2, 3, 50, 10]);
    expect(compiled.limit).toBe(50);
    expect(compiled.text).not.toContain("paid");
  });

  it("qualifies one, two, and three part names", () => {
    const one = compileSelect({ resource: "orders" }, context);
    expect(one.text.startsWith("SELECT d.* FROM `dash`.`analytics`.`orders` AS d ")).toBe(true);

    const two = compileSelect({ resource: "inventory.orders" }, context);
    expect(two.text).toContain("FROM `dash`.`inventory`.`orders` AS d ");

    const three = compileSelect({ resource: "other.inventory.orders" }, context);
    expect(three.text).toContain("FROM `other`.`inventory`.`orders` AS d ");
  });

  it("compiles like, ilike, and null without inlining values", () => {
    const compiled = compileSelect(
      {
        resource: "orders",
        columns: ["id"],
        filters: [
          { column: "status", op: "like", value: "p%" },
          { column: "region", op: "ilike", value: "%EUROPE%" },
          { column: "note", op: "eq", value: null },
          { column: "region", op: "neq", value: null },
        ],
        limit: 5,
      },
      context,
    );
    expect(compiled.text).toContain("`status` LIKE $1");
    expect(compiled.text).toContain("LOWER(`region`) LIKE LOWER($2)");
    expect(compiled.text).toContain("`note` IS NULL");
    expect(compiled.text).toContain("`region` IS NOT NULL");
    expect(compiled.values).toEqual(["p%", "%EUROPE%", 5, 0]);
  });

  it("rejects injection in the resource name and an empty in list", () => {
    expect(() => compileSelect({ resource: "orders;drop table users" }, context)).toThrow(
      QueryValidationError,
    );
    expect(() =>
      compileSelect(
        { resource: "orders", filters: [{ column: "id", op: "in", value: [] }] },
        context,
      ),
    ).toThrow(QueryValidationError);
    expect(() => compileSelect({ resource: "orders" }, { bucket: "bad name", scope: "analytics" })).toThrow(
      QueryValidationError,
    );
  });
});
