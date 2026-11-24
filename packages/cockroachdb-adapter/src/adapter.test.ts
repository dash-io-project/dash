import { readFileSync } from "node:fs";
import type { AdapterFilter, CockroachConnectionConfig } from "@dash/core";
import { QueryValidationError } from "@dash/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CockroachAdapter,
  createCockroachAdapter,
  listenForPoolErrors,
  parseInt8Text,
  type SqlClient,
} from "./adapter.ts";

const NOT_READY =
  "CockroachDB test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  const port = Number(process.env.DASH_TEST_COCKROACHDB_PORT ?? 26229);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_COCKROACHDB_PORT: ${process.env.DASH_TEST_COCKROACHDB_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_COCKROACHDB_HOST ?? "127.0.0.1",
    port,
    database: process.env.DASH_TEST_COCKROACHDB_DATABASE ?? "dash",
    user: process.env.DASH_TEST_COCKROACHDB_USER ?? "dash",
    password: process.env.DASH_TEST_COCKROACHDB_PASSWORD ?? "dash",
  };
}

function caPem(): string {
  const path = process.env.DASH_TEST_COCKROACHDB_CA ?? "/tmp/dash-test-cockroach-certs/ca.crt";
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`${NOT_READY} CA file not found at ${path}.`);
  }
}

function clusterConfig(overrides: Partial<CockroachConnectionConfig> = {}): CockroachConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "cockroachdb",
    host: endpoint.host,
    port: endpoint.port,
    database: endpoint.database,
    user: endpoint.user,
    password: endpoint.password,
    ssl: true,
    sslCa: caPem(),
    ...overrides,
  };
}

function connectionString(scheme = "cockroachdb"): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  return `${scheme}://${user}:${password}@${endpoint.host}:${endpoint.port}/${endpoint.database}`;
}

async function requireCluster(adapter: CockroachAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

function client(result: {
  rows?: Record<string, unknown>[];
  fields?: Array<{ name: string; dataTypeID?: number }>;
  error?: unknown;
  endError?: unknown;
}): { client: SqlClient; calls: number } {
  const state = { calls: 0 };
  return {
    calls: 0,
    client: {
      async query() {
        state.calls += 1;
        if (result.error !== undefined) {
          throw result.error;
        }
        return { rows: result.rows ?? [], fields: result.fields };
      },
      async end() {
        if (result.endError !== undefined) {
          throw result.endError;
        }
      },
    },
  };
}

describe("CockroachAdapter value parsing", () => {
  it("returns a safe INT8 as a number and keeps the rest as text", () => {
    expect(parseInt8Text("10")).toBe(10);
    expect(parseInt8Text("-10")).toBe(-10);
    expect(parseInt8Text("0")).toBe(0);
    expect(parseInt8Text("9007199254740991")).toBe(9007199254740991);
    expect(parseInt8Text("9223372036854775807")).toBe("9223372036854775807");
    expect(parseInt8Text("-9223372036854775808")).toBe("-9223372036854775808");
    expect(parseInt8Text("9007199254740993")).toBe("9007199254740993");
    expect(parseInt8Text("01")).toBe("01");
    expect(parseInt8Text("1.5")).toBe("1.5");
    expect(parseInt8Text("")).toBe("");
    expect(parseInt8Text("+10")).toBe("+10");
  });

  it("ignores an idle pool error", async () => {
    const pool = new pg.Pool({ host: "127.0.0.1", port: 1, max: 1, connectionTimeoutMillis: 1000 });
    listenForPoolErrors(pool);
    expect(() => pool.emit("error", new Error("idle socket closed"))).not.toThrow();
    await pool.end();
  });

  it("opens a pool from fields and closes it twice", async () => {
    const plain = createCockroachAdapter({
      kind: "cockroachdb",
      host: "127.0.0.1",
      port: 1,
      database: "dash",
      user: "dash",
      ssl: false,
    });
    await plain.close();
    await plain.close();
    const routed = CockroachAdapter.fromConfig({
      kind: "cockroachdb",
      host: "127.0.0.1",
      port: 1,
      database: "dash",
      user: "dash",
      password: "dash",
      ssl: true,
      cluster: "app-cluster",
      connectionString: "cockroachdb://dash:dash@127.0.0.1:1/dash?sslmode=require",
    });
    await routed.close();
  });

  it("rejects an invalid config before it opens a socket", () => {
    expect(() =>
      CockroachAdapter.fromConfig({
        kind: "cockroachdb",
        host: "not a host",
        database: "dash",
        user: "dash",
        password: "super-secret",
      }),
    ).toThrow(QueryValidationError);
  });
});

describe("CockroachAdapter query results", () => {
  it("reports a driver error and a non-error failure", async () => {
    const failed = new CockroachAdapter(
      client({ error: new Error("password authentication failed") }).client,
    );
    const result = await failed.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("password authentication failed");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const unknown = new CockroachAdapter(client({ error: "down" }).client);
    expect((await unknown.testConnection()).message).toBe("Connection failed");
    const ok = new CockroachAdapter(client({ rows: [{ ok: 1 }], fields: [{ name: "ok", dataTypeID: 23 }] }).client);
    expect((await ok.testConnection()).message).toBe("Connected to CockroachDB");
  });

  it("groups columns and stops after the column cap", async () => {
    const adapter = new CockroachAdapter(
      client({
        rows: [
          { namespace: "public", name: "orders", table_type: "BASE TABLE", column_name: "id", data_type: "INT8", is_nullable: "NO" },
          { namespace: "public", name: "orders", table_type: "BASE TABLE", column_name: "note", data_type: "STRING", is_nullable: "yes" },
          { namespace: "public", name: "paid_orders", table_type: "MATERIALIZED VIEW", column_name: "id", data_type: "INT8", is_nullable: "YES" },
          { namespace: "public", name: "events", column_name: "message", data_type: "STRING", is_nullable: "NO" },
        ],
      }).client,
    );
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("cockroachdb");
    expect(schema.resources.map((resource) => `${resource.namespace}.${resource.name}:${resource.kind}`)).toEqual([
      "public.orders:table",
      "public.paid_orders:view",
      "public.events:table",
    ]);
    expect(schema.resources[0]?.columns[1]).toEqual({ name: "note", type: "STRING", nullable: true });
    const huge = Array.from({ length: 10001 }, () => ({ namespace: "public", name: "t", column_name: "c" }));
    const capped = new CockroachAdapter(client({ rows: huge }).client);
    await expect(capped.introspectSchema()).rejects.toThrow(/10000 columns/);
  });

  it("binds scalar values and marks a full page", async () => {
    const seen: unknown[][] = [];
    const fake: SqlClient = {
      async query(_text, values) {
        seen.push(values ?? []);
        return {
          rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
          fields: [
            { name: "id", dataTypeID: 20 },
            { name: "raw" },
            { name: "other", dataTypeID: 99999 },
          ],
        };
      },
      async end() {
        return undefined;
      },
    };
    const adapter = new CockroachAdapter(fake);
    const page = await adapter.query({
      resource: "orders",
      columns: ["id"],
      filters: [
        { column: "id", op: "eq", value: 1n },
        { column: "flag", op: "eq", value: true },
        { column: "name", op: "eq", value: "q1" },
        { column: "day", op: "eq", value: new Date("2026-01-15T00:00:00Z") },
        { column: "payload", op: "eq", value: new Uint8Array([1, 2]) },
      ],
      limit: 2,
    });
    expect(page.rowCount).toBe(2);
    expect(page.truncated).toBe(true);
    expect(page.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(page.columns.map((column) => column.type)).toEqual(["int8", "unknown", "unknown"]);
    expect(seen[0]?.slice(0, 5)).toEqual([1n, true, "q1", expect.any(Date), expect.any(Uint8Array)]);
    await expect(
      adapter.query({ resource: "orders", filters: [{ column: "id", op: "eq", value: { bad: true } }] }),
    ).rejects.toThrow(/scalar values/);
    await expect(
      adapter.query({ resource: "orders", filters: [{ column: "id", op: "eq", value: Number.NaN }] }),
    ).rejects.toThrow(QueryValidationError);
    await expect(
      adapter.query({ resource: "orders", filters: [{ column: "id", op: "eq", value: Number.POSITIVE_INFINITY }] }),
    ).rejects.toThrow(QueryValidationError);
    await expect(
      adapter.query({
        resource: "orders",
        filters: [{ column: "day", op: "eq", value: new Date(Number.NaN) }],
      }),
    ).rejects.toThrow(QueryValidationError);
    await expect(
      adapter.query({ resource: "orders", filters: [{ column: "id", op: "eq", value: [1] }] }),
    ).rejects.toThrow(QueryValidationError);
  });

  it("uses row keys when the driver sends no fields", async () => {
    const adapter = new CockroachAdapter(
      client({ rows: [{ month: "2026-01" }] }).client,
    );
    const result = await adapter.query({ resource: "revenue", limit: 10 });
    expect(result.columns).toEqual([{ name: "month", type: "unknown", nullable: true }]);
    expect(result.truncated).toBe(false);
    const empty = new CockroachAdapter(client({ rows: [] }).client);
    expect((await empty.query({ resource: "revenue", limit: 10 })).columns).toEqual([]);
  });

  it("marks a max page truncated only when it is full", async () => {
    const full = new CockroachAdapter(
      client({ rows: Array.from({ length: 10000 }, () => ({ id: 1 })), fields: [{ name: "id", dataTypeID: 23 }] }).client,
    );
    expect((await full.query({ resource: "orders", limit: 10000 })).truncated).toBe(true);
    const short = new CockroachAdapter(
      client({ rows: [{ id: 1 }], fields: [{ name: "id", dataTypeID: 23 }] }).client,
    );
    expect((await short.query({ resource: "orders", limit: 10000 })).truncated).toBe(false);
    const exact = new CockroachAdapter(
      client({ rows: [{ id: 1 }, { id: 2 }], fields: [{ name: "id", dataTypeID: 23 }] }).client,
    );
    expect((await exact.query({ resource: "orders", limit: 2 })).truncated).toBe(false);
  });
});

describe("CockroachAdapter against the test cluster", () => {
  let adapter: CockroachAdapter;

  beforeAll(async () => {
    adapter = CockroachAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to CockroachDB");
  });

  it("groups real tables and views and hides system columns", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("cockroachdb");
    expect(schema.resources.map((resource) => `${resource.namespace}.${resource.name}`)).toEqual([
      "analytics.targets",
      "public.events",
      "public.orders",
      "public.paid_orders",
      "public.revenue",
      "public.types",
    ]);
    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({ namespace: "public", kind: "table" });
    expect(orders?.columns).toEqual([
      { name: "id", type: "INT8", nullable: false },
      { name: "total", type: "INT8", nullable: false },
      { name: "status", type: "STRING", nullable: false },
      { name: "region", type: "STRING", nullable: true },
      { name: "note", type: "STRING", nullable: true },
    ]);
    const events = schema.resources.find((resource) => resource.name === "events");
    expect(events?.columns.map((column) => column.name)).toEqual(["message"]);
    const paid = schema.resources.find((resource) => resource.name === "paid_orders");
    expect(paid?.kind).toBe("view");
    expect(paid?.columns.map((column) => column.name)).toEqual(["id", "total", "status", "region"]);
    const types = schema.resources.find((resource) => resource.name === "types");
    expect(types?.columns.map((column) => column.type)).toEqual([
      "INT4",
      "INT8",
      "DECIMAL(10,2)",
      "BOOL",
      "DATE",
      "TIMESTAMPTZ",
      "BYTES",
    ]);
  });

  it("runs a compiled select and returns CockroachDB values", async () => {
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
      { name: "amount", type: "int8", nullable: true },
    ]);
    const types = await adapter.query({ resource: "public.types", limit: 5 });
    expect(types.rows).toEqual([
      {
        id: 1,
        big: "9223372036854775807",
        ratio: "1.50",
        flag: true,
        day: "2026-01-15",
        seen: "2026-01-15 00:00:00+00",
        payload: "\\x0102",
      },
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
        resource: "public.orders",
        columns: ["id"],
        filters: testCase.filters,
        orderBy: [{ column: "id", direction: "asc" }],
        limit: 20,
      });
      expect(result.rows.map((row) => row.id)).toEqual(testCase.ids);
    }
  });

  it("queries a schema and another database", async () => {
    const targets = await adapter.query({
      resource: "analytics.targets",
      columns: ["name", "goal"],
      limit: 5,
    });
    expect(targets.rows).toEqual([{ name: "q1", goal: 100 }]);
    const extra = await adapter.query({
      resource: "other.public.extra",
      columns: ["label"],
      limit: 5,
    });
    expect(extra.rows).toEqual([{ label: "outside" }]);
  });

  it("honors offset and does not mark an exact page truncated", async () => {
    const page = await adapter.query({
      resource: "public.revenue",
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
      { name: "id", type: "int8", nullable: true },
      { name: "status", type: "string", nullable: true },
    ]);
  });
});

describe("CockroachAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = CockroachAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string and the default TLS mode", async () => {
    const adapter = createCockroachAdapter({
      kind: "cockroachdb",
      connectionString: connectionString("postgresql"),
      sslCa: caPem(),
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

  it("connects when sslmode is require", async () => {
    const adapter = createCockroachAdapter({
      kind: "cockroachdb",
      connectionString: `${connectionString()}?sslmode=require`,
      sslCa: caPem(),
    });
    try {
      expect((await adapter.testConnection()).ok).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it("reports a rejected password from the cluster", async () => {
    const adapter = CockroachAdapter.fromConfig(clusterConfig({ password: "super-secret-not-the-password" }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/password|auth/);
      expect(result.message).not.toContain("super-secret-not-the-password");
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when TLS is turned off", async () => {
    const adapter = CockroachAdapter.fromConfig(clusterConfig({ ssl: false, sslCa: undefined }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/SSL/);
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when the private CA is omitted", async () => {
    const adapter = CockroachAdapter.fromConfig(clusterConfig({ sslCa: undefined }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message.toLowerCase()).toMatch(/certificate|ssl|tls|self-signed|verify/);
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when a serverless cluster name is sent to this node", async () => {
    const adapter = CockroachAdapter.fromConfig(clusterConfig({ cluster: "demo-cluster" }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message.toLowerCase()).toMatch(/tenant|cluster/);
      expect(result.message).not.toContain(clusterEndpoint().password);
    } finally {
      await adapter.close();
    }
  });

  it("closes the pool", async () => {
    const adapter = CockroachAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
  });
});
