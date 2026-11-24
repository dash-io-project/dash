import type { DynamoDbSession } from "./connection.ts";
import { DynamoDbError, dynamoCall } from "./http.ts";
import { scalarToAttribute } from "./values.ts";

const ORDERS: Array<Record<string, string | number>> = [
  { id: 1, total: 10, status: "paid", region: "Europe", note: "first" },
  { id: 2, total: 25, status: "paid", region: "Europe" },
  { id: 3, total: 5, status: "open", region: "Asia Pacific", note: "third" },
  { id: 4, total: 40, status: "paid", region: "North America" },
  { id: 5, total: 25, status: "hold", region: "Other" },
];

const REVENUE: Array<Record<string, string | number>> = [
  { month: "2026-01", amount: 10 },
  { month: "2026-02", amount: 20 },
  { month: "2026-03", amount: 15 },
];

export async function ensureDynamoFixture(session: DynamoDbSession): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  await ensureTable(
    session,
    signal,
    "orders",
    [{ AttributeName: "id", AttributeType: "N" }],
    [{ AttributeName: "id", KeyType: "HASH" }],
  );
  await ensureTable(
    session,
    signal,
    "revenue",
    [{ AttributeName: "month", AttributeType: "S" }],
    [{ AttributeName: "month", KeyType: "HASH" }],
  );
  for (const row of ORDERS) {
    await putItem(session, signal, "orders", row);
  }
  for (const row of REVENUE) {
    await putItem(session, signal, "revenue", row);
  }
}

async function ensureTable(
  session: DynamoDbSession,
  signal: AbortSignal,
  name: string,
  attributes: Array<{ AttributeName: string; AttributeType: string }>,
  keys: Array<{ AttributeName: string; KeyType: string }>,
): Promise<void> {
  try {
    await dynamoCall(
      session,
      "CreateTable",
      {
        TableName: name,
        AttributeDefinitions: attributes,
        KeySchema: keys,
        BillingMode: "PAY_PER_REQUEST",
      },
      signal,
    );
  } catch (error) {
    if (error instanceof DynamoDbError && error.type === "ResourceInUseException") {
      return;
    }
    throw error;
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const described = await dynamoCall(session, "DescribeTable", { TableName: name }, signal);
    const table =
      described && typeof described === "object" && !Array.isArray(described)
        ? (described as { Table?: { TableStatus?: unknown } }).Table
        : undefined;
    if (table?.TableStatus === "ACTIVE") {
      return;
    }
    await delay(100);
  }
  throw new Error("DynamoDB table was not ready");
}

async function putItem(
  session: DynamoDbSession,
  signal: AbortSignal,
  table: string,
  row: Record<string, string | number>,
): Promise<void> {
  const item: Record<string, ReturnType<typeof scalarToAttribute>> = {};
  for (const [key, value] of Object.entries(row)) {
    item[key] = scalarToAttribute(value);
  }
  await dynamoCall(session, "PutItem", { TableName: table, Item: item }, signal);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
