import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterFilter, OpenSearchConnectionConfig } from "@dash/core";
import { QueryValidationError } from "@dash/core";
import { OpenSearchAdapter, createOpenSearchAdapter, fieldsFromMapping, toPlain } from "./adapter.ts";

const NOT_READY = "OpenSearch test cluster is not ready. Start it with `pnpm test:services:start`.";
const ORDERS = "dash_orders";
const OTHER = "dash_other";

function properties(): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    status: { type: "keyword" },
    label: { type: "text", fields: { keyword: { type: "keyword" } } },
    meta: { type: "object", properties: { inner: { type: "keyword" } } },
    tree: { type: "nested" },
    "": { type: "keyword" },
    "bad name": { type: "keyword" },
    note: { type: "" },
    flag: "keyword",
  };
  Object.defineProperty(fields, "__proto__", {
    value: { type: "keyword" },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(fields, "constructor", {
    value: { type: "keyword" },
    enumerable: true,
    configurable: true,
  });
  return fields;
}

describe("value and mapping conversion", () => {
  it("turns client values into JSON values and drops banned keys", () => {
    expect(toPlain(null)).toBeNull();
    expect(toPlain(undefined)).toBeNull();
    expect(toPlain("paid")).toBe("paid");
    expect(toPlain(true)).toBe(true);
    expect(toPlain(10)).toBe(10);
    expect(toPlain(Number.NaN)).toBeNull();
    expect(toPlain(12n)).toBe(12);
    expect(toPlain(9007199254740993n)).toBe("9007199254740993");
    expect(toPlain([1, { status: "paid" }])).toEqual([1, { status: "paid" }]);
    const record = toPlain({ status: "paid", constructor: "nope", nested: { flag: false } });
    expect(record).toEqual({ status: "paid", nested: { flag: false } });
    expect(toPlain(Symbol("x"))).toBeNull();
  });

  it("reads scalar properties and skips objects, nested fields, and unsafe names", () => {
    const fields = fieldsFromMapping({
      dash_orders: {
        mappings: {
          properties: properties(),
        },
      },
      ignored: { mappings: {} },
    });
    expect(fields.get("status")).toEqual({ type: "keyword", keyword: false });
    expect(fields.get("label")).toEqual({ type: "text", keyword: true });
    expect(fields.has("meta")).toBe(false);
    expect(fields.has("tree")).toBe(false);
    expect(fields.has("note")).toBe(false);
    expect([...fields.keys()]).toEqual(["status", "label"]);
    expect(fieldsFromMapping(null).size).toBe(0);
    expect(fieldsFromMapping({ dash_orders: null }).size).toBe(0);
    expect(fieldsFromMapping(["nope"]).size).toBe(0);
  });
});

describe("OpenSearchAdapter request parsing", () => {
  it("reports a non-error failure as a failed connection", async () => {
    const adapter = new OpenSearchAdapter(
      { ping: () => Promise.reject("down"), close: async () => undefined } as never,
      { node: "http://127.0.0.1:9", auth: "none" },
      [],
    );
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("OpenSearch request failed");
    await adapter.close();
  });

  it("replaces an empty client message", async () => {
    const adapter = new OpenSearchAdapter(
      { ping: () => Promise.reject(new Error("")), close: async () => undefined } as never,
      { node: "http://127.0.0.1:9", auth: "none" },
      [],
    );
    const result = await adapter.testConnection();
    expect(result.message).toBe("OpenSearch request failed");
    await adapter.close();
  });
  it("treats a mapping 404 as an empty schema", async () => {
    const server = await stub((req, res) => {
      if ((req.url ?? "").includes("_mapping")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { reason: "no such index [super-secret]" } }));
        return;
      }
      res.writeHead(200);
      res.end();
    });
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      username: "dash",
      password: "super-secret",
    });
    const schema = await adapter.introspectSchema();
    expect(schema).toEqual({ kind: "opensearch", resources: [] });
    await adapter.close();
    await server.close();
  });

  it("rejects a search body that has no hits", async () => {
    const server = await stub((req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.includes("_mapping")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ dash_orders: { mappings: { properties: { status: { type: "keyword" } } } } }));
        return;
      }
      if (req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200);
      res.end();
    });
    const adapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: server.url });
    await expect(adapter.query({ resource: ORDERS, limit: 1 })).rejects.toThrow(
      /search response is invalid/,
    );
    await adapter.close();
    await server.close();
  });

  it("rejects a search body that is not an object", async () => {
    const server = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("null");
    });
    const adapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: server.url });
    await expect(adapter.query({ resource: ORDERS, limit: 1 })).rejects.toThrow(
      /search response is invalid/,
    );
    const schema = await adapter.introspectSchema();
    expect(schema.resources).toEqual([]);
    await adapter.close();
    await server.close();
  });

  it("infers column types when the mapping is missing", async () => {
    const server = await stub((req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.includes("_mapping")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "index_not_found_exception" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          hits: {
            hits: [
              {
                _id: 1,
                _source: {
                  _id: "inside",
                  name: null,
                  gone: null,
                  flag: true,
                  tags: ["a"],
                  blob: { inner: 1 },
                },
              },
              { _id: "2", _source: ["x"] },
              { _id: "3", _source: { name: "paid" } },
            ],
          },
        }),
      );
    });
    const adapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: server.url });
    const result = await adapter.query({ resource: ORDERS, limit: 5 });
    expect(result.rows[0]?._id).toBeNull();
    expect(result.columns.map((column) => [column.name, column.type])).toEqual(
      expect.arrayContaining([
        ["_id", "keyword"],
        ["name", "string"],
        ["flag", "boolean"],
        ["tags", "array"],
        ["blob", "object"],
        ["gone", "unknown"],
      ]),
    );
    expect(result.rows[0]).not.toHaveProperty("_id", "inside");
    await adapter.close();
    await server.close();
  });

  it("reports a mapping failure that is not a missing index", async () => {
    const server = await stub((req, res) => {
      if ((req.url ?? "").includes("_mapping")) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "engine blew up" }));
        return;
      }
      res.writeHead(200);
      res.end();
    });
    const adapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: server.url });
    await expect(adapter.query({ resource: ORDERS, limit: 1 })).rejects.toThrow(/engine blew up/);
    await adapter.close();
    await server.close();
  });

  it("uses the client message when the engine omits a reason", async () => {
    const server = await stub((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "   " }));
    });
    const adapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: server.url });
    await expect(adapter.introspectSchema()).rejects.toThrow(/Response Error/);
    await adapter.close();
    await server.close();

    const down = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: "http://127.0.0.1:1" });
    await expect(down.introspectSchema()).rejects.toThrow(/ECONNREFUSED|connect/i);
    await down.close();
  });

  it("reads a plain-text error and an error object without a reason", async () => {
    const plain = await stub((_req, res) => {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("plain failure");
    });
    const plainAdapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: plain.url });
    await expect(plainAdapter.introspectSchema()).rejects.toThrow(/plain failure/);
    await plainAdapter.close();
    await plain.close();

    const bare = await stub((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "illegal_argument_exception" } }));
    });
    const bareAdapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: bare.url });
    await expect(bareAdapter.introspectSchema()).rejects.toThrow(/illegal_argument_exception/);
    await bareAdapter.close();
    await bare.close();
  });
});

function clusterNode(): string {
  const port = Number(process.env.DASH_TEST_OPENSEARCH_PORT ?? 9209);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid DASH_TEST_OPENSEARCH_PORT: ${process.env.DASH_TEST_OPENSEARCH_PORT}`);
  }
  const host = process.env.DASH_TEST_OPENSEARCH_HOST ?? "127.0.0.1";
  return process.env.DASH_TEST_OPENSEARCH_NODE ?? `http://${host}:${port}`;
}

function clusterConfig(overrides: Partial<OpenSearchConnectionConfig> = {}): OpenSearchConnectionConfig {
  return { kind: "opensearch", node: clusterNode(), ...overrides };
}

async function clusterFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${clusterNode()}${path}`, init);
  } catch (error) {
    throw new Error(`${NOT_READY} ${error instanceof Error ? error.message : ""}`);
  }
}

async function requireCluster(adapter: OpenSearchAdapter): Promise<void> {
  const result = await adapter.testConnection();
  if (!result.ok) {
    throw new Error(`${NOT_READY} ${result.message}`);
  }
}

describe("OpenSearchAdapter against the test cluster", () => {
  let adapter: OpenSearchAdapter;

  beforeAll(async () => {
    adapter = createOpenSearchAdapter(clusterConfig());
    await requireCluster(adapter);
    const exists = await clusterFetch(`/${ORDERS}`, { method: "HEAD" });
    if (exists.ok) {
      const removed = await clusterFetch(`/${ORDERS}`, { method: "DELETE" });
      if (!removed.ok && removed.status !== 404) {
        throw new Error(`Failed to reset ${ORDERS}: ${removed.status}`);
      }
    }
    const created = await clusterFetch(`/${ORDERS}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: { index: { number_of_shards: 1, number_of_replicas: 0 } },
        mappings: {
          dynamic: false,
          properties: {
            id: { type: "integer" },
            status: { type: "keyword" },
            note: { type: "keyword" },
            total: { type: "double" },
            flag: { type: "boolean" },
            label: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
            created_at: { type: "date" },
            big: { type: "long" },
            meta: { type: "object", properties: { inner: { type: "keyword" } } },
          },
        },
      }),
    });
    if (!created.ok) {
      throw new Error(`Failed to create ${ORDERS}: ${created.status} ${await created.text()}`);
    }
    const bulk = [
      JSON.stringify({ index: { _index: ORDERS, _id: "1" } }),
      JSON.stringify({
        id: 1,
        status: "paid",
        note: "Alpha",
        total: 10,
        flag: true,
        label: "Hello World",
        created_at: "2024-01-01T00:00:00.000Z",
        constructor: "nope",
        meta: { inner: "hidden" },
      }),
      JSON.stringify({ index: { _index: ORDERS, _id: "2" } }),
      JSON.stringify({
        id: 2,
        status: "open",
        note: "beta",
        total: 5,
        flag: false,
        label: "Other",
        created_at: "2024-02-01T00:00:00.000Z",
      }),
      JSON.stringify({ index: { _index: ORDERS, _id: "3" } }),
      `{"id":3,"status":"paid","total":20,"flag":true,"label":"Hello World","created_at":"2024-03-01T00:00:00.000Z","big":9007199254740993}`,
      "",
    ].join("\n");
    const loaded = await clusterFetch("/_bulk?refresh=true", {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body: bulk,
    });
    if (!loaded.ok) {
      throw new Error(`Failed to load ${ORDERS}: ${loaded.status} ${await loaded.text()}`);
    }
    const payload = (await loaded.json()) as { errors?: boolean };
    if (payload.errors) {
      throw new Error(`OpenSearch rejected a fixture document`);
    }
    const other = await clusterFetch(`/${OTHER}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: { index: { number_of_shards: 1, number_of_replicas: 0 } },
        mappings: { properties: { id: { type: "integer" } } },
      }),
    });
    if (!other.ok && other.status !== 400) {
      throw new Error(`Failed to create ${OTHER}: ${other.status}`);
    }
  });

  afterAll(async () => {
    await clusterFetch(`/${ORDERS}`, { method: "DELETE" }).catch(() => undefined);
    await clusterFetch(`/${OTHER}`, { method: "DELETE" }).catch(() => undefined);
    await adapter?.close();
  });

  it("lists mapped fields and skips object fields and system indices", async () => {
    const schema = await adapter.introspectSchema();
    expect(schema.kind).toBe("opensearch");
    const orders = schema.resources.find((resource) => resource.name === ORDERS);
    expect(orders?.kind).toBe("table");
    expect(orders?.columns).toEqual(
      expect.arrayContaining([
        { name: "status", type: "keyword", nullable: true },
        { name: "label", type: "text", nullable: true },
        { name: "total", type: "double", nullable: true },
        { name: "big", type: "long", nullable: true },
      ]),
    );
    expect(orders?.columns.map((column) => column.name)).not.toContain("meta");
    expect(schema.resources.every((resource) => !resource.name.startsWith("."))).toBe(true);
  });

  it("filters, sorts, and pages fixture rows", async () => {
    const paid = await adapter.query({
      resource: ORDERS,
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "total", op: "gte", value: 10 },
      ],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 10,
    });
    expect(paid.rows.map((row) => row.id)).toEqual([1, 3]);
    expect(paid.truncated).toBe(false);
    expect(paid.rows[0]).not.toHaveProperty("constructor");

    const missingNote = await adapter.query({
      resource: ORDERS,
      columns: ["id", "note"],
      filters: [{ column: "note", op: "eq", value: null }],
    });
    expect(missingNote.rows).toEqual([{ id: 3, note: null }]);
    expect(missingNote.columns.map((column) => column.name)).toEqual(["id", "note"]);
    expect(Object.hasOwn(missingNote.rows[0] ?? {}, "_id")).toBe(false);

    const notAlpha = await adapter.query({
      resource: ORDERS,
      columns: ["id"],
      filters: [{ column: "note", op: "neq", value: "Alpha" }],
      orderBy: [{ column: "id", direction: "asc" }],
    });
    expect(notAlpha.rows.map((row) => row.id)).toEqual([2]);

    const listed = await adapter.query({
      resource: ORDERS,
      columns: ["_id", "note"],
      filters: [{ column: "note", op: "in", value: ["beta", null] }],
      orderBy: [{ column: "_id", direction: "asc" }],
    });
    expect(listed.rows.map((row) => row._id)).toEqual(["2", "3"]);
    expect(listed.columns.find((column) => column.name === "_id")?.type).toBe("keyword");

    const like = await adapter.query({
      resource: ORDERS,
      columns: ["id"],
      filters: [{ column: "note", op: "like", value: "A%" }],
    });
    expect(like.rows.map((row) => row.id)).toEqual([1]);
    const ilike = await adapter.query({
      resource: ORDERS,
      columns: ["id"],
      filters: [{ column: "note", op: "ilike", value: "alpha" }],
    });
    expect(ilike.rows.map((row) => row.id)).toEqual([1]);

    const label = await adapter.query({
      resource: ORDERS,
      columns: ["id"],
      filters: [{ column: "label", op: "eq", value: "Hello World" }],
      orderBy: [{ column: "id", direction: "asc" }],
    });
    expect(label.rows.map((row) => row.id)).toEqual([1, 3]);

    const page = await adapter.query({
      resource: ORDERS,
      columns: ["id"],
      orderBy: [{ column: "total", direction: "desc" }],
      limit: 1,
      offset: 1,
    });
    expect(page.rows).toEqual([{ id: 1 }]);
    expect(page.truncated).toBe(true);

    const big = await adapter.query({
      resource: ORDERS,
      columns: ["big"],
      filters: [{ column: "id", op: "eq", value: 3 }],
    });
    expect(big.rows[0]?.big).toBe("9007199254740993");
  });

  it("rejects a resource that would search more than one index", async () => {
    await expect(adapter.query({ resource: `${ORDERS},${OTHER}` })).rejects.toBeInstanceOf(
      QueryValidationError,
    );
    await expect(adapter.query({ resource: "*" })).rejects.toBeInstanceOf(QueryValidationError);
    const injected: AdapterFilter = { column: "status", op: "eq", value: { gt: 1 } };
    await expect(adapter.query({ resource: ORDERS, filters: [injected] })).rejects.toBeInstanceOf(
      QueryValidationError,
    );
  });

  it("connects with a connection string and closes", async () => {
    const viaString = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      connectionString: clusterNode(),
    });
    const result = await viaString.testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Connected to OpenSearch");
    await viaString.close();
    await viaString.close();
  });
});

function stub(
  respond: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(respond);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}
