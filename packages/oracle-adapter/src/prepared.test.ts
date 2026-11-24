import { beforeEach, expect, it, vi } from "vitest";
import { QueryValidationError } from "@dash/core";
import oracledb from "oracledb";
import { OracleAdapter } from "./adapter.ts";

const execute = vi.hoisted(() => vi.fn());
const closeConnection = vi.hoisted(() => vi.fn());
const closePool = vi.hoisted(() => vi.fn());
const createPool = vi.hoisted(() => vi.fn());

vi.mock("oracledb", () => {
  const DB_TYPE_DATE = { name: "DATE" };
  const DB_TYPE_NUMBER = { name: "NUMBER" };
  const DB_TYPE_VARCHAR = { name: "VARCHAR" };
  const DB_TYPE_CLOB = { name: "CLOB" };
  const DB_TYPE_NCLOB = { name: "NCLOB" };
  const DB_TYPE_BLOB = { name: "BLOB" };
  const DB_TYPE_BFILE = { name: "BFILE" };
  const DB_TYPE_LONG_RAW = { name: "LONG RAW" };
  const api = {
    createPool,
    OUT_FORMAT_OBJECT: 4002,
    DB_TYPE_DATE,
    DB_TYPE_NUMBER,
    DB_TYPE_VARCHAR,
    DB_TYPE_CLOB,
    DB_TYPE_NCLOB,
    DB_TYPE_BLOB,
    DB_TYPE_BFILE,
    DB_TYPE_LONG_RAW,
  };
  return { default: api, ...api };
});

beforeEach(() => {
  vi.clearAllMocks();
  closeConnection.mockResolvedValue(undefined);
  closePool.mockResolvedValue(undefined);
  execute.mockResolvedValue({ rows: [], metaData: [] });
  createPool.mockResolvedValue({
    getConnection: vi.fn().mockResolvedValue({
      execute,
      close: closeConnection,
      callTimeout: 0,
    }),
    close: closePool,
  });
});

it.each([undefined, {}, ["paid"], Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects unsupported bind values before executing SQL: %j",
  async (value) => {
    const adapter = OracleAdapter.fromConfig({
      kind: "oracle",
      host: "db.internal",
      database: "FREEPDB1",
      user: "reader",
      password: "s3cret",
    });
    try {
      await expect(
        adapter.query({
          resource: "orders",
          filters: [{ column: "status", op: "eq", value }],
        }),
      ).rejects.toThrow(QueryValidationError);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await adapter.close();
    }
  },
);

it("sends untrusted values as named binds", async () => {
  const adapter = OracleAdapter.fromConfig({
    kind: "oracle",
    host: "db.internal",
    database: "FREEPDB1",
    user: "reader",
    password: "s3cret",
  });
  const payload = "paid' OR 1=1 -- ";
  try {
    await adapter.query({
      resource: "orders",
      filters: [{ column: "status", op: "eq", value: payload }],
      limit: 10,
      offset: 2,
    });
    expect(execute).toHaveBeenCalledWith(
      'SELECT * FROM "ORDERS" WHERE "STATUS" = :p0 ORDER BY NULL OFFSET :p1 ROWS FETCH NEXT :p2 ROWS ONLY',
      { p0: payload, p1: 2, p2: 10 },
      expect.any(Object),
    );
  } finally {
    await adapter.close();
  }
});

it("uses TCPS for Oracle Cloud and keeps the password out of the connect string", async () => {
  const adapter = OracleAdapter.fromConfig({
    kind: "oracle",
    host: "db.adb.us-ashburn-1.oraclecloud.com",
    database: "db_high.adb.oraclecloud.com",
    user: "reader",
    password: "super-secret",
  });
  try {
    await adapter.testConnection();
  } finally {
    await adapter.close();
  }
  expect(createPool).toHaveBeenCalledWith(
    expect.objectContaining({
      user: "reader",
      password: "super-secret",
      connectString:
        "tcps://db.adb.us-ashburn-1.oraclecloud.com:1522/db_high.adb.oraclecloud.com?ssl_server_dn_match=yes",
    }),
  );
  const config = createPool.mock.calls.at(-1)?.[0] as { connectString: string };
  expect(config.connectString).not.toContain("super-secret");
});

it("does not open another pool after close", async () => {
  const adapter = OracleAdapter.fromConfig({
    kind: "oracle",
    host: "db.internal",
    database: "FREEPDB1",
    user: "reader",
    password: "s3cret",
  });
  await adapter.testConnection();
  expect(createPool).toHaveBeenCalledTimes(1);
  await adapter.close();
  const result = await adapter.testConnection();
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/closed/);
  expect(createPool).toHaveBeenCalledTimes(1);
});

it("redacts a password from a borrow failure and keeps the query error when close fails", async () => {
  createPool.mockResolvedValue({
    getConnection: vi.fn().mockRejectedValue(new Error("login failed for s3cret")),
    close: closePool,
  });
  const adapter = OracleAdapter.fromConfig({
    kind: "oracle",
    host: "db.internal",
    database: "FREEPDB1",
    user: "reader",
    password: "s3cret",
  });
  const borrowed = await adapter.testConnection();
  expect(borrowed.ok).toBe(false);
  expect(borrowed.message).toBe("login failed for ***");
  expect(borrowed.message).not.toContain("s3cret");

  execute.mockRejectedValue(new Error("ORA-00942 missing s3cret"));
  closeConnection.mockRejectedValue(new Error("close failed with s3cret"));
  createPool.mockResolvedValue({
    getConnection: vi.fn().mockResolvedValue({
      execute,
      close: closeConnection,
      callTimeout: 0,
    }),
    close: closePool,
  });
  const queried = OracleAdapter.fromConfig({
    kind: "oracle",
    host: "db.internal",
    database: "FREEPDB1",
    user: "reader",
    password: "s3cret",
  });
  const failed = await queried.testConnection();
  expect(failed.message).toBe("ORA-00942 missing ***");
  expect(failed.message).not.toContain("close failed");
  await queried.close();
});

it("fetches a BLOB as bytes and reads a BFILE before the connection closes", async () => {
  const adapter = OracleAdapter.fromConfig({
    kind: "oracle",
    host: "db.internal",
    database: "FREEPDB1",
    user: "reader",
    password: "s3cret",
  });
  try {
    await adapter.testConnection();
    const options = execute.mock.calls.find((call) => call[2])?.[2] as {
      fetchTypeHandler: (metaData: { dbType: unknown; name: string }) => {
        type?: unknown;
        converter?: (value: unknown) => Promise<unknown>;
      };
    };
    expect(options.fetchTypeHandler({ dbType: oracledb.DB_TYPE_BLOB, name: "BIN" })).toEqual({
      type: oracledb.DB_TYPE_LONG_RAW,
    });
    const file = options.fetchTypeHandler({ dbType: oracledb.DB_TYPE_BFILE, name: "FILE" });
    const payload = Buffer.from("abc");
    await expect(file.converter?.({ getData: async () => payload })).resolves.toBe(payload);
    await expect(file.converter?.(null)).resolves.toBeNull();
  } finally {
    await adapter.close();
  }
});
