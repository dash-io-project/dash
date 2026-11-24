import { QueryValidationError } from "@dash/core";
import type { ClickHouseConnectionConfig } from "@dash/core";

/** HTTPS port used by ClickHouse Cloud and a typical secure HTTP interface. */
export const CLICKHOUSE_TLS_PORT = 8443;
/** Plain HTTP interface port. The adapter does not speak the native protocol. */
export const CLICKHOUSE_HTTP_PORT = 8123;

const CONNECTION_STRING_MAX = 8192;
const KNOWN_PARAMS = new Set(["ssl"]);
const HOST_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const SIMPLE_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,126}$/;
const PASSWORD_MAX = 4096;

export interface ClickHouseSession {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  /** True when the HTTP interface is HTTPS. */
  ssl: boolean;
}

export function assertClickHouseHost(host: string): string {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1);
    if (!isIpv6(inner)) {
      throw new QueryValidationError("Invalid ClickHouse host");
    }
    return inner;
  }
  if (!trimmed || trimmed.length > 253 || !isHost(trimmed)) {
    throw new QueryValidationError("Invalid ClickHouse host");
  }
  return trimmed;
}

function isIpv4(value: string): boolean {
  if (!IPV4.test(value)) {
    return false;
  }
  return value.split(".").every((octet) => {
    if (octet.length > 1 && octet.startsWith("0")) {
      return false;
    }
    return Number(octet) <= 255;
  });
}

function isIpv6(value: string): boolean {
  if (!value || value.length > 45 || value.includes("%")) {
    return false;
  }
  const compression = value.indexOf("::");
  if (compression !== -1 && compression !== value.lastIndexOf("::")) {
    return false;
  }
  const sides = compression === -1 ? [value] : [value.slice(0, compression), value.slice(compression + 2)];
  let count = 0;
  for (let index = 0; index < sides.length; index += 1) {
    const side = sides[index] ?? "";
    if (side === "") {
      continue;
    }
    const parts = side.split(":");
    if (parts.some((part) => part.length === 0)) {
      return false;
    }
    const tail = parts[parts.length - 1] ?? "";
    if (index === sides.length - 1 && tail.includes(".")) {
      parts.pop();
      if (!isIpv4(tail)) {
        return false;
      }
      count += 2;
    }
    if (parts.some((part) => !HEX_GROUP.test(part))) {
      return false;
    }
    count += parts.length;
  }
  return compression === -1 ? count === 8 : count < 8;
}

function isHost(value: string): boolean {
  if (value === "localhost") {
    return true;
  }
  return isIpv4(value) || isIpv6(value) || HOST_NAME.test(value);
}

function assertPort(value: string | number | undefined, ssl: boolean): number {
  if (value === undefined || value === "") {
    return ssl ? CLICKHOUSE_TLS_PORT : CLICKHOUSE_HTTP_PORT;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryValidationError("Invalid ClickHouse port");
  }
  return port;
}

function assertClickHouseName(value: string, label: "database" | "user"): string {
  if (!SIMPLE_NAME.test(value)) {
    throw new QueryValidationError(`Invalid ClickHouse ${label}`);
  }
  return value;
}

function assertPassword(value: string): string {
  if (value.length > PASSWORD_MAX) {
    throw new QueryValidationError("Invalid ClickHouse password");
  }
  return value;
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new QueryValidationError(`Invalid ClickHouse ${label}`);
  }
}

function sslFlag(params: URLSearchParams): boolean | undefined {
  if (params.getAll("ssl").length > 1) {
    throw new QueryValidationError("ClickHouse connection parameter `ssl` is repeated");
  }
  const raw = params.get("ssl");
  if (raw === null) {
    return undefined;
  }
  const normalized = raw.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new QueryValidationError("Invalid ClickHouse ssl parameter");
}

interface ParsedClickHouseUrl {
  host: string;
  port?: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
}

export function parseClickHouseConnectionString(connectionString: string): ClickHouseSession {
  const parsed = parseUrl(connectionString);
  return {
    host: parsed.host,
    port: assertPort(parsed.port, parsed.ssl),
    database: parsed.database,
    user: parsed.user,
    ...(parsed.password !== undefined ? { password: parsed.password } : {}),
    ssl: parsed.ssl,
  };
}

function parseUrl(connectionString: string): ParsedClickHouseUrl {
  const raw = connectionString.trim();
  if (!raw) {
    throw new QueryValidationError("ClickHouse connection string is required");
  }
  if (raw.length > CONNECTION_STRING_MAX) {
    throw new QueryValidationError("ClickHouse connection string is too long");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueryValidationError("Invalid ClickHouse connection string");
  }
  if (url.hash) {
    throw new QueryValidationError("Invalid ClickHouse connection string");
  }
  if (url.protocol !== "clickhouse:" && url.protocol !== "https:" && url.protocol !== "http:") {
    throw new QueryValidationError(
      "ClickHouse connection string must use the clickhouse://, https://, or http:// scheme",
    );
  }
  for (const key of url.searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) {
      throw new QueryValidationError("Unsupported ClickHouse connection parameter");
    }
  }
  if (!url.hostname) {
    throw new QueryValidationError("Invalid ClickHouse host");
  }
  const database = decodePart(url.pathname.replace(/^\//, ""), "database");
  if (!database) {
    throw new QueryValidationError("ClickHouse database is required");
  }
  if (database.includes("/")) {
    throw new QueryValidationError("ClickHouse connection string can include one database");
  }
  if (!url.username) {
    throw new QueryValidationError("ClickHouse user is required");
  }
  const flagged = sslFlag(url.searchParams);
  let ssl: boolean;
  if (url.protocol === "https:") {
    if (flagged === false) {
      throw new QueryValidationError("ClickHouse https scheme and ssl disagree");
    }
    ssl = true;
  } else if (url.protocol === "http:") {
    if (flagged === true) {
      throw new QueryValidationError("ClickHouse http scheme and ssl disagree");
    }
    ssl = false;
  } else {
    ssl = flagged ?? true;
  }
  const user = decodePart(url.username, "user");
  const password = url.password ? assertPassword(decodePart(url.password, "password")) : undefined;
  return {
    host: assertClickHouseHost(url.hostname),
    ...(url.port ? { port: assertPort(url.port, ssl) } : {}),
    database: assertClickHouseName(database, "database"),
    user: assertClickHouseName(user, "user"),
    ...(password !== undefined ? { password } : {}),
    ssl,
  };
}

function textField(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

export function clickhouseSession(config: ClickHouseConnectionConfig): ClickHouseSession {
  const parsed = config.connectionString ? parseUrl(config.connectionString) : undefined;
  const host = textField(config.host);
  const database = textField(config.database);
  const user = textField(config.user);
  const password = textField(config.password);
  if (!parsed && !host) {
    throw new QueryValidationError("Invalid ClickHouse host");
  }
  const ssl = config.ssl ?? parsed?.ssl ?? true;
  return {
    host: host ? assertClickHouseHost(host) : parsed!.host,
    port:
      config.port !== undefined
        ? assertPort(config.port, ssl)
        : (parsed?.port ?? assertPort(undefined, ssl)),
    database: database
      ? assertClickHouseName(database, "database")
      : assertClickHouseName(parsed?.database ?? "", "database"),
    user: user ? assertClickHouseName(user, "user") : assertClickHouseName(parsed?.user ?? "", "user"),
    ...((password ?? parsed?.password) !== undefined
      ? { password: assertPassword((password ?? parsed?.password)!) }
      : {}),
    ssl,
  };
}

export function clickhousePublicSummary(
  config: ClickHouseConnectionConfig,
): Record<string, string | number | boolean> {
  try {
    const session = clickhouseSession(config);
    return {
      host: session.host,
      port: session.port,
      database: session.database,
      user: session.user,
      ssl: session.ssl,
    };
  } catch {
    return { host: "", port: "", database: "", user: "", ssl: false };
  }
}

/** HTTP origin for the official client. Credentials stay out of the URL. */
export function clickhouseEndpoint(session: ClickHouseSession): string {
  const protocol = session.ssl ? "https" : "http";
  const host = session.host.includes(":") ? `[${session.host}]` : session.host;
  return `${protocol}://${host}:${session.port}`;
}
