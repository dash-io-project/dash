import { QueryValidationError, type OracleConnectionConfig } from "@dash/core";

export const ORACLE_DEFAULT_PORT = 1521;
const ORACLE_CLOUD_PORT = 1522;

const CONNECTION_STRING_MAX = 8192;
const PASSWORD_MAX = 1024;
const SERVICE_MAX = 256;

const CLOUD_SUFFIXES = [".oraclecloud.com", ".oraclegovcloud.com", ".oraclegovcloud.uk"];

const HOST_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.$-]{0,255}$/;
const SID_NAME = /^[A-Za-z][A-Za-z0-9_$#]{0,63}$/;
const USER_NAME = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;

const URL_PARAMS = new Set(["ssl", "sid"]);
const EASY_PARAMS = new Set(["ssl_server_dn_match"]);

const CONTAINER_KEYS = new Set([
  "description",
  "address",
  "address_list",
  "connect_data",
  "security",
  "failover_mode",
]);

const IGNORED_KEYS = new Set([
  "retry_count",
  "retry_delay",
  "expire_time",
  "transport_connect_timeout",
  "failover",
  "load_balance",
  "source_route",
  "enable",
  "sdu",
  "recv_buf_size",
  "send_buf_size",
  "type",
  "method",
  "retries",
  "delay",
]);

export interface OracleSession {
  host: string;
  port: number;
  service?: string;
  sid?: string;
  user: string;
  password: string;
  ssl: boolean;
  cloud: boolean;
  connectString: string;
}

interface ParsedOracle {
  host?: string;
  port?: number;
  service?: string;
  sid?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

interface DescriptorGroup {
  name: string;
  value?: string;
  children?: DescriptorGroup[];
}

export function isOracleCloudHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  return CLOUD_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function assertPort(value: string | number | undefined): number {
  if (value === undefined || value === "") {
    return ORACLE_DEFAULT_PORT;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryValidationError("Invalid Oracle port");
  }
  return port;
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

export function assertOracleHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || normalized.includes("%") || !isHost(normalized)) {
    throw new QueryValidationError("Invalid Oracle host");
  }
  return normalized;
}

function assertService(value: string): string {
  const service = value.trim();
  if (!service || service.length > SERVICE_MAX || !SERVICE_NAME.test(service)) {
    throw new QueryValidationError("Invalid Oracle service name");
  }
  return service;
}

function assertSid(value: string): string {
  const sid = value.trim();
  if (!SID_NAME.test(sid)) {
    throw new QueryValidationError("Invalid Oracle SID");
  }
  return sid;
}

function assertUser(value: string): string {
  if (!USER_NAME.test(value)) {
    throw new QueryValidationError("Invalid Oracle user");
  }
  return value;
}

function assertPassword(value: string): string {
  if (!value || value.length > PASSWORD_MAX) {
    throw new QueryValidationError("Invalid Oracle password");
  }
  return value;
}

function textField(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new QueryValidationError(`Invalid Oracle ${label}`);
  }
}

function parseBoolean(value: string, label: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "1":
    case "on":
      return true;
    case "false":
    case "no":
    case "0":
    case "off":
      return false;
    default:
      throw new QueryValidationError(`Invalid Oracle ${label}`);
  }
}

function skipSpace(source: string, index: { i: number }): void {
  while (index.i < source.length && /\s/.test(source[index.i] ?? "")) {
    index.i += 1;
  }
}

function readKey(source: string, index: { i: number }): string {
  const start = index.i;
  while (index.i < source.length && /[A-Za-z0-9_]/.test(source[index.i] ?? "")) {
    index.i += 1;
  }
  if (index.i === start) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  return source.slice(start, index.i);
}

function parseGroup(source: string, index: { i: number }): DescriptorGroup {
  skipSpace(source, index);
  if (source[index.i] !== "(") {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  index.i += 1;
  skipSpace(source, index);
  const name = readKey(source, index);
  skipSpace(source, index);
  if (source[index.i] !== "=") {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  index.i += 1;
  skipSpace(source, index);
  if (source[index.i] === "(") {
    const children: DescriptorGroup[] = [];
    while (source[index.i] === "(") {
      children.push(parseGroup(source, index));
      skipSpace(source, index);
    }
    if (source[index.i] !== ")") {
      throw new QueryValidationError("Invalid Oracle connection string");
    }
    index.i += 1;
    return { name, children };
  }
  const start = index.i;
  while (index.i < source.length && source[index.i] !== ")") {
    index.i += 1;
  }
  if (source[index.i] !== ")") {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  const value = source.slice(start, index.i).trim();
  index.i += 1;
  if (!value) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  return { name, value };
}

function collectDescriptor(
  group: DescriptorGroup,
  parsed: ParsedOracle,
  flags: { dnMatch: boolean },
): void {
  const name = group.name.toLowerCase();
  if (group.value !== undefined) {
    switch (name) {
      case "protocol": {
        const protocol = group.value.toLowerCase();
        if (protocol !== "tcp" && protocol !== "tcps") {
          throw new QueryValidationError("Unsupported Oracle connection parameter");
        }
        const ssl = protocol === "tcps";
        if (flags.dnMatch && !ssl) {
          return;
        }
        if (parsed.ssl !== undefined && parsed.ssl !== ssl) {
          throw new QueryValidationError("Invalid Oracle connection string");
        }
        parsed.ssl = ssl;
        return;
      }
      case "host": {
        const host = assertOracleHost(group.value);
        if (parsed.host && parsed.host !== host) {
          throw new QueryValidationError("Oracle connection string can include one host");
        }
        parsed.host = host;
        return;
      }
      case "port": {
        const port = assertPort(group.value);
        if (parsed.port !== undefined && parsed.port !== port) {
          throw new QueryValidationError("Invalid Oracle connection string");
        }
        parsed.port = port;
        return;
      }
      case "service_name": {
        if (parsed.service || parsed.sid) {
          throw new QueryValidationError("Oracle connection string can include one service name");
        }
        parsed.service = assertService(group.value);
        return;
      }
      case "sid": {
        if (parsed.service || parsed.sid) {
          throw new QueryValidationError("Oracle connection string can include one service name");
        }
        parsed.sid = assertSid(group.value);
        return;
      }
      case "ssl_server_dn_match": {
        if (!parseBoolean(group.value, "ssl_server_dn_match")) {
          throw new QueryValidationError("Oracle TLS requires server name verification");
        }
        flags.dnMatch = true;
        parsed.ssl = true;
        return;
      }
      default:
        if (!IGNORED_KEYS.has(name)) {
          throw new QueryValidationError("Unsupported Oracle connection parameter");
        }
        return;
    }
  }
  if (!CONTAINER_KEYS.has(name)) {
    throw new QueryValidationError("Unsupported Oracle connection parameter");
  }
  for (const child of group.children ?? []) {
    collectDescriptor(child, parsed, flags);
  }
}

function parseDescriptor(source: string): ParsedOracle {
  const index = { i: 0 };
  const group = parseGroup(source, index);
  skipSpace(source, index);
  if (index.i !== source.length || group.name.toLowerCase() !== "description") {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  const parsed: ParsedOracle = {};
  collectDescriptor(group, parsed, { dnMatch: false });
  return parsed;
}

function applyEasyParams(raw: string): { connect: string; ssl?: boolean } {
  const query = raw.indexOf("?");
  if (query === -1) {
    return { connect: raw };
  }
  const params = new URLSearchParams(raw.slice(query + 1));
  const seen = new Set<string>();
  for (const key of params.keys()) {
    const normalized = key.toLowerCase();
    if (!EASY_PARAMS.has(normalized) || seen.has(normalized) || params.getAll(key).length > 1) {
      throw new QueryValidationError("Unsupported Oracle connection parameter");
    }
    seen.add(normalized);
  }
  const match = params.get("ssl_server_dn_match");
  if (match !== null && !parseBoolean(match, "ssl_server_dn_match")) {
    throw new QueryValidationError("Oracle TLS requires server name verification");
  }
  return {
    connect: raw.slice(0, query),
    ...(match !== null ? { ssl: true } : {}),
  };
}

function splitAuthority(authority: string): { host: string; port?: number } {
  if (!authority || authority.includes(" ") || authority.includes("/")) {
    throw new QueryValidationError("Invalid Oracle host");
  }
  const colon = authority.lastIndexOf(":");
  if (colon > 0 && authority.indexOf(":") === colon) {
    return {
      host: assertOracleHost(authority.slice(0, colon)),
      port: assertPort(authority.slice(colon + 1)),
    };
  }
  return { host: assertOracleHost(authority) };
}

function parseEasyConnect(connect: string, ssl: boolean): ParsedOracle {
  let raw = connect.trim();
  if (raw.toLowerCase().startsWith("tcps://")) {
    ssl = true;
    raw = raw.slice("tcps://".length);
  } else if (raw.toLowerCase().startsWith("tcp://")) {
    raw = raw.slice("tcp://".length);
  }
  if (raw.startsWith("//")) {
    raw = raw.slice(2);
  }
  const applied = applyEasyParams(raw);
  raw = applied.connect;
  if (applied.ssl) {
    ssl = true;
  }
  const slash = raw.indexOf("/");
  if (slash <= 0 || raw.includes("(", 0)) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  const service = raw.slice(slash + 1);
  if (!service || service.includes("/")) {
    throw new QueryValidationError("Oracle connection string can include one service name");
  }
  const authority = splitAuthority(raw.slice(0, slash));
  return {
    host: authority.host,
    ...(authority.port !== undefined ? { port: authority.port } : {}),
    service: assertService(service),
    ...(ssl ? { ssl } : {}),
  };
}

function parseSidConnect(connect: string): ParsedOracle | undefined {
  const parts = connect.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return undefined;
  }
  if (!/^\d+$/.test(parts[1]) || parts[2].includes("/")) {
    return undefined;
  }
  return {
    host: assertOracleHost(parts[0]),
    port: assertPort(parts[1]),
    sid: assertSid(parts[2]),
  };
}

function parseConnect(connect: string): ParsedOracle {
  const raw = connect.trim();
  if (!raw) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  if (raw.startsWith("(")) {
    return parseDescriptor(raw);
  }
  if (raw.includes("/")) {
    return parseEasyConnect(raw, false);
  }
  const sid = parseSidConnect(raw);
  if (sid) {
    return sid;
  }
  throw new QueryValidationError("Invalid Oracle connection string");
}

function splitJdbcCredentials(body: string): {
  user?: string;
  password?: string;
  connect: string;
} {
  if (body.startsWith("@")) {
    return { connect: body.slice(1) };
  }
  const at = body.lastIndexOf("@");
  if (at <= 0) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  const credentials = body.slice(0, at);
  const slash = credentials.indexOf("/");
  if (slash <= 0) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  return {
    user: credentials.slice(0, slash),
    password: credentials.slice(slash + 1),
    connect: body.slice(at + 1),
  };
}

function parseJdbc(raw: string): ParsedOracle {
  const marker = "jdbc:oracle:thin:";
  const body = raw.slice(marker.length).trim();
  const parts = splitJdbcCredentials(body);
  const parsed = parseConnect(parts.connect);
  if (parts.user !== undefined) {
    parsed.user = assertUser(parts.user);
  }
  if (parts.password !== undefined) {
    parsed.password = assertPassword(parts.password);
  }
  return parsed;
}

function parseUrl(raw: string): ParsedOracle {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  if (url.protocol !== "oracle:") {
    throw new QueryValidationError("Oracle connection string must use the oracle:// scheme");
  }
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (!URL_PARAMS.has(normalized)) {
      throw new QueryValidationError("Unsupported Oracle connection parameter");
    }
    if (seen.has(normalized) || url.searchParams.getAll(key).length > 1) {
      throw new QueryValidationError("Invalid Oracle connection string");
    }
    seen.add(normalized);
  }
  if (!url.hostname) {
    throw new QueryValidationError("Invalid Oracle host");
  }
  const pathname = url.pathname.replace(/^\//, "");
  if (pathname.includes("/")) {
    throw new QueryValidationError("Oracle connection string can include one service name");
  }
  const parsed: ParsedOracle = {
    host: assertOracleHost(url.hostname),
    ...(url.port ? { port: assertPort(url.port) } : {}),
  };
  const sid = url.searchParams.get("sid");
  if (pathname && sid) {
    throw new QueryValidationError("Oracle connection string can include one service name");
  }
  if (pathname) {
    parsed.service = assertService(decodePart(pathname, "service name"));
  }
  if (sid !== null) {
    parsed.sid = assertSid(sid);
  }
  if (url.username) {
    parsed.user = assertUser(decodePart(url.username, "user"));
  }
  if (url.password) {
    parsed.password = assertPassword(decodePart(url.password, "password"));
  }
  const ssl = url.searchParams.get("ssl");
  if (ssl !== null) {
    parsed.ssl = parseBoolean(ssl, "ssl");
  }
  return parsed;
}

export function parseOracleConnectionString(connectionString: string): ParsedOracle {
  const raw = connectionString.trim();
  if (!raw) {
    throw new QueryValidationError("Oracle connection string is required");
  }
  if (raw.length > CONNECTION_STRING_MAX || /[\u0000-\u001f]/.test(raw)) {
    throw new QueryValidationError("Invalid Oracle connection string");
  }
  if (raw.toLowerCase().startsWith("jdbc:oracle:thin:")) {
    return parseJdbc(raw);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !raw.toLowerCase().startsWith("oracle://")) {
    if (!raw.toLowerCase().startsWith("tcps://") && !raw.toLowerCase().startsWith("tcp://")) {
      throw new QueryValidationError("Oracle connection string must use the oracle:// scheme");
    }
  }
  if (raw.toLowerCase().startsWith("oracle://")) {
    return parseUrl(raw);
  }
  if (
    raw.startsWith("(") ||
    raw.toLowerCase().startsWith("tcps://") ||
    raw.toLowerCase().startsWith("tcp://") ||
    raw.includes("/")
  ) {
    return parseConnect(raw);
  }
  const sid = parseSidConnect(raw);
  if (sid) {
    return sid;
  }
  throw new QueryValidationError("Oracle connection string must use the oracle:// scheme");
}

function resolveSsl(explicit: boolean | undefined, parsed: boolean | undefined, cloud: boolean): boolean {
  const value = explicit ?? parsed ?? cloud;
  if (cloud && !value) {
    throw new QueryValidationError("Oracle Cloud requires TLS");
  }
  return value;
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

export function oracleConnectString(session: {
  host: string;
  port: number;
  service?: string;
  sid?: string;
  ssl: boolean;
}): string {
  if (session.service && session.sid) {
    throw new QueryValidationError("Oracle connection string can include one service name");
  }
  if (session.service) {
    const host = formatHost(session.host);
    if (session.ssl) {
      return `tcps://${host}:${session.port}/${session.service}?ssl_server_dn_match=yes`;
    }
    return `${host}:${session.port}/${session.service}`;
  }
  if (session.sid) {
    const protocol = session.ssl ? "tcps" : "tcp";
    const security = session.ssl ? "(security=(ssl_server_dn_match=yes))" : "";
    return `(description=(address=(protocol=${protocol})(host=${session.host})(port=${session.port}))(connect_data=(sid=${session.sid}))${security})`;
  }
  throw new QueryValidationError("Oracle service name is required");
}

export function oracleSession(config: OracleConnectionConfig): OracleSession {
  const raw = config.connectionString?.trim();
  const parsed = raw ? parseOracleConnectionString(raw) : undefined;
  const hostText = textField(config.host);
  const host = hostText ? assertOracleHost(hostText) : parsed?.host;
  if (!host) {
    throw new QueryValidationError("Invalid Oracle host");
  }
  const cloud = isOracleCloudHost(host);
  const serviceText = textField(config.database);
  const service = serviceText ? assertService(serviceText) : parsed?.service;
  const sid = service ? undefined : parsed?.sid;
  if (!service && !sid) {
    throw new QueryValidationError("Oracle service name is required");
  }
  const userText = textField(config.user) ?? parsed?.user;
  if (!userText) {
    throw new QueryValidationError("Oracle user is required");
  }
  const passwordText = textField(config.password) ?? parsed?.password;
  if (!passwordText) {
    throw new QueryValidationError("Oracle password is required");
  }
  const ssl = resolveSsl(config.ssl, parsed?.ssl, cloud);
  const port =
    config.port !== undefined
      ? assertPort(config.port)
      : (parsed?.port ?? (cloud ? ORACLE_CLOUD_PORT : ORACLE_DEFAULT_PORT));
  const session: OracleSession = {
    host,
    port,
    user: assertUser(userText),
    password: assertPassword(passwordText),
    ssl,
    cloud,
    connectString: "",
  };
  if (service) {
    session.service = service;
  }
  if (sid) {
    session.sid = sid;
  }
  session.connectString = oracleConnectString(session);
  return session;
}

export function oraclePublicSummary(
  config: OracleConnectionConfig,
): Record<string, string | number | boolean> {
  try {
    const session = oracleSession(config);
    return {
      host: session.host,
      port: session.port,
      database: session.service ?? session.sid ?? "",
      user: session.user,
      ssl: session.ssl,
      cloud: session.cloud,
    };
  } catch {
    return {
      host: config.connectionString ? "(connection string)" : (config.host ?? ""),
      database: "",
      user: "",
      ssl: false,
      cloud: false,
    };
  }
}
