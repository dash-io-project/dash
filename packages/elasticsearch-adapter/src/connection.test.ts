import { describe, expect, it } from "vitest";
import {
  elasticsearchPublicSummary,
  elasticsearchSession,
  nodeFromCloudId,
  normalizeApiKey,
  scrub,
} from "./index.ts";

const CLOUD_DOMAIN = "us-east-1.aws.found.io";
const CLOUD_ES = "4de77e4f-fb54-48b2-b36b-cd8ccd5b6cfe";

function cloudId(): string {
  const decoded = `${CLOUD_DOMAIN}$${CLOUD_ES}$kibana`;
  return `dash:${Buffer.from(decoded, "utf8").toString("base64")}`;
}

describe("elasticsearchSession", () => {
  it("reads an https URL and keeps the password out of the origin", () => {
    const session = elasticsearchSession({
      kind: "elasticsearch",
      connectionString: "https://reader:s3cret@search.example:9200",
    });
    expect(session.origin).toBe("https://search.example:9200");
    expect(session.tls).toBe(true);
    expect(session.auth).toBe("basic");
    expect(session.user).toBe("reader");
    expect(session.authorization.startsWith("Basic ")).toBe(true);
    expect(session.origin).not.toContain("s3cret");
  });

  it("accepts http only for a loopback host", () => {
    const session = elasticsearchSession({
      kind: "elasticsearch",
      connectionString: "http://dash:dash_test@127.0.0.1:9209",
    });
    expect(session.origin).toBe("http://127.0.0.1:9209");
    expect(session.tls).toBe(false);

    expect(() =>
      elasticsearchSession({
        kind: "elasticsearch",
        connectionString: "http://dash:dash_test@search.example:9200",
      }),
    ).toThrow(/TLS/);
  });

  it("treats elasticsearch:// as https and rejects query parameters", () => {
    const session = elasticsearchSession({
      kind: "elasticsearch",
      connectionString: "elasticsearch://reader:s3cret@search.example:9200",
    });
    expect(session.origin).toBe("https://search.example:9200");
    expect(() =>
      elasticsearchSession({
        kind: "elasticsearch",
        connectionString: "https://reader:s3cret@search.example:9200?tlsInsecure=true",
      }),
    ).toThrow(/unsupported elasticsearch connection parameter/i);
  });

  it("rejects TLS settings that disagree with the URL", () => {
    expect(() =>
      elasticsearchSession({
        kind: "elasticsearch",
        connectionString: "http://dash:dash_test@127.0.0.1:9209",
        tls: true,
      }),
    ).toThrow(/disagree/);
    expect(() =>
      elasticsearchSession({
        kind: "elasticsearch",
        connectionString: "https://reader:s3cret@search.example:9200",
        tls: false,
      }),
    ).toThrow(/disagree/);
  });

  it("builds a loopback node from host fields and requires TLS elsewhere", () => {
    const local = elasticsearchSession({
      kind: "elasticsearch",
      host: "127.0.0.1",
      port: 9209,
      user: "dash",
      password: "dash_test",
    });
    expect(local.origin).toBe("http://127.0.0.1:9209");
    expect(local.tls).toBe(false);

    const remote = elasticsearchSession({
      kind: "elasticsearch",
      host: "search.example",
      user: "reader",
      password: "s3cret",
      tls: true,
    });
    expect(remote.origin).toBe("https://search.example:9200");

    expect(() =>
      elasticsearchSession({
        kind: "elasticsearch",
        host: "search.example",
        user: "reader",
        password: "s3cret",
        tls: false,
      }),
    ).toThrow(/TLS/);
  });

  it("decodes a cloud id into the deployment host", () => {
    expect(nodeFromCloudId(cloudId())).toBe(`https://${CLOUD_ES}.${CLOUD_DOMAIN}`);
    const session = elasticsearchSession({
      kind: "elasticsearch",
      cloudId: cloudId(),
      apiKey: "idvalue:secretvalue",
    });
    expect(session.origin).toBe(`https://${CLOUD_ES}.${CLOUD_DOMAIN}`);
    expect(session.tls).toBe(true);
    expect(session.auth).toBe("api-key");
    expect(session.authorization).toBe(`ApiKey ${Buffer.from("idvalue:secretvalue").toString("base64")}`);
    expect(() =>
      nodeFromCloudId(`dash:${Buffer.from("example.com$not a host$kibana").toString("base64")}`),
    ).toThrow(/cloud id/);
  });

  it("refuses to combine an API key with basic authentication", () => {
    expect(() =>
      elasticsearchSession({
        kind: "elasticsearch",
        host: "127.0.0.1",
        user: "dash",
        password: "dash_test",
        apiKey: "abcdefghijklmnop",
      }),
    ).toThrow(/cannot both be set/);
  });

  it("encodes an id:secret API key and accepts an encoded token", () => {
    expect(normalizeApiKey("idvalue:secretvalue")).toBe(
      Buffer.from("idvalue:secretvalue").toString("base64"),
    );
    expect(normalizeApiKey("YWJjZGVmZ2hpamtsbW5vcA==")).toBe("YWJjZGVmZ2hpamtsbW5vcA==");
    expect(() => normalizeApiKey("short")).toThrow(/API key/);
  });
});

describe("elasticsearchPublicSummary", () => {
  it("omits the password and the API key", () => {
    expect(
      elasticsearchPublicSummary({
        kind: "elasticsearch",
        host: "search.example",
        port: 9200,
        user: "reader",
        password: "super-secret",
        tls: true,
      }),
    ).toEqual({
      host: "search.example",
      port: 9200,
      user: "reader",
      tls: true,
      auth: "basic",
    });

    const fromKey = elasticsearchPublicSummary({
      kind: "elasticsearch",
      connectionString: "https://search.example:9200",
      apiKey: "idvalue:secretvalue",
    });
    expect(fromKey).toEqual({
      host: "search.example",
      port: 9200,
      user: "",
      tls: true,
      auth: "api-key",
    });
    expect(JSON.stringify(fromKey)).not.toContain("secretvalue");

    const malformed = elasticsearchPublicSummary({
      kind: "elasticsearch",
      connectionString: "http://reader:super-secret@search.example:9200",
    });
    expect(malformed.host).toBe("");
    expect(JSON.stringify(malformed)).not.toContain("super-secret");
  });
});

describe("scrub", () => {
  it("removes the password and its encoded form", () => {
    expect(scrub("connect failed for https://dash:s3cret@127.0.0.1/ using s3cret", ["s3cret"])).toBe(
      "connect failed for https://dash:[redacted]@127.0.0.1/ using [redacted]",
    );
  });
});
