import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, DynamoDbConnectionConfig } from "@dash/core";
import { QueryValidationError } from "@dash/core";
import { DynamoDbAdapter, accumulateTableNames, createDynamoDbAdapter } from "./adapter.ts";
import { dynamoSession, type DynamoDbSession } from "./connection.ts";
import { ensureDynamoFixture } from "./fixture.ts";
import { DynamoDbError, dynamoCall } from "./http.ts";
import { scalarToAttribute } from "./values.ts";

const NOT_READY = "DynamoDB test cluster is not ready. Start it with `pnpm test:services:start`.";

function clusterEndpoint(): {
  host: string;
  port: number;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
} {
  const port = Number(process.env.DASH_TEST_DYNAMODB_PORT ?? 8009);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid DASH_TEST_DYNAMODB_PORT: ${process.env.DASH_TEST_DYNAMODB_PORT}`);
  }
  return {
    host: process.env.DASH_TEST_DYNAMODB_HOST ?? "127.0.0.1",
    port,
    region: process.env.DASH_TEST_DYNAMODB_REGION ?? "us-east-1",
    accessKeyId: process.env.DASH_TEST_DYNAMODB_ACCESS_KEY_ID ?? "dash",
    secretAccessKey: process.env.DASH_TEST_DYNAMODB_SECRET_ACCESS_KEY ?? "dashsecret",
  };
}

function clusterConfig(overrides: Partial<DynamoDbConnectionConfig> = {}): DynamoDbConnectionConfig {
  const endpoint = clusterEndpoint();
  return {
    kind: "dynamodb",
    region: endpoint.region,
    accessKeyId: endpoint.accessKeyId,
    secretAccessKey: endpoint.secretAccessKey,
    endpoint: `http://${endpoint.host}:${endpoint.port}`,
    ...overrides,
  };
}

function connectionString(): string {
  const endpoint = clusterEndpoint();
  const origin = `http://${endpoint.host}:${endpoint.port}`;
  return `dynamodb://${encodeURIComponent(endpoint.accessKeyId)}:${encodeURIComponent(endpoint.secretAccessKey)}@${endpoint.region}?endpoint=${encodeURIComponent(origin)}`;
}

async function requireCluster(adapter: DynamoDbAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("accumulateTableNames", () => {
  it("reports a further page when the cap is filled", () => {
    const collected = accumulateTableNames(
      [
        { names: ["a", "b"], next: "c" },
        { names: ["c", "d"], next: "e" },
      ],
      3,
    );
    expect(collected.names).toEqual(["a", "b", "c"]);
    expect(collected.truncated).toBe(true);
  });

  it("stays complete when the last page fits", () => {
    const collected = accumulateTableNames([{ names: ["b", "a"] }], 3);
    expect(collected.names).toEqual(["a", "b"]);
    expect(collected.truncated).toBe(false);
  });
});

describe("DynamoDbAdapter against the test cluster", () => {
  let adapter: DynamoDbAdapter;

  beforeAll(async () => {
    adapter = DynamoDbAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await deleteTable(dynamoSession(clusterConfig()), WIDE_TABLE);
    await ensureDynamoFixture(dynamoSession(clusterConfig()));
  }, 30_000);

  afterAll(async () => {
    await adapter.close();
  });

  it("reports a successful connection test", async () => {
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toBe("Connected to DynamoDB");
  });

  it("lists sampled tables", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("dynamodb");
    expect(schema.resources.map((resource) => resource.name)).toEqual(["orders", "revenue"]);
    const orders = schema.resources.find((resource) => resource.name === "orders");
    expect(orders).toMatchObject({ namespace: "us-east-1", kind: "table" });
    expect(orders?.columns.map((column) => column.name)).toEqual(["id", "note", "region", "status", "total"]);
    expect(orders?.columns.find((column) => column.name === "id")).toMatchObject({
      type: "number",
      nullable: false,
    });
    expect(orders?.columns.find((column) => column.name === "note")?.nullable).toBe(true);
    expect(orders?.columns.find((column) => column.name === "status")?.type).toBe("string");
  });

  it("runs a compiled read and returns rows in order", async () => {
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

  it("honors offset and does not mark an exact page truncated", async () => {
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

  it("returns requested columns when the cluster sends no rows", async () => {
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

  it("rejects an operator object before it reaches the cluster", async () => {
    await expect(
      adapter.query({
        resource: "orders",
        filters: [{ column: "status", op: "eq", value: { S: "paid" } }],
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);
  });
});

describe("DynamoDbAdapter connection setup", () => {
  it("connects with a connection string", async () => {
    const probe = DynamoDbAdapter.fromConfig(clusterConfig());
    try {
      await requireCluster(probe);
    } finally {
      await probe.close();
    }
    const adapter = createDynamoDbAdapter({
      kind: "dynamodb",
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

  it("reports a refused port without echoing the secret", async () => {
    const adapter = DynamoDbAdapter.fromConfig(
      clusterConfig({ endpoint: "http://127.0.0.1:1", secretAccessKey: "dashsecret" }),
    );
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toBe("DynamoDB request failed");
      expect(result.message).not.toContain("dashsecret");
    } finally {
      await adapter.close();
    }
  });

  it("stops calling DynamoDB after close", async () => {
    const adapter = DynamoDbAdapter.fromConfig(clusterConfig());
    await adapter.close();
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("DynamoDB request was cancelled");
  });
});

describe("DynamoDbAdapter page at the scan cap", () => {
  let adapter: DynamoDbAdapter;

  beforeAll(async () => {
    adapter = DynamoDbAdapter.fromConfig(clusterConfig());
    await requireCluster(adapter);
    await writeNumberTable(dynamoSession(clusterConfig()), WIDE_TABLE, PAGE_CAP + 1);
  }, 120_000);

  afterAll(async () => {
    await deleteTable(dynamoSession(clusterConfig()), WIDE_TABLE);
    await adapter?.close();
  });

  it("returns 10000 rows and marks the page truncated when one more row exists", async () => {
    const result = await adapter.query({
      resource: WIDE_TABLE,
      columns: ["n"],
      limit: PAGE_CAP,
    });
    expect(result.rowCount).toBe(PAGE_CAP);
    expect(result.truncated).toBe(true);
    expect(new Set(result.rows.map((row) => row.n)).size).toBe(PAGE_CAP);
  }, 60_000);
});

const PAGE_CAP = 10_000;
const WIDE_TABLE = "wide";

async function deleteTable(session: DynamoDbSession, name: string): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  try {
    await dynamoCall(session, "DeleteTable", { TableName: name }, signal);
  } catch (error) {
    if (error instanceof DynamoDbError && error.type === "ResourceNotFoundException") {
      return;
    }
    throw error;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await dynamoCall(session, "DescribeTable", { TableName: name }, signal);
    } catch (error) {
      if (error instanceof DynamoDbError && error.type === "ResourceNotFoundException") {
        return;
      }
      throw error;
    }
    await delay(100);
  }
  throw new Error("DynamoDB table was not deleted");
}

async function writeNumberTable(session: DynamoDbSession, name: string, count: number): Promise<void> {
  const signal = AbortSignal.timeout(120_000);
  await deleteTable(session, name);
  await dynamoCall(
    session,
    "CreateTable",
    {
      TableName: name,
      AttributeDefinitions: [{ AttributeName: "n", AttributeType: "N" }],
      KeySchema: [{ AttributeName: "n", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    },
    signal,
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const described = await dynamoCall(session, "DescribeTable", { TableName: name }, signal);
    const table =
      described && typeof described === "object" && !Array.isArray(described)
        ? (described as { Table?: { TableStatus?: unknown } }).Table
        : undefined;
    if (table?.TableStatus === "ACTIVE") {
      break;
    }
    if (attempt === 49) {
      throw new Error("DynamoDB table was not ready");
    }
    await delay(100);
  }

  const batches: number[][] = [];
  for (let start = 1; start <= count; start += 25) {
    const ids: number[] = [];
    for (let n = start; n < start + 25 && n <= count; n += 1) {
      ids.push(n);
    }
    batches.push(ids);
  }
  let index = 0;
  async function worker(): Promise<void> {
    while (index < batches.length) {
      const current = index;
      index += 1;
      const ids = batches[current];
      if (!ids) {
        return;
      }
      let pending: Array<{ PutRequest: { Item: Record<string, unknown> } }> = ids.map((n) => ({
        PutRequest: { Item: { n: scalarToAttribute(n) } },
      }));
      for (let attempt = 0; attempt < 8 && pending.length > 0; attempt += 1) {
        const response = await dynamoCall(
          session,
          "BatchWriteItem",
          { RequestItems: { [name]: pending } },
          signal,
        );
        pending = unprocessedPuts(response, name);
      }
      if (pending.length > 0) {
        throw new Error("DynamoDB did not store every item");
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
}

function unprocessedPuts(
  body: unknown,
  table: string,
): Array<{ PutRequest: { Item: Record<string, unknown> } }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const raw = (body as { UnprocessedItems?: unknown }).UnprocessedItems;
  if (raw === undefined) {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const items = (raw as Record<string, unknown>)[table];
  if (items === undefined) {
    return [];
  }
  if (!Array.isArray(items)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  return items as Array<{ PutRequest: { Item: Record<string, unknown> } }>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
