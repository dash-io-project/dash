import { describe, expect, it } from "vitest";
import type { ElasticsearchSession } from "./connection.ts";
import { elasticsearchRequest, quoteUnsafeIntegers } from "./http.ts";

function session(secrets: string[] = ["s3cret"]): ElasticsearchSession {
  return {
    origin: "http://127.0.0.1:9209",
    authorization: "Basic dGVzdA==",
    tls: false,
    auth: "basic",
    user: "dash",
    secrets,
  };
}

describe("quoteUnsafeIntegers", () => {
  it("quotes only integers past the safe range", () => {
    const text =
      '{"total":9007199254740993,"safe":9007199254740991,"note":"id 9007199254740993","loss":-9007199254740993}';
    expect(quoteUnsafeIntegers(text)).toBe(
      '{"total":"9007199254740993","safe":9007199254740991,"note":"id 9007199254740993","loss":"-9007199254740993"}',
    );
  });
});

describe("elasticsearchRequest", () => {
  it("sends the authorization header and does not follow a redirect", async () => {
    const seen: { authorization?: string; url?: string } = {};
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      seen.url = String(input);
      seen.authorization = new Headers(init?.headers).get("authorization") ?? undefined;
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example" } });
    }) as typeof fetch;

    await expect(elasticsearchRequest(session(), "/", { method: "GET", fetchImpl })).rejects.toThrow(
      /redirect/,
    );
    expect(seen.url).toBe("http://127.0.0.1:9209/");
    expect(seen.authorization).toBe("Basic dGVzdA==");
  });

  it("scrubs secrets from an error body", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { reason: "failed for s3cret" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await expect(
      elasticsearchRequest(session(), "/", { method: "GET", fetchImpl }),
    ).rejects.toThrow(/\[redacted\]/);
  });

  it("accepts an origin whose port is the scheme default", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      seen.push(String(input));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await expect(
      elasticsearchRequest(
        { ...session(), origin: "https://search.example:443", tls: true },
        "/",
        { method: "GET", fetchImpl },
      ),
    ).resolves.toEqual({});
    expect(seen).toEqual(["https://search.example/"]);
  });

  it("discards a credential failure body", async () => {
    const fetchImpl = (async () => new Response("s3cret", { status: 401 })) as typeof fetch;
    await expect(elasticsearchRequest(session(), "/", { method: "GET", fetchImpl })).rejects.toThrow(
      /credentials/,
    );
  });

  it("allows a named mapping batch and refuses a wildcard", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    await expect(
      elasticsearchRequest(session(), "/orders,revenue/_mapping", { method: "GET", fetchImpl }),
    ).resolves.toEqual({});
    await expect(
      elasticsearchRequest(session(), "/*/_mapping", { method: "GET", fetchImpl }),
    ).rejects.toThrow(/request failed/);
  });

  it("refuses a path that is not a Dash Elasticsearch call", async () => {
    const fetchImpl = (() => {
      throw new Error("fetch should not run");
    }) as typeof fetch;
    await expect(
      elasticsearchRequest(session(), "/orders/_delete_by_query", { method: "POST", fetchImpl }),
    ).rejects.toThrow(/request failed/);
  });
});
