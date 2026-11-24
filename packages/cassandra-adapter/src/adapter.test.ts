import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, CassandraConnectionConfig } from "@dash/core";
import { CassandraAdapter, createCassandraAdapter } from "./adapter.ts";

const NOT_READY =
  "Cassandra test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  keyspace: string;
  localDataCenter: string;
  user: string;
  password: string;
} {
  const port = Number(process.env.DASH_TEST_CASSANDRA_PORT ?? 39042);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_CASSANDRA_PORT: ${process.env.DASH_TEST_CASSANDRA_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_CASSANDRA_HOST ?? "127.0.0.1",
    port,
    keyspace: process.env.DASH_TEST_CASSANDRA_KEYSPACE ?? "dash",
    localDataCenter: process.env.DASH_TEST_CASSANDRA_LOCAL_DC ?? "datacenter1",
    user: process.env.DASH_TEST_CASSANDRA_USER ?? "dash",
    password: process.env.DASH_TEST_CASSANDRA_PASSWORD ?? "dash",
  };
}

function clusterConfig(
  overrides: Partial<CassandraConnectionConfig> = {},
): CassandraConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "cassandra",
    host: endpoint.host,
    port: endpoint.port,
    keyspace: endpoint.keyspace,
    localDataCenter: endpoint.localDataCenter,
    user: endpoint.user,
    password: endpoint.password,
    ...overrides,
  };
}

function connectionString(): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  const dc = encodeURIComponent(endpoint.localDataCenter);
  return `cassandra://${user}:${password}@${endpoint.host}:${endpoint.port}/${endpoint.keyspace}?dc=${dc}`;
}

async function requireCluster(adapter: CassandraAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("CassandraAdapter against the test cluster", () => {
  let adapter: CassandraAdapter;

  beforeAll(async () => {
    adapter = CassandraAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to Apache Cassandra");
  });

  it("groups real tables and views into resources", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("cassandra");
    expect(schema.resources.map((resource) => `${resource.namespace}.${resource.name}`)).toEqual([
      "dash.orders",
      "dash.orders_by_status",
      "dash.revenue",
      "dash.samples",
    ]);

    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({ namespace: "dash", kind: "table" });
    expect(orders?.columns).toEqual([
      { name: "tenant", type: "text", nullable: false },
      { name: "id", type: "int", nullable: false },
      { name: "note", type: "text", nullable: true },
      { name: "region", type: "text", nullable: true },
      { name: "status", type: "text", nullable: true },
      { name: "total", type: "int", nullable: true },
    ]);

    const byStatus = schema.resources.find((resource) => resource.name === "orders_by_status");
    expect(byStatus?.kind).toBe("view");
    expect(byStatus?.columns.map((column) => column.name)).toEqual([
      "tenant",
      "status",
      "id",
      "region",
      "total",
    ]);
  });

  it("runs a compiled select and returns rows", async () => {
    const result = await adapter.query({
      resource: "revenue",
      columns: ["month", "amount"],
      filters: [{ column: "bucket", op: "eq", value: "all" }],
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
      { name: "month", type: "unknown", nullable: true },
      { name: "amount", type: "unknown", nullable: true },
    ]);
  });

  it("reads the status view in clustering order", async () => {
    const result = await adapter.query({
      resource: "dash.orders_by_status",
      columns: ["id"],
      filters: [
        { column: "tenant", op: "eq", value: "dash" },
        { column: "status", op: "eq", value: "paid" },
      ],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 10,
    });
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 4 }]);
  });

  it("applies each supported filter operator on the cluster", async () => {
    const cases: Array<{ filters: AdapterFilter[]; ids: number[] }> = [
      { filters: [{ column: "status", op: "eq", value: "open" }], ids: [3] },
      { filters: [{ column: "total", op: "gt", value: 25 }], ids: [4] },
      { filters: [{ column: "total", op: "gte", value: 25 }], ids: [2, 4] },
      { filters: [{ column: "total", op: "lt", value: 10 }], ids: [3] },
      { filters: [{ column: "total", op: "lte", value: 10 }], ids: [1, 3] },
      { filters: [{ column: "id", op: "in", value: [2, 4] }], ids: [2, 4] },
    ];

    for (const testCase of cases) {
      const result = await adapter.query({
        resource: "dash.orders",
        columns: ["id"],
        filters: [{ column: "tenant", op: "eq", value: "dash" }, ...testCase.filters],
        orderBy: [{ column: "id", direction: "asc" }],
        limit: 20,
      });
      expect(result.rows.map((row) => row.id)).toEqual(testCase.ids);
    }
  });

  it("does not interpolate a filter value into the statement", async () => {
    const result = await adapter.query({
      resource: "orders",
      columns: ["id"],
      filters: [
        { column: "tenant", op: "eq", value: "dash" },
        { column: "status", op: "eq", value: "paid' OR tenant = 'dash" },
      ],
      limit: 20,
    });
    expect(result.rows).toEqual([]);
  });

  it("honors offset and marks the page truncated when the limit is filled", async () => {
    const page = await adapter.query({
      resource: "dash.revenue",
      columns: ["month"],
      filters: [{ column: "bucket", op: "eq", value: "all" }],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 1,
      offset: 1,
    });
    expect(page.rows).toEqual([{ month: "2026-02" }]);
    expect(page.truncated).toBe(true);

    const exact = await adapter.query({
      resource: "revenue",
      columns: ["month"],
      filters: [{ column: "bucket", op: "eq", value: "all" }],
      limit: 3,
    });
    expect(exact.rowCount).toBe(3);
    expect(exact.truncated).toBe(true);
  });

  it("returns column metadata when the cluster sends no rows", async () => {
    const result = await adapter.query({
      resource: "orders",
      columns: ["id", "status"],
      filters: [
        { column: "tenant", op: "eq", value: "dash" },
        { column: "id", op: "eq", value: -1 },
      ],
      limit: 5,
    });
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.columns.map((column) => column.name)).toEqual(["id", "status"]);
  });

  it("returns JSON-safe values for Cassandra types", async () => {
    const result = await adapter.query({
      resource: "samples",
      columns: ["id", "active", "big", "seen", "item", "payload", "tags"],
      filters: [
        { column: "id", op: "eq", value: 1 },
        { column: "active", op: "eq", value: true },
      ],
      limit: 1,
    });
    expect(result.rows).toEqual([
      {
        id: 1,
        active: true,
        big: "9007199254740993",
        seen: "2026-01-15T12:00:00.000Z",
        item: "123e4567-e89b-12d3-a456-426614174000",
        payload: "aGk=",
        tags: [1, 2, 3],
      },
    ]);
  });
});

describe("CassandraAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = CassandraAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string", async () => {
    const adapter = createCassandraAdapter({
      kind: "cassandra",
      connectionString: connectionString(),
    });
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(true);
      const rows = await adapter.query({
        resource: "revenue",
        columns: ["amount"],
        filters: [
          { column: "bucket", op: "eq", value: "all" },
          { column: "month", op: "eq", value: "2026-01" },
        ],
        limit: 1,
      });
      expect(rows.rows).toEqual([{ amount: 10 }]);
    } finally {
      await adapter.close();
    }
  });

  it("reports a rejected password from the cluster", async () => {
    const adapter = CassandraAdapter.fromConfig(
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

  it("reports failure when ssl is required by a plaintext cluster", async () => {
    const adapter = CassandraAdapter.fromConfig(clusterConfig({ ssl: true }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message.length).toBeGreaterThan(0);
    } finally {
      await adapter.close();
    }
  });

  it("closes the client", async () => {
    const adapter = CassandraAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
  });
});
