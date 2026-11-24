import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, ClickHouseConnectionConfig } from "@dash/core";
import { ClickHouseAdapter, createClickHouseAdapter } from "./adapter.ts";

const NOT_READY =
  "ClickHouse test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  const port = Number(process.env.DASH_TEST_CLICKHOUSE_PORT ?? 18123);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_CLICKHOUSE_PORT: ${process.env.DASH_TEST_CLICKHOUSE_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_CLICKHOUSE_HOST ?? "127.0.0.1",
    port,
    database: process.env.DASH_TEST_CLICKHOUSE_DATABASE ?? "dash",
    user: process.env.DASH_TEST_CLICKHOUSE_USER ?? "dash",
    password: process.env.DASH_TEST_CLICKHOUSE_PASSWORD ?? "dash",
  };
}

function clusterConfig(
  overrides: Partial<ClickHouseConnectionConfig> = {},
): ClickHouseConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "clickhouse",
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
  return `clickhouse://${user}:${password}@${endpoint.host}:${endpoint.port}/${endpoint.database}?ssl=false`;
}

async function requireCluster(adapter: ClickHouseAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("ClickHouseAdapter against the test cluster", () => {
  let adapter: ClickHouseAdapter;

  beforeAll(async () => {
    adapter = ClickHouseAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter?.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to ClickHouse");
  });

  it("groups real tables and views into resources", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("clickhouse");
    expect(schema.resources.map((resource) => resource.name)).toEqual([
      "orders",
      "paid_orders",
      "revenue",
    ]);

    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({
      namespace: "dash",
      kind: "table",
    });
    expect(orders?.columns).toEqual([
      { name: "id", type: "Int32", nullable: false },
      { name: "total", type: "Int32", nullable: false },
      { name: "status", type: "String", nullable: false },
      { name: "region", type: "Nullable(String)", nullable: true },
      { name: "note", type: "Nullable(String)", nullable: true },
    ]);

    const paid = schema.resources.find((resource) => resource.name === "paid_orders");
    expect(paid?.kind).toBe("view");
    expect(paid?.columns.map((column) => column.name)).toEqual([
      "id",
      "total",
      "status",
      "region",
    ]);
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
      { month: "2026-01", amount: 10 },
      { month: "2026-02", amount: 20 },
      { month: "2026-03", amount: 15 },
    ]);
    expect(result.columns).toEqual([
      { name: "month", type: "String", nullable: false },
      { name: "amount", type: "Int32", nullable: false },
    ]);
  });

  it("applies each filter operator on the cluster", async () => {
    const cases: Array<{ filters: AdapterFilter[]; ids: number[] }> = [
      { filters: [{ column: "status", op: "eq", value: "open" }], ids: [3] },
      { filters: [{ column: "status", op: "neq", value: "open" }], ids: [1, 2, 4] },
      { filters: [{ column: "total", op: "gt", value: 25 }], ids: [4] },
      { filters: [{ column: "total", op: "gte", value: 25 }], ids: [2, 4] },
      { filters: [{ column: "total", op: "lt", value: 10 }], ids: [3] },
      { filters: [{ column: "total", op: "lte", value: 10 }], ids: [1, 3] },
      { filters: [{ column: "id", op: "in", value: [2, 4] }], ids: [2, 4] },
      { filters: [{ column: "status", op: "like", value: "p%" }], ids: [1, 2, 4] },
      { filters: [{ column: "status", op: "like", value: "P%" }], ids: [] },
      { filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }], ids: [1, 2] },
      { filters: [{ column: "note", op: "eq", value: null }], ids: [2, 4] },
      { filters: [{ column: "note", op: "neq", value: null }], ids: [1, 3] },
      { filters: [{ column: "status", op: "eq", value: "paid' OR '1'='1" }], ids: [] },
    ];

    for (const testCase of cases) {
      const result = await adapter.query({
        resource: "dash.orders",
        columns: ["id"],
        filters: testCase.filters,
        orderBy: [{ column: "id", direction: "asc" }],
        limit: 20,
      });
      expect(result.rows.map((row) => row.id)).toEqual(testCase.ids);
    }
  });

  it("honors offset and marks the page truncated when the limit is filled", async () => {
    const page = await adapter.query({
      resource: "dash.revenue",
      columns: ["month"],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 1,
      offset: 1,
    });
    expect(page.rows).toEqual([{ month: "2026-02" }]);
    expect(page.truncated).toBe(true);

    const exact = await adapter.query({
      resource: "revenue",
      columns: ["month"],
      limit: 3,
    });
    expect(exact.rowCount).toBe(3);
    expect(exact.truncated).toBe(false);

    const partial = await adapter.query({
      resource: "revenue",
      columns: ["month"],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 2,
    });
    expect(partial.rowCount).toBe(2);
    expect(partial.truncated).toBe(true);
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
    expect(result.columns.map((column) => column.name)).toEqual(["id", "status"]);
  });
});

describe("ClickHouseAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = ClickHouseAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string", async () => {
    const adapter = createClickHouseAdapter({
      kind: "clickhouse",
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
      expect(rows.rows).toEqual([{ amount: 10 }]);
    } finally {
      await adapter.close();
    }
  });

  it("reports a rejected password from the cluster", async () => {
    const adapter = ClickHouseAdapter.fromConfig(
      clusterConfig({ password: "not-the-cluster-password" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/password|auth/);
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when https is required by a plaintext cluster", async () => {
    const adapter = ClickHouseAdapter.fromConfig(clusterConfig({ ssl: true }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message.length).toBeGreaterThan(0);
    } finally {
      await adapter.close();
    }
  });

  it("closes the client", async () => {
    const adapter = ClickHouseAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(adapter);
      await adapter.close();
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/closed/);
      await expect(adapter.query({ resource: "orders", columns: ["id"], limit: 1 })).rejects.toThrow(
        /closed/,
      );
      await adapter.close();
    } finally {
      await adapter.close();
    }
  });
});
