import type { Neo4jConnectionConfig } from "@dash/core";

const MAX_URI = 2048;
const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const DATABASE_NAME = /^[A-Za-z][A-Za-z0-9.-]{2,62}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const SCHEMES: Record<string, { scheme: Neo4jScheme; encrypted: boolean }> = {
  "bolt:": { scheme: "bolt", encrypted: false },
  "bolt+s:": { scheme: "bolt+s", encrypted: true },
  "neo4j:": { scheme: "neo4j", encrypted: false },
  "neo4j+s:": { scheme: "neo4j+s", encrypted: true },
};

export type Neo4jScheme = "bolt" | "bolt+s" | "neo4j" | "neo4j+s";

export interface Neo4jTarget {
  /** Bolt URI without a user or a password. */
  uri: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypted: boolean;
}

interface ParsedUri {
  scheme: Neo4jScheme;
  encrypted: boolean;
  host: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
}

function assertHost(host: string): string {
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.length === 0 || bare.length > 253 || bare.includes("..")) {
    throw new Error("Neo4j host is invalid");
  }
  if (bare.includes(":")) {
    if (!/^[0-9A-Fa-f:]+$/.test(bare) || bare.split("::").length > 2) {
      throw new Error("Neo4j host is invalid");
    }
    return bare;
  }
  if (!HOST_NAME.test(bare)) {
    throw new Error("Neo4j host is invalid");
  }
  return bare;
}

function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Neo4j port is invalid");
  }
  return port;
}

export function assertDatabase(name: string): string {
  if (
    !DATABASE_NAME.test(name) ||
    name.endsWith(".") ||
    name.endsWith("-") ||
    name.includes("..")
  ) {
    throw new Error("Neo4j database name is invalid");
  }
  return name;
}

function assertCredential(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`Neo4j ${label} is required`);
  }
  if (value.length > 256 || CONTROL.test(value)) {
    throw new Error(`Neo4j ${label} is invalid`);
  }
  return value;
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Neo4j ${label} is invalid`);
  }
}

function boltUri(scheme: Neo4jScheme, host: string, port: number): string {
  const bracket = host.includes(":") ? `[${host}]` : host;
  return `${scheme}://${bracket}:${port}`;
}

function databaseFromPath(pathname: string): string | undefined {
  if (pathname === "" || pathname === "/") {
    return undefined;
  }
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 1) {
    throw new Error("Neo4j database name is invalid");
  }
  const raw = parts[0];
  if (raw === undefined) {
    throw new Error("Neo4j database name is invalid");
  }
  return assertDatabase(decodePart(raw, "database"));
}

export function readNeo4jUri(connectionString: string): ParsedUri {
  if (connectionString.length === 0 || connectionString.length > MAX_URI) {
    throw new Error("Neo4j connection string is invalid");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Neo4j connection string is invalid");
  }
  if (url.protocol === "bolt+ssc:" || url.protocol === "neo4j+ssc:") {
    throw new Error("Neo4j connection string cannot disable certificate checks");
  }
  const scheme = SCHEMES[url.protocol];
  if (!scheme) {
    throw new Error("Neo4j connection string must use bolt://, bolt+s://, neo4j://, or neo4j+s://");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("Unsupported Neo4j connection parameter");
  }
  if (!url.hostname) {
    throw new Error("Neo4j host is invalid");
  }
  const host = assertHost(url.hostname);
  const port = assertPort(url.port === "" ? 7687 : Number(url.port));
  const database = databaseFromPath(url.pathname);
  let user: string | undefined;
  let password: string | undefined;
  if (url.username !== "" || url.password !== "") {
    user = assertCredential(decodePart(url.username, "user"), "user");
    password = assertCredential(decodePart(url.password, "password"), "password");
  }
  return { scheme: scheme.scheme, encrypted: scheme.encrypted, host, port, database, user, password };
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text.length === 0 ? undefined : text;
}

/**
 * Resolve a connection. The returned URI has no user and no password.
 * Host and port are checked so they cannot change the URI.
 */
export function resolveNeo4jTarget(config: Neo4jConnectionConfig): Neo4jTarget {
  if (config.encryption !== undefined && typeof config.encryption !== "boolean") {
    throw new Error("Neo4j encryption setting is invalid");
  }
  const connectionString = optionalText(config.connectionString);
  if (connectionString) {
    const parsed = readNeo4jUri(connectionString);
    if (config.encryption === true && !parsed.encrypted) {
      throw new Error("Neo4j encryption settings disagree");
    }
    const database = databaseChoice(optionalText(config.database), parsed.database);
    const user = parsed.user ?? optionalText(config.user);
    const password = parsed.password ?? config.password;
    if (!user) {
      throw new Error("Neo4j user is required");
    }
    if (password === undefined || password === "") {
      throw new Error("Neo4j password is required");
    }
    return {
      uri: boltUri(parsed.scheme, parsed.host, parsed.port),
      host: parsed.host,
      port: parsed.port,
      database,
      user: assertCredential(user, "user"),
      password: assertCredential(password, "password"),
      encrypted: parsed.encrypted,
    };
  }

  if (!config.host) {
    throw new Error("Neo4j host is required");
  }
  const host = assertHost(config.host.trim());
  const port = assertPort(config.port ?? 7687);
  const database = assertDatabase(optionalText(config.database) ?? "neo4j");
  if (!config.user) {
    throw new Error("Neo4j user is required");
  }
  if (config.password === undefined || config.password === "") {
    throw new Error("Neo4j password is required");
  }
  const encrypted = config.encryption === true;
  return {
    uri: boltUri(encrypted ? "bolt+s" : "bolt", host, port),
    host,
    port,
    database,
    user: assertCredential(config.user, "user"),
    password: assertCredential(config.password, "password"),
    encrypted,
  };
}

function databaseChoice(configured: string | undefined, fromUri: string | undefined): string {
  if (configured && fromUri && configured.toLowerCase() !== fromUri.toLowerCase()) {
    throw new Error("Neo4j database settings disagree");
  }
  return assertDatabase(configured ?? fromUri ?? "neo4j");
}

export function neo4jPublicSummary(
  config: Neo4jConnectionConfig,
): { host: string; port: number | ""; database: string; user: string; encryption: boolean } {
  try {
    const target = resolveNeo4jTarget(config);
    return {
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      encryption: target.encrypted,
    };
  } catch {
    return { host: "", port: "", database: "", user: "", encryption: false };
  }
}

export function secretsFrom(config: Neo4jConnectionConfig, password?: string): string[] {
  const secrets = [config.password, password, config.connectionString].filter(
    (value): value is string => typeof value === "string" && value.length >= 3,
  );
  if (!config.connectionString) {
    return secrets;
  }
  try {
    const parsed = readNeo4jUri(config.connectionString);
    if (parsed.password && parsed.password.length >= 3) {
      secrets.push(parsed.password);
    }
  } catch {
    // The raw connection string is already in the list when it is long enough.
  }
  return secrets;
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
  return text.slice(0, 500);
}
