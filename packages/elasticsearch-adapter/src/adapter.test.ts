import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, ElasticsearchConnectionConfig } from "@dash/core";
import { QueryValidationError } from "@dash/core";
import { ElasticsearchAdapter, createElasticsearchAdapter } from "./adapter.ts";

const NOT_READY =
  "Elasticsearch test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): { host: string; port: number; user: string; password: string } {
  const port = Number(process.env.DASH_TEST_ELASTICSEARCH_PORT ?? 9219);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_ELASTICSEARCH_PORT: ${process.env.DASH_TEST_ELASTICSEARCH_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_ELASTICSEARCH_HOST ?? "127.0.0.1",
    port,
    user: process.env.DASH_TEST_ELASTICSEARCH_USER ?? "dash",
    password: process.env.DASH_TEST_ELASTICSEARCH_PASSWORD ?? "dash_test",
  };
}

function clusterConfig(
  overrides: Partial<ElasticsearchConnectionConfig> = {},
): ElasticsearchConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "elasticsearch",
    host: endpoint.host,
    port: endpoint.port,
    user: endpoint.user,
    password: endpoint.password,
    tls: false,
    ...overrides,
  };
}

function connectionString(): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  return `http://${user}:${password}@${endpoint.host}:${endpoint.port}`;
}

async function requireCluster(adapter: ElasticsearchAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("ElasticsearchAdapter against the test cluster", () => {
  let adapter: ElasticsearchAdapter;

  beforeAll(async () => {
    adapter = ElasticsearchAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  }, 30_000);

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to Elasticsearch");
  });

  it("lists indices and aliases", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("elasticsearch");
    expect(schema.resources.map((resource) => resource.name)).toEqual([
      "orders",
      "paid_orders",
      "revenue",
    ]);

    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({ kind: "collection" });
    expect(orders?.columns).toEqual([
      { name: "_id", type: "string", nullable: false },
      { name: "id", type: "number", nullable: true },
      { name: "note", type: "string", nullable: true },
      { name: "region", type: "string", nullable: true },
      { name: "status", type: "string", nullable: true },
      { name: "total", type: "number", nullable: true },
    ]);

    const paid = schema.resources.find((resource) => resource.name === "paid_orders");
    expect(paid?.kind).toBe("view");
    expect(paid?.columns.map((column) => column.name)).toEqual([
      "_id",
      "id",
      "region",
      "status",
      "total",
    ]);
  });

  it("runs a compiled search and returns rows", async () => {
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
      { name: "month", type: "string", nullable: true },
      { name: "amount", type: "number", nullable: true },
    ]);
  });

  it("applies each filter operator on the cluster", async () => {
    const cases: Array<{ filters: AdapterFilter[]; ids: number[] }> = [
      { filters: [{ column: "status", op: "eq", value: "open" }], ids: [3] },
      { filters: [{ column: "status", op: "neq", value: "open" }], ids: [1, 2, 4, 5] },
      { filters: [{ column: "total", op: "gt", value: 25 }], ids: [4] },
      { filters: [{ column: "total", op: "gte", value: 25 }], ids: [2, 4, 5] },
      { filters: [{ column: "total", op: "lt", value: 10 }], ids: [3] },
      { filters: [{ column: "total", op: "lte", value: 10 }], ids: [1, 3] },
      { filters: [{ column: "id", op: "in", value: [2, 4] }], ids: [2, 4] },
      { filters: [{ column: "status", op: "like", value: "p%" }], ids: [1, 2, 4] },
      { filters: [{ column: "region", op: "ilike", value: "%EUROPE%" }], ids: [1, 2] },
      { filters: [{ column: "note", op: "eq", value: null }], ids: [2, 4, 5] },
      { filters: [{ column: "note", op: "neq", value: null }], ids: [1, 3] },
      { filters: [{ column: "note", op: "in", value: [null] }], ids: [2, 4, 5] },
      { filters: [{ column: "note", op: "neq", value: "first" }], ids: [3] },
    ];

    for (const testCase of cases) {
      const result = await adapter.query({
        resource: "orders",
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
      resource: "revenue",
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
    expect(result.columns).toEqual([
      { name: "id", type: "number", nullable: true },
      { name: "status", type: "string", nullable: true },
    ]);
  });

  it("reads a paid_orders alias as a view", async () => {
    const result = await adapter.query({
      resource: "paid_orders",
      columns: ["id", "status"],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 10,
    });
    expect(result.rows).toEqual([
      { id: 1, status: "paid" },
      { id: 2, status: "paid" },
      { id: 4, status: "paid" },
    ]);
  });

  it("matches a document _id", async () => {
    const sample = await adapter.query({
      resource: "revenue",
      columns: ["_id", "month"],
      filters: [{ column: "month", op: "eq", value: "2026-01" }],
      limit: 1,
    });
    const id = sample.rows[0]?._id;
    expect(typeof id).toBe("string");
    const again = await adapter.query({
      resource: "revenue",
      columns: ["month"],
      filters: [{ column: "_id", op: "eq", value: id }],
      limit: 5,
    });
    expect(again.rows).toEqual([{ month: "2026-01" }]);
  });

  it("rejects an operator object before it reaches the cluster", async () => {
    await expect(
      adapter.query({
        resource: "orders",
        filters: [{ column: "status", op: "eq", value: { term: "paid" } }],
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);
  });
});

describe("ElasticsearchAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = ElasticsearchAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  }, 30_000);

  it("connects with a connection string", async () => {
    const adapter = createElasticsearchAdapter({
      kind: "elasticsearch",
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

  it("reports a rejected password without echoing it", async () => {
    const adapter = ElasticsearchAdapter.fromConfig(
      clusterConfig({ password: "not-the-cluster-password" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/credential|unauthorized|security|auth/);
      expect(result.message).not.toContain("not-the-cluster-password");
    } finally {
      await adapter.close();
    }
  });

  it("closes the client", async () => {
    const adapter = ElasticsearchAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/closed/);
  });
});
