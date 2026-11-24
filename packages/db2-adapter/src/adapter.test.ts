import { QueryValidationError } from "@dash/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Db2Adapter, createDb2Adapter } from "./adapter.ts";
import type { SqlClient } from "./driver.ts";

const state = vi.hoisted(() => ({
  broken: false,
  max: [] as number[],
  opened: [] as string[],
  prepared: [] as string[],
  executed: [] as unknown[][],
  returned: 0,
  closedPools: 0,
  failOpen: undefined as string | undefined,
  failPrepare: false,
  failExecute: false,
  executeTuple: false,
  closeConnectionError: false,
  thrown: undefined as unknown,
  rawResult: undefined as unknown,
  rawMetadata: undefined as unknown,
  metadata: [] as Array<Record<string, unknown>>,
  rows: [] as unknown,
}));

vi.mock("ibm_db", () => {
  class Pool {
    setMaxPoolSize(size: number) {
      state.max.push(size);
    }
    async open(connectionString: string) {
      state.opened.push(connectionString);
      if (state.thrown !== undefined) {
        throw state.thrown;
      }
      if (state.failOpen) {
        throw new Error(state.failOpen);
      }
      return {
        async prepare(sql: string) {
          state.prepared.push(sql);
          if (state.failPrepare) {
            throw new Error("prepare failed");
          }
          return {
            async execute(params?: unknown[]) {
              state.executed.push(params ?? []);
              if (state.failExecute) {
                throw new Error(`execute failed ${connectionString}`);
              }
              if (state.rawResult !== undefined) {
                return state.rawResult;
              }
              const result = {
                getColumnMetadataSync() {
                  return state.rawMetadata === undefined ? state.metadata : state.rawMetadata;
                },
                async fetchAll() {
                  return state.rows;
                },
                async close() {
                  return undefined;
                },
              };
              return state.executeTuple ? [result, []] : result;
            },
            async close() {
              return undefined;
            },
          };
        },
        async close() {
          state.returned += 1;
          if (state.closeConnectionError) {
            throw new Error("close failed");
          }
        },
      };
    }
    async close() {
      state.closedPools += 1;
    }
  }
  const api = function db2Driver() {
    return undefined;
  };
  Object.defineProperty(api, "Pool", {
    get() {
      return state.broken ? undefined : Pool;
    },
  });
  return { default: api, Pool };
});

const config = {
  kind: "db2" as const,
  host: "db.example",
  database: "dash",
  user: "db2inst1",
  password: "super-secret",
  schema: "DASH",
};

function resetState(): void {
  state.broken = false;
  state.max.length = 0;
  state.opened.length = 0;
  state.prepared.length = 0;
  state.executed.length = 0;
  state.returned = 0;
  state.closedPools = 0;
  state.failOpen = undefined;
  state.failPrepare = false;
  state.failExecute = false;
  state.executeTuple = false;
  state.closeConnectionError = false;
  state.thrown = undefined;
  state.rawResult = undefined;
  state.rawMetadata = undefined;
  state.metadata = [];
  state.rows = [];
}

beforeEach(() => {
  resetState();
});

describe("Db2Adapter", () => {
  it("prepares a statement and binds every value", async () => {
    state.metadata = [
      { SQL_DESC_NAME: "ID", SQL_DESC_TYPE_NAME: "INTEGER" },
      { SQL_DESC_NAME: "  ", SQL_DESC_TYPE_NAME: "VARCHAR" },
      { SQL_DESC_NAME: "STATUS", SQL_DESC_TYPE_NAME: "" },
    ];
    state.rows = [{ ID: 1, STATUS: "paid" }];
    const adapter = createDb2Adapter(config);
    try {
      const probe = await adapter.testConnection();
      expect(probe.ok).toBe(true);
      expect(probe.message).toBe("Connected to IBM Db2");
      expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
      const result = await adapter.query({
        resource: "ORDERS",
        columns: ["ID", "STATUS"],
        filters: [{ column: "STATUS", op: "eq", value: "paid" }],
        limit: 10,
      });
      expect(state.max).toEqual([5]);
      expect(state.opened[0]).toContain("PWD=super-secret");
      expect(state.opened[0]).not.toContain("Security=SSL");
      expect(state.prepared[0]).toBe('SELECT 1 AS "ok" FROM SYSIBM.SYSDUMMY1');
      expect(state.executed[0]).toEqual([]);
      expect(state.prepared[1]).toContain('FROM "DASH"."ORDERS"');
      expect(state.prepared[1]).toContain('"STATUS" = ?');
      expect(state.executed[1]?.slice(0, 1)).toEqual(["paid"]);
      expect(result.rows).toEqual([{ ID: 1, STATUS: "paid" }]);
      expect(result.columns).toEqual([
        { name: "ID", type: "INTEGER", nullable: true },
        { name: "STATUS", type: "unknown", nullable: true },
      ]);
      expect(result.truncated).toBe(false);
      expect(state.returned).toBe(2);
    } finally {
      await adapter.close();
      await adapter.close();
    }
    expect(state.closedPools).toBe(1);
  });

  it("uses a result tuple, caps extra rows, and marks a full page truncated", async () => {
    state.executeTuple = true;
    state.rows = [{ ID: 1 }, { ID: 2 }, { ID: 3 }];
    const adapter = Db2Adapter.fromConfig({ ...config, ssl: true });
    try {
      const result = await adapter.query({ resource: "ORDERS", columns: ["ID"], limit: 2 });
      expect(state.opened[0]).toContain("Security=SSL");
      expect(result.rows).toEqual([{ ID: 1 }, { ID: 2 }]);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(true);
      expect(result.columns.map((column) => column.name)).toEqual(["ID"]);
    } finally {
      await adapter.close();
    }
  });

  it("returns metadata columns when the result has no rows", async () => {
    state.metadata = [{ SQL_DESC_NAME: "ID", SQL_DESC_TYPE_NAME: "INTEGER" }];
    state.rows = [];
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.query({
        resource: "ORDERS",
        columns: ["ID"],
        filters: [{ column: "ID", op: "eq", value: -1 }],
      });
      expect(result.rows).toEqual([]);
      expect(result.columns).toEqual([{ name: "ID", type: "INTEGER", nullable: true }]);
      expect(result.truncated).toBe(false);
    } finally {
      await adapter.close();
    }
  });

  it("groups tables and views and skips a blank catalog name", async () => {
    state.rows = [
      {
        namespace: "DASH",
        name: "ORDERS",
        table_type: "T",
        column_name: "ID",
        data_type: "INTEGER",
        is_nullable: "N",
      },
      {
        namespace: "DASH",
        name: "ORDERS",
        table_type: "T",
        column_name: "STATUS",
        data_type: "VARCHAR",
        is_nullable: "Y",
      },
      {
        NAMESPACE: "DASH",
        NAME: "PAID_ORDERS",
        TABLE_TYPE: "V",
        COLUMN_NAME: "ID",
        DATA_TYPE: "INTEGER",
        IS_NULLABLE: "Y",
      },
      {
        namespace: "",
        name: "SKIP",
        table_type: "T",
        column_name: "ID",
        data_type: "INTEGER",
        is_nullable: "N",
      },
      {
        namespace: "DASH",
        name: "NOTES",
        table_type: "view",
        column_name: "BODY",
        data_type: null,
        is_nullable: "YES",
      },
      {
        namespace: "DASH",
        name: "CODES",
        column_name: "N",
        data_type: 12,
        is_nullable: "N",
      },
    ];
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const schema = await adapter.introspectSchema();
      expect(schema.kind).toBe("db2");
      expect(schema.resources).toEqual([
        {
          name: "ORDERS",
          namespace: "DASH",
          kind: "table",
          columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "STATUS", type: "VARCHAR", nullable: true },
          ],
        },
        {
          name: "PAID_ORDERS",
          namespace: "DASH",
          kind: "view",
          columns: [{ name: "ID", type: "INTEGER", nullable: true }],
        },
        {
          name: "NOTES",
          namespace: "DASH",
          kind: "view",
          columns: [{ name: "BODY", type: "", nullable: true }],
        },
        {
          name: "CODES",
          namespace: "DASH",
          kind: "table",
          columns: [{ name: "N", type: "12", nullable: false }],
        },
      ]);
      expect(state.prepared[0]).toContain("SYSCAT.COLUMNS");
    } finally {
      await adapter.close();
    }
  });

  it("rejects a catalog that is too large", async () => {
    state.rows = Array.from({ length: 10_001 }, () => ({ name: "ORDERS" }));
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await expect(adapter.introspectSchema()).rejects.toThrow(/10000 columns/);
    } finally {
      await adapter.close();
    }
  });

  it("redacts the password when the driver reports a failure", async () => {
    state.failOpen = "connect failed PWD=super-secret;HOSTNAME=db.example";
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("PWD=[redacted]");
      expect(result.message).not.toContain("super-secret");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await adapter.close();
    }
  });

  it("redacts a password inside an execute error and still returns the connection", async () => {
    state.failExecute = true;
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await expect(adapter.query({ resource: "ORDERS" })).rejects.toThrow(Error);
      await expect(adapter.query({ resource: "ORDERS" })).rejects.not.toThrow(/super-secret/);
      expect(state.returned).toBeGreaterThan(0);
    } finally {
      await adapter.close();
    }
  });

  it("returns the connection when prepare fails and ignores a close error", async () => {
    state.failPrepare = true;
    state.closeConnectionError = true;
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toBe("prepare failed");
      expect(state.returned).toBe(1);
    } finally {
      await adapter.close();
    }
  });

  it("rejects a value that cannot be bound before it opens a connection", async () => {
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await expect(
        adapter.query({
          resource: "ORDERS",
          filters: [{ column: "STATUS", op: "eq", value: { bad: true } }],
        }),
      ).rejects.toThrow(QueryValidationError);
      expect(state.opened).toEqual([]);
    } finally {
      await adapter.close();
    }
  });

  it("binds a date and a big integer", async () => {
    state.rows = [];
    state.metadata = [{ SQL_DESC_NAME: "ID", SQL_DESC_TYPE_NAME: "BIGINT" }];
    const stamp = new Date("2026-01-02T00:00:00.000Z");
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await adapter.query({
        resource: "ORDERS",
        filters: [
          { column: "CREATED", op: "eq", value: stamp },
          { column: "ID", op: "eq", value: 10n },
          { column: "OPEN", op: "eq", value: true },
          { column: "NOTE", op: "eq", value: null },
        ],
      });
      expect(state.executed[0]?.slice(0, 4)).toEqual([stamp, 10n, true, null]);
    } finally {
      await adapter.close();
    }
  });

  it("fails a query that does not return rows", async () => {
    state.rows = "not-rows";
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await expect(adapter.query({ resource: "ORDERS" })).rejects.toThrow("Db2 query failed");
    } finally {
      await adapter.close();
    }
  });

  it("fails when a row is an array", async () => {
    state.rows = [["ID"]];
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await expect(adapter.query({ resource: "ORDERS" })).rejects.toThrow("Db2 query failed");
    } finally {
      await adapter.close();
    }
  });

  it("fails when execute returns no result", async () => {
    state.rawResult = null;
    const adapter = Db2Adapter.fromConfig(config);
    try {
      await expect(adapter.query({ resource: "ORDERS" })).rejects.toThrow("Db2 query failed");
    } finally {
      await adapter.close();
    }
  });

  it("reads column names from the row when metadata is absent", async () => {
    state.rawMetadata = [null, { SQL_DESC_NAME: "" }];
    state.rows = [{ ID: 4 }];
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.query({ resource: "ORDERS", columns: ["ID"], limit: 5 });
      expect(result.columns).toEqual([{ name: "ID", type: "unknown", nullable: true }]);
    } finally {
      await adapter.close();
    }
  });

  it("reports a driver object that has an empty message", async () => {
    state.thrown = { message: "" };
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Connection failed");
    } finally {
      await adapter.close();
    }
  });

  it("redacts a password that is the whole driver message", async () => {
    state.thrown = new Error("super-secret");
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toBe("[redacted]");
      expect(result.message).not.toContain("super-secret");
    } finally {
      await adapter.close();
    }
  });

  it("replaces a blank driver message", async () => {
    state.thrown = new Error("   ");
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.testConnection();
      expect(result.message).toBe("Connection failed");
    } finally {
      await adapter.close();
    }
  });

  it("redacts a PWD clause that does not match the stored password", async () => {
    state.thrown = new Error("login failed PWD={hidden};PWD=plain");
    const adapter = Db2Adapter.fromConfig({ ...config, password: undefined });
    try {
      const result = await adapter.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).not.toContain("hidden");
      expect(result.message).not.toContain("plain");
      expect(result.message).toContain("PWD=[redacted]");
    } finally {
      await adapter.close();
    }
  });

  it("shares one pool across overlapping queries and reads row keys without metadata", async () => {
    state.rawMetadata = null;
    state.rows = [{ ID: 1 }];
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const [first, second] = await Promise.all([
        adapter.query({ resource: "ORDERS", columns: ["ID"], limit: 1 }),
        adapter.query({ resource: "ORDERS", columns: ["ID"], limit: 1 }),
      ]);
      expect(first.columns).toEqual([{ name: "ID", type: "unknown", nullable: true }]);
      expect(second.rows).toEqual([{ ID: 1 }]);
      expect(state.max).toEqual([5]);
    } finally {
      await adapter.close();
    }
  });

  it("reports a thrown string as a connection failure", async () => {
    state.thrown = "nope";
    const adapter = Db2Adapter.fromConfig(config);
    try {
      const result = await adapter.testConnection();
      expect(result.message).toBe("Connection failed");
    } finally {
      await adapter.close();
    }
  });

  it("uses a driver object message and ignores a close that wins the race", async () => {
    state.thrown = { message: "driver object failed" };
    const objectError = Db2Adapter.fromConfig(config);
    try {
      const result = await objectError.testConnection();
      expect(result.message).toBe("driver object failed");
    } finally {
      await objectError.close();
    }

    state.thrown = undefined;
    const adapter = Db2Adapter.fromConfig(config);
    const pending = adapter.testConnection();
    await adapter.close();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Db2 connection is closed");
  });

  it("reports a closed client and a missing driver", async () => {
    const adapter = Db2Adapter.fromConfig(config);
    await adapter.testConnection();
    await adapter.close();
    const closed = await adapter.testConnection();
    expect(closed.ok).toBe(false);
    expect(closed.message).toBe("Db2 connection is closed");

    state.broken = true;
    const missing = Db2Adapter.fromConfig(config);
    const pending = missing.testConnection();
    await missing.close();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Db2 driver is unavailable");
  });

  it("uses row keys when a fake client omits column metadata", async () => {
    const client: SqlClient = {
      async query() {
        return { rows: [{ ID: 1 }, { ID: 2 }, { ID: 3 }] };
      },
      async end() {
        return undefined;
      },
    };
    const adapter = new Db2Adapter(client);
    const result = await adapter.query({ resource: "ORDERS", columns: ["ID"], limit: 2 });
    expect(result.rows).toEqual([{ ID: 1 }, { ID: 2 }]);
    expect(result.columns).toEqual([{ name: "ID", type: "unknown", nullable: true }]);
    expect(result.truncated).toBe(true);
    const empty = new Db2Adapter({
      async query() {
        return { rows: [{ ID: 9 }], fields: [{ name: " ID ", type: "  " }, { name: "   " }] };
      },
      async end() {
        return undefined;
      },
    });
    const none = await empty.query({ resource: "ORDERS", limit: 5 });
    expect(none.columns).toEqual([{ name: "ID", type: "unknown", nullable: true }]);
    expect(none.truncated).toBe(false);
    const blank = new Db2Adapter({
      async query() {
        return { rows: [] };
      },
      async end() {
        return undefined;
      },
    });
    expect((await blank.query({ resource: "ORDERS", limit: 1 })).columns).toEqual([]);
  });

  it("rejects an invalid host before it loads a pool", () => {
    expect(() =>
      Db2Adapter.fromConfig({
        kind: "db2",
        host: "bad host",
        database: "DASH",
        user: "db2inst1",
        password: "super-secret",
      }),
    ).toThrow(QueryValidationError);
    expect(state.max).toEqual([]);
  });

  it("reports a non-Error failure as a connection failure", async () => {
    const adapter = new Db2Adapter({
      async query() {
        throw "nope";
      },
      async end() {
        return undefined;
      },
    });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Connection failed");
  });
});
