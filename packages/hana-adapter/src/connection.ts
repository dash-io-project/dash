import { QueryValidationError, type HanaConnectionConfig } from "@dash/core";

export const HANA_DEFAULT_PORT = 30015;

const CONNECTION_STRING_MAX = 8192;
const PASSWORD_MAX = 4096;
const KNOWN_PARAMS = new Set(["schema", "encrypt", "sslValidateCertificate"]);
const HOST_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_-]{0,126}$/;
const USER_NAME = /^[A-Za-z_][A-Za-z0-9_.@-]{0,126}$/;

export interface HanaSession {
  host: string;
  port: number;
  database?: string;
  schema?: string;
  user: string;
  password?: string;
  encrypt: boolean;
  validateCertificate: boolean;
}

export interface HanaDriverOptions {
  serverNode: string;
  uid: string;
  pwd?: string;
  databaseName?: string;
  currentSchema?: string;
  encrypt: "true" | "false";
  sslValidateCertificate: "true" | "false";
  connectTimeout: number;
}

export function assertHanaHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || !isHost(normalized)) {
    throw new QueryValidationError("Invalid SAP HANA host");
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
  if (value === undefined || value === "") {
    return HANA_DEFAULT_PORT;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryValidationError("Invalid SAP HANA port");
  }
  return port;
}

function assertHanaName(value: string, label: "database" | "schema"): string {
  if (!IDENT.test(value)) {
    throw new QueryValidationError(`Invalid SAP HANA ${label}`);
  }
  return value;
}

function assertHanaUser(value: string): string {
  if (!USER_NAME.test(value)) {
    throw new QueryValidationError("Invalid SAP HANA user");
  }
  return value;
}

function assertPassword(value: string): string {
  if (value.length > PASSWORD_MAX) {
    throw new QueryValidationError("Invalid SAP HANA password");
  }
  return value;
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new QueryValidationError(`Invalid SAP HANA ${label}`);
  }
}

function textField(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function booleanParam(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new QueryValidationError(`Invalid SAP HANA ${label}`);
}

function flag(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}

function serverNode(host: string, port: number): string {
  const literal = host.includes(":") ? `[${host}]` : host;
  return `${literal}:${port}`;
}

export function parseHanaConnectionString(connectionString: string): HanaSession {
  const raw = connectionString.trim();
  if (!raw) {
    throw new QueryValidationError("SAP HANA connection string is required");
  }
  if (raw.length > CONNECTION_STRING_MAX) {
    throw new QueryValidationError("SAP HANA connection string is too long");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueryValidationError("Invalid SAP HANA connection string");
  }
  if (url.protocol !== "hana:") {
    throw new QueryValidationError("SAP HANA connection string must use the hana:// scheme");
  }
  for (const key of url.searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) {
      throw new QueryValidationError("Unsupported SAP HANA connection parameter");
    }
  }
  for (const key of KNOWN_PARAMS) {
    if (url.searchParams.getAll(key).length > 1) {
      throw new QueryValidationError(`SAP HANA connection parameter \`${key}\` is repeated`);
    }
  }
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (!hostname) {
    throw new QueryValidationError("Invalid SAP HANA host");
  }
  if (!url.username) {
    throw new QueryValidationError("SAP HANA user is required");
  }
  const pathname = url.pathname.replace(/^\//, "");
  if (pathname.includes("/")) {
    throw new QueryValidationError("SAP HANA connection string can include one database");
  }
  const database = pathname ? assertHanaName(decodePart(pathname, "database"), "database") : undefined;
  const schemaParam = url.searchParams.get("schema");
  const schema =
    schemaParam === null || schemaParam === ""
      ? undefined
      : assertHanaName(schemaParam, "schema");
  const encryptParam = url.searchParams.get("encrypt");
  const validateParam = url.searchParams.get("sslValidateCertificate");
  const encrypt = encryptParam === null ? true : booleanParam(encryptParam, "encrypt");
  const validateCertificate =
    validateParam === null ? encrypt : encrypt && booleanParam(validateParam, "sslValidateCertificate");
  const user = assertHanaUser(decodePart(url.username, "user"));
  const password = url.password ? assertPassword(decodePart(url.password, "password")) : undefined;
  return {
    host: assertHanaHost(hostname),
    port: assertPort(url.port || undefined),
    ...(database ? { database } : {}),
    ...(schema ? { schema } : {}),
    user,
    ...(password !== undefined ? { password } : {}),
    encrypt,
    validateCertificate,
  };
}

function resolveEncrypt(explicit: boolean | undefined, fromUri: boolean | undefined): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (fromUri !== undefined) {
    return fromUri;
  }
  return true;
}

function resolveValidate(
  explicit: boolean | undefined,
  fromUri: boolean | undefined,
  encrypt: boolean,
): boolean {
  if (!encrypt) {
    return false;
  }
  if (explicit !== undefined) {
    return explicit;
  }
  if (fromUri !== undefined) {
    return fromUri;
  }
  return true;
}

export function hanaSession(config: HanaConnectionConfig): HanaSession {
  const parsed = config.connectionString
    ? parseHanaConnectionString(config.connectionString)
    : undefined;
  const host = textField(config.host?.trim());
  const database = textField(config.database?.trim());
  const user = textField(config.user?.trim());
  const schema = textField(config.schema?.trim());
  const password = textField(config.password);
  if (!parsed && !host) {
    throw new QueryValidationError("SAP HANA host is required");
  }
  if (!parsed && !user) {
    throw new QueryValidationError("SAP HANA user is required");
  }
  const encrypt = resolveEncrypt(config.encrypt, parsed?.encrypt);
  const validateCertificate = resolveValidate(
    config.sslValidateCertificate,
    parsed?.validateCertificate,
    encrypt,
  );
  const resolvedDatabase = database
    ? assertHanaName(database, "database")
    : parsed?.database;
  const resolvedSchema = schema ? assertHanaName(schema, "schema") : parsed?.schema;
  const resolvedPassword = password ?? parsed?.password;
  return {
    host: host ? assertHanaHost(host) : parsed!.host,
    port: config.port !== undefined ? assertPort(config.port) : (parsed?.port ?? HANA_DEFAULT_PORT),
    ...(resolvedDatabase ? { database: resolvedDatabase } : {}),
    ...(resolvedSchema ? { schema: resolvedSchema } : {}),
    user: user ? assertHanaUser(user) : parsed!.user,
    ...(resolvedPassword !== undefined ? { password: assertPassword(resolvedPassword) } : {}),
    encrypt,
    validateCertificate,
  };
}

/**
 * Build the driver property bag. The driver accepts encrypt flags as the
 * strings true and false. Unknown driver properties stay out of this object.
 */
export function hanaDriverOptions(session: HanaSession): HanaDriverOptions {
  return {
    serverNode: serverNode(session.host, session.port),
    uid: session.user,
    ...(session.password !== undefined ? { pwd: session.password } : {}),
    ...(session.database !== undefined ? { databaseName: session.database } : {}),
    ...(session.schema !== undefined ? { currentSchema: session.schema } : {}),
    encrypt: flag(session.encrypt),
    sslValidateCertificate: flag(session.validateCertificate),
    connectTimeout: 10_000,
  };
}

export function hanaPublicSummary(
  config: HanaConnectionConfig,
): Record<string, string | number | boolean> {
  try {
    const session = hanaSession(config);
    return {
      host: session.host,
      port: session.port,
      database: session.database ?? "",
      schema: session.schema ?? "",
      user: session.user,
      encrypt: session.encrypt,
    };
  } catch {
    return {
      host: "",
      port: "",
      database: "",
      schema: "",
      user: "",
      encrypt: true,
    };
  }
}
