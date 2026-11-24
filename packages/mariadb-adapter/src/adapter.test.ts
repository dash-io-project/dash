import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, MariadbConnectionConfig } from "@dash/core";
import {
  MariadbAdapter,
  createMariadbAdapter,
  parseMariadbConnectionString,
  type SqlClient,
  type SqlQueryResult,
} from "./adapter.ts";

describe("parseMariadbConnectionString", () => {
  it("reads host, port, user, password, and database", () => {
    expect(
      parseMariadbConnectionString("mariadb://reader:s3cret@db.internal:25060/analytics"),
    ).toEqual({
      host: "db.internal",
      port: 25060,
      database: "analytics",
      user: "reader",
      password: "s3cret",
      ssl: undefined,
    });
  });

  it("decodes reserved characters in the user and the password", () => {
    expect(
      parseMariadbConnectionString("mariadb://read%40er:s%3Ecret@db.internal/analytics"),
    ).toMatchObject({
      user: "read@er",
      password: "s>cret",
      database: "analytics",
    });
  });

  it.each([
    ["ssl=TRUE", true],
    ["ssl=1", true],
    ["ssl-mode=REQUIRED", true],
    ["ssl-mode=PREFERRED", true],
    ["sslMode=VERIFY_CA", true],
    ["sslMode=VERIFY_IDENTITY", true],
    ["ssl=FALSE", false],
    ["ssl=0", false],
    ["ssl-mode=DISABLED", false],
    ["ssl-mode=DISABLE", false],
  ] as const)("maps %s onto ssl %s and ignores other query keys", (query, ssl) => {
    expect(
      parseMariadbConnectionString(
        `mariadb://reader@db.internal/analytics?${query}&charset=utf8mb4`,
      ).ssl,
    ).toBe(ssl);
  });

  it("leaves ssl unset when the URI has no SSL key", () => {
    expect(
      parseMariadbConnectionString("mariadb://reader@db.internal/analytics?charset=utf8mb4").ssl,
    ).toBeUndefined();
  });

  it.each([
    ["", /invalid/i],
    ["m".repeat(2049), /invalid/i],
    ["not a uri", /invalid/i],
    ["mysql://localhost/dash", /mariadb:\/\//],
    ["mariadb://localhost/a/b", /one database/],
    ["mariadb://localhost:0/dash", /port/],
    ["mariadb://localhost:65536/dash", /invalid|port/i],
    ["mariadb://localhost/a%ZZ", /database name/],
    ["mariadb://us%ZZ@localhost/dash", /user name|invalid/i],
    ["mariadb://user:p%ZZ@localhost/dash", /password|invalid/i],
    ["mariadb://localhost/dash?ssl=MAYBE", /SSL option/],
  ])("rejects %j", (value, pattern) => {
    expect(() => parseMariadbConnectionString(value)).toThrow(pattern);
  });
});

describe("MariadbAdapter TLS config", () => {
  it("accepts ssl: true without a connection", async () => {
    const adapter = MariadbAdapter.fromConfig({
      kind: "mariadb",
      host: "127.0.0.1",
      port: 65535,
      database: "dash",
      user: "dash",
      password: "dash",
      ssl: true,
    });
    await adapter.close();
  });
});

function fakeClient(result: SqlQueryResult | Error | string): SqlClient {
  return {
    async query() {
      if (typeof result === "string" || result instanceof Error) {
        throw result;
      }
      return result;
    },
    async end() {},
  };
}

describe("MariadbAdapter result shape", () => {
  it("reports a non-error failure as a failed connection test", async () => {
    const adapter = new MariadbAdapter(fakeClient("down"));
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Connection failed");
  });

  it("uses row keys when the driver omits field metadata", async () => {
    const adapter = new MariadbAdapter(
      fakeClient({
        rows: [{ id: 1, status: "paid" }],
      }),
    );
    const result = await adapter.query({ resource: "orders", columns: ["id", "status"] });
    expect(result.columns.map((column) => column.name)).toEqual(["id", "status"]);
    expect(result.rows).toEqual([{ id: 1, status: "paid" }]);
  });

  it("returns no columns when the driver omits metadata and rows", async () => {
    const adapter = new MariadbAdapter(fakeClient({ rows: [] }));
    const result = await adapter.query({
      resource: "orders",
      columns: ["id"],
      filters: [{ column: "id", op: "eq", value: -1 }],
    });
    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("groups tables and views from introspection rows", async () => {
    const adapter = new MariadbAdapter(
      fakeClient({
        rows: [
          {
            namespace: "dash",
            name: "orders",
            table_type: "BASE TABLE",
            column_name: "id",
            data_type: "int",
            is_nullable: "NO",
          },
          {
            namespace: "dash",
            name: "orders",
            table_type: "BASE TABLE",
            column_name: "note",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            namespace: "dash",
            name: "paid_orders",
            table_type: "VIEW",
            column_name: "id",
            data_type: "int",
            is_nullable: "NO",
          },
        ],
      }),
    );
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("mariadb");
    expect(schema.resources).toEqual([
      {
        name: "orders",
        namespace: "dash",
        kind: "table",
        columns: [
          { name: "id", type: "int", nullable: false },
          { name: "note", type: "text", nullable: true },
        ],
      },
      {
        name: "paid_orders",
        namespace: "dash",
        kind: "view",
        columns: [{ name: "id", type: "int", nullable: false }],
      },
    ]);
  });
});

const NOT_READY =
  "MariaDB test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  const port = Number(process.env.DASH_TEST_MARIADB_PORT ?? 33039);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_MARIADB_PORT: ${process.env.DASH_TEST_MARIADB_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_MARIADB_HOST ?? "127.0.0.1",
    port,
    database: process.env.DASH_TEST_MARIADB_DATABASE ?? "dash",
    user: process.env.DASH_TEST_MARIADB_USER ?? "dash",
    password: process.env.DASH_TEST_MARIADB_PASSWORD ?? "dash",
  };
}

function clusterConfig(
  overrides: Partial<MariadbConnectionConfig> = {},
): MariadbConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "mariadb",
    host: endpoint.host,
    port: endpoint.port,
    database: endpoint.database,
    user: endpoint.user,
    password: endpoint.password,
    ...overrides,
  };
}

function connectionString(): string {
  const endpoint = clusterEndpoint();
  const user = encodeURIComponent(endpoint.user);
  const password = encodeURIComponent(endpoint.password);
  return `mariadb://${user}:${password}@${endpoint.host}:${endpoint.port}/${endpoint.database}`;
}

async function requireCluster(adapter: MariadbAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("MariadbAdapter against the test cluster", () => {
  let adapter: MariadbAdapter;

  beforeAll(async () => {
    adapter = MariadbAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to MariaDB");
  });

  it("groups real tables and views into resources", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("mariadb");
    expect(schema.resources.map((resource) => resource.name)).toEqual([
      "metrics",
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
      { name: "id", type: "int", nullable: false },
      { name: "total", type: "int", nullable: false },
      { name: "status", type: "varchar", nullable: false },
      { name: "region", type: "varchar", nullable: true },
      { name: "note", type: "text", nullable: true },
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
      { name: "month", type: "unknown", nullable: true },
      { name: "amount", type: "unknown", nullable: true },
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
    expect(result.columns.map((column) => column.name)).toEqual(["id", "status"]);
  });

  it("returns DATE as a calendar string and BIGINT beyond MAX_SAFE_INTEGER as a string", async () => {
    const result = await adapter.query({
      resource: "metrics",
      columns: ["billed_on", "amount"],
      filters: [{ column: "id", op: "eq", value: 1 }],
      limit: 1,
    });
    expect(result.rows).toEqual([{ billed_on: "2026-01-15", amount: "9007199254740993" }]);
  });

  it("returns a safe BIGINT as a number", async () => {
    const result = await adapter.query({
      resource: "metrics",
      columns: ["amount"],
      filters: [{ column: "id", op: "eq", value: 2 }],
      limit: 1,
    });
    expect(result.rows).toEqual([{ amount: 42 }]);
  });
});

describe("MariadbAdapter connection setup", () => {
  beforeAll(async () => {
    const probe = MariadbAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
  });

  it("connects with a connection string", async () => {
    const adapter = createMariadbAdapter({
      kind: "mariadb",
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
    const adapter = MariadbAdapter.fromConfig(
      clusterConfig({ password: "not-the-cluster-password" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message.toLowerCase()).toMatch(/password|auth|access denied/);
      expect(result.message).not.toContain("not-the-cluster-password");
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when ssl is required against a self-signed cluster certificate", async () => {
    const adapter = MariadbAdapter.fromConfig(clusterConfig({ ssl: true }));
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/SSL|certificate|CERT|self[- ]signed/i);
    } finally {
      await adapter.close();
    }
  });

  it("reports failure when ssl is set on a connection string", async () => {
    const adapter = createMariadbAdapter({
      kind: "mariadb",
      connectionString: connectionString(),
      ssl: true,
    });
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/SSL|certificate|CERT|self[- ]signed/i);
    } finally {
      await adapter.close();
    }
  });

  it("closes the pool", async () => {
    const adapter = MariadbAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
  });
});
