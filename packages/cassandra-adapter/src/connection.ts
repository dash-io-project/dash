import { QueryValidationError, type CassandraConnectionConfig } from "@dash/core";

export const CASSANDRA_DEFAULT_PORT = 9042;
export const CASSANDRA_DEFAULT_DATA_CENTER = "datacenter1";

const CONNECTION_STRING_MAX = 4096;
const PASSWORD_MAX = 4096;
const KEYSPACE_MAX = 48;
const KNOWN_PARAMS = new Set(["dc", "ssl"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const USER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,127}$/;
const DATA_CENTER = /^[A-Za-z0-9_-]{1,128}$/;
const HOST_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export interface CassandraSession {
  contactPoints: string[];
  port: number;
  keyspace?: string;
  localDataCenter: string;
  user?: string;
  password?: string;
  ssl: boolean;
}

interface ParsedCassandraUri {
  host: string;
  port?: number;
  keyspace?: string;
  localDataCenter?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

function text(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function assertHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || !isHost(normalized)) {
    throw new QueryValidationError("Invalid Cassandra host");
  }
  return normalized;
}

function isHost(value: string): boolean {
  if (value === "localhost") {
    return true;
  }
  if (IPV4.test(value)) {
    return value.split(".").every((octet) => {
      if (octet.length > 1 && octet.startsWith("0")) {
        return false;
      }
      return Number(octet) <= 255;
    });
  }
  if (value.includes(":")) {
    return isIpv6(value);
  }
  return HOST_NAME.test(value);
}

function isIpv6(value: string): boolean {
  if (!/^[0-9a-f:]+$/.test(value)) {
    return false;
  }
  return value.split("::").length <= 2;
}

function assertPort(value: string | number | undefined): number {
  if (value === undefined || value === "") {
    return CASSANDRA_DEFAULT_PORT;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryValidationError("Invalid Cassandra port");
  }
  return port;
}

function assertKeyspace(value: string): string {
  if (!IDENT.test(value) || value.length > KEYSPACE_MAX) {
    throw new QueryValidationError("Invalid Cassandra keyspace");
  }
  return value;
}

function assertUser(value: string): string {
  if (!USER_NAME.test(value)) {
    throw new QueryValidationError("Invalid Cassandra user");
  }
  return value;
}

function assertPassword(value: string): string {
  if (value.length > PASSWORD_MAX) {
    throw new QueryValidationError("Invalid Cassandra password");
  }
  return value;
}

function assertDataCenter(value: string): string {
  if (!DATA_CENTER.test(value)) {
    throw new QueryValidationError("Invalid Cassandra data center");
  }
  return value;
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new QueryValidationError("Invalid Cassandra connection string");
  }
}

function sslFromParam(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new QueryValidationError("Invalid Cassandra ssl parameter");
}

export function parseCassandraConnectionString(connectionString: string): ParsedCassandraUri {
  const raw = connectionString.trim();
  if (!raw) {
    throw new QueryValidationError("Cassandra connection string is required");
  }
  if (raw.length > CONNECTION_STRING_MAX) {
    throw new QueryValidationError("Cassandra connection string is too long");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueryValidationError("Invalid Cassandra connection string");
  }
  if (url.protocol !== "cassandra:") {
    throw new QueryValidationError("Cassandra connection string must use the cassandra:// scheme");
  }
  if (url.hash) {
    throw new QueryValidationError("Invalid Cassandra connection string");
  }
  for (const key of url.searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) {
      throw new QueryValidationError("Unsupported Cassandra connection parameter");
    }
  }
  for (const key of KNOWN_PARAMS) {
    if (url.searchParams.getAll(key).length > 1) {
      throw new QueryValidationError("Cassandra connection parameter is repeated");
    }
  }
  if (!url.hostname) {
    throw new QueryValidationError("Invalid Cassandra host");
  }
  const path = url.pathname.replace(/^\//, "");
  if (path.includes("/")) {
    throw new QueryValidationError("Cassandra connection string can include one keyspace");
  }
  const keyspace = path ? assertKeyspace(decodePart(path)) : undefined;
  const dc = url.searchParams.get("dc");
  const ssl = url.searchParams.get("ssl");
  const user = url.username ? assertUser(decodePart(url.username)) : undefined;
  const password = url.password ? assertPassword(decodePart(url.password)) : undefined;
  if (password !== undefined && user === undefined) {
    throw new QueryValidationError("Cassandra user is required");
  }
  return {
    host: assertHost(url.hostname),
    port: url.port ? assertPort(url.port) : undefined,
    ...(keyspace !== undefined ? { keyspace } : {}),
    ...(dc !== null ? { localDataCenter: assertDataCenter(dc) } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(ssl !== null ? { ssl: sslFromParam(ssl) } : {}),
  };
}

export function cassandraSession(config: CassandraConnectionConfig): CassandraSession {
  const parsed = config.connectionString
    ? parseCassandraConnectionString(config.connectionString)
    : undefined;
  const host = text(config.host);
  const keyspace = text(config.keyspace);
  const user = text(config.user);
  const password = text(config.password);
  const dataCenter = text(config.localDataCenter);
  if (!parsed && !host) {
    throw new QueryValidationError("Cassandra host is required");
  }
  const resolvedUser = user ?? parsed?.user;
  const resolvedPassword = password ?? parsed?.password;
  if (resolvedPassword !== undefined && resolvedUser === undefined) {
    throw new QueryValidationError("Cassandra user is required");
  }
  const resolvedKeyspace = keyspace ?? parsed?.keyspace;
  return {
    contactPoints: [host ? assertHost(host) : parsed!.host],
    port: config.port !== undefined ? assertPort(config.port) : (parsed?.port ?? CASSANDRA_DEFAULT_PORT),
    ...(resolvedKeyspace !== undefined ? { keyspace: assertKeyspace(resolvedKeyspace) } : {}),
    localDataCenter: dataCenter
      ? assertDataCenter(dataCenter)
      : (parsed?.localDataCenter ?? CASSANDRA_DEFAULT_DATA_CENTER),
    ...(resolvedUser !== undefined ? { user: assertUser(resolvedUser) } : {}),
    ...(resolvedPassword !== undefined ? { password: assertPassword(resolvedPassword) } : {}),
    ssl: config.ssl !== undefined ? config.ssl : (parsed?.ssl ?? false),
  };
}

export function cassandraPublicSummary(
  config: CassandraConnectionConfig,
): Record<string, string | number | boolean> {
  try {
    const session = cassandraSession(config);
    return {
      host: session.contactPoints[0] ?? "",
      port: session.port,
      keyspace: session.keyspace ?? "",
      localDataCenter: session.localDataCenter,
      user: session.user ?? "",
      ssl: session.ssl,
    };
  } catch {
    return {
      host: config.connectionString ? "(connection string)" : "",
      port: "",
      keyspace: "",
      localDataCenter: "",
      user: "",
      ssl: false,
    };
  }
}
