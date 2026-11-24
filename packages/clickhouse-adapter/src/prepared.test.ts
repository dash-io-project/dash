import { beforeEach, expect, it, vi } from "vitest";
import { QueryValidationError } from "@dash/core";
import { ClickHouseAdapter } from "./adapter.ts";

const client = vi.hoisted(() => ({
  options: [] as unknown[],
  query: vi.fn().mockResolvedValue({
    json: async () => ({ meta: [], data: [], rows: 0 }),
  }),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@clickhouse/client", () => ({
  createClient(options: unknown) {
    client.options.push(options);
    return {
      query: client.query,
      close: client.close,
    };
  },
}));

const config = {
  kind: "clickhouse" as const,
  host: "localhost",
  database: "dash",
  user: "dash",
  ssl: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  client.options.length = 0;
});

it.each([undefined, {}, ["paid"], Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects unsupported bind values before executing SQL: %j",
  async (value) => {
    const adapter = ClickHouseAdapter.fromConfig(config);
    try {
      await expect(
        adapter.query({
          resource: "orders",
          filters: [{ column: "status", op: "eq", value }],
        }),
      ).rejects.toThrow(QueryValidationError);
      expect(client.query).not.toHaveBeenCalled();
    } finally {
      await adapter.close();
    }
  },
);

it("builds the client from parsed fields and keeps the password out of the URL", async () => {
  const adapter = ClickHouseAdapter.fromConfig({
    kind: "clickhouse",
    connectionString: "clickhouse://dash:super-secret@example.clickhouse.cloud/analytics",
  });
  try {
    const options = client.options.at(-1) as {
      url?: string;
      username?: string;
      password?: string;
      database?: string;
      request_timeout?: number;
      clickhouse_settings?: { readonly?: string; max_execution_time?: number };
    };
    expect(options).toMatchObject({
      url: "https://example.clickhouse.cloud:8443",
      username: "dash",
      password: "super-secret",
      database: "analytics",
      application: "dash",
      request_timeout: 60_000,
      clickhouse_settings: {
        readonly: "1",
        max_execution_time: 60,
        cancel_http_readonly_queries_on_client_close: 1,
      },
    });
    expect(options.url).not.toContain("super-secret");
    expect(options.url).not.toContain("dash:");
    expect(options).not.toHaveProperty("connectionString");
  } finally {
    await adapter.close();
  }
});

it("qualifies the connected database even when that database is default", async () => {
  const adapter = ClickHouseAdapter.fromConfig({ ...config, database: "default" });
  try {
    await adapter.query({ resource: "orders", limit: 1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("FROM `default`.`orders`"),
      }),
    );
  } finally {
    await adapter.close();
  }
});

it("marks a maximum page truncated only when another row exists", async () => {
  const page = Array.from({ length: 10_000 }, (_, index) => ({ id: index }));
  client.query.mockResolvedValueOnce({
    json: async () => ({ meta: [{ name: "id", type: "Int32" }], data: page }),
  });
  const adapter = ClickHouseAdapter.fromConfig(config);
  try {
    const exact = await adapter.query({ resource: "orders", limit: 10_000 });
    expect(exact.rowCount).toBe(10_000);
    expect(exact.truncated).toBe(false);
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({ query_params: { p0: 10_001, p1: 0 } }),
    );
  } finally {
    await adapter.close();
  }

  client.query.mockResolvedValueOnce({
    json: async () => ({
      meta: [
        { name: "id", type: "Int32" },
        { name: "tags", type: "Array(Nullable(String))" },
        { name: "label", type: "LowCardinality(Nullable(String))" },
      ],
      data: [...page, { id: 10_000 }],
    }),
  });
  const again = ClickHouseAdapter.fromConfig(config);
  try {
    const overflow = await again.query({ resource: "orders", limit: 10_000 });
    expect(overflow.rowCount).toBe(10_000);
    expect(overflow.truncated).toBe(true);
    expect(overflow.columns).toEqual([
      { name: "id", type: "Int32", nullable: false },
      { name: "tags", type: "Array(Nullable(String))", nullable: false },
      { name: "label", type: "LowCardinality(Nullable(String))", nullable: true },
    ]);
  } finally {
    await again.close();
  }
});

it("sends untrusted values as query parameters", async () => {
  const adapter = ClickHouseAdapter.fromConfig(config);
  const payload = "paid' OR 1=1 -- ";
  try {
    await adapter.query({
      resource: "orders",
      filters: [{ column: "status", op: "eq", value: payload }],
      limit: 10,
      offset: 2,
    });
    expect(client.query).toHaveBeenCalledWith({
      query: "SELECT * FROM `dash`.`orders` WHERE `status` = {p0:String} LIMIT {p1:UInt64} OFFSET {p2:UInt64}",
      query_params: { p0: payload, p1: 11, p2: 2 },
      format: "JSON",
    });
  } finally {
    await adapter.close();
  }
});
