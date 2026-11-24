import {
  type CouchbaseConnectionConfig,
  QueryValidationError,
  assertIdentifier,
} from "@dash/core";

const MAX_URI = 2048;
const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const USER_NAME = /^[A-Za-z0-9._@+-]{1,128}$/;
const ALLOWED_PARAMS = new Set(["scope", "network"]);

export interface CouchbaseTarget {
  connectionString: string;
  host: string;
  port: number;
  user: string;
  password: string;
  bucket: string;
  scope: string;
  tls: boolean;
  network?: "default" | "external";
}

export type CouchbaseSummary = {
  host: string;
  port: number;
  bucket: string;
  scope: string;
  user: string;
  tls: boolean;
};

interface ParsedUri {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  bucket?: string;
  scope?: string;
  tls: boolean;
  network?: "default" | "external";
}

function assertName(name: string, label: string): string {
  try {
    return assertIdentifier(name, label);
  } catch (error) {
    if (error instanceof QueryValidationError) {
      throw new Error(`Couchbase ${label} is invalid`);
    }
    throw error;
  }
}

function assertHost(host: string): string {
  if (host.length > 253 || !HOST_NAME.test(host) || host.includes("..")) {
    throw new Error("Couchbase host is invalid");
  }
  return host;
}

function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Couchbase port is invalid");
  }
  return port;
}

function assertUser(user: string): string {
  if (!USER_NAME.test(user)) {
    throw new Error("Couchbase user is invalid");
  }
  return user;
}

function assertPassword(password: string): string {
  if (password.length < 1 || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new Error("Couchbase password is invalid");
  }
  return password;
}

function assertNetwork(value: string): "default" | "external" {
  if (value === "default" || value === "external") {
    return value;
  }
  throw new Error("Couchbase network is invalid");
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Couchbase ${label} is invalid`);
  }
}

function sameOrThrow<T>(left: T | undefined, right: T | undefined, message: string): T | undefined {
  if (left !== undefined && right !== undefined && left !== right) {
    throw new Error(message);
  }
  return left ?? right;
}

function parseConnectionString(value: string): ParsedUri {
  if (value.length === 0 || value.length > MAX_URI) {
    throw new Error("Invalid Couchbase connection string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Couchbase connection string");
  }
  if (url.protocol !== "couchbase:" && url.protocol !== "couchbases:") {
    throw new Error("Couchbase connection string must use couchbase:// or couchbases://");
  }
  if (url.hash) {
    throw new Error("Invalid Couchbase connection string");
  }
  if (url.username === "" && url.password) {
    throw new Error("Couchbase user is invalid");
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      throw new Error("Unsupported Couchbase connection parameter");
    }
  }
  if (!url.hostname) {
    throw new Error("Couchbase host is invalid");
  }
  const host = assertHost(url.hostname);
  const port = url.port ? assertPort(Number(url.port)) : undefined;
  const path = url.pathname.replace(/^\//, "");
  let bucket: string | undefined;
  if (path) {
    if (path.includes("/")) {
      throw new Error("Couchbase bucket is invalid");
    }
    bucket = assertName(decodePart(path, "bucket"), "bucket");
  }
  const scopeParam = url.searchParams.get("scope");
  const scope = scopeParam ? assertName(decodePart(scopeParam, "scope"), "scope") : undefined;
  const networkParam = url.searchParams.get("network");
  const network = networkParam ? assertNetwork(networkParam) : undefined;
  const user = url.username ? assertUser(decodePart(url.username, "user")) : undefined;
  const password = url.password ? assertPassword(decodePart(url.password, "password")) : undefined;
  return {
    host,
    port,
    user,
    password,
    bucket,
    scope,
    tls: url.protocol === "couchbases:",
    network,
  };
}

function sdkConnectionString(
  host: string,
  port: number,
  tls: boolean,
  network: "default" | "external" | undefined,
): string {
  const scheme = tls ? "couchbases" : "couchbase";
  const base = `${scheme}://${host}:${port}`;
  return network ? `${base}?network=${network}` : base;
}

export function couchbaseTarget(config: CouchbaseConnectionConfig): CouchbaseTarget {
  const parsed = config.connectionString
    ? parseConnectionString(config.connectionString)
    : undefined;
  if (parsed && config.tls === true && !parsed.tls) {
    throw new Error("Couchbase TLS settings disagree");
  }
  if (parsed && config.tls === false && parsed.tls) {
    throw new Error("Couchbase TLS settings disagree");
  }
  const tls = config.tls ?? parsed?.tls ?? false;
  const host = parsed ? parsed.host : config.host ? assertHost(config.host) : undefined;
  if (!host) {
    throw new Error("Couchbase host is required");
  }
  const port = assertPort(config.port ?? parsed?.port ?? (tls ? 11207 : 11210));
  const user = sameOrThrow(config.user ? assertUser(config.user) : undefined, parsed?.user, "Couchbase user settings disagree");
  const password = sameOrThrow(
    config.password !== undefined ? assertPassword(config.password) : undefined,
    parsed?.password,
    "Couchbase password settings disagree",
  );
  const bucket = sameOrThrow(
    config.bucket ? assertName(config.bucket, "bucket") : undefined,
    parsed?.bucket,
    "Couchbase bucket settings disagree",
  );
  const scope =
    sameOrThrow(
      config.scope ? assertName(config.scope, "scope") : undefined,
      parsed?.scope,
      "Couchbase scope settings disagree",
    ) ?? "_default";
  const network = sameOrThrow(config.network ? assertNetwork(config.network) : undefined, parsed?.network, "Couchbase network settings disagree");
  if (!user) {
    throw new Error("Couchbase user is required");
  }
  if (!password) {
    throw new Error("Couchbase password is required");
  }
  if (!bucket) {
    throw new Error("Couchbase bucket is required");
  }
  return {
    connectionString: sdkConnectionString(host, port, tls, network),
    host,
    port,
    user,
    password,
    bucket,
    scope,
    tls,
    ...(network ? { network } : {}),
  };
}

export function couchbasePublicSummary(config: CouchbaseConnectionConfig): CouchbaseSummary {
  try {
    const target = couchbaseTarget(config);
    return {
      host: target.host,
      port: target.port,
      bucket: target.bucket,
      scope: target.scope,
      user: target.user,
      tls: target.tls,
    };
  } catch {
    return { host: "", port: 0, bucket: "", scope: "", user: "", tls: false };
  }
}

export function couchbaseErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Couchbase request failed";
  }
  const cause = error.cause;
  if (cause && typeof cause === "object" && "first_error_message" in cause) {
    const detail = cause.first_error_message;
    if (typeof detail === "string" && detail.length > 0 && !error.message.includes(detail)) {
      return `${error.message}: ${detail}`;
    }
  }
  return error.message;
}

export function scrubSecrets(message: string, secrets: readonly string[]): string {
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 3))];
  unique.sort((left, right) => right.length - left.length);
  let text = message;
  for (const secret of unique) {
    text = text.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && encoded.length >= 3) {
      text = text.split(encoded).join("[redacted]");
    }
  }
  return text;
}
