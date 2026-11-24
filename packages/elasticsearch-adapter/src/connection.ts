import type { ElasticsearchConnectionConfig } from "@dash/core";

const MAX_URI = 2048;
const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const ES_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const API_KEY_PART = /^[A-Za-z0-9_-]{1,220}$/;
const ENCODED_API_KEY = /^[A-Za-z0-9+/=_-]{8,512}$/;

export interface ElasticsearchSession {
  origin: string;
  authorization: string;
  tls: boolean;
  auth: "basic" | "api-key";
  /** Basic-auth user. Empty when the session uses an API key. */
  user: string;
  secrets: readonly string[];
}

export function elasticsearchSession(config: ElasticsearchConnectionConfig): ElasticsearchSession {
  if (config.connectionString && config.cloudId) {
    throw new Error("Elasticsearch cloud id cannot be combined with a connection string");
  }
  if (config.connectionString && config.host) {
    throw new Error("Elasticsearch host cannot be combined with a connection string");
  }
  if (config.cloudId && config.host) {
    throw new Error("Elasticsearch cloud id cannot be combined with a host");
  }

  const fromUri = config.connectionString
    ? parseElasticsearchConnectionString(config.connectionString)
    : undefined;
  const auth = authorization(config, fromUri);
  const secrets = collectSecrets(config, fromUri, auth.header);

  if (config.cloudId) {
    if (config.tls === false) {
      throw new Error("Elasticsearch TLS settings disagree");
    }
    return {
      origin: nodeFromCloudId(config.cloudId),
      authorization: auth.header,
      tls: true,
      auth: auth.kind,
      user: auth.user,
      secrets,
    };
  }

  if (fromUri) {
    if (config.tls === true && !fromUri.tls) {
      throw new Error("Elasticsearch TLS settings disagree");
    }
    if (config.tls === false && fromUri.tls) {
      throw new Error("Elasticsearch TLS settings disagree");
    }
    return {
      origin: fromUri.origin,
      authorization: auth.header,
      tls: fromUri.tls,
      auth: auth.kind,
      user: auth.user,
      secrets,
    };
  }

  if (!config.host) {
    throw new Error("Elasticsearch host is required");
  }
  const host = assertHost(config.host);
  const port = assertPort(config.port ?? 9200);
  const loopback = isLoopback(host);
  let tls: boolean;
  if (config.tls === false) {
    if (!loopback) {
      throw new Error("Elasticsearch requires TLS for this host");
    }
    tls = false;
  } else if (config.tls === true) {
    tls = true;
  } else {
    tls = !loopback;
  }
  return {
    origin: originFor(tls ? "https" : "http", host, port),
    authorization: auth.header,
    tls,
    auth: auth.kind,
    user: auth.user,
    secrets,
  };
}

export function elasticsearchUsesTls(config: ElasticsearchConnectionConfig): boolean {
  try {
    return elasticsearchSession(config).tls;
  } catch {
    return false;
  }
}

export function parseElasticsearchConnectionString(value: string): {
  origin: string;
  tls: boolean;
  user?: string;
  password?: string;
} {
  if (value.length === 0 || value.length > MAX_URI) {
    throw new Error("Invalid Elasticsearch connection string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Elasticsearch connection string");
  }
  if (url.username === "" && url.password !== "") {
    throw new Error("Invalid Elasticsearch connection string");
  }
  if (url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Unsupported Elasticsearch connection parameter");
  }
  const scheme = url.protocol;
  const host = assertHost(url.hostname);
  const loopback = isLoopback(host);
  let tls: boolean;
  if (scheme === "https:" || scheme === "elasticsearch:") {
    tls = true;
  } else if (scheme === "http:") {
    if (!loopback) {
      throw new Error("Elasticsearch requires TLS for this host");
    }
    tls = false;
  } else {
    throw new Error("Elasticsearch connection string must use https:// or http://");
  }
  const port = url.port
    ? assertPort(Number(url.port))
    : tls
      ? 443
      : 9200;
  let user: string | undefined;
  let password: string | undefined;
  if (url.username) {
    try {
      user = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password);
    } catch {
      throw new Error("Invalid Elasticsearch connection string");
    }
    assertCredential(user, "user");
    assertCredential(password, "password");
    if (user.includes(":")) {
      throw new Error("Elasticsearch user is invalid");
    }
  }
  return {
    origin: originFor(tls ? "https" : "http", host, port),
    tls,
    ...(user ? { user, password: password ?? "" } : {}),
  };
}

export function elasticsearchPublicSummary(
  config: ElasticsearchConnectionConfig,
): { host: string; port: number; user: string; tls: boolean; auth: string } {
  try {
    const session = elasticsearchSession(config);
    const url = new URL(session.origin);
    const port = url.port ? Number(url.port) : session.tls ? 443 : 9200;
    return {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port,
      user: session.user,
      tls: session.tls,
      auth: session.auth,
    };
  } catch {
    return { host: "", port: 0, user: "", tls: false, auth: "" };
  }
}

export function nodeFromCloudId(cloudId: string): string {
  if (cloudId.length === 0 || cloudId.length > 1024 || /[\u0000-\u001f\u007f]/.test(cloudId)) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  const colon = cloudId.indexOf(":");
  if (colon <= 0 || colon !== cloudId.lastIndexOf(":") || colon === cloudId.length - 1) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  const encoded = cloudId.slice(colon + 1);
  if (!/^[A-Za-z0-9+/=_-]+$/.test(encoded)) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  if (decoded.includes("\0") || !/^[\x20-\x7e]+$/.test(decoded)) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  const parts = decoded.split("$");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  const domain = parts[0] ?? "";
  const esId = parts[1] ?? "";
  if (!HOST_NAME.test(domain) || domain.includes("..") || domain.length > 253) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  if (!ES_ID.test(esId)) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  const host = `${esId}.${domain}`;
  if (!HOST_NAME.test(host) || host.includes("..")) {
    throw new Error("Invalid Elasticsearch cloud id");
  }
  return `https://${host}`;
}

function authorization(
  config: ElasticsearchConnectionConfig,
  fromUri: { user?: string; password?: string } | undefined,
): { header: string; kind: "basic" | "api-key"; user: string } {
  if (fromUri?.user && (config.user || config.password)) {
    throw new Error("Elasticsearch user cannot be combined with credentials in the connection string");
  }
  const uriUser = fromUri?.user;
  const basicRequested = Boolean(config.user || config.password || uriUser);
  if (config.apiKey && basicRequested) {
    throw new Error("Elasticsearch API key and basic authentication cannot both be set");
  }
  if (config.apiKey) {
    return { header: `ApiKey ${normalizeApiKey(config.apiKey)}`, kind: "api-key", user: "" };
  }
  const user = uriUser ?? config.user;
  const password = uriUser ? fromUri?.password : config.password;
  if (!user) {
    throw new Error("Elasticsearch user or API key is required");
  }
  if (password === undefined || password.length === 0) {
    throw new Error("Elasticsearch password is required");
  }
  assertCredential(user, "user");
  assertCredential(password, "password");
  if (user.includes(":")) {
    throw new Error("Elasticsearch user is invalid");
  }
  const token = Buffer.from(`${user}:${password}`, "utf8").toString("base64");
  return { header: `Basic ${token}`, kind: "basic", user };
}

export function normalizeApiKey(apiKey: string): string {
  assertCredential(apiKey, "API key");
  if (apiKey.includes(":")) {
    const colon = apiKey.indexOf(":");
    if (colon !== apiKey.lastIndexOf(":") || colon === 0 || colon === apiKey.length - 1) {
      throw new Error("Elasticsearch API key is invalid");
    }
    const id = apiKey.slice(0, colon);
    const secret = apiKey.slice(colon + 1);
    if (!API_KEY_PART.test(id) || !API_KEY_PART.test(secret)) {
      throw new Error("Elasticsearch API key is invalid");
    }
    return Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
  }
  if (!ENCODED_API_KEY.test(apiKey)) {
    throw new Error("Elasticsearch API key is invalid");
  }
  return apiKey;
}

function collectSecrets(
  config: ElasticsearchConnectionConfig,
  fromUri: { password?: string } | undefined,
  header: string,
): string[] {
  const secrets = [config.password, config.apiKey, config.connectionString, fromUri?.password, header]
    .filter((value): value is string => typeof value === "string" && value.length >= 3);
  if (config.apiKey && config.apiKey.includes(":")) {
    try {
      secrets.push(normalizeApiKey(config.apiKey));
    } catch {
      // The raw key is already listed when it is long enough.
    }
  }
  return secrets;
}

function assertHost(host: string): string {
  const bare = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (bare.length === 0 || bare.length > 253 || bare.includes("..")) {
    throw new Error("Elasticsearch host is invalid");
  }
  if (bare === "::1") {
    return bare;
  }
  if (!HOST_NAME.test(bare)) {
    throw new Error("Elasticsearch host is invalid");
  }
  return bare;
}

function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Elasticsearch port is invalid");
  }
  return port;
}

function assertCredential(value: string, label: string): string {
  if (value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Elasticsearch ${label} is invalid`);
  }
  return value;
}

export function isLoopback(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

function originFor(scheme: "http" | "https", host: string, port: number): string {
  const formatted = host.includes(":") ? `[${host}]` : host;
  // Always include the port. `http://host` would otherwise mean port 80, not 9200.
  return `${scheme}://${formatted}:${port}`;
}
