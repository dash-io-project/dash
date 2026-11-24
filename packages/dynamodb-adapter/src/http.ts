import { createHash, createHmac } from "node:crypto";
import type { DynamoDbSession } from "./connection.ts";

const MAX_RESPONSE = 2_000_000;
const MAX_REQUEST = 1_500_000;
const REQUEST_TIMEOUT_MS = 10_000;
const TARGET = /^[A-Za-z]+$/;

export class DynamoDbError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = "DynamoDbError";
    this.status = status;
    this.type = type;
  }
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(date, "utf8").digest();
  const regionKey = createHmac("sha256", dateKey).update(region, "utf8").digest();
  const serviceKey = createHmac("sha256", regionKey).update(service, "utf8").digest();
  return createHmac("sha256", serviceKey).update("aws4_request", "utf8").digest();
}

const signingKeyCache = new WeakMap<DynamoDbSession, { date: string; key: Buffer }>();

function sessionSigningKey(session: DynamoDbSession, amz: string): Buffer {
  const date = amz.slice(0, 8);
  const cached = signingKeyCache.get(session);
  if (cached?.date === date) {
    return cached.key;
  }
  const key = signingKey(session.secretAccessKey, date, session.region, "dynamodb");
  signingKeyCache.set(session, { date, key });
  return key;
}

export function signAuthorization(input: {
  region: string;
  service: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;
  headers: ReadonlyArray<readonly [string, string]>;
  /** Reuse a key derived for this session and calendar day. */
  derivedKey?: Buffer;
}): string {
  const date = input.amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  const headers = input.headers.map(([name, value]) => [name.toLowerCase(), canonicalValue(value)] as const);
  headers.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const canonicalHeaders = headers.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = headers.map(([name]) => name).join(";");
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    input.derivedKey ?? signingKey(input.secretAccessKey, date, input.region, input.service),
  )
    .update(stringToSign, "utf8")
    .digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export function amzDate(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function dynamoCall(
  session: DynamoDbSession,
  target: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  deadline?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!TARGET.test(target)) {
    throw new Error("DynamoDB request failed");
  }
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > MAX_REQUEST) {
    throw new Error("DynamoDB request failed");
  }
  const stamped = amzDate();
  const signed: Array<[string, string]> = [
    ["content-type", "application/x-amz-json-1.0"],
    ["host", session.host],
    ["x-amz-date", stamped],
    ["x-amz-target", `DynamoDB_20120810.${target}`],
  ];
  if (session.sessionToken) {
    signed.push(["x-amz-security-token", session.sessionToken]);
  }
  const authorization = signAuthorization({
    region: session.region,
    service: "dynamodb",
    body: payload,
    accessKeyId: session.accessKeyId,
    secretAccessKey: session.secretAccessKey,
    amzDate: stamped,
    headers: signed,
    derivedKey: sessionSigningKey(session, stamped),
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-amz-json-1.0",
    "X-Amz-Date": stamped,
    "X-Amz-Target": `DynamoDB_20120810.${target}`,
    Authorization: authorization,
  };
  if (session.sessionToken) {
    headers["X-Amz-Security-Token"] = session.sessionToken;
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = AbortSignal.any(deadline ? [signal, timeout, deadline] : [signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(new URL("/", session.origin), {
      method: "POST",
      redirect: "manual",
      signal: requestSignal,
      headers,
      body: payload,
    });
  } catch (error) {
    throw transportError(error, signal, deadline, timeout);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("DynamoDB refused a redirect");
  }
  if (response.status !== 200) {
    throw await errorResponse(response);
  }
  try {
    return JSON.parse(await readText(response, MAX_RESPONSE)) as unknown;
  } catch (error) {
    throw transportError(error, signal, deadline, timeout);
  }
}

function canonicalValue(value: string): string {
  return value.trim().replace(/ {2,}/g, " ");
}

function transportError(
  error: unknown,
  signal: AbortSignal,
  deadline: AbortSignal | undefined,
  timeout: AbortSignal,
): Error {
  if (error instanceof DynamoDbError || error instanceof SyntaxError) {
    return new Error("DynamoDB returned an unexpected response");
  }
  if (error instanceof Error && /DynamoDB returned|DynamoDB response exceeded|DynamoDB refused/.test(error.message)) {
    return error;
  }
  if (deadline?.aborted || timeout.aborted) {
    return new Error("DynamoDB request timed out");
  }
  if (signal.aborted) {
    return new Error("DynamoDB request was cancelled");
  }
  return new Error("DynamoDB request failed");
}

async function errorResponse(response: Response): Promise<DynamoDbError> {
  let text = "";
  try {
    text = await readText(response, 65_536);
  } catch {
    return new DynamoDbError(response.status, "", "DynamoDB request failed");
  }
  try {
    const body = JSON.parse(text) as { __type?: unknown; message?: unknown; Message?: unknown };
    const type = typeof body.__type === "string" ? body.__type.split("#").pop() ?? "" : "";
    const message = body.message ?? body.Message;
    if (typeof message === "string" && message.trim()) {
      return new DynamoDbError(response.status, type, message.trim().slice(0, 500));
    }
    return new DynamoDbError(response.status, type, "DynamoDB request failed");
  } catch {
    return new DynamoDbError(response.status, "", "DynamoDB request failed");
  }
}

async function readText(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("DynamoDB response exceeded the size limit");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
