import { describe, expect, it } from "vitest";
import { ElasticsearchAdapter } from "./adapter.ts";
import { elasticsearchSession } from "./connection.ts";

function adapterFor(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { adapter: ElasticsearchAdapter; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    urls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return {
    adapter: new ElasticsearchAdapter(
      elasticsearchSession({
        kind: "elasticsearch",
        host: "127.0.0.1",
        port: 9209,
        user: "dash",
        password: "dash_test",
        tls: false,
      }),
      fetchImpl,
    ),
    urls,
  };
}

describe("ElasticsearchAdapter query", () => {
  const hits = [1, 2, 3].map((id) => ({
    _id: String(id),
    _source: { month: `2026-0${id}` },
  }));

  function search(bodyText: string | undefined): Response {
    const request = bodyText ? (JSON.parse(bodyText) as { from?: number; size?: number }) : {};
    const from = request.from ?? 0;
    const size = request.size ?? hits.length;
    return new Response(JSON.stringify({ hits: { hits: hits.slice(from, from + size) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("does not mark an exact page truncated", async () => {
    let size = 0;
    const { adapter } = adapterFor((_url, init) => {
      const request = JSON.parse(String(init?.body)) as { size: number };
      size = request.size;
      return search(String(init?.body));
    });
    const result = await adapter.query({ resource: "revenue", columns: ["month"], limit: 3 });
    expect(size).toBe(4);
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.rows.map((row) => row.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(result.columns.find((column) => column.name === "month")?.type).toBe("string");
  });

  it("keeps an integer past 2^53 and reports its type", async () => {
    const { adapter } = adapterFor(
      async () =>
        new Response(
          '{"hits":{"hits":[{"_id":"1","_source":{"total":9007199254740993,"flag":true}}]}}',
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await adapter.query({ resource: "orders", columns: ["total", "flag"], limit: 5 });
    expect(result.rows).toEqual([{ total: "9007199254740993", flag: true }]);
    expect(result.columns).toEqual([
      { name: "total", type: "integer", nullable: true },
      { name: "flag", type: "boolean", nullable: true },
    ]);
  });

  it("drops the extra hit when another row exists", async () => {
    const { adapter } = adapterFor((_url, init) => search(String(init?.body)));
    const page = await adapter.query({
      resource: "revenue",
      columns: ["month"],
      limit: 1,
      offset: 1,
    });
    expect(page.rows).toEqual([{ month: "2026-02" }]);
    expect(page.truncated).toBe(true);
  });

  it("keeps an untrusted source key off the object prototype", async () => {
    const { adapter } = adapterFor(
      async () =>
        new Response(
          '{"hits":{"hits":[{"_id":"1","_source":{"__proto__":{"polluted":true},"id":1}}]}}',
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await adapter.query({ resource: "orders", limit: 5 });
    expect(Object.hasOwn(result.rows[0] ?? {}, "__proto__")).toBe(true);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});

describe("ElasticsearchAdapter introspectSchema", () => {
  it("loads mappings for the listed names, including a hidden alias target", async () => {
    const indices = ["orders", "revenue"].map((index) => ({ index }));
    const aliases = [{ alias: "paid_orders", index: "paid_orders_data" }];
    const properties = {
      id: { type: "integer" },
      status: { type: "keyword" },
    };
    const mappings: Record<string, unknown> = {
      orders: { mappings: { properties } },
      revenue: { mappings: { properties: { month: { type: "keyword" } } } },
      paid_orders_data: { mappings: { properties } },
    };
    const { adapter, urls } = adapterFor((url) => {
      if (url.includes("/_cat/indices")) {
        return new Response(JSON.stringify(indices), { status: 200 });
      }
      if (url.includes("/_cat/aliases")) {
        return new Response(JSON.stringify(aliases), { status: 200 });
      }
      const names = new URL(url).pathname.replace(/^\/|\/_mapping$/g, "").split(",");
      const body: Record<string, unknown> = {};
      for (const name of names) {
        const entry = mappings[name];
        if (entry) {
          body[name] = entry;
        }
      }
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const schema = await adapter.introspectSchema();
    expect(schema.resources.map((resource) => [resource.name, resource.kind])).toEqual([
      ["orders", "collection"],
      ["paid_orders", "view"],
      ["revenue", "collection"],
    ]);
    const view = schema.resources.find((resource) => resource.name === "paid_orders");
    expect(view?.columns.map((column) => column.name)).toEqual(["_id", "id", "status"]);
    expect(urls.some((url) => url.includes("expand_wildcards=open,hidden") && url.includes("/_mapping"))).toBe(
      false,
    );
    expect(urls.some((url) => url.includes("paid_orders_data"))).toBe(true);
  });

  it("does not download mappings past the resource cap", async () => {
    const indices = Array.from({ length: 250 }, (_, index) => ({
      index: `idx_${String(index).padStart(4, "0")}`,
    }));
    const { adapter, urls } = adapterFor((url) => {
      if (url.includes("/_cat/indices")) {
        return new Response(JSON.stringify(indices), { status: 200 });
      }
      if (url.includes("/_cat/aliases")) {
        return new Response("[]", { status: 200 });
      }
      const names = new URL(url).pathname.replace(/^\/|\/_mapping$/g, "").split(",");
      const body: Record<string, unknown> = {};
      for (const name of names) {
        body[name] = { mappings: { properties: { id: { type: "integer" } } } };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const schema = await adapter.introspectSchema();
    expect(schema.resources).toHaveLength(200);
    expect(schema.resources[0]?.name).toBe("idx_0000");
    expect(schema.resources.at(-1)?.name).toBe("idx_0199");
    const requested = urls
      .filter((url) => url.includes("/_mapping"))
      .flatMap((url) => new URL(url).pathname.replace(/^\/|\/_mapping$/g, "").split(","));
    expect(requested).toHaveLength(200);
    expect(requested).not.toContain("idx_0200");
    expect(urls.some((url) => url.includes("/_mapping?"))).toBe(false);
  });
});
