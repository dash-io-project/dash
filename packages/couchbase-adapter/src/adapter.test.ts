import type { AdapterFilter, CouchbaseConnectionConfig } from "@dash/core";
import { QueryValidationError } from "@dash/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CouchbaseAdapter, createCouchbaseAdapter } from "./adapter.ts";

const NOT_READY =
  "Couchbase test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  bucket: string;
  scope: string;
  user: string;
  password: string;
  network: "default" | "external";
} {
  const port = Number(process.env.DASH_TEST_COUCHBASE_PORT ?? 11299);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_COUCHBASE_PORT: ${process.env.DASH_TEST_COUCHBASE_PORT}`);
  }
  const network = process.env.DASH_TEST_COUCHBASE_NETWORK ?? "external";
  if (network !== "default" && network !== "external") {
    throw new Error(`Invalid DASH_TEST_COUCHBASE_NETWORK: ${network}`);
  }
  return {
    host: process.env.DASH_TEST_COUCHBASE_HOST ?? "127.0.0.1",
    port,
    bucket: process.env.DASH_TEST_COUCHBASE_BUCKET ?? "dash",
    scope: process.env.DASH_TEST_COUCHBASE_SCOPE ?? "analytics",
    user: process.env.DASH_TEST_COUCHBASE_USER ?? "dash",
    password: process.env.DASH_TEST_COUCHBASE_PASSWORD ?? "dashdash",
    network,
  };
}

function clusterConfig(
  overrides: Partial<CouchbaseConnectionConfig> = {},
): CouchbaseConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "couchbase",
    host: endpoint.host,
    port: endpoint.port,
    bucket: endpoint.bucket,
    scope: endpoint.scope,
    user: endpoint.user,
    password: endpoint.password,
    network: endpoint.network,
    ...overrides,
  };
}

function connectionString(): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  return `couchbase://${user}:${password}@${endpoint.host}:${endpoint.port}/${endpoint.bucket}?scope=${endpoint.scope}&network=${endpoint.network}`;
}

async function requireCluster(adapter: CouchbaseAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("CouchbaseAdapter query validation", () => {
  it("rejects a bad resource name before it opens a connection", async () => {
    const adapter = CouchbaseAdapter.fromConfig({
      kind: "couchbase",
      host: "127.0.0.1",
      bucket: "dash",
      user: "dash",
      password: "dash",
    });
    try {
      await expect(adapter.query({ resource: "orders;drop" })).rejects.toThrow(QueryValidationError);
    } finally {
      await adapter.close();
    }
  });
});

describe("CouchbaseAdapter against the test cluster", () => {
  let adapter: CouchbaseAdapter;

  beforeAll(async () => {
    adapter = CouchbaseAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to Couchbase");
  });

  it("lists fixture collections and infers columns", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("couchbase");
    const names = schema.resources.map((resource) => `${resource.namespace}.${resource.name}`);
    expect(names).toEqual(["analytics.orders", "analytics.revenue"]);
    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({ namespace: "analytics", kind: "collection" });
    expect(orders?.columns).toEqual([
      { name: "id", type: "number", nullable: false },
      { name: "note", type: "string", nullable: true },
      { name: "region", type: "string", nullable: false },
      { name: "status", type: "string", nullable: false },
      { name: "total", type: "number", nullable: false },
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
      { name: "month", type: "unknown", nullable: true },
      { name: "amount", type: "unknown", nullable: true },
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
      { filters: [{ column: "note", op: "eq", value: null }], ids: [2, 4] },
    ];

    for (const testCase of cases) {
      const result = await adapter.query({
        resource: "analytics.orders",
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
      resource: "dash.analytics.revenue",
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
    expect(exact.truncated).toBe(true);
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

describe("CouchbaseAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = CouchbaseAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string", async () => {
    const adapter = createCouchbaseAdapter({
      kind: "couchbase",
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
    const adapter = CouchbaseAdapter.fromConfig(
      clusterConfig({ password: "not-the-cluster-password" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/password|auth/);
      expect(result.message).not.toContain("not-the-cluster-password");
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when tls is required by a plaintext cluster", async () => {
    const adapter = CouchbaseAdapter.fromConfig(clusterConfig({ tls: true }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/TLS|SSL|handshake|certificate|timeout/i);
    } finally {
      await adapter.close();
    }
  });

  it("reports a missing bucket", async () => {
    const adapter = CouchbaseAdapter.fromConfig(clusterConfig({ bucket: "missing" }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/bucket/i);
    } finally {
      await adapter.close();
    }
  });

  it("closes the cluster", async () => {
    const adapter = CouchbaseAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
  });
});
