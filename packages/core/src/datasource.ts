import type { DataSourceKind } from "./adapter.ts";

export interface DataSourceRecord {
  id: string;
  name: string;
  kind: DataSourceKind;
  description: string;
  /** Public, non-secret connection hints for the UI. */
  summary: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface PostgresConnectionConfig {
  kind: "postgres";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface MysqlConnectionConfig {
  kind: "mysql";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface MariadbConnectionConfig {
  kind: "mariadb";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface Db2ConnectionConfig {
  kind: "db2";
  connectionString?: string;
  host?: string;
  port?: number;
  /** Database name. Db2 stores at most 8 characters. */
  database?: string;
  user?: string;
  password?: string;
  /** Default schema for an unqualified table or view. */
  schema?: string;
  ssl?: boolean;
}

export interface SnowflakeConnectionConfig {
  kind: "snowflake";
  connectionString?: string;
  account?: string;
  user?: string;
  password?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
  authenticator?: string;
}

export interface MongoConnectionConfig {
  kind: "mongodb";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Authentication database. Defaults to `admin` when a user is set without a connection string. */
  authSource?: string;
  tls?: boolean;
}

export type DocumentDbReadPreference =
  | "primary"
  | "primaryPreferred"
  | "secondary"
  | "secondaryPreferred"
  | "nearest";

export interface DocumentDbConnectionConfig {
  kind: "documentdb";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Authentication database. The default is `admin` when a user is set. */
  authSource?: string;
  /** Replica set name. Amazon DocumentDB clusters use `rs0`. */
  replicaSet?: string;
  /** Read preference. Amazon DocumentDB samples use `secondaryPreferred`. */
  readPreference?: DocumentDbReadPreference;
  /**
   * PEM CA bundle. Omit this field to use the Amazon RDS global bundle.
   * The text replaces that bundle. It cannot contain a private key.
   */
  caBundle?: string;
}

export interface DatabricksConnectionConfig {
  kind: "databricks";
  connectionString?: string;
  /** Workspace host, such as `adb-123.azuredatabricks.net` or `127.0.0.1`. */
  host?: string;
  /** SQL warehouse HTTP path, `/sql/1.0/warehouses/{id}`. */
  httpPath?: string;
  /** Personal access token. Sent only to the workspace host. */
  token?: string;
  /** Unity Catalog catalog. Unqualified resources use this with `schema`. */
  catalog?: string;
  schema?: string;
  /**
   * API origin. Cloud warehouses use `https://{host}`.
   * The local emulator is `http://127.0.0.1:14439`.
   * The origin host must match `host`.
   */
  apiEndpoint?: string;
}

export interface RedshiftConnectionConfig {
  kind: "redshift";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Encrypt the session and verify the server certificate. */
  ssl?: boolean;
}

export interface StripeConnectionConfig {
  kind: "stripe";
  connectionString?: string;
  /** Secret or restricted key. Sent only to the Stripe API origin. */
  apiKey?: string;
  /**
   * API origin. Cloud accounts use `https://api.stripe.com`.
   * The local fixture is `http://127.0.0.1:12119`.
   * `http` is accepted only for a loopback host.
   */
  apiEndpoint?: string;
}

export interface OpenSearchConnectionConfig {
  kind: "opensearch";
  /**
   * Node origin, such as `https://search-domain.us-east-1.es.amazonaws.com`
   * or `http://127.0.0.1:9209`. `http` is accepted only for a loopback host.
   * Put the user and password in `username` and `password`, not in this URL.
   */
  node?: string;
  /**
   * `https://[user[:password]@]host[:port][?region=&service=]`.
   * `opensearch://` means `https://`. `http` is accepted only for a loopback host.
   * The only query keys are `region` and `service` (`es` or `aoss`).
   */
  connectionString?: string;
  /** Basic auth user. Do not set this when `region` is set. */
  username?: string;
  password?: string;
  /** When set, each request is signed with AWS SigV4. Do not also set basic auth. */
  region?: string;
  /** `es` for Amazon OpenSearch Service. `aoss` for OpenSearch Serverless. Default `es`. */
  service?: "es" | "aoss";
  /** Static AWS credentials. Omit both keys to use the default credential chain. */
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface BigQueryConnectionConfig {
  kind: "bigquery";
  projectId: string;
  /** Default dataset. Unqualified resources are `dataset.table`. */
  dataset?: string;
  /** BigQuery location, such as `US` or `us-central1`. */
  location?: string;
  /**
   * Service account key fields. Omit to use Application Default Credentials.
   * The private key stays inside the encrypted data-source config.
   */
  credentials?: {
    client_email: string;
    private_key: string;
  };
  /**
   * API origin. The local emulator is `http://127.0.0.1:9059`.
   * Non-Google hosts are called without an access token.
   */
  apiEndpoint?: string;
}

export type ConnectionConfig =
  | PostgresConnectionConfig
  | MysqlConnectionConfig
  | MariadbConnectionConfig
  | Db2ConnectionConfig
  | SnowflakeConnectionConfig
  | MongoConnectionConfig
  | DocumentDbConnectionConfig
  | BigQueryConnectionConfig
  | DatabricksConnectionConfig
  | RedshiftConnectionConfig
  | StripeConnectionConfig
  | OpenSearchConnectionConfig;
