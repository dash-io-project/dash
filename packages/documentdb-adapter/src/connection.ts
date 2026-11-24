import type { DocumentDbConnectionConfig, DocumentDbReadPreference } from "@dash/core";
import type { MongoClientOptions } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import { AWS_RDS_CA_BUNDLE } from "./aws-ca.ts";

const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const DATABASE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const REPLICA_SET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_URI = 2048;
const MAX_CA_BYTES = 512 * 1024;
const CONTROL = /[\u0000-\u001f\u007f]/;
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

const READ_PREFERENCES = new Set<DocumentDbReadPreference>([
  "primary",
  "primaryPreferred",
  "secondary",
  "secondaryPreferred",
  "nearest",
]);

const AUTH_MECHANISMS = new Set(["SCRAM-SHA-1", "SCRAM-SHA-256"]);

const ALLOWED_PARAMS = new Set([
  "tls",
  "ssl",
  "replicaset",
  "readpreference",
  "retrywrites",
  "retryreads",
  "authsource",
  "authmechanism",
  "directconnection",
]);

const INSECURE_TLS = new Set([
  "tlsinsecure",
  "tlsallowinvalidcertificates",
  "tlsallowinvalidhostnames",
  "sslinsecure",
  "sslallowinvalidcertificates",
  "sslallowinvalidhostnames",
  "sslinvalidhostnameallowed",
]);

const FILE_PARAMS = new Set([
  "tlscafile",
  "tlscertificatekeyfile",
  "tlscertificatefile",
  "tlscrlfile",
  "tlscertificatekeyfilepassword",
  "sslcafile",
  "sslcertificatefile",
  "sslcertificatekeyfile",
  "sslcrlfile",
  "pemkeyfile",
  "pemkeypassword",
]);

export interface DocumentDbSummary {
  host: string;
  port?: number;
  database: string;
  user: string;
  tls: true;
  replicaSet: string;
  readPreference: string;
}

export interface DocumentDbTarget {
  uri: string;
  database: string;
  options: MongoClientOptions;
  summary: DocumentDbSummary;
}

interface ParsedDocumentDbUri {
  database?: string;
  username?: string;
  password?: string;
  authSource?: string;
  replicaSet?: string;
  readPreference?: DocumentDbReadPreference;
  directConnection?: boolean;
  hosts: string[];
}

function assertHost(host: string): string {
  if (host.length === 0 || host.length > 253 || !HOST_NAME.test(host) || host.includes("..")) {
    throw new Error("The DocumentDB host is invalid.");
  }
  return host;
}

function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The DocumentDB port is invalid.");
  }
  return port;
}

function assertDatabase(name: string): string {
  if (!DATABASE_NAME.test(name)) {
    throw new Error("The DocumentDB database name is invalid.");
  }
  return name;
}

function assertCredential(value: string, label: "user" | "password"): string {
  if (value.length > 256 || CONTROL.test(value)) {
    throw new Error(
      label === "user" ? "The DocumentDB user is invalid." : "The DocumentDB password is invalid.",
    );
  }
  return value;
}

function assertReplicaSet(name: string): string {
  if (!REPLICA_SET.test(name)) {
    throw new Error("The DocumentDB replica set name is invalid.");
  }
  return name;
}

function assertReadPreference(value: string): DocumentDbReadPreference {
  if (!READ_PREFERENCES.has(value as DocumentDbReadPreference)) {
    throw new Error("The DocumentDB read preference is invalid.");
  }
  return value as DocumentDbReadPreference;
}

function assertHostEntry(entry: string): void {
  const colon = entry.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(entry.slice(colon + 1))) {
    assertHost(entry.slice(0, colon));
    assertPort(Number(entry.slice(colon + 1)));
    return;
  }
  assertHost(entry);
}

/** Return each PEM certificate. Reject a private key and an empty bundle. */
export function documentDbCaCertificates(pem: string): string[] {
  if (pem.length === 0 || pem.length > MAX_CA_BYTES || pem.includes("\u0000")) {
    throw new Error("The DocumentDB CA bundle is invalid.");
  }
  if (/private key/i.test(pem)) {
    throw new Error("The DocumentDB CA bundle cannot contain a private key.");
  }
  const blocks = pem.match(CERTIFICATE_BLOCK);
  if (!blocks || blocks.length === 0) {
    throw new Error("The DocumentDB CA bundle has no certificate.");
  }
  return blocks.map((block) => block.trim());
}

const AWS_RDS_CA_CERTIFICATES = documentDbCaCertificates(AWS_RDS_CA_BUNDLE);

function caFor(config: DocumentDbConnectionConfig): string[] {
  const custom = config.caBundle?.trim();
  if (!custom) {
    return AWS_RDS_CA_CERTIFICATES;
  }
  return documentDbCaCertificates(custom);
}

function baseOptions(ca: string[]): MongoClientOptions {
  return {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    appName: "dash",
    tls: true,
    ca,
    retryWrites: false,
  };
}

function decodeUserInfo(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parameterValues(url: ConnectionString): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const [key, value] of url.searchParams.entries()) {
    const name = key.toLowerCase();
    const list = values.get(name) ?? [];
    list.push(value);
    values.set(name, list);
  }
  for (const list of values.values()) {
    if (list.length > 1) {
      throw new Error("The DocumentDB connection string repeats a parameter.");
    }
  }
  for (const name of values.keys()) {
    if (INSECURE_TLS.has(name)) {
      throw new Error("The DocumentDB connection string cannot disable TLS verification.");
    }
    if (FILE_PARAMS.has(name)) {
      throw new Error("The DocumentDB connection string cannot set a certificate file path.");
    }
    if (!ALLOWED_PARAMS.has(name)) {
      throw new Error("The DocumentDB connection string has an unsupported parameter.");
    }
  }
  return values;
}

function booleanParam(values: Map<string, string[]>, name: string): boolean | undefined {
  const value = values.get(name)?.[0];
  if (value === undefined) {
    return undefined;
  }
  if (value !== "true" && value !== "false") {
    throw new Error("The DocumentDB connection string has an invalid boolean value.");
  }
  return value === "true";
}

function textParam(values: Map<string, string[]>, name: string): string | undefined {
  const value = values.get(name)?.[0];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function readDocumentDbUri(connectionString: string): ParsedDocumentDbUri {
  if (connectionString.length > MAX_URI) {
    throw new Error("The DocumentDB connection string is too long.");
  }
  if (!/^mongodb:\/\/\S+$/.test(connectionString)) {
    throw new Error("The DocumentDB connection string must use the mongodb:// scheme.");
  }
  let url: ConnectionString;
  try {
    url = new ConnectionString(connectionString);
  } catch {
    throw new Error("The DocumentDB connection string is invalid.");
  }
  if (url.isSRV || url.hosts.length === 0) {
    throw new Error("The DocumentDB connection string must use the mongodb:// scheme.");
  }
  for (const host of url.hosts) {
    assertHostEntry(host);
  }
  const values = parameterValues(url);
  const tls = booleanParam(values, "tls");
  const ssl = booleanParam(values, "ssl");
  if (tls === false || ssl === false || (tls !== undefined && ssl !== undefined && tls !== ssl)) {
    throw new Error("The DocumentDB connection string cannot disable TLS.");
  }
  if (booleanParam(values, "retrywrites") === true) {
    throw new Error("The DocumentDB adapter does not enable retryable writes.");
  }
  booleanParam(values, "retryreads");
  const directConnection = booleanParam(values, "directconnection");
  const replicaSetValue = textParam(values, "replicaset");
  const replicaSet = replicaSetValue ? assertReplicaSet(replicaSetValue) : undefined;
  const readPreferenceValue = textParam(values, "readpreference");
  const readPreference = readPreferenceValue ? assertReadPreference(readPreferenceValue) : undefined;
  const authSourceValue = textParam(values, "authsource");
  const authSource = authSourceValue ? assertDatabase(authSourceValue) : undefined;
  const authMechanism = textParam(values, "authmechanism");
  if (authMechanism !== undefined && !AUTH_MECHANISMS.has(authMechanism)) {
    throw new Error("The DocumentDB connection string has an unsupported auth mechanism.");
  }

  let database: string | undefined;
  const pathname = url.pathname.replace(/^\//, "");
  if (pathname) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new Error("The DocumentDB database name is invalid.");
    }
    if (decoded.includes("/")) {
      throw new Error("The DocumentDB database name is invalid.");
    }
    database = assertDatabase(decoded);
  }

  const username = url.username ? assertCredential(decodeUserInfo(url.username), "user") : undefined;
  const password = url.password ? assertCredential(decodeUserInfo(url.password), "password") : undefined;

  return {
    hosts: [...url.hosts],
    ...(database ? { database } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(authSource ? { authSource } : {}),
    ...(replicaSet ? { replicaSet } : {}),
    ...(readPreference ? { readPreference } : {}),
    ...(directConnection !== undefined ? { directConnection } : {}),
  };
}

function summaryFor(
  host: string,
  port: number | undefined,
  database: string,
  user: string,
  replicaSet: string,
  readPreference: string,
): DocumentDbSummary {
  return {
    host,
    ...(port !== undefined ? { port } : {}),
    database,
    user,
    tls: true,
    replicaSet,
    readPreference,
  };
}

function summaryFromHosts(
  hosts: string[],
  database: string,
  user: string,
  replicaSet: string,
  readPreference: string,
): DocumentDbSummary {
  if (hosts.length === 1) {
    const entry = hosts[0] ?? "";
    const colon = entry.lastIndexOf(":");
    if (colon > 0 && /^\d+$/.test(entry.slice(colon + 1))) {
      return summaryFor(
        entry.slice(0, colon),
        Number(entry.slice(colon + 1)),
        database,
        user,
        replicaSet,
        readPreference,
      );
    }
    return summaryFor(entry, 27017, database, user, replicaSet, readPreference);
  }
  return summaryFor(hosts.join(","), undefined, database, user, replicaSet, readPreference);
}

function disagree(left: string | undefined, right: string | undefined, message: string): void {
  if (left && right && left !== right) {
    throw new Error(message);
  }
}

/**
 * Resolve a connection. Discrete credentials stay in driver options.
 * TLS is on, retryable writes are off, and the CA is the Amazon RDS bundle unless `caBundle` is set.
 */
export function resolveDocumentDbTarget(config: DocumentDbConnectionConfig): DocumentDbTarget {
  const ca = caFor(config);
  const options = baseOptions(ca);

  if (config.connectionString) {
    const parsed = readDocumentDbUri(config.connectionString);
    disagree(
      config.replicaSet,
      parsed.replicaSet,
      "The DocumentDB replica set settings disagree.",
    );
    disagree(
      config.readPreference,
      parsed.readPreference,
      "The DocumentDB read preference settings disagree.",
    );
    disagree(config.authSource, parsed.authSource, "The DocumentDB auth source settings disagree.");
    const replicaSet = config.replicaSet
      ? assertReplicaSet(config.replicaSet)
      : parsed.replicaSet;
    const readPreference = config.readPreference
      ? assertReadPreference(config.readPreference)
      : parsed.readPreference;
    if (parsed.directConnection && replicaSet) {
      throw new Error("The DocumentDB connection cannot set directConnection with a replica set.");
    }
    const database = config.database ? assertDatabase(config.database) : parsed.database;
    if (!database) {
      throw new Error("The DocumentDB database name is required.");
    }
    if (config.authSource) {
      options.authSource = assertDatabase(config.authSource);
    } else if (parsed.username && !parsed.authSource) {
      options.authSource = "admin";
    }
    if (config.replicaSet) {
      options.replicaSet = replicaSet;
    }
    if (config.readPreference) {
      options.readPreference = readPreference;
    }
    return {
      uri: config.connectionString,
      database,
      options,
      summary: summaryFromHosts(
        parsed.hosts,
        database,
        parsed.username ?? "",
        replicaSet ?? "",
        readPreference ?? "",
      ),
    };
  }

  if (!config.host) {
    throw new Error("The DocumentDB host is required.");
  }
  const host = assertHost(config.host);
  const port = assertPort(config.port ?? 27017);
  if (!config.database) {
    throw new Error("The DocumentDB database name is required.");
  }
  const database = assertDatabase(config.database);
  if (config.user) {
    options.auth = {
      username: assertCredential(config.user, "user"),
      password: assertCredential(config.password ?? "", "password"),
    };
    options.authSource = assertDatabase(config.authSource ?? "admin");
  } else if (config.password || config.authSource) {
    throw new Error("The DocumentDB user is required.");
  }
  const replicaSet = config.replicaSet ? assertReplicaSet(config.replicaSet) : undefined;
  const readPreference = config.readPreference
    ? assertReadPreference(config.readPreference)
    : undefined;
  if (replicaSet) {
    options.replicaSet = replicaSet;
  }
  if (readPreference) {
    options.readPreference = readPreference;
  }
  return {
    uri: `mongodb://${host}:${port}`,
    database,
    options,
    summary: summaryFor(host, port, database, config.user ?? "", replicaSet ?? "", readPreference ?? ""),
  };
}

export function parseDocumentDbConnectionString(connectionString: string): { database?: string } {
  const parsed = readDocumentDbUri(connectionString);
  return parsed.database ? { database: parsed.database } : {};
}

export function documentDbSecrets(config: DocumentDbConnectionConfig): string[] {
  const secrets = [config.password, config.connectionString].filter(
    (value): value is string => typeof value === "string" && value.length >= 3,
  );
  if (!config.connectionString) {
    return secrets;
  }
  try {
    const parsed = readDocumentDbUri(config.connectionString);
    if (parsed.password && parsed.password.length >= 3) {
      secrets.push(parsed.password);
    }
  } catch {
    // The connection string is already in the list when it is long enough.
  }
  return secrets;
}

export function documentDbPublicSummary(
  config: DocumentDbConnectionConfig,
): Record<string, string | number | boolean | null> {
  try {
    const summary = resolveDocumentDbTarget(config).summary;
    const record: Record<string, string | number | boolean | null> = {
      host: summary.host,
      database: summary.database,
      user: summary.user,
      tls: true,
      replicaSet: summary.replicaSet,
      readPreference: summary.readPreference,
    };
    if (summary.port !== undefined) {
      record.port = summary.port;
    }
    return record;
  } catch {
    const usingUri = Boolean(config.connectionString) && !config.host;
    return {
      host: usingUri ? "(connection string)" : "",
      database: "",
      user: "",
      tls: true,
      replicaSet: "",
      readPreference: "",
    };
  }
}
