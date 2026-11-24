import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OpenSearchAdapter } from "./adapter.ts";
import {
  openSearchPublicSummary,
  openSearchSession,
  parseOpenSearchNode,
  scrubSecrets,
} from "./connection.ts";

interface Hit {
  method: string;
  url: string;
  authorization: string;
}

interface Stub {
  url: string;
  hits: Hit[];
  close: () => Promise<void>;
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = closers.splice(0);
  await Promise.all(pending.map((close) => close()));
});

function listen(
  respond: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Stub> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    hits.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: String(req.headers.authorization ?? ""),
    });
    respond(req, res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const close = () =>
        new Promise<void>((done, fail) => {
          server.close((error) => (error ? fail(error) : done()));
        });
      closers.push(close);
      resolve({ url: `http://127.0.0.1:${address.port}`, hits, close });
    });
    server.on("error", reject);
  });
}

function ok(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200);
  res.end();
}

describe("openSearchSession", () => {
  it("reads basic auth from a connection string and keeps it out of the node", () => {
    const session = openSearchSession({
      kind: "opensearch",
      connectionString: "https://dash:p%40ss@search-domain.us-east-1.es.amazonaws.com/",
    });
    expect(session).toEqual({
      node: "https://search-domain.us-east-1.es.amazonaws.com",
      auth: "basic",
      username: "dash",
      password: "p@ss",
    });
    expect(session.node).not.toContain("p%40ss");
  });

  it("treats opensearch:// as https and reads SigV4 settings from the query", () => {
    const session = openSearchSession({
      kind: "opensearch",
      connectionString: "opensearch://search-domain.us-east-1.es.amazonaws.com?region=us-east-1&service=aoss",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret-key-value",
      sessionToken: "session-token-value",
    });
    expect(session.node).toBe("https://search-domain.us-east-1.es.amazonaws.com");
    expect(session.auth).toBe("sigv4");
    expect(session.region).toBe("us-east-1");
    expect(session.service).toBe("aoss");
    expect(session.accessKeyId).toBe("AKIDEXAMPLE");
  });

  it("lets a node URL replace the connection string", () => {
    const session = openSearchSession({
      kind: "opensearch",
      node: "http://127.0.0.1:9209",
      connectionString: "https://dash:super-secret@search.example.com",
    });
    expect(session).toEqual({ node: "http://127.0.0.1:9209", auth: "none" });
  });

  it("allows http only on a loopback host, including the whole 127/8 range", () => {
    expect(
      openSearchSession({ kind: "opensearch", node: "http://127.1.2.3:9200" }).auth,
    ).toBe("none");
    expect(
      openSearchSession({ kind: "opensearch", node: "http://[::1]:9200" }).node,
    ).toBe("http://[::1]:9200");
  });

  it("rejects unsafe connection settings and does not echo secrets", () => {
    const secret = "super-secret-password";
    const cases: Array<{ config: Parameters<typeof openSearchSession>[0]; message: RegExp }> = [
      {
        config: { kind: "opensearch", node: `http://search.example.com` },
        message: /loopback/,
      },
      {
        config: { kind: "opensearch", node: "https://search.example.com/dash" },
        message: /invalid/i,
      },
      {
        config: { kind: "opensearch", node: `https://dash:${secret}@search.example.com` },
        message: /own fields/,
      },
      {
        config: { kind: "opensearch", node: "https://search.example.com?region=us-east-1" },
        message: /invalid/i,
      },
      {
        config: {
          kind: "opensearch",
          connectionString: `https://dash:${secret}@search.example.com?debug=1`,
        },
        message: /unsupported opensearch connection parameter/i,
      },
      {
        config: {
          kind: "opensearch",
          connectionString: "https://search.example.com?region=us-east-1&region=eu-west-1",
        },
        message: /unsupported opensearch connection parameter/i,
      },
      {
        config: {
          kind: "opensearch",
          connectionString: "https://search.example.com?service=foo",
        },
        message: /es or aoss/,
      },
      {
        config: { kind: "opensearch", node: "https://search.example.com", username: "dash" },
        message: /user and a password/,
      },
      {
        config: {
          kind: "opensearch",
          node: "https://search.example.com",
          username: "da:sh",
          password: secret,
        },
        message: /user is invalid/,
      },
      {
        config: {
          kind: "opensearch",
          node: "https://search.example.com",
          username: "dash",
          password: "bad\npassword",
        },
        message: /password is invalid/,
      },
      {
        config: {
          kind: "opensearch",
          node: "https://search.example.com",
          username: "dash",
          password: secret,
          region: "us-east-1",
        },
        message: /not both/,
      },
      {
        config: { kind: "opensearch", node: "https://search.example.com", region: "US-EAST-1" },
        message: /region is invalid/,
      },
      {
        config: { kind: "opensearch", node: "https://search.example.com", service: "es" },
        message: /service needs a region/,
      },
      {
        config: {
          kind: "opensearch",
          node: "https://search.example.com",
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: secret,
        },
        message: /need a region/,
      },
      {
        config: {
          kind: "opensearch",
          node: "https://search.example.com",
          region: "us-east-1",
          accessKeyId: "AKIDEXAMPLE",
        },
        message: /access key and a secret key/,
      },
      {
        config: { kind: "opensearch", node: "https://search.example.com" },
        message: /auth is required/,
      },
      {
        config: { kind: "opensearch" },
        message: /required/,
      },
    ];
    for (const entry of cases) {
      expect(() => openSearchSession(entry.config), entry.message.source).toThrow(entry.message);
      try {
        openSearchSession(entry.config);
      } catch (error) {
        expect(error instanceof Error ? error.message : "").not.toContain(secret);
      }
    }
  });

  it("rejects malformed node URLs", () => {
    expect(() => parseOpenSearchNode("", true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode("https://search.example.com ", true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode("not a url", true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode("https://", true)).toThrow(/invalid/i);
    const emptyPassword = parseOpenSearchNode("https://user:@search.example.com", true);
    expect(emptyPassword.username).toBe("user");
    expect(emptyPassword.password).toBeUndefined();
    expect(() =>
      openSearchSession({
        kind: "opensearch",
        connectionString: "https://user:@search.example.com",
      }),
    ).toThrow(/user and a password/);
    expect(() => parseOpenSearchNode("ftp://search.example.com", true)).toThrow(/https/);
    expect(() => parseOpenSearchNode("https://search.example.com/#x", true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode("http://127.0.0.1:0", true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode("https://bad_host.example", true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode(`https://${"a".repeat(254)}`, true)).toThrow(/invalid/i);
    expect(() => parseOpenSearchNode("https://a%zz:pw@search.example.com", true)).toThrow(/invalid/i);
    expect(() => openSearchSession({
      kind: "opensearch",
      connectionString: "https://:super-secret@search.example.com",
    })).toThrow(/user and a password/);
    expect(
      openSearchSession({
        kind: "opensearch",
        node: "http://127.0.0.1:9200",
        region: "   ",
        password: "",
      }).auth,
    ).toBe("none");
    expect(() => openSearchSession({
      kind: "opensearch",
      node: "https://search.example.com",
      region: "us-east-1",
      service: "nope" as "es",
    })).toThrow(/es or aoss/);
    expect(() => openSearchSession({
      kind: "opensearch",
      node: "https://search.example.com",
      region: "us-east-1",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "x".repeat(4097),
    })).toThrow(/secret key is invalid/);
    expect(() => openSearchSession({
      kind: "opensearch",
      node: "http://127.example:9200",
    })).toThrow(/loopback/);
    expect(() => openSearchSession({
      kind: "opensearch",
      node: "http://10.1.2.3:9200",
    })).toThrow(/loopback/);
  });

  it("returns an empty summary when the config is invalid", () => {
    const summary = openSearchPublicSummary({
      kind: "opensearch",
      connectionString: "https://dash:super-secret@evil.example?debug=1",
    });
    expect(summary).toEqual({ node: "", auth: "", region: "", service: "" });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });

  it("summarizes basic auth without a region", () => {
    expect(
      openSearchPublicSummary({
        kind: "opensearch",
        node: "https://search.example.com",
        username: "dash",
        password: "super-secret",
      }),
    ).toEqual({
      node: "search.example.com",
      auth: "basic",
      region: "",
      service: "",
    });
  });

  it("summarizes a valid source without secrets", () => {
    const summary = openSearchPublicSummary({
      kind: "opensearch",
      node: "https://search-domain.us-east-1.es.amazonaws.com",
      region: "us-east-1",
      secretAccessKey: "super-secret",
      accessKeyId: "AKIDEXAMPLE",
    });
    expect(summary).toEqual({
      node: "search-domain.us-east-1.es.amazonaws.com",
      auth: "sigv4",
      region: "us-east-1",
      service: "es",
    });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });
});

describe("scrubSecrets", () => {
  it("replaces the longer secret first and the URI encoding", () => {
    const text = scrubSecrets("secret-key and secret and s%20ecret-key", ["secret", "secret-key", "s ecret-key"]);
    expect(text).toBe("[redacted] and [redacted] and [redacted]");
  });

  it("ignores a secret shorter than 3 characters and limits the message", () => {
    const text = scrubSecrets(`${"a".repeat(600)} xy`, ["xy"]);
    expect(text).toHaveLength(500);
    expect(text).not.toContain("[redacted]");
  });
});

describe("OpenSearch auth headers", () => {
  it("sends basic auth on ping and redacts the password from a failure", async () => {
    const password = "super-secret-password";
    const encoded = Buffer.from(`dash:${password}`).toString("base64");
    const server = await listen((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { reason: `rejected ${password} token ${encoded}` } }));
    });
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      username: "dash",
      password,
    });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(server.hits[0]?.method).toBe("HEAD");
    expect(server.hits[0]?.url).toBe("/");
    expect(server.hits[0]?.authorization).toBe(`Basic ${encoded}`);
    expect(result.message).not.toContain(password);
    expect(result.message).not.toContain(encoded);
    await adapter.close();
    await adapter.close();
  });

  it("redacts a secret that the engine copies into an error", async () => {
    const password = "super-secret-password";
    const server = await listen((req, res) => {
      if (req.method === "HEAD") {
        res.writeHead(200);
        res.end();
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { reason: `rejected ${password}` } }));
    });
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      username: "dash",
      password,
    });
    await expect(adapter.introspectSchema()).rejects.toThrow(/\[redacted\]/);
    try {
      await adapter.introspectSchema();
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(password);
    }
    await adapter.close();
  });

  it("reports a 404 ping as a failed connection", async () => {
    const server = await listen((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const adapter = OpenSearchAdapter.fromConfig({ kind: "opensearch", node: server.url });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("OpenSearch ping failed");
    await adapter.close();
  });

  it("does not follow a redirect", async () => {
    const other = await listen(ok);
    const server = await listen((_req, res) => {
      res.writeHead(302, { location: other.url });
      res.end();
    });
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      username: "dash",
      password: "super-secret-password",
    });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("OpenSearch ping failed");
    expect(other.hits).toEqual([]);
    await adapter.close();
  });

  it("rejects a redirect from OpenSearch Serverless", async () => {
    const server = await listen((_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:9/" });
      res.end();
    });
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      region: "us-east-1",
      service: "aoss",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret-key-value",
    });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("OpenSearch ping failed");
    expect(server.hits[0]?.method).toBe("POST");
    await adapter.close();
  });

  it("signs a request that includes a session token", async () => {
    const server = await listen(ok);
    const token = "session-token-value";
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      region: "us-east-1",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret-key-value",
      sessionToken: token,
    });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    expect(server.hits[0]?.authorization).toContain("AWS4-HMAC-SHA256");
    expect(server.hits[0]?.authorization).not.toContain(token);
    await adapter.close();
  });

  it("signs a request with static AWS credentials", async () => {
    const server = await listen(ok);
    const secret = "secret-key-value";
    const adapter = OpenSearchAdapter.fromConfig({
      kind: "opensearch",
      node: server.url,
      region: "us-east-1",
      service: "es",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: secret,
    });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
    const header = server.hits[0]?.authorization ?? "";
    expect(header).toContain("AWS4-HMAC-SHA256");
    expect(header).toContain("AKIDEXAMPLE");
    expect(header).toContain("/us-east-1/es/aws4_request");
    expect(header).not.toContain(secret);
    expect(header.startsWith("Basic ")).toBe(false);
    await adapter.close();
  });

  it("signs with the default credential chain when no session token is set", async () => {
    const server = await listen(ok);
    const previous = {
      accessKey: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      token: process.env.AWS_SESSION_TOKEN,
      disabled: process.env.AWS_EC2_METADATA_DISABLED,
    };
    process.env.AWS_ACCESS_KEY_ID = "AKIADEFAULTKEY";
    process.env.AWS_SECRET_ACCESS_KEY = "default-secret-value";
    delete process.env.AWS_SESSION_TOKEN;
    process.env.AWS_EC2_METADATA_DISABLED = "true";
    try {
      const adapter = OpenSearchAdapter.fromConfig({
        kind: "opensearch",
        node: server.url,
        region: "us-west-2",
      });
      const result = await adapter.testConnection();
      expect(result.ok).toBe(true);
      expect(server.hits[0]?.authorization).toContain("/us-west-2/es/aws4_request");
      expect(server.hits[0]?.authorization).not.toContain("default-secret-value");
      await adapter.close();
    } finally {
      restore("AWS_ACCESS_KEY_ID", previous.accessKey);
      restore("AWS_SECRET_ACCESS_KEY", previous.secret);
      restore("AWS_SESSION_TOKEN", previous.token);
      restore("AWS_EC2_METADATA_DISABLED", previous.disabled);
    }
  });

  it("signs an OpenSearch Serverless probe with the default credential chain", async () => {
    const server = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const previous = {
      accessKey: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      token: process.env.AWS_SESSION_TOKEN,
      disabled: process.env.AWS_EC2_METADATA_DISABLED,
    };
    process.env.AWS_ACCESS_KEY_ID = "AKIADEFAULTKEY";
    process.env.AWS_SECRET_ACCESS_KEY = "default-secret-value";
    process.env.AWS_SESSION_TOKEN = "default-session-token";
    process.env.AWS_EC2_METADATA_DISABLED = "true";
    try {
      const adapter = OpenSearchAdapter.fromConfig({
        kind: "opensearch",
        node: server.url,
        region: "eu-west-1",
        service: "aoss",
      });
      const result = await adapter.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toBe("Connected to OpenSearch");
      const hit = server.hits[0];
      expect(hit?.method).toBe("POST");
      expect(hit?.url).toBe("/_search");
      expect(hit?.authorization).toContain("AKIADEFAULTKEY");
      expect(hit?.authorization).toContain("/eu-west-1/aoss/aws4_request");
      expect(hit?.authorization).not.toContain("default-secret-value");
      expect(hit?.authorization).not.toContain("default-session-token");
      await adapter.close();
    } finally {
      restore("AWS_ACCESS_KEY_ID", previous.accessKey);
      restore("AWS_SECRET_ACCESS_KEY", previous.secret);
      restore("AWS_SESSION_TOKEN", previous.token);
      restore("AWS_EC2_METADATA_DISABLED", previous.disabled);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
