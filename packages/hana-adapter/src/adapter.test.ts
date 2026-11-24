import { describe, expect, it } from "vitest";
import { HanaAdapter, createHanaAdapter } from "./adapter.ts";
import type { SqlClient, SqlQueryResult } from "./client.ts";
import { INTROSPECT_SQL, TEST_CONNECTION_SQL } from "./sql.ts";

function fakeClient(handler: (text: string, values?: unknown[]) => SqlQueryResult | Promise<SqlQueryResult>) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let closed = 0;
  const client: SqlClient = {
    async query(text, values) {
      calls.push({ text, values });
      return handler(text, values);
    },
    async end() {
      closed += 1;
    },
  };
  return { client, calls, closed: () => closed };
}

describe("HanaAdapter", () => {
  it("reports a successful connection test", async () => {
    const fake = fakeClient(() => ({ rows: [{ ok: 1 }] }));
    const adapter = new HanaAdapter(fake.client);
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Connected to SAP HANA");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fake.calls).toEqual([{ text: TEST_CONNECTION_SQL, values: undefined }]);
  });

  it("reports a failed connection test", async () => {
    const fake = fakeClient(() => {
      throw new Error("authentication failed");
    });
    const adapter = new HanaAdapter(fake.client);
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("authentication failed");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a non-error failure as a connection failure", async () => {
    const fake = fakeClient(() => {
      throw "down";
    });
    const result = await new HanaAdapter(fake.client).testConnection();
    expect(result).toMatchObject({ ok: false, message: "Connection failed" });
  });

  it("groups tables and views and skips a row with no column", async () => {
    const fake = fakeClient(() => ({
      rows: [
        {
          namespace: "ANALYTICS",
          name: "ORDERS",
          table_type: "TABLE",
          column_name: "ID",
          data_type: "INTEGER",
          is_nullable: "FALSE",
        },
        {
          NAMESPACE: "ANALYTICS",
          NAME: "ORDERS",
          TABLE_TYPE: "TABLE",
          COLUMN_NAME: "STATUS",
          DATA_TYPE: "NVARCHAR",
          IS_NULLABLE: "TRUE",
        },
        {
          namespace: "ANALYTICS",
          name: "PAID_ORDERS",
          table_type: "VIEW",
          column_name: "ID",
          data_type: "INTEGER",
          is_nullable: "YES",
        },
        {
          namespace: "ANALYTICS",
          name: "METRICS",
          column_name: "ID",
          data_type: "INTEGER",
          is_nullable: "1",
        },
        { namespace: "ANALYTICS", name: "SKIP", table_type: "TABLE" },
      ],
    }));
    const schema = await new HanaAdapter(fake.client).introspectSchema();
    expect(fake.calls[0]?.text).toBe(INTROSPECT_SQL);
    expect(fake.calls[0]?.values).toBeUndefined();
    expect(schema).toEqual({
      kind: "hana",
      resources: [
        {
          name: "ORDERS",
          namespace: "ANALYTICS",
          kind: "table",
          columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "STATUS", type: "NVARCHAR", nullable: true },
          ],
        },
        {
          name: "PAID_ORDERS",
          namespace: "ANALYTICS",
          kind: "view",
          columns: [{ name: "ID", type: "INTEGER", nullable: true }],
        },
        {
          name: "METRICS",
          namespace: "ANALYTICS",
          kind: "table",
          columns: [{ name: "ID", type: "INTEGER", nullable: true }],
        },
      ],
    });
  });

  it("returns columns from the statement and marks a full page truncated", async () => {
    const fake = fakeClient(() => ({
      rows: [{ id: 1 }, { id: 2 }],
      fields: [
        { name: "id", type: "INTEGER", nullable: false },
      ],
    }));
    const result = await new HanaAdapter(fake.client).query({
      resource: "orders",
      columns: ["id"],
      limit: 2,
    });
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.columns).toEqual([{ name: "id", type: "INTEGER", nullable: false }]);
    expect(fake.calls[0]?.text).toBe('SELECT "id" FROM "orders" LIMIT ? OFFSET ?');
    expect(fake.calls[0]?.values).toEqual([2, 0]);
  });

  it("derives columns from the first row when the driver has no fields", async () => {
    const fake = fakeClient(() => ({ rows: [{ id: 1, status: "paid" }] }));
    const result = await new HanaAdapter(fake.client).query({ resource: "orders", limit: 10 });
    expect(result.truncated).toBe(false);
    expect(result.columns).toEqual([
      { name: "id", type: "unknown", nullable: true },
      { name: "status", type: "unknown", nullable: true },
    ]);
  });

  it("returns no columns for an empty page without field metadata", async () => {
    const fake = fakeClient(() => ({ rows: [] }));
    const result = await new HanaAdapter(fake.client).query({ resource: "orders" });
    expect(result).toMatchObject({ columns: [], rowCount: 0, truncated: false });
  });

  it("closes the client", async () => {
    const fake = fakeClient(() => ({ rows: [] }));
    const adapter = new HanaAdapter(fake.client);
    await adapter.close();
    expect(fake.closed()).toBe(1);
  });
});

describe("createHanaAdapter", () => {
  it("rejects a config with no host", () => {
    expect(() => createHanaAdapter({ kind: "hana", user: "SYSTEM" })).toThrow(/host is required/);
  });
});
