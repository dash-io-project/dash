import { describe, expect, it } from "vitest";
import { QueryValidationError } from "@dash/core";
import {
  boundedPageLimit,
  compareRows,
  compileRead,
  exceedsUnfilteredWindow,
  matchesResidual,
  type TableKeys,
} from "./query.ts";

const ORDERS: TableKeys = { hash: "id", hashType: "number" };
const REVENUE: TableKeys = { hash: "month", hashType: "string", range: "region", rangeType: "string" };

describe("compileRead", () => {
  it("uses Query when a filter is equality on the partition key", () => {
    const compiled = compileRead(
      { resource: "orders", filters: [{ column: "id", op: "eq", value: 1 }] },
      ORDERS,
    );
    expect(compiled.operation).toBe("Query");
    expect(compiled.body.KeyConditionExpression).toBe("#c0 = :v0");
    expect(compiled.body.ExpressionAttributeNames).toEqual({ "#c0": "id" });
    expect(compiled.body.ExpressionAttributeValues).toEqual({ ":v0": { N: "1" } });
    expect(JSON.stringify(compiled.body.KeyConditionExpression)).not.toContain("id");
  });

  it("scans when the partition key is not bound", () => {
    const compiled = compileRead(
      { resource: "orders", filters: [{ column: "status", op: "eq", value: "paid" }] },
      ORDERS,
    );
    expect(compiled.operation).toBe("Scan");
    expect(compiled.body.KeyConditionExpression).toBeUndefined();
    expect(compiled.body.FilterExpression).toBe("#c0 = :v0");
    expect(compiled.body.ExpressionAttributeNames).toEqual({ "#c0": "status" });
  });

  it("compiles comparisons, membership, and prefix patterns", () => {
    const compiled = compileRead(
      {
        resource: "orders",
        filters: [
          { column: "total", op: "gte", value: 25 },
          { column: "status", op: "like", value: "p%" },
          { column: "id", op: "in", value: [2, 4] },
          { column: "note", op: "eq", value: null },
        ],
      },
      ORDERS,
    );
    expect(compiled.body.FilterExpression).toBe(
      "(#c0 >= :v0) AND (begins_with(#c1, :v1)) AND (#c2 IN (:v2, :v3)) AND ((attribute_not_exists(#c3) OR #c3 = :v4))",
    );
    expect(compiled.residual).toEqual([]);
  });

  it("keeps case-insensitive patterns for after the scan", () => {
    const compiled = compileRead(
      { resource: "orders", filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }] },
      ORDERS,
    );
    expect(compiled.body.FilterExpression).toBeUndefined();
    expect(compiled.residual).toEqual([{ column: "region", op: "ilike", value: "%EUROPE%" }]);
    expect(matchesResidual({ region: "Europe" }, compiled.residual)).toBe(true);
    expect(matchesResidual({ region: "Asia Pacific" }, compiled.residual)).toBe(false);
    expect(matchesResidual({}, compiled.residual)).toBe(false);
  });

  it("puts a sort-key prefix in the key condition and requests descending order", () => {
    const compiled = compileRead(
      {
        resource: "revenue",
        filters: [
          { column: "month", op: "eq", value: "2026-01" },
          { column: "region", op: "like", value: "Eu%" },
        ],
        orderBy: [{ column: "region", direction: "desc" }],
      },
      REVENUE,
    );
    expect(compiled.operation).toBe("Query");
    expect(compiled.body.KeyConditionExpression).toBe("(#c0 = :v0) AND (begins_with(#c1, :v1))");
    expect(compiled.body.ScanIndexForward).toBe(false);
    expect(compiled.nativeOrder).toBe("desc");
  });

  it("rejects a qualified name, an empty list, and an operator object", () => {
    expect(() => compileRead({ resource: "dash.orders" }, ORDERS)).toThrow(QueryValidationError);
    expect(() =>
      compileRead({ resource: "orders", filters: [{ column: "id", op: "in", value: [] }] }, ORDERS),
    ).toThrow(/non-empty array/);
    expect(() =>
      compileRead(
        { resource: "orders", filters: [{ column: "status", op: "eq", value: { S: "paid" } }] },
        ORDERS,
      ),
    ).toThrow(QueryValidationError);
  });

  it("makes a null comparison match nothing", () => {
    const compiled = compileRead(
      { resource: "orders", filters: [{ column: "total", op: "gt", value: null }] },
      ORDERS,
    );
    expect(compiled.body.FilterExpression).toBe(
      "(attribute_exists(#c0) AND attribute_not_exists(#c0))",
    );
  });

  it("projects selected columns only when DynamoDB can apply every filter and the order", () => {
    const projected = compileRead(
      {
        resource: "orders",
        columns: ["status"],
        filters: [{ column: "id", op: "eq", value: 1 }],
      },
      ORDERS,
    );
    expect(projected.body.ProjectionExpression).toBe("#c1");
    expect(projected.body.ExpressionAttributeNames).toEqual({ "#c0": "id", "#c1": "status" });
    expect(boundedPageLimit(projected, 0)).toBe(1001);

    const filtered = compileRead(
      {
        resource: "orders",
        columns: ["status"],
        filters: [{ column: "status", op: "eq", value: "paid" }],
        limit: 10,
      },
      ORDERS,
    );
    expect(filtered.body.ProjectionExpression).toBe("#c0");
    expect(boundedPageLimit(filtered, 0)).toBeUndefined();

    const sorted = compileRead(
      {
        resource: "orders",
        columns: ["status"],
        orderBy: [{ column: "total", direction: "desc" }],
        limit: 10,
      },
      ORDERS,
    );
    expect(sorted.body.ProjectionExpression).toBeUndefined();
    expect(boundedPageLimit(sorted, 0)).toBeUndefined();
    const wide = compileRead({ resource: "orders", limit: 10, offset: 10_000 }, ORDERS);
    expect(exceedsUnfilteredWindow(wide, 10_000)).toBe(true);
    expect(exceedsUnfilteredWindow(filtered, 10_000)).toBe(false);
  });

  it("matches residual patterns without a regular expression", () => {
    expect(matchesResidual({ note: "paid" }, [{ column: "note", op: "like", value: "p_id" }])).toBe(true);
    expect(matchesResidual({ note: "paid" }, [{ column: "note", op: "like", value: "%a%" }])).toBe(true);
    expect(matchesResidual({ note: "aa" }, [{ column: "note", op: "like", value: "%a%a%b" }])).toBe(false);
    expect(matchesResidual({ note: "" }, [{ column: "note", op: "like", value: "%" }])).toBe(true);
  });

  it("rejects a key filter whose type does not match the table", () => {
    expect(() =>
      compileRead({ resource: "orders", filters: [{ column: "id", op: "eq", value: "1" }] }, ORDERS),
    ).toThrow(/does not match the DynamoDB key type/);
  });

  it("skips the network when a key is compared with null", () => {
    const compiled = compileRead(
      { resource: "orders", filters: [{ column: "id", op: "eq", value: null }] },
      ORDERS,
    );
    expect(compiled.empty).toBe(true);
    expect(compiled.body.KeyConditionExpression).toBeUndefined();
  });

  it("drops a not-null check on a key because keys are always present", () => {
    const compiled = compileRead(
      { resource: "orders", filters: [{ column: "id", op: "neq", value: null }] },
      ORDERS,
    );
    expect(compiled.empty).toBe(false);
    expect(compiled.body.FilterExpression).toBeUndefined();
    expect(compiled.operation).toBe("Scan");
  });

  it("orders decimal strings numerically, with nulls last", () => {
    const order = [{ column: "total", direction: "asc" as const }];
    expect(compareRows({ total: "20" }, { total: "100" }, order)).toBeLessThan(0);
    expect(compareRows({ total: "1.2" }, { total: "1.10" }, order)).toBeGreaterThan(0);
    expect(compareRows({ total: "-10" }, { total: "-2" }, order)).toBeLessThan(0);
    expect(compareRows({ total: null }, { total: "1" }, order)).toBeGreaterThan(0);
  });
});
