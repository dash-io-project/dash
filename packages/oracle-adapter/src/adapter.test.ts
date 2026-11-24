import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, OracleConnectionConfig } from "@dash/core";
import { OracleAdapter, createOracleAdapter } from "./adapter.ts";

const NOT_READY = "Oracle test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  const port = Number(process.env.DASH_TEST_ORACLE_PORT ?? 15219);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_ORACLE_PORT: ${process.env.DASH_TEST_ORACLE_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_ORACLE_HOST ?? "127.0.0.1",
    port,
    database: process.env.DASH_TEST_ORACLE_DATABASE ?? "FREEPDB1",
    user: process.env.DASH_TEST_ORACLE_USER ?? "dash",
    password: process.env.DASH_TEST_ORACLE_PASSWORD ?? "Dash_test1",
  };
}

function clusterConfig(overrides: Partial<OracleConnectionConfig> = {}): OracleConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "oracle",
    host: endpoint.host,
    port: endpoint.port,
    database: endpoint.database,
    user: endpoint.user,
    password: endpoint.password,
    ssl: false,
    ...overrides,
  };
}

function connectionString(): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  return `oracle://${user}:${password}@${endpoint.host}:${endpoint.port}/${endpoint.database}`;
}

async function requireCluster(adapter: OracleAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("OracleAdapter against the test cluster", () => {
  let adapter: OracleAdapter;

  beforeAll(async () => {
    adapter = OracleAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to Oracle");
  });

  it("groups real tables and views into resources", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("oracle");
    expect(schema.resources.map((resource) => resource.name)).toEqual([
      "METRICS",
      "ORDERS",
      "PAID_ORDERS",
      "REVENUE",
    ]);

    const orders = schema.resources.find((resource) => resource.name === "ORDERS");
    expect(orders).toMatchObject({
      namespace: "DASH",
      kind: "table",
    });
    expect(orders?.columns).toEqual([
      { name: "ID", type: "number", nullable: false },
      { name: "TOTAL", type: "number", nullable: false },
      { name: "STATUS", type: "varchar2", nullable: false },
      { name: "REGION", type: "varchar2", nullable: true },
      { name: "NOTE", type: "clob", nullable: true },
    ]);

    const paid = schema.resources.find((resource) => resource.name === "PAID_ORDERS");
    expect(paid?.kind).toBe("view");
    expect(paid?.columns.map((column) => column.name)).toEqual(["ID", "TOTAL", "STATUS", "REGION"]);
  });

  it("runs a compiled select and returns rows", async () => {
    const result = await adapter.query({
      resource: "revenue",
      columns: ["month", "amount"],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 10,
    });
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.rows).toEqual([
      { MONTH: "2026-01", AMOUNT: 10 },
      { MONTH: "2026-02", AMOUNT: 20 },
      { MONTH: "2026-03", AMOUNT: 15 },
    ]);
    expect(result.columns).toEqual([
      { name: "MONTH", type: "unknown", nullable: true },
      { name: "AMOUNT", type: "unknown", nullable: true },
    ]);
  });

  it("applies each filter operator on the cluster", async () => {
    const cases: Array<{ filters: AdapterFilter[]; ids: number[] }> = [
      { filters: [{ column: "status", op: "eq", value: "open" }], ids: [3] },
      { filters: [{ column: "status", op: "neq", value: "open" }], ids: [1, 2, 4, 5] },
      { filters: [{ column: "total", op: "gt", value: 25 }], ids: [4] },
      { filters: [{ column: "total", op: "gte", value: 25 }], ids: [2, 4] },
      { filters: [{ column: "total", op: "lt", value: 10 }], ids: [3] },
      { filters: [{ column: "total", op: "lte", value: 10 }], ids: [1, 3] },
      { filters: [{ column: "id", op: "in", value: [2, 4] }], ids: [2, 4] },
      { filters: [{ column: "status", op: "like", value: "p%" }], ids: [1, 2, 4] },
      { filters: [{ column: "status", op: "like", value: "P%" }], ids: [5] },
      { filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }], ids: [1, 2, 5] },
    ];

    for (const testCase of cases) {
      const result = await adapter.query({
        resource: "DASH.orders",
        columns: ["id"],
        filters: testCase.filters,
        orderBy: [{ column: "id", direction: "asc" }],
        limit: 20,
      });
      expect(result.rows.map((row) => row.ID)).toEqual(testCase.ids);
    }
  });

  it("honors offset and marks the page truncated when the limit is filled", async () => {
    const page = await adapter.query({
      resource: "DASH.revenue",
      columns: ["month"],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 1,
      offset: 1,
    });
    expect(page.rows).toEqual([{ MONTH: "2026-02" }]);
    expect(page.truncated).toBe(true);

    const exact = await adapter.query({
      resource: "revenue",
      columns: ["month"],
      limit: 3,
    });
    expect(exact.rowCount).toBe(3);
    expect(exact.truncated).toBe(true);
  });

  it("treats SQL injection payloads as literal filter values", async () => {
    for (const value of ["paid' OR 1=1 -- ", "paid\\' OR 1=1 -- "]) {
      const result = await adapter.query({
        resource: "orders",
        columns: ["id"],
        filters: [{ column: "status", op: "eq", value }],
      });
      expect(result.rows).toEqual([]);
    }
  });

  it("returns column metadata when the cluster sends no rows", async () => {
    const result = await adapter.query({
      resource: "orders",
      columns: ["id", "status"],
      filters: [{ column: "id", op: "eq", value: -1 }],
      limit: 5,
    });
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.columns.map((column) => column.name)).toEqual(["ID", "STATUS"]);
  });

  it("returns DATE as a calendar string and NUMBER beyond MAX_SAFE_INTEGER as a string", async () => {
    const result = await adapter.query({
      resource: "metrics",
      columns: ["billed_on", "amount"],
      limit: 1,
    });
    expect(result.rows).toEqual([{ BILLED_ON: "2026-01-15", AMOUNT: "9007199254740993" }]);
  });
});

describe("OracleAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = OracleAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string", async () => {
    const adapter = createOracleAdapter({
      kind: "oracle",
      connectionString: connectionString(),
    });
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(true);
      const rows = await adapter.query({
        resource: "revenue",
        columns: ["amount"],
        filters: [{ column: "month", op: "eq", value: "2026-01" }],
        limit: 1,
      });
      expect(rows.rows).toEqual([{ AMOUNT: 10 }]);
    } finally {
      await adapter.close();
    }
  });

  it("reports a rejected password from the cluster", async () => {
    const adapter = OracleAdapter.fromConfig(
      clusterConfig({ password: "not-the-cluster-password" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/password|logon|auth|ora-01017|denied/);
    } finally {
      await adapter.close();
    }
  });

  it("closes the pool", async () => {
    const adapter = OracleAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
  });
});
