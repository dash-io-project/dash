import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryValidationError } from "@dash/core";
import { HanaAdapter, createHanaAdapter } from "./adapter.ts";

const state = vi.hoisted(() => ({
  pools: [] as Array<{ options: unknown; pool: unknown }>,
  gets: 0,
  drops: 0,
  disconnects: 0,
  clears: 0,
  timeouts: [] as number[],
  prepared: [] as Array<{ sql: string; params: unknown[] }>,
  failGet: null as Error | null,
  emptyGet: false,
  emptyPrepare: false,
  failPrepare: null as Error | null,
  failExec: null as Error | null,
  failDrop: null as Error | null,
  failDisconnect: null as Error | null,
  failClear: null as Error | null,
  columnInfo: [] as Array<{ columnName: string; typeName: string; nullable: number }>,
  columnInfoThrows: false,
  result: [] as unknown,
}));

vi.mock("@sap/hana-client", () => ({
  createPool(options: unknown, pool: unknown) {
    const record = { options, pool };
    state.pools.push(record);
    return {
      getConnection(callback: (error: Error | null, connection?: unknown) => void) {
        state.gets += 1;
        if (state.failGet) {
          callback(state.failGet);
          return;
        }
        if (state.emptyGet) {
          callback(null);
          return;
        }
        const connection = {
          prepare(sql: string, done: (error: Error | null, statement?: unknown) => void) {
            if (state.failPrepare) {
              done(state.failPrepare);
              return;
            }
            if (state.emptyPrepare) {
              done(null);
              return;
            }
            const statement = {
              exec(params: unknown[], doneExec: (error: Error | null, rows?: unknown) => void) {
                state.prepared.push({ sql, params });
                if (state.failExec) {
                  doneExec(state.failExec);
                  return;
                }
                doneExec(null, state.result);
              },
              drop(doneDrop?: (error?: Error | null) => void) {
                state.drops += 1;
                doneDrop?.(state.failDrop);
              },
              getColumnInfo() {
                if (state.columnInfoThrows) {
                  throw new Error("no metadata");
                }
                return state.columnInfo;
              },
              setTimeout(timeout: number) {
                state.timeouts.push(timeout);
              },
            };
            done(null, statement);
          },
          disconnect(doneDisconnect?: (error?: Error | null) => void) {
            state.disconnects += 1;
            doneDisconnect?.(state.failDisconnect);
          },
        };
        callback(null, connection);
      },
      clear(done?: (error?: Error | null) => void) {
        state.clears += 1;
        done?.(state.failClear);
      },
    };
  },
}));

const config = {
  kind: "hana" as const,
  host: "hana.internal",
  port: 30015,
  database: "HXE",
  schema: "ANALYTICS",
  user: "reader",
  password: "super-secret",
  encrypt: true,
  sslValidateCertificate: true,
};

beforeEach(() => {
  state.pools.length = 0;
  state.gets = 0;
  state.drops = 0;
  state.disconnects = 0;
  state.clears = 0;
  state.timeouts.length = 0;
  state.prepared.length = 0;
  state.failGet = null;
  state.emptyGet = false;
  state.emptyPrepare = false;
  state.failPrepare = null;
  state.failExec = null;
  state.failDrop = null;
  state.failDisconnect = null;
  state.failClear = null;
  state.columnInfo = [{ columnName: "ID", typeName: "INTEGER", nullable: 0 }];
  state.columnInfoThrows = false;
  state.result = [{ ID: 1 }];
});

describe("prepared statements", () => {
  it("opens a pool from each factory with the driver allowlist", () => {
    const adapter = HanaAdapter.fromConfig(config);
    expect(adapter.kind).toBe("hana");
    expect(createHanaAdapter(config).kind).toBe("hana");
    expect(state.pools).toHaveLength(2);
    expect(state.pools[0]?.options).toEqual({
      serverNode: "hana.internal:30015",
      uid: "reader",
      pwd: "super-secret",
      databaseName: "HXE",
      currentSchema: "ANALYTICS",
      encrypt: "true",
      sslValidateCertificate: "true",
      connectTimeout: 10_000,
    });
    expect(state.pools[0]?.pool).toEqual({
      maxConnectedOrPooled: 5,
      maxPooledIdleTime: 60,
      pingCheck: false,
    });
    expect(typeof state.pools[0]?.options).toBe("object");
  });

  it("rejects a missing host before it opens a pool", () => {
    expect(() => HanaAdapter.fromConfig({ kind: "hana", user: "SYSTEM" })).toThrow(/host is required/);
    expect(state.pools).toHaveLength(0);
  });

  it.each([
    ["undefined", undefined],
    ["object", {}],
    ["array", ["paid"]],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["invalid date", new Date(Number.NaN)],
  ])(
    "rejects unsupported bind values before it borrows a connection: %s",
    async (_label, value) => {
      const adapter = HanaAdapter.fromConfig(config);
      await expect(
        adapter.query({
          resource: "orders",
          filters: [{ column: "status", op: "eq", value }],
        }),
      ).rejects.toThrow(QueryValidationError);
      expect(state.gets).toBe(0);
      expect(state.prepared).toEqual([]);
    },
  );

  it("binds null, booleans, dates, and binary values", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    const when = new Date("2026-01-02T03:04:05.000Z");
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.query({
      resource: "orders",
      filters: [
        { column: "note", op: "eq", value: null },
        { column: "flag", op: "eq", value: false },
        { column: "seen", op: "eq", value: when },
        { column: "blob", op: "eq", value: bytes },
      ],
      limit: 1,
    });
    expect(state.prepared[0]?.params?.slice(0, 3)).toEqual([null, false, when]);
    expect(Buffer.isBuffer(state.prepared[0]?.params?.[3])).toBe(true);
    expect(Buffer.from(state.prepared[0]?.params?.[3] as Uint8Array).equals(Buffer.from(bytes))).toBe(
      true,
    );
    expect(state.prepared[0]?.params?.slice(4)).toEqual([1, 0]);
  });

  it("rejects a bind list that is longer than the parameter cap", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    const value = Array.from({ length: 10_001 }, () => 1);
    await expect(
      adapter.query({
        resource: "orders",
        filters: [{ column: "id", op: "in", value }],
      }),
    ).rejects.toThrow(/too many parameters/);
    expect(state.gets).toBe(0);
  });

  it("sends untrusted values only as prepared-statement binds", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    const payload = "paid' OR 1=1 -- ";
    const result = await adapter.query({
      resource: "orders",
      filters: [{ column: "status", op: "eq", value: payload }],
      limit: 10,
      offset: 2,
    });
    expect(state.prepared).toEqual([
      {
        sql: 'SELECT * FROM "orders" WHERE "status" = ? LIMIT ? OFFSET ?',
        params: [payload, 10, 2],
      },
    ]);
    expect(state.timeouts).toEqual([60_000]);
    expect(state.drops).toBe(1);
    expect(state.disconnects).toBe(1);
    expect(result.columns).toEqual([{ name: "ID", type: "INTEGER", nullable: false }]);
    expect(result.rows).toEqual([{ ID: 1 }]);
  });

  it("reuses the pool for a second query", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    await adapter.query({ resource: "orders", limit: 1 });
    await adapter.query({ resource: "orders", limit: 1 });
    expect(state.pools).toHaveLength(1);
    expect(state.gets).toBe(2);
    expect(state.disconnects).toBe(2);
  });

  it("falls back to row keys when column metadata is empty or throws", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.columnInfo = [];
    state.result = [{ id: 4 }];
    const empty = await adapter.query({ resource: "orders", limit: 5 });
    expect(empty.columns).toEqual([{ name: "id", type: "unknown", nullable: true }]);

    state.columnInfoThrows = true;
    const thrown = await adapter.query({ resource: "orders", limit: 5 });
    expect(thrown.columns).toEqual([{ name: "id", type: "unknown", nullable: true }]);
  });

  it("disconnects when prepare fails and does not drop a statement", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.failPrepare = new Error("prepare failed super-secret");
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(
      /prepare failed \[redacted\]/,
    );
    expect(state.drops).toBe(0);
    expect(state.disconnects).toBe(1);
    expect(state.prepared).toEqual([]);
  });

  it("drops and disconnects when exec fails, and redacts the password", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.failExec = new Error("exec failed super-secret");
    state.failDrop = new Error("drop failed");
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/exec failed \[redacted\]/);
    expect(state.drops).toBe(1);
    expect(state.disconnects).toBe(1);
  });

  it("returns the connection when drop fails after a successful exec", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.failDrop = new Error("drop failed super-secret");
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/drop failed \[redacted\]/);
    expect(state.disconnects).toBe(1);
  });

  it("redacts a password in a pool checkout error and does not disconnect", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.failGet = new Error("login failed for super-secret");
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/login failed for \[redacted\]/);
    expect(state.disconnects).toBe(0);
  });

  it("rejects an empty pool checkout or an empty prepare", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.emptyGet = true;
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/no connection/);
    expect(state.disconnects).toBe(0);

    state.emptyGet = false;
    state.emptyPrepare = true;
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/did not prepare/);
    expect(state.disconnects).toBe(1);
    expect(state.drops).toBe(0);
  });

  it("reports a disconnect failure after a successful query", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.failDisconnect = new Error("disconnect failed");
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/disconnect failed/);
    expect(state.drops).toBe(1);
  });

  it("treats a nullable column with no type name as unknown", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.columnInfo = [{ columnName: "", typeName: "", nullable: 1 }];
    const result = await adapter.query({ resource: "orders", limit: 1 });
    expect(result.columns).toEqual([{ name: "", type: "unknown", nullable: true }]);
  });

  it("rejects a result that is not a row list", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.result = 1 as unknown as never[];
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/did not return rows/);
    state.result = [[{ id: 1 }]] as unknown as never[];
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/invalid row/);
    expect(state.disconnects).toBe(2);
  });

  it("clears the pool once and rejects later queries", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    await adapter.close();
    await adapter.close();
    expect(state.clears).toBe(1);
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow(/closed/);
    expect(state.gets).toBe(0);
  });

  it("surfaces a pool clear failure", async () => {
    const adapter = HanaAdapter.fromConfig(config);
    state.failClear = new Error("clear failed");
    await expect(adapter.close()).rejects.toThrow(/clear failed/);
  });

  it("rejects a short password only when the driver echoes four or more characters", async () => {
    const adapter = HanaAdapter.fromConfig({ ...config, password: "ab" });
    state.failExec = new Error("failed ab");
    await expect(adapter.query({ resource: "orders" })).rejects.toThrow("failed ab");
  });
});
