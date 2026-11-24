import { beforeEach, expect, it, vi } from "vitest";
import { QueryValidationError } from "@dash/core";
import { MariadbAdapter } from "./adapter.ts";

const pool = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue(Object.assign([], { meta: [] })),
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

const createPool = vi.hoisted(() => vi.fn((_config: Record<string, unknown>) => pool));

vi.mock("mariadb", () => ({ createPool }));

beforeEach(() => vi.clearAllMocks());

it.each([undefined, {}, ["paid"], Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects unsupported bind values before executing SQL: %j",
  async (value) => {
    const adapter = MariadbAdapter.fromConfig({ kind: "mariadb", host: "localhost" });
    try {
      await expect(
        adapter.query({
          resource: "orders",
          filters: [{ column: "status", op: "eq", value }],
        }),
      ).rejects.toThrow(QueryValidationError);
      expect(pool.execute).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    } finally {
      await adapter.close();
    }
  },
);

it("sends untrusted values separately through server-side prepared statements", async () => {
  const adapter = MariadbAdapter.fromConfig({ kind: "mariadb", host: "localhost" });
  const payload = "paid' OR 1=1 -- ";
  try {
    await adapter.query({
      resource: "orders",
      filters: [{ column: "status", op: "eq", value: payload }],
      limit: 10,
      offset: 2,
    });
    expect(pool.execute).toHaveBeenCalledWith(
      "SELECT * FROM `orders` WHERE `status` = ? LIMIT ? OFFSET ?",
      [payload, 10, 2],
    );
    expect(pool.query).not.toHaveBeenCalled();
  } finally {
    await adapter.close();
  }
});

it("does not pass URI options that can change driver behavior", () => {
  const adapter = MariadbAdapter.fromConfig({
    kind: "mariadb",
    connectionString:
      "mariadb://reader:s3cret@db.internal:3306/analytics?local_infile=1&debug=1&ssl-mode=REQUIRED",
  });
  const config = createPool.mock.calls[0]?.[0];
  expect(config).toBeDefined();
  if (!config) {
    return;
  }
  expect(config).toMatchObject({
    host: "db.internal",
    port: 3306,
    database: "analytics",
    user: "reader",
    password: "s3cret",
    permitLocalInfile: false,
    multipleStatements: false,
    namedPlaceholders: false,
    permitSetMultiParamEntries: false,
    debug: false,
    trace: false,
    logParam: false,
  });
  expect(config.ssl).toMatchObject({
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  });
  expect(config).not.toHaveProperty("uri");
  return adapter.close();
});

it("rejects a driver result that is not a row list", async () => {
  pool.execute.mockResolvedValueOnce({ affectedRows: 1 });
  const adapter = MariadbAdapter.fromConfig({ kind: "mariadb", host: "localhost" });
  try {
    await expect(adapter.query({ resource: "orders", limit: 1 })).rejects.toThrow(/did not return rows/);
  } finally {
    await adapter.close();
  }
});

it("leaves TLS off when the config and the URI do not request it", () => {
  const adapter = MariadbAdapter.fromConfig({
    kind: "mariadb",
    connectionString: "mariadb://reader@db.internal/analytics?ssl-mode=DISABLED",
  });
  const config = createPool.mock.calls[0]?.[0];
  expect(config).toBeDefined();
  if (!config) {
    return;
  }
  expect(config.ssl).toBeUndefined();
  return adapter.close();
});
