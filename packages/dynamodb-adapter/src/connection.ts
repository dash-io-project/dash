import type { DynamoDbConnectionConfig } from "@dash/core";

const MAX_URI = 4096;
const MAX_ENDPOINT = 300;
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
const ACCESS_KEY = /^[A-Za-z0-9]{1,128}$/;
const SECRET = /^[\x21-\x7e]{1,256}$/;
const SESSION_TOKEN = /^[\x21-\x7e]{1,4096}$/;

export interface DynamoDbSession {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  origin: string;
  host: string;
}

export function scrubSecrets(message: string, secrets: readonly string[]): string {
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 8))];
  unique.sort((left, right) => right.length - left.length);
  let text = message;
  for (const secret of unique) {
    text = text.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && encoded.length >= 8) {
      text = text.split(encoded).join("[redacted]");
    }
  }
  return text.slice(0, 500);
}

export function dynamoSession(config: DynamoDbConnectionConfig): DynamoDbSession {
  const parsed = config.connectionString
    ? parseDynamoConnectionString(config.connectionString)
    : undefined;
  const region = requireRegion(config.region ?? parsed?.region);
  const accessKeyId = requireAccessKey(config.accessKeyId ?? parsed?.accessKeyId);
  const secretAccessKey = requireSecret(config.secretAccessKey ?? parsed?.secretAccessKey);
  const sessionToken = optionalSessionToken(config.sessionToken);
  const endpoint = config.endpoint ?? parsed?.endpoint;
  const origin = endpoint ? normalizeEndpoint(endpoint, region) : cloudOrigin(region);
  return {
    region,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
    origin,
    host: hostHeader(origin),
  };
}

export function parseDynamoConnectionString(value: string): {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint?: string;
} {
  if (value.length === 0 || value.length > MAX_URI) {
    throw new Error("Invalid DynamoDB connection string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid DynamoDB connection string");
  }
  if (url.protocol !== "dynamodb:") {
    throw new Error("DynamoDB connection string must use dynamodb://");
  }
  if (url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Invalid DynamoDB connection string");
  }
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "endpoint") || url.searchParams.getAll("endpoint").length > 1) {
    throw new Error("Unsupported DynamoDB connection parameter");
  }
  let accessKeyId: string;
  let secretAccessKey: string;
  try {
    accessKeyId = decodeURIComponent(url.username);
    secretAccessKey = decodeURIComponent(url.password);
  } catch {
    throw new Error("Invalid DynamoDB connection string");
  }
  const region = requireRegion(url.hostname);
  const endpoint = url.searchParams.get("endpoint");
  return {
    accessKeyId: requireAccessKey(accessKeyId),
    secretAccessKey: requireSecret(secretAccessKey),
    region,
    ...(endpoint ? { endpoint: normalizeEndpoint(endpoint, region) } : {}),
  };
}

export function dynamoPublicSummary(config: DynamoDbConnectionConfig): {
  region: string;
  endpoint: string;
  accessKeyId: string;
} {
  try {
    const session = dynamoSession(config);
    const url = new URL(session.origin);
    const hostname = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
    return {
      region: session.region,
      endpoint: url.port ? `${hostname}:${url.port}` : hostname,
      accessKeyId: session.accessKeyId,
    };
  } catch {
    return { region: "", endpoint: "", accessKeyId: "" };
  }
}

export function cloudOrigin(region: string): string {
  return `https://${cloudHostname(requireRegion(region))}`;
}

export function normalizeEndpoint(value: string, region: string): string {
  if (value.length === 0 || value.length > MAX_ENDPOINT) {
    throw new Error("Invalid DynamoDB endpoint");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid DynamoDB endpoint");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid DynamoDB endpoint");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error("Invalid DynamoDB endpoint");
  }
  const loopback = isLoopback(url.hostname);
  const cloud = cloudHostname(region);
  if (url.protocol === "http:" && loopback) {
    return url.origin;
  }
  if (url.protocol === "https:" && url.hostname === cloud) {
    if (url.port && url.port !== "443") {
      throw new Error("Invalid DynamoDB endpoint");
    }
    return `https://${cloud}`;
  }
  if (url.protocol === "https:" && loopback) {
    return url.origin;
  }
  const awsHost =
    url.hostname.startsWith("dynamodb.") &&
    (url.hostname.endsWith(".amazonaws.com") || url.hostname.endsWith(".amazonaws.com.cn"));
  if (awsHost && url.hostname !== cloud) {
    throw new Error("DynamoDB endpoint does not match the region");
  }
  throw new Error("Invalid DynamoDB endpoint");
}

export function hostHeader(origin: string): string {
  const url = new URL(origin);
  const hostname = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  if (!url.port) {
    return hostname;
  }
  return `${hostname}:${url.port}`;
}

export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function cloudHostname(region: string): string {
  const suffix = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  return `dynamodb.${region}.${suffix}`;
}

function requireRegion(value: string | undefined): string {
  const region = value?.trim() ?? "";
  if (region.length > 32 || !REGION.test(region)) {
    throw new Error("Invalid DynamoDB region");
  }
  return region;
}

function requireAccessKey(value: string | undefined): string {
  if (!value || !ACCESS_KEY.test(value)) {
    throw new Error("Invalid DynamoDB access key");
  }
  return value;
}

function requireSecret(value: string | undefined): string {
  if (!value || !SECRET.test(value)) {
    throw new Error("Invalid DynamoDB secret access key");
  }
  return value;
}

function optionalSessionToken(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!SESSION_TOKEN.test(value)) {
    throw new Error("Invalid DynamoDB session token");
  }
  return value;
}
