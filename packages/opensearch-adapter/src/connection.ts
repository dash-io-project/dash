import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { OpenSearchConnectionConfig } from "@dash/core";
import { Client, type ClientOptions } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws-v3";

const MAX_URL = 2048;
const MAX_SECRET = 4096;
const REGION = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const HOST =
  /^(?:localhost|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/;

export type OpenSearchAuth = "basic" | "sigv4" | "none";
export type OpenSearchService = "es" | "aoss";

export interface OpenSearchSession {
  node: string;
  auth: OpenSearchAuth;
  username?: string;
  password?: string;
  region?: string;
  service?: OpenSearchService;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface OpenSearchSummary {
  node: string;
  auth: string;
  region: string;
  service: string;
}

interface ParsedNode {
  node: string;
  username?: string;
  password?: string;
  region?: string;
  service?: OpenSearchService;
}

function blank(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function secret(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

function assertNoControls(value: string, label: string): void {
  if (value.length > MAX_SECRET || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`OpenSearch ${label} is invalid`);
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") {
    return true;
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts[0] !== "127") {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function assertHostname(hostname: string): void {
  // The URL parser already checks an IPv6 address.
  if (hostname.includes(":")) {
    return;
  }
  if (hostname.length > 253 || !HOST.test(hostname)) {
    throw new Error("OpenSearch node URL is invalid");
  }
}

/**
 * Reads a node URL. A connection string may carry user info and `region` or
 * `service`. The `node` field may not.
 */
export function parseOpenSearchNode(value: string, allowUserinfo: boolean): ParsedNode {
  if (value.length === 0 || value.length > MAX_URL || /\s/.test(value)) {
    throw new Error("OpenSearch node URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OpenSearch node URL is invalid");
  }
  let protocol = url.protocol;
  if (protocol === "opensearch:") {
    protocol = "https:";
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("OpenSearch node URL must use https");
  }
  if (url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("OpenSearch node URL is invalid");
  }
  if (!allowUserinfo && (url.username || url.password)) {
    throw new Error("Put the OpenSearch user and password in their own fields");
  }
  if (!allowUserinfo && url.search) {
    throw new Error("OpenSearch node URL is invalid");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  assertHostname(hostname);
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error("OpenSearch node URL is invalid");
  }
  if (protocol === "http:" && !isLoopbackHost(hostname)) {
    throw new Error("OpenSearch allows http only for a loopback host");
  }

  let username: string | undefined;
  let password: string | undefined;
  if (url.username || url.password) {
    try {
      username = decodeURIComponent(url.username) || undefined;
      password = decodeURIComponent(url.password) || undefined;
    } catch {
      throw new Error("OpenSearch node URL is invalid");
    }
  }

  const entries = [...url.searchParams.entries()];
  const names = entries.map(([key]) => key);
  if (new Set(names).size !== names.length) {
    throw new Error("Unsupported OpenSearch connection parameter");
  }
  let region: string | undefined;
  let service: OpenSearchService | undefined;
  for (const [key, raw] of entries) {
    if (key === "region") {
      region = raw;
      continue;
    }
    if (key === "service") {
      if (raw !== "es" && raw !== "aoss") {
        throw new Error("OpenSearch service must be es or aoss");
      }
      service = raw;
      continue;
    }
    throw new Error("Unsupported OpenSearch connection parameter");
  }

  return {
    node: `${protocol}//${url.host}`,
    username,
    password,
    region,
    service,
  };
}

export function openSearchSession(config: OpenSearchConnectionConfig): OpenSearchSession {
  const nodeField = blank(config.node);
  const parsed = nodeField
    ? parseOpenSearchNode(nodeField, false)
    : config.connectionString
      ? parseOpenSearchNode(config.connectionString.trim(), true)
      : undefined;
  if (!parsed) {
    throw new Error("OpenSearch node URL is required");
  }

  const username = blank(config.username) ?? parsed.username;
  const password = secret(config.password) ?? parsed.password;
  const region = blank(config.region) ?? blank(parsed.region);
  let service = config.service ?? parsed.service;
  const accessKeyId = blank(config.accessKeyId);
  const secretAccessKey = secret(config.secretAccessKey);
  const sessionToken = secret(config.sessionToken);

  if (username) {
    assertNoControls(username, "user");
    if (username.includes(":")) {
      throw new Error("OpenSearch user is invalid");
    }
  }
  if (password) {
    assertNoControls(password, "password");
  }
  if ((username && !password) || (password && !username)) {
    throw new Error("OpenSearch basic auth needs a user and a password");
  }
  if (region && !REGION.test(region)) {
    throw new Error("OpenSearch region is invalid");
  }
  if (service && service !== "es" && service !== "aoss") {
    throw new Error("OpenSearch service must be es or aoss");
  }
  if (service && !region) {
    throw new Error("OpenSearch service needs a region");
  }
  if (region && !service) {
    service = "es";
  }

  const basic = Boolean(username && password);
  const sigv4 = Boolean(region);
  if (basic && sigv4) {
    throw new Error("Use OpenSearch basic auth or AWS SigV4, not both");
  }
  if (accessKeyId || secretAccessKey || sessionToken) {
    if (!sigv4) {
      throw new Error("OpenSearch AWS credentials need a region");
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("OpenSearch AWS credentials need an access key and a secret key");
    }
    assertNoControls(accessKeyId, "access key");
    assertNoControls(secretAccessKey, "secret key");
    if (sessionToken) {
      assertNoControls(sessionToken, "session token");
    }
  }
  if (!basic && !sigv4 && !isLoopbackHost(new URL(parsed.node).hostname)) {
    throw new Error("OpenSearch auth is required");
  }

  return {
    node: parsed.node,
    auth: basic ? "basic" : sigv4 ? "sigv4" : "none",
    ...(username && password ? { username, password } : {}),
    ...(region && service ? { region, service } : {}),
    ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
    ...(sessionToken ? { sessionToken } : {}),
  };
}

export function openSearchPublicSummary(config: OpenSearchConnectionConfig): {
  node: string;
  auth: string;
  region: string;
  service: string;
} {
  try {
    const session = openSearchSession(config);
    const url = new URL(session.node);
    return {
      node: url.host,
      auth: session.auth,
      region: session.region ?? "",
      service: session.service ?? "",
    };
  } catch {
    return { node: "", auth: "", region: "", service: "" };
  }
}

export function openSearchSecrets(config: OpenSearchConnectionConfig): string[] {
  const found = [config.password, config.secretAccessKey, config.sessionToken, config.connectionString];
  try {
    const session = openSearchSession(config);
    found.push(session.password, session.secretAccessKey, session.sessionToken);
    if (session.username && session.password) {
      found.push(Buffer.from(`${session.username}:${session.password}`).toString("base64"));
    }
  } catch {
    // The raw fields above still cover a URL that failed to parse.
  }
  return found.filter((value): value is string => typeof value === "string" && value.length >= 3);
}

export function scrubSecrets(message: string, secrets: readonly string[]): string {
  const unique = [...new Set(secrets.filter((item) => item.length >= 3))];
  unique.sort((left, right) => right.length - left.length);
  let text = message;
  for (const item of unique) {
    text = text.split(item).join("[redacted]");
    const encoded = encodeURIComponent(item);
    if (encoded !== item && encoded.length >= 3) {
      text = text.split(encoded).join("[redacted]");
    }
  }
  return text.slice(0, 500);
}

async function credentialsFor(session: OpenSearchSession): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}> {
  if (session.accessKeyId && session.secretAccessKey) {
    return {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
    };
  }
  const loaded = await defaultProvider()();
  return {
    accessKeyId: loaded.accessKeyId,
    secretAccessKey: loaded.secretAccessKey,
    ...(loaded.sessionToken ? { sessionToken: loaded.sessionToken } : {}),
  };
}

export function createOpenSearchClient(session: OpenSearchSession): Client {
  const options: ClientOptions = {
    node: session.node,
    ssl: { rejectUnauthorized: true },
    requestTimeout: 10_000,
    pingTimeout: 10_000,
    maxRetries: 0,
    sniffOnStart: false,
    sniffOnConnectionFault: false,
    enableLongNumeralSupport: true,
  };
  if (session.auth === "basic" && session.username && session.password) {
    options.auth = { username: session.username, password: session.password };
  }
  if (session.auth === "sigv4" && session.region && session.service) {
    return new Client({
      ...AwsSigv4Signer({
        region: session.region,
        service: session.service,
        getCredentials: () => credentialsFor(session),
      }),
      ...options,
    });
  }
  return new Client(options);
}
