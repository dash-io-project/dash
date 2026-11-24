import {
  QueryValidationError,
  assertIdentifier,
  type Db2ConnectionConfig,
} from "@dash/core";

export const DB2_DEFAULT_PORT = 50000;

const CONNECTION_STRING_MAX = 8192;
const PASSWORD_MAX = 4096;
const IDENTIFIER_MAX = 128;
const KNOWN_PARAMS = new Set(["schema", "ssl"]);
const HOST_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DATABASE_NAME = /^[A-Z][A-Z0-9@#$]{0,7}$/;
const USER_NAME = /^[A-Za-z][A-Za-z0-9@#$_]{0,127}$/;

export interface Db2Session {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  schema?: string;
  ssl: boolean;
}

export function assertDb2Identifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || name.length > IDENTIFIER_MAX) {
    throw new QueryValidationError("Invalid Db2 identifier");
  }
  return name;
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

export function assertDb2Host(host: string): string {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  if (!normalized || normalized.length > 253 || !isHost(normalized)) {
    throw new QueryValidationError("Invalid Db2 host");
  }
  return normalized;
}

function assertPort(value: string | number | undefined): number {
  if (value === undefined || value === "") {
    return DB2_DEFAULT_PORT;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryValidationError("Invalid Db2 port");
  }
  return port;
}

function assertDatabase(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!DATABASE_NAME.test(normalized)) {
    throw new QueryValidationError("Invalid Db2 database");
  }
  return normalized;
}

function assertUser(value: string): string {
  if (!USER_NAME.test(value)) {
    throw new QueryValidationError("Invalid Db2 user");
  }
  return value;
}

function assertPassword(value: string): string {
  if (value.length > PASSWORD_MAX || /[\u0000\r\n]/.test(value)) {
    throw new QueryValidationError("Invalid Db2 password");
  }
  return value;
}

function assertSchema(value: string): string {
  try {
    assertIdentifier(value, "Db2 schema");
  } catch {
    throw new QueryValidationError("Invalid Db2 schema");
  }
  return assertDb2Identifier(value);
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new QueryValidationError("Invalid Db2 connection string");
  }
}

function sslFromValue(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new QueryValidationError("Invalid Db2 ssl parameter");
}

function textField(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseDb2ConnectionString(connectionString: string): Db2Session {
  const raw = connectionString.trim();
  if (!raw) {
    throw new QueryValidationError("Db2 connection string is required");
  }
  if (raw.length > CONNECTION_STRING_MAX) {
    throw new QueryValidationError("Db2 connection string is too long");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueryValidationError("Invalid Db2 connection string");
  }
  if (url.protocol !== "db2:") {
    throw new QueryValidationError("Db2 connection string must use the db2:// scheme");
  }
  if (url.hash) {
    throw new QueryValidationError("Invalid Db2 connection string");
  }
  for (const key of url.searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) {
      throw new QueryValidationError("Unsupported Db2 connection parameter");
    }
  }
  for (const key of KNOWN_PARAMS) {
    if (url.searchParams.getAll(key).length > 1) {
      throw new QueryValidationError(`Db2 connection parameter \`${key}\` is repeated`);
    }
  }
  if (!url.hostname) {
    throw new QueryValidationError("Invalid Db2 host");
  }
  const database = decodePart(url.pathname.replace(/^\//, ""));
  if (!database || database.includes("/")) {
    throw new QueryValidationError("Invalid Db2 database");
  }
  if (!url.username) {
    throw new QueryValidationError("Db2 user is required");
  }
  const user = decodePart(url.username);
  const password = url.password ? assertPassword(decodePart(url.password)) : undefined;
  const schemaValue = url.searchParams.get("schema");
  const sslValue = url.searchParams.get("ssl");
  return {
    host: assertDb2Host(url.hostname),
    port: assertPort(url.port || undefined),
    database: assertDatabase(database),
    user: assertUser(user),
    ...(password !== undefined ? { password } : {}),
    ...(schemaValue ? { schema: assertSchema(decodePart(schemaValue)) } : {}),
    ssl: sslValue === null ? false : sslFromValue(sslValue),
  };
}

export function db2Session(config: Db2ConnectionConfig): Db2Session {
  const parsed = config.connectionString
    ? parseDb2ConnectionString(config.connectionString)
    : undefined;
  const host = textField(config.host);
  const database = textField(config.database);
  const user = textField(config.user);
  const password = textField(config.password);
  const schema = textField(config.schema);
  if (!parsed && !host) {
    throw new QueryValidationError("Invalid Db2 host");
  }
  const resolvedPassword = password ?? parsed?.password;
  const resolvedSchema = schema ?? parsed?.schema;
  return {
    host: host ? assertDb2Host(host) : parsed!.host,
    port: config.port !== undefined ? assertPort(config.port) : (parsed?.port ?? DB2_DEFAULT_PORT),
    database: database ? assertDatabase(database) : assertDatabase(parsed?.database ?? ""),
    user: user ? assertUser(user) : assertUser(parsed?.user ?? ""),
    ...(resolvedPassword !== undefined ? { password: assertPassword(resolvedPassword) } : {}),
    ...(resolvedSchema !== undefined ? { schema: assertSchema(resolvedSchema) } : {}),
    ssl: config.ssl ?? parsed?.ssl ?? false,
  };
}

/** Brace a CLI value so `;` and `}` stay inside one keyword. */
export function db2CliValue(value: string): string {
  if (value.length === 0 || /[;{}]/.test(value) || value !== value.trim()) {
    return `{${value.replaceAll("}", "}}")}}`;
  }
  return value;
}

export function db2ConnectionString(session: Db2Session): string {
  const parts = [
    `DATABASE=${db2CliValue(session.database)}`,
    `HOSTNAME=${db2CliValue(session.host)}`,
    `PORT=${session.port}`,
    "PROTOCOL=TCPIP",
    `UID=${db2CliValue(session.user)}`,
  ];
  if (session.password !== undefined) {
    parts.push(`PWD=${db2CliValue(session.password)}`);
  }
  if (session.ssl) {
    parts.push("Security=SSL");
  }
  parts.push("ConnectTimeout=10", "QueryTimeout=60");
  return parts.join(";");
}

export function db2PublicSummary(
  config: Db2ConnectionConfig,
): Record<string, string | number | boolean> {
  try {
    const session = db2Session(config);
    return {
      host: session.host,
      port: session.port,
      database: session.database,
      user: session.user,
      schema: session.schema ?? "",
      ssl: session.ssl,
    };
  } catch {
    return { host: "", port: "", database: "", user: "", schema: "", ssl: false };
  }
}
