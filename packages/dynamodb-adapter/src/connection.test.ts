import { describe, expect, it } from "vitest";
import {
  dynamoPublicSummary,
  dynamoSession,
  parseDynamoConnectionString,
  scrubSecrets,
} from "./connection.ts";

const KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

describe("parseDynamoConnectionString", () => {
  it("reads a regional cloud connection", () => {
    expect(parseDynamoConnectionString(`dynamodb://${KEY}:${encodeURIComponent(SECRET)}@us-east-1`)).toEqual({
      accessKeyId: KEY,
      secretAccessKey: SECRET,
      region: "us-east-1",
    });
  });

  it("reads a loopback endpoint", () => {
    expect(
      parseDynamoConnectionString(
        `dynamodb://dash:dashsecret@us-east-1?endpoint=${encodeURIComponent("http://127.0.0.1:8009")}`,
      ).endpoint,
    ).toBe("http://127.0.0.1:8009");
  });

  it("rejects another scheme without echoing the secret", () => {
    expect(() => parseDynamoConnectionString(`https://dynamodb.us-east-1.amazonaws.com`)).toThrow(/dynamodb:\/\//);
  });

  it("rejects an unsupported parameter without echoing the secret or the parameter", () => {
    const value = `dynamodb://${KEY}:${encodeURIComponent(SECRET)}@us-east-1?debug=1`;
    expect(() => parseDynamoConnectionString(value)).toThrow(/unsupported dynamodb connection parameter/i);
    try {
      parseDynamoConnectionString(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain(SECRET);
      expect(message).not.toMatch(/debug/i);
    }
  });

  it("rejects a non-loopback endpoint without echoing the host or the secret", () => {
    const value = `dynamodb://${KEY}:${encodeURIComponent(SECRET)}@us-east-1?endpoint=${encodeURIComponent("http://evil.example")}`;
    expect(() => parseDynamoConnectionString(value)).toThrow(/invalid dynamodb endpoint/i);
    try {
      parseDynamoConnectionString(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("evil.example");
      expect(message).not.toContain(SECRET);
    }
  });
});

describe("dynamoSession", () => {
  it("uses the regional HTTPS endpoint", () => {
    const session = dynamoSession({
      kind: "dynamodb",
      region: "eu-west-1",
      accessKeyId: KEY,
      secretAccessKey: SECRET,
    });
    expect(session.origin).toBe("https://dynamodb.eu-west-1.amazonaws.com");
    expect(session.host).toBe("dynamodb.eu-west-1.amazonaws.com");
  });

  it("uses the China partition for a cn region", () => {
    const session = dynamoSession({
      kind: "dynamodb",
      region: "cn-north-1",
      accessKeyId: KEY,
      secretAccessKey: SECRET,
    });
    expect(session.origin).toBe("https://dynamodb.cn-north-1.amazonaws.com.cn");
  });

  it("lets explicit fields override the URI", () => {
    const session = dynamoSession({
      kind: "dynamodb",
      connectionString: `dynamodb://${KEY}:${encodeURIComponent(SECRET)}@us-east-1`,
      region: "eu-west-1",
      accessKeyId: "dash",
      secretAccessKey: "override-secret",
      endpoint: "http://127.0.0.1:8009",
    });
    expect(session.region).toBe("eu-west-1");
    expect(session.accessKeyId).toBe("dash");
    expect(session.secretAccessKey).toBe("override-secret");
    expect(session.origin).toBe("http://127.0.0.1:8009");
    expect(session.host).toBe("127.0.0.1:8009");
  });

  it("rejects an endpoint in another region without echoing it", () => {
    expect(() =>
      dynamoSession({
        kind: "dynamodb",
        region: "us-east-1",
        accessKeyId: KEY,
        secretAccessKey: SECRET,
        endpoint: "https://dynamodb.eu-west-1.amazonaws.com",
      }),
    ).toThrow(/does not match the region/i);
  });

  it("rejects http for the AWS endpoint", () => {
    expect(() =>
      dynamoSession({
        kind: "dynamodb",
        region: "us-east-1",
        accessKeyId: KEY,
        secretAccessKey: SECRET,
        endpoint: "http://dynamodb.us-east-1.amazonaws.com",
      }),
    ).toThrow(/invalid dynamodb endpoint/i);
  });
});

describe("dynamoPublicSummary", () => {
  it("omits the secret access key", () => {
    const summary = dynamoPublicSummary({
      kind: "dynamodb",
      region: "us-east-1",
      accessKeyId: KEY,
      secretAccessKey: SECRET,
      sessionToken: "session-token-value",
    });
    expect(summary).toEqual({
      region: "us-east-1",
      endpoint: "dynamodb.us-east-1.amazonaws.com",
      accessKeyId: KEY,
    });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect(JSON.stringify(summary)).not.toContain("session-token-value");
  });

  it("returns an empty summary for a malformed URI", () => {
    const summary = dynamoPublicSummary({
      kind: "dynamodb",
      connectionString: `dynamodb://${KEY}:${encodeURIComponent(SECRET)}@us-east-1?debug=1`,
    });
    expect(summary).toEqual({ region: "", endpoint: "", accessKeyId: "" });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });
});

describe("scrubSecrets", () => {
  it("replaces long secrets and their encoded form", () => {
    expect(scrubSecrets(`failed ${SECRET} and ${encodeURIComponent(SECRET)}`, [SECRET])).toBe(
      "failed [redacted] and [redacted]",
    );
  });
});
