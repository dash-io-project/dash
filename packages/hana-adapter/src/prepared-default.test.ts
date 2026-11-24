import { beforeEach, expect, it, vi } from "vitest";
import { HanaAdapter } from "./adapter.ts";

const state = vi.hoisted(() => ({
  calls: 0,
  prepared: [] as string[],
  dropped: 0,
  released: 0,
}));

vi.mock("@sap/hana-client", () => ({
  default: {
    createPool() {
      state.calls += 1;
      return {
        getConnection(callback: (error: Error | null, connection?: unknown) => void) {
          callback(null, {
            prepare(sql: string, done: (error: Error | null, statement?: unknown) => void) {
              state.prepared.push(sql);
              done(null, {
                exec(_params: unknown[], doneExec: (error: Error | null, rows?: unknown) => void) {
                  doneExec(null, []);
                },
                drop(doneDrop?: (error?: Error | null) => void) {
                  state.dropped += 1;
                  doneDrop?.(null);
                },
                getColumnInfo() {
                  return [];
                },
                setTimeout() {
                  return undefined;
                },
              });
            },
            disconnect(doneDisconnect?: (error?: Error | null) => void) {
              state.released += 1;
              doneDisconnect?.(null);
            },
          });
        },
        clear(done?: (error?: Error | null) => void) {
          done?.(null);
        },
      };
    },
  },
}));

beforeEach(() => {
  state.calls = 0;
  state.prepared.length = 0;
  state.dropped = 0;
  state.released = 0;
});

it("prepares a statement when the driver is a default export", async () => {
  const adapter = HanaAdapter.fromConfig({
    kind: "hana",
    host: "localhost",
    user: "SYSTEM",
  });
  await adapter.query({ resource: "orders", limit: 1 });
  expect(state.calls).toBe(1);
  expect(state.prepared).toEqual(['SELECT * FROM "orders" LIMIT ? OFFSET ?']);
  expect(state.dropped).toBe(1);
  expect(state.released).toBe(1);
});
