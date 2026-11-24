import { QueryValidationError } from "@dash/core";
import type { CockroachConnectionConfig } from "@dash/core";

export const COCKROACH_DEFAULT_PORT = 26257;

const CONNECTION_STRING_MAX = 8192;
const PASSWORD_MAX = 4096;
const CA_MAX = 64 * 1024;
const KNOWN_PARAMS = new Set(["ssl", "sslmode", "options"]);
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const USER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/;
const CLUSTER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const SCHEMES = new Set(["cockroachdb:", "cockroach:", "postgres:", "postgresql:"]);

export type CockroachTlsMode = "off" | "require" | "verify-ca" | "verify-full";

export interface CockroachSession {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  /** True when the session encrypts the wire. */
  ssl: boolean;
  tls: CockroachTlsMode;
  cluster?: string;
  sslCa?: string;
}

export function assertCockroachHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || !isHost(normalized)) {
    throw new QueryValidationError("Invalid CockroachDB host");
  }
  return normalized;
}

function isHost(value: string): boolean {
  if (value === "localhost" || value === "::1") {
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
  return HOST_NAME.test(value);
}

function assertPort(value: string | number | undefined): number {
  if (value === undefined) {
    return COCKROACH_DEFAULT_PORT;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryValidationError("Invalid CockroachDB port");
  }
  return port;
}

function assertDatabase(value: string): string {
  if (!NAME.test(value)) {
    throw new QueryValidationError("Invalid CockroachDB database");
  }
  return value;
}

function assertUser(value: string): string {
  if (!USER_NAME.test(value)) {
    throw new QueryValidationError("Invalid CockroachDB user");
  }
  return value;
}

function assertPassword(value: string): string {
  if (value.length > PASSWORD_MAX) {
    throw new QueryValidationError("Invalid CockroachDB password");
  }
  return value;
}

function assertCluster(value: string): string {
  if (value.includes("--") || !CLUSTER_NAME.test(value)) {
    throw new QueryValidationError("Invalid CockroachDB cluster");
  }
  return value;
}

export function assertCockroachCa(value: string): string {
  const pem = value.trim();
  if (
    pem.length === 0 ||
    pem.length > CA_MAX ||
    pem.includes("PRIVATE KEY") ||
    !pem.includes("-----BEGIN CERTIFICATE-----") ||
    !pem.includes("-----END CERTIFICATE-----")
  ) {
    throw new QueryValidationError("Invalid CockroachDB CA certificate");
  }
  return pem;
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new QueryValidationError(`Invalid CockroachDB ${label}`);
  }
}

function modeFromSslFlag(ssl: string): CockroachTlsMode {
  const normalized = ssl.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return "verify-full";
  }
  if (normalized === "false" || normalized === "0") {
    return "off";
  }
  throw new QueryValidationError("Invalid CockroachDB ssl parameter");
}

function modeFromSslMode(sslmode: string): CockroachTlsMode {
  switch (sslmode.toLowerCase()) {
    case "disable":
      return "off";
    case "require":
      return "require";
    case "verify-ca":
      return "verify-ca";
    case "verify-full":
      return "verify-full";
    default:
      throw new QueryValidationError("Invalid CockroachDB sslmode");
  }
}

function sslFromParams(params: URLSearchParams): CockroachTlsMode | undefined {
  for (const key of KNOWN_PARAMS) {
    if (params.getAll(key).length > 1) {
      throw new QueryValidationError("CockroachDB connection parameter is repeated");
    }
  }
  const ssl = params.get("ssl");
  const sslmode = params.get("sslmode");
  const fromSsl = ssl === null ? undefined : modeFromSslFlag(ssl);
  const fromMode = sslmode === null ? undefined : modeFromSslMode(sslmode);
  if (fromSsl !== undefined && fromMode !== undefined && (fromSsl === "off") !== (fromMode === "off")) {
    throw new QueryValidationError("CockroachDB ssl and sslmode disagree");
  }
  return fromMode ?? fromSsl;
}

function clusterFromParams(params: URLSearchParams): string | undefined {
  const options = params.get("options");
  if (options === null) {
    return undefined;
  }
  const prefix = "--cluster=";
  if (!options.startsWith(prefix)) {
    throw new QueryValidationError("Unsupported CockroachDB connection parameter");
  }
  return assertCluster(options.slice(prefix.length));
}

function resolveTls(
  explicit: boolean | undefined,
  fromUri: CockroachTlsMode | undefined,
): CockroachTlsMode {
  if (explicit === false) {
    return "off";
  }
  if (explicit === true) {
    if (fromUri && fromUri !== "off") {
      return fromUri;
    }
    return "verify-full";
  }
  return fromUri ?? "verify-full";
}

function sessionFrom(parts: Omit<CockroachSession, "ssl">): CockroachSession {
  return { ...parts, ssl: parts.tls !== "off" };
}

export function parseCockroachConnectionString(connectionString: string): CockroachSession {
  const raw = connectionString.trim();
  if (!raw) {
    throw new QueryValidationError("CockroachDB connection string is required");
  }
  if (raw.length > CONNECTION_STRING_MAX) {
    throw new QueryValidationError("CockroachDB connection string is too long");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueryValidationError("Invalid CockroachDB connection string");
  }
  if (!SCHEMES.has(url.protocol)) {
    throw new QueryValidationError(
      "CockroachDB connection string must use the cockroachdb://, cockroach://, postgres://, or postgresql:// scheme",
    );
  }
  if (url.hash) {
    throw new QueryValidationError("Invalid CockroachDB connection string");
  }
  for (const key of url.searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) {
      throw new QueryValidationError("Unsupported CockroachDB connection parameter");
    }
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new QueryValidationError("Invalid CockroachDB host");
  }
  const path = url.pathname;
  if (!path.startsWith("/") || path.slice(1).includes("/")) {
    throw new QueryValidationError("Invalid CockroachDB database");
  }
  if (!url.username) {
    throw new QueryValidationError("CockroachDB user is required");
  }
  const database = assertDatabase(decodePart(path.slice(1), "database"));
  const user = assertUser(decodePart(url.username, "user"));
  const password = url.password ? assertPassword(decodePart(url.password, "password")) : undefined;
  const tls = sslFromParams(url.searchParams) ?? "verify-full";
  const cluster = clusterFromParams(url.searchParams);
  return sessionFrom({
    host: assertCockroachHost(hostname),
    port: assertPort(url.port || undefined),
    database,
    user,
    ...(password !== undefined ? { password } : {}),
    ...(cluster !== undefined ? { cluster } : {}),
    tls,
  });
}

function textField(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

export function cockroachSession(config: CockroachConnectionConfig): CockroachSession {
  const uri = textField(config.connectionString?.trim());
  const parsed = uri ? parseCockroachConnectionString(uri) : undefined;
  const host = textField(config.host?.trim());
  const database = textField(config.database?.trim());
  const user = textField(config.user?.trim());
  const password = textField(config.password);
  const cluster = textField(config.cluster?.trim());
  const sslCa = textField(config.sslCa);
  if (!parsed && !host) {
    throw new QueryValidationError("Invalid CockroachDB host");
  }
  const tls = resolveTls(config.ssl, parsed?.tls);
  const resolvedCluster = cluster ?? parsed?.cluster;
  return sessionFrom({
    host: host ? assertCockroachHost(host) : parsed!.host,
    port: config.port !== undefined ? assertPort(config.port) : (parsed?.port ?? assertPort(undefined)),
    database: database ? assertDatabase(database) : assertDatabase(parsed?.database ?? ""),
    user: user ? assertUser(user) : assertUser(parsed?.user ?? ""),
    ...((password ?? parsed?.password) !== undefined
      ? { password: assertPassword((password ?? parsed?.password)!) }
      : {}),
    ...(resolvedCluster !== undefined ? { cluster: assertCluster(resolvedCluster) } : {}),
    ...(sslCa !== undefined ? { sslCa: assertCockroachCa(sslCa) } : {}),
    tls,
  });
}

export function cockroachPublicSummary(
  config: CockroachConnectionConfig,
): Record<string, string | number | boolean> {
  try {
    const session = cockroachSession(config);
    return {
      host: session.host,
      port: session.port,
      database: session.database,
      user: session.user,
      ssl: session.ssl,
      cluster: session.cluster ?? "",
      customCa: Boolean(session.sslCa),
    };
  } catch {
    return {
      host: "",
      port: "",
      database: "",
      user: "",
      ssl: false,
      cluster: "",
      customCa: false,
    };
  }
}
