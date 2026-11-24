import { describe, expect, it } from "vitest";
import { couchbaseErrorMessage, couchbasePublicSummary, couchbaseTarget, scrubSecrets } from "./connection.ts";

const fields = {
  kind: "couchbase" as const,
  host: "cb.example.com",
  port: 11210,
  user: "dash",
  password: "super-secret",
  bucket: "analytics",
  scope: "app",
};

describe("couchbaseTarget", () => {
  it("builds a connection string that omits the password", () => {
    const target = couchbaseTarget(fields);
    expect(target.connectionString).toBe("couchbase://cb.example.com:11210");
    expect(target.connectionString).not.toContain("super-secret");
    expect(target).toMatchObject({
      host: "cb.example.com",
      port: 11210,
      user: "dash",
      bucket: "analytics",
      scope: "app",
      tls: false,
    });
  });

  it("reads a couchbase URI and keeps only scope and network", () => {
    const target = couchbaseTarget({
      kind: "couchbase",
      connectionString:
        "couchbase://dash:super-secret@127.0.0.1:11299/analytics?scope=app&network=external",
    });
    expect(target.connectionString).toBe("couchbase://127.0.0.1:11299?network=external");
    expect(target.connectionString).not.toContain("super-secret");
    expect(target).toMatchObject({
      user: "dash",
      password: "super-secret",
      bucket: "analytics",
      scope: "app",
      network: "external",
      tls: false,
    });
  });

  it("uses TLS and port 11207 for couchbases when the port is omitted", () => {
    const target = couchbaseTarget({
      kind: "couchbase",
      connectionString: "couchbases://reader:super-secret@cb.cloud.couchbase.com/analytics",
    });
    expect(target.tls).toBe(true);
    expect(target.port).toBe(11207);
    expect(target.connectionString).toBe("couchbases://cb.cloud.couchbase.com:11207");
    expect(target.scope).toBe("_default");
  });

  it.each([
    ["wrong scheme", { connectionString: "postgres://dash:super-secret@127.0.0.1/analytics" }, /couchbase:\/\//],
    ["driver option", { connectionString: "couchbase://dash:super-secret@127.0.0.1/analytics?tls_verify=none" }, /unsupported couchbase connection parameter/i],
    ["bad network", { connectionString: "couchbase://dash:super-secret@127.0.0.1/analytics?network=other" }, /network/i],
    ["hash", { connectionString: "couchbase://dash:super-secret@127.0.0.1/analytics#frag" }, /invalid couchbase connection string/i],
    ["bad host", { ...fields, host: "not a host", connectionString: undefined }, /host/i],
    ["bad port", { ...fields, port: 0 }, /port/i],
    ["missing bucket", { ...fields, bucket: undefined }, /bucket/i],
    ["missing user", { ...fields, user: undefined }, /user/i],
    ["missing password", { ...fields, password: undefined }, /password/i],
    ["tls disagree", { connectionString: "couchbase://dash:super-secret@127.0.0.1/analytics", tls: true }, /tls/i],
    ["plaintext disagree", { connectionString: "couchbases://dash:super-secret@cb.example.com/analytics", tls: false }, /tls/i],
    ["bucket disagree", { ...fields, connectionString: "couchbase://dash:super-secret@127.0.0.1/other" }, /bucket/i],
    ["user disagree", { ...fields, connectionString: "couchbase://other:super-secret@127.0.0.1/analytics" }, /user/i],
    ["password disagree", { ...fields, connectionString: "couchbase://dash:other-secret@127.0.0.1/analytics" }, /password/i],
  ])("rejects %s", (_name, config, pattern) => {
    expect(() => couchbaseTarget({ kind: "couchbase", ...config })).toThrow(pattern);
    try {
      couchbaseTarget({ kind: "couchbase", ...config });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("super-secret");
      expect(message).not.toContain("other-secret");
      expect(message).not.toMatch(/tls_verify/i);
    }
  });
});

describe("couchbasePublicSummary", () => {
  it("omits the password", () => {
    expect(couchbasePublicSummary(fields)).toEqual({
      host: "cb.example.com",
      port: 11210,
      bucket: "analytics",
      scope: "app",
      user: "dash",
      tls: false,
    });
    expect(JSON.stringify(couchbasePublicSummary(fields))).not.toContain("super-secret");
  });

  it("returns an empty summary for a rejected URI", () => {
    const summary = couchbasePublicSummary({
      kind: "couchbase",
      connectionString: "couchbase://dash:super-secret@127.0.0.1/analytics?tls_verify=none",
    });
    expect(summary).toEqual({ host: "", port: 0, bucket: "", scope: "", user: "", tls: false });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });
});

describe("couchbaseErrorMessage", () => {
  it("adds the server message and ignores a non-error", () => {
    const error = new Error("parsing failure");
    error.cause = { first_error_message: "syntax error near IN" };
    expect(couchbaseErrorMessage(error)).toBe("parsing failure: syntax error near IN");
    expect(couchbaseErrorMessage("nope")).toBe("Couchbase request failed");
  });
});

describe("scrubSecrets", () => {
  it("removes the password and its encoded form", () => {
    const text = scrubSecrets("failed for a/b and a%2Fb", ["a/b"]);
    expect(text).toBe("failed for [redacted] and [redacted]");
    expect(text).not.toContain("a/b");
  });
});
