import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QueryValidationError, type AdapterFilter, type Neo4jConnectionConfig } from "@dash/core";
import { Neo4jAdapter, createNeo4jAdapter } from "./adapter.ts";

const NOT_READY = "Neo4j test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  const port = Number(process.env.DASH_TEST_NEO4J_PORT ?? 17687);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_NEO4J_PORT: ${process.env.DASH_TEST_NEO4J_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_NEO4J_HOST ?? "127.0.0.1",
    port,
    database: process.env.DASH_TEST_NEO4J_DATABASE ?? "neo4j",
    user: process.env.DASH_TEST_NEO4J_USER ?? "neo4j",
    password: process.env.DASH_TEST_NEO4J_PASSWORD ?? "dash",
  };
}

function clusterConfig(overrides: Partial<Neo4jConnectionConfig> = {}): Neo4jConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "neo4j",
    host: endpoint.host,
    port: endpoint.port,
    database: endpoint.database,
    user: endpoint.user,
    password: endpoint.password,
    ...overrides,
  };
}

function connectionString(database = clusterEndpoint().database): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  return `bolt://${user}:${password}@${endpoint.host}:${endpoint.port}/${database}`;
}

async function requireCluster(adapter: Neo4jAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("Neo4jAdapter against the test cluster", () => {
  let adapter: Neo4jAdapter;

  beforeAll(async () => {
    adapter = Neo4jAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to Neo4j");
  });

  it("maps labels and relationship types to resources", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("neo4j");
    expect(schema.resources.map((resource) => `${resource.namespace}.${resource.name}`)).toEqual([
      "node.customers",
      "node.orders",
      "node.revenue",
      "relationship.PLACED",
    ]);

    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({ namespace: "node", kind: "collection" });
    expect(orders?.columns).toEqual([
      { name: "id", type: "Long", nullable: false },
      { name: "note", type: "String", nullable: true },
      { name: "region", type: "String", nullable: false },
      { name: "status", type: "String", nullable: false },
      { name: "total", type: "Long", nullable: false },
    ]);

    const placed = schema.resources.find((resource) => resource.name === "PLACED");
    expect(placed?.columns.map((column) => column.name)).toEqual(["amount", "channel"]);
    expect(schema.resources.find((resource) => resource.name === "customers")?.columns).toEqual([
      { name: "name", type: "String", nullable: false },
    ]);
    expect(schema.resources.some((resource) => resource.name.includes(" "))).toBe(false);
    expect(schema.resources.flatMap((resource) => resource.columns.map((column) => column.name))).not.toContain(
      "bad name",
    );
  });

  it("runs a compiled read and returns rows", async () => {
    const result = await adapter.query({
      resource: "node.revenue",
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
    const newest = await adapter.query({
      resource: "node.revenue",
      columns: ["month"],
      orderBy: [{ column: "month", direction: "desc" }],
      limit: 3,
    });
    expect(newest.rows.map((row) => row.month)).toEqual(["2026-03", "2026-02", "2026-01"]);
    expect(result.columns).toEqual([
      { name: "month", type: "unknown", nullable: true },
      { name: "amount", type: "unknown", nullable: true },
    ]);
  });

  it("reads relationship properties", async () => {
    const result = await adapter.query({
      resource: "relationship.PLACED",
      columns: ["channel", "amount"],
      orderBy: [{ column: "amount", direction: "asc" }],
      limit: 10,
    });
    expect(result.rows).toEqual([
      { channel: "web", amount: 10 },
      { channel: "app", amount: 25 },
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
      { filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }], ids: [1, 2] },
    ];

    for (const testCase of cases) {
      const result = await adapter.query({
        resource: "node.orders",
        columns: ["id"],
        filters: testCase.filters,
        orderBy: [{ column: "id", direction: "asc" }],
        limit: 20,
      });
      expect(result.rows.map((row) => row.id)).toEqual(testCase.ids);
    }

    const both = await adapter.query({
      resource: "node.orders",
      columns: ["id"],
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "total", op: "gte", value: 25 },
      ],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 10,
    });
    expect(both.rows.map((row) => row.id)).toEqual([2, 4]);
  });

  it("honors offset and marks the page truncated when the limit is filled", async () => {
    const page = await adapter.query({
      resource: "node.revenue",
      columns: ["month"],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 1,
      offset: 1,
    });
    expect(page.rows).toEqual([{ month: "2026-02" }]);
    expect(page.truncated).toBe(true);

    const exact = await adapter.query({
      resource: "node.revenue",
      columns: ["month"],
      limit: 3,
    });
    expect(exact.rowCount).toBe(3);
    expect(exact.truncated).toBe(true);

    const past = await adapter.query({
      resource: "node.revenue",
      columns: ["month"],
      orderBy: [{ column: "month", direction: "asc" }],
      limit: 1,
      offset: 10,
    });
    expect(past.rows).toEqual([]);
    expect(past.truncated).toBe(false);
  });

  it("returns column metadata when the cluster sends no rows", async () => {
    const result = await adapter.query({
      resource: "node.orders",
      columns: ["id", "status"],
      filters: [{ column: "id", op: "eq", value: -1 }],
      limit: 5,
    });
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.columns.map((column) => column.name)).toEqual(["id", "status"]);
  });

  it("returns every property when the query omits columns", async () => {
    const result = await adapter.query({
      resource: "node.revenue",
      filters: [{ column: "month", op: "eq", value: "2026-01" }],
      limit: 5,
    });
    expect(result.rows).toEqual([{ month: "2026-01", amount: 10 }]);
  });
});

describe("Neo4jAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = Neo4jAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string", async () => {
    const adapter = createNeo4jAdapter({
      kind: "neo4j",
      connectionString: connectionString(),
    });
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(true);
      const rows = await adapter.query({
        resource: "node.revenue",
        columns: ["amount"],
        filters: [{ column: "month", op: "eq", value: "2026-01" }],
        limit: 1,
      });
      expect(rows.rows).toEqual([{ amount: 10 }]);
    } finally {
      await adapter.close();
    }
  });

  it("reports a rejected password without echoing it", async () => {
    const adapter = Neo4jAdapter.fromConfig(
      clusterConfig({ password: "not-the-cluster-password" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/auth/);
      expect(result.message).not.toContain("not-the-cluster-password");
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when encryption is required by a plaintext cluster", async () => {
    const adapter = Neo4jAdapter.fromConfig(clusterConfig({ encryption: true }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/encrypt|TLS|SSL|ECONNRESET|handshake|secure/i);
      expect(result.message).not.toContain(clusterEndpoint().password);
    } finally {
      await adapter.close();
    }
  });

  it("closes the driver", async () => {
    const adapter = Neo4jAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    await expect(adapter.query({ resource: "node.revenue", limit: 1 })).rejects.toThrow();
    await expect(adapter.introspectSchema()).rejects.toThrow();
    await adapter.close();
  });
});

describe("Neo4jAdapter validation", () => {
  it("ignores a blank connection string and uses the host fields", () => {
    const adapter = Neo4jAdapter.fromConfig({
      kind: "neo4j",
      connectionString: "   ",
      host: "127.0.0.1",
      user: "dash",
      password: "secret-value",
    });
    return adapter.close();
  });

  it("rejects an unsafe query before it opens a session", async () => {
    const adapter = Neo4jAdapter.fromConfig({
      kind: "neo4j",
      host: "127.0.0.1",
      port: 1,
      user: "reader",
      password: "super-secret-password",
    });
    try {
      await expect(adapter.query({ resource: "orders" })).rejects.toBeInstanceOf(QueryValidationError);
      await adapter.close();
      let failed: Error | undefined;
      try {
        await adapter.query({ resource: "node.orders", limit: 1 });
      } catch (error) {
        failed = error instanceof Error ? error : new Error("Neo4j request failed");
      }
      expect(failed).toBeInstanceOf(Error);
      expect(failed?.message).not.toContain("super-secret-password");
    } finally {
      await adapter.close();
    }
  });
});
