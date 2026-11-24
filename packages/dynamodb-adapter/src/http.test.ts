import { describe, expect, it, vi } from "vitest";
import { dynamoSession } from "./connection.ts";
import { dynamoCall, signAuthorization, signingKey } from "./http.ts";

describe("signingKey", () => {
  it("matches the AWS documented HMAC chain", () => {
    const key = signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam");
    expect(key.toString("hex")).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
  });
});

describe("signAuthorization", () => {
  it("matches the AWS SigV4 post-vanilla vector", () => {
    const authorization = signAuthorization({
      region: "us-east-1",
      service: "service",
      body: "",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      amzDate: "20150830T123600Z",
      headers: [
        ["host", "example.amazonaws.com"],
        ["x-amz-date", "20150830T123600Z"],
      ],
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
    );
  });

  it("changes the signature when the session token changes", () => {
    const shared = {
      region: "us-east-1",
      service: "dynamodb",
      body: "{}",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      amzDate: "20150830T123600Z",
    };
    const first = signAuthorization({
      ...shared,
      headers: [
        ["host", "example.amazonaws.com"],
        ["x-amz-security-token", "token-a"],
      ],
    });
    const second = signAuthorization({
      ...shared,
      headers: [
        ["host", "example.amazonaws.com"],
        ["x-amz-security-token", "token-b"],
      ],
    });
    expect(first).not.toBe(second);
    expect(first).toContain("x-amz-security-token");
  });
});

describe("dynamoCall", () => {
  const session = dynamoSession({
    kind: "dynamodb",
    region: "us-east-1",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    endpoint: "http://127.0.0.1:8009",
  });

  it("posts a signed JSON request and does not follow a redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { Location: "http://evil.example" } }),
    );
    await expect(
      dynamoCall(session, "ListTables", { Limit: 1 }, AbortSignal.timeout(1000), undefined, fetchImpl),
    ).rejects.toThrow(/refused a redirect/i);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers?.["X-Amz-Target"]).toBe("DynamoDB_20120810.ListTables");
    expect(String(init?.body)).toBe('{"Limit":1}');
    expect(headers?.Authorization).not.toContain("wJalrXUtnFEMI");
  });

  it("reads a DynamoDB error message", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            __type: "com.amazonaws.dynamodb.v20120810#ResourceNotFoundException",
            message: "Requested resource not found",
          }),
          { status: 400 },
        ),
    );
    await expect(dynamoCall(session, "DescribeTable", { TableName: "orders" }, new AbortController().signal, undefined, fetchImpl)).rejects.toThrow(
      /Requested resource not found/,
    );
  });
});
