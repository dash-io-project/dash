import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Dashboard, DataSourceRecord } from "@dash/core";
import { api } from "~/lib/api";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { parseBigQueryUri } from "~/lib/bigquery-uri";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Select, type SelectOption } from "~/components/Select";
import { Button, Field, TextArea, TextInput, Badge, EmptyState } from "~/components/ui";
import { fetchMe } from "~/lib/session";

function serviceAccountCredentials(raw: string):
  | { client_email: string; private_key: string }
  | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Service account JSON is invalid");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Service account JSON must include client_email and private_key");
  }
  const record = parsed as { client_email?: unknown; private_key?: unknown };
  if (typeof record.client_email !== "string" || typeof record.private_key !== "string") {
    throw new Error("Service account JSON must include client_email and private_key");
  }
  return { client_email: record.client_email, private_key: record.private_key };
}

export const Route = createFileRoute("/_authed/data-sources")({
  component: DataSourcesPage,
});

type SourceKind =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "db2"
  | "hana"
  | "snowflake"
  | "mongodb"
  | "documentdb"
  | "bigquery"
  | "databricks"
  | "redshift"
  | "stripe"
  | "opensearch"
  | "cockroachdb"
  | "couchbase"
  | "neo4j"
  | "cassandra"
  | "oracle"
  | "clickhouse"
  | "dynamodb"
  | "elasticsearch";

type ReadPreference =
  | "primary"
  | "primaryPreferred"
  | "secondary"
  | "secondaryPreferred"
  | "nearest";

const KIND_OPTIONS: SelectOption<SourceKind>[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "cockroachdb", label: "CockroachDB" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "db2", label: "IBM Db2" },
  { value: "hana", label: "SAP HANA" },
  { value: "oracle", label: "Oracle Database" },
  { value: "redshift", label: "Amazon Redshift" },
  { value: "clickhouse", label: "ClickHouse" },
  { value: "snowflake", label: "Snowflake" },
  { value: "mongodb", label: "MongoDB" },
  { value: "documentdb", label: "Amazon DocumentDB" },
  { value: "bigquery", label: "Google BigQuery" },
  { value: "databricks", label: "Databricks SQL" },
  { value: "stripe", label: "Stripe" },
  { value: "opensearch", label: "Amazon OpenSearch" },
  { value: "couchbase", label: "Couchbase" },
  { value: "neo4j", label: "Neo4j" },
  { value: "cassandra", label: "Apache Cassandra" },
  { value: "dynamodb", label: "Amazon DynamoDB" },
  { value: "elasticsearch", label: "Elasticsearch" },
];

const READ_PREFERENCE_OPTIONS: SelectOption<ReadPreference>[] = [
  { value: "primary", label: "primary" },
  { value: "primaryPreferred", label: "primaryPreferred" },
  { value: "secondary", label: "secondary" },
  { value: "secondaryPreferred", label: "secondaryPreferred" },
  { value: "nearest", label: "nearest" },
];

const URI_PLACEHOLDER: Record<SourceKind, string> = {
  postgres: "postgres://user:password@localhost:5432/analytics",
  cockroachdb: "cockroachdb://user:password@host:26257/defaultdb?sslmode=verify-full",
  mysql: "mysql://user:password@localhost:3306/analytics",
  mariadb: "mariadb://user:password@localhost:3306/analytics",
  db2: "db2://db2inst1:password@localhost:50000/DASH?schema=DASH",
  hana: "hana://user:password@host:30015/DB?schema=ANALYTICS&encrypt=true&sslValidateCertificate=true",
  oracle: "oracle://user:password@db.adb.region.oraclecloud.com:1522/service_high.adb.oraclecloud.com",
  redshift: "redshift://user:password@cluster.redshift.amazonaws.com:5439/analytics?sslmode=require",
  clickhouse: "https://user:password@host.clickhouse.cloud:8443/analytics",
  snowflake: "snowflake://user:password@account/database/schema?warehouse=COMPUTE_WH",
  mongodb: "mongodb://user:password@host:27017/analytics?authSource=admin",
  documentdb:
    "mongodb://user:password@cluster.us-east-1.docdb.amazonaws.com:27017/analytics?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false",
  bigquery: "bigquery://project/dataset?location=US&endpoint=http://127.0.0.1:9059",
  databricks:
    "databricks://token:dapi000@adb-000.0.azuredatabricks.net/sql/1.0/warehouses/abc?catalog=main&schema=default",
  stripe: "stripe://sk_test_000@api.stripe.com",
  opensearch: "https://user:password@search-domain.us-east-1.es.amazonaws.com?region=us-east-1",
  couchbase: "couchbase://user:password@127.0.0.1:11210/bucket?scope=_default",
  neo4j: "bolt://user:password@localhost:7687",
  cassandra: "cassandra://user:password@127.0.0.1:9042/analytics?dc=datacenter1",
  dynamodb: "dynamodb://accessKeyId:secretAccessKey@us-east-1",
  elasticsearch: "https://user:password@host:9200",
};

function tlsFromElasticsearchUri(value: string): boolean | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "elasticsearch:") {
      return true;
    }
    if (url.protocol === "http:") {
      return false;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sslFromDb2Uri(value: string): boolean | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "db2:") {
      return undefined;
    }
    const ssl = url.searchParams.get("ssl")?.toLowerCase();
    if (ssl === "true" || ssl === "1") {
      return true;
    }
    if (ssl === "false" || ssl === "0") {
      return false;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sslFromRedshiftUri(value: string): boolean | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    const ssl = url.searchParams.get("ssl")?.toLowerCase();
    const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
    if (sslmode === "disable" || ssl === "false" || ssl === "0") {
      return false;
    }
    if (
      sslmode === "require" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full" ||
      ssl === "true" ||
      ssl === "1"
    ) {
      return true;
    }
    return true;
  } catch {
    return undefined;
  }
}

function oracleCloudHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  return [".oraclecloud.com", ".oraclegovcloud.com", ".oraclegovcloud.uk"].some((suffix) =>
    normalized.endsWith(suffix),
  );
}

function sslFromOracleUri(value: string): boolean | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/oraclecloud\.com|oraclegovcloud\.(?:com|uk)/i.test(trimmed)) {
    return true;
  }
  if (/(?:^|@)tcps:\/\//i.test(trimmed) || /protocol\s*=\s*tcps/i.test(trimmed)) {
    return true;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "oracle:") {
      return undefined;
    }
    const ssl = url.searchParams.get("ssl")?.toLowerCase();
    if (ssl === "false" || ssl === "0" || ssl === "no") {
      return false;
    }
    if (ssl === "true" || ssl === "1" || ssl === "yes") {
      return true;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sslFromClickHouseUri(value: string): boolean | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") {
      return true;
    }
    if (url.protocol === "http:") {
      return false;
    }
    const ssl = url.searchParams.get("ssl")?.toLowerCase();
    if (ssl === "false" || ssl === "0") {
      return false;
    }
    if (ssl === "true" || ssl === "1" || url.protocol === "clickhouse:") {
      return true;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function ConnectionUriField({
  kind,
  value,
  onChange,
}: {
  kind: SourceKind;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Connection URI">
      <TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={URI_PLACEHOLDER[kind]}
        required
        rows={3}
        spellCheck={false}
        autoComplete="off"
        className="min-h-16 font-mono text-[13px]"
      />
    </Field>
  );
}

function ConnectionModeToggle({
  usingUri,
  onChange,
}: {
  usingUri: boolean;
  onChange: (usingUri: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="link"
      onClick={() => onChange(!usingUri)}
    >
      {usingUri ? "Enter fields instead" : "Paste a connection URI instead"}
    </button>
  );
}

const emptyForm = {
  name: "",
  description: "",
  kind: "postgres" as SourceKind,
  host: "localhost",
  port: "5432",
  database: "",
  user: "postgres",
  password: "",
  ssl: false,
  encryption: false,
  tls: false,
  authSource: "admin",
  connectionString: "",
  useConnectionString: true,
  account: "",
  warehouse: "",
  schema: "PUBLIC",
  role: "",
  projectId: "",
  bqDataset: "",
  location: "",
  apiEndpoint: "",
  serviceAccountJson: "",
  httpPath: "",
  token: "",
  catalog: "",
  apiKey: "",
  cloudId: "",
  node: "",
  region: "",
  osService: "es" as "es" | "aoss",
  accessKeyId: "",
  secretAccessKey: "",
  sessionToken: "",
  replicaSet: "",
  readPreference: "secondaryPreferred" as ReadPreference,
  caBundle: "",
  encrypt: true,
  validateCertificate: true,
  cluster: "",
  sslCa: "",
  bucket: "",
  scope: "_default",
  keyspace: "",
  localDataCenter: "datacenter1",
};

function DataSourcesPage() {
  const { workspace, workspaceApi } = useWorkspace();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const sources = useQuery({
    queryKey: ["data-sources"],
    queryFn: async () => {
      const payload = await api<{ dataSources: DataSourceRecord[] }>("/api/data-sources");
      return payload.dataSources;
    },
  });
  const dashboards = useQuery({
    queryKey: ["dashboards", workspace.id],
    queryFn: async () => {
      const payload = await workspaceApi<{ dashboards: Dashboard[] }>("/api/dashboards");
      return payload.dashboards;
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DataSourceRecord | null>(null);

  const isAdmin = me.data?.role === "admin";

  const create = useMutation({
    mutationFn: async () => {
      const config =
        form.kind === "bigquery"
          ? {
              kind: "bigquery" as const,
              ...(form.useConnectionString
                ? parseBigQueryUri(form.connectionString)
                : {
                    projectId: form.projectId.trim(),
                    dataset: form.bqDataset.trim() || undefined,
                    location: form.location.trim() || undefined,
                    apiEndpoint: form.apiEndpoint.trim() || undefined,
                  }),
              credentials: serviceAccountCredentials(form.serviceAccountJson),
            }
          : form.kind === "snowflake"
            ? form.useConnectionString
              ? {
                  kind: "snowflake" as const,
                  connectionString: form.connectionString.trim(),
                }
              : {
                  kind: "snowflake" as const,
                  account: form.account,
                  user: form.user,
                  password: form.password,
                  warehouse: form.warehouse,
                  database: form.database,
                  schema: form.schema,
                  role: form.role || undefined,
                }
            : form.kind === "mongodb"
              ? form.useConnectionString
                ? {
                    kind: "mongodb" as const,
                    connectionString: form.connectionString.trim(),
                    database: form.database.trim() || undefined,
                    tls: form.tls,
                  }
                : {
                    kind: "mongodb" as const,
                    host: form.host,
                    port: Number(form.port),
                    database: form.database,
                    user: form.user || undefined,
                    password: form.password || undefined,
                    authSource: form.user ? form.authSource || "admin" : undefined,
                    tls: form.tls,
                  }
              : form.kind === "documentdb"
                ? form.useConnectionString
                  ? {
                      kind: "documentdb" as const,
                      connectionString: form.connectionString.trim(),
                      database: form.database.trim() || undefined,
                      caBundle: form.caBundle.trim() || undefined,
                    }
                  : {
                      kind: "documentdb" as const,
                      host: form.host,
                      port: Number(form.port),
                      database: form.database,
                      user: form.user || undefined,
                      password: form.password || undefined,
                      authSource: form.user ? form.authSource || "admin" : undefined,
                      replicaSet: form.replicaSet.trim() || undefined,
                      readPreference: form.readPreference,
                      caBundle: form.caBundle.trim() || undefined,
                    }
                : form.kind === "mysql" || form.kind === "mariadb"
                ? form.useConnectionString
                  ? {
                      kind: form.kind,
                      connectionString: form.connectionString.trim(),
                      ssl: form.ssl,
                    }
                  : {
                      kind: form.kind,
                      host: form.host,
                      port: Number(form.port),
                      database: form.database,
                      user: form.user,
                      password: form.password,
                      ssl: form.ssl,
                    }
                : form.kind === "redshift"
                  ? form.useConnectionString
                    ? {
                        kind: "redshift" as const,
                        connectionString: form.connectionString.trim(),
                        ssl: form.ssl,
                      }
                    : {
                        kind: "redshift" as const,
                        host: form.host,
                        port: Number(form.port),
                        database: form.database,
                        user: form.user,
                        password: form.password,
                        ssl: form.ssl,
                      }
                  : form.kind === "clickhouse"
                    ? form.useConnectionString
                      ? {
                          kind: "clickhouse" as const,
                          connectionString: form.connectionString.trim(),
                          ssl: form.ssl,
                        }
                      : {
                          kind: "clickhouse" as const,
                          host: form.host,
                          port: Number(form.port),
                          database: form.database,
                          user: form.user,
                          password: form.password,
                          ssl: form.ssl,
                        }
                  : form.kind === "db2"
                    ? form.useConnectionString
                      ? {
                          kind: "db2" as const,
                          connectionString: form.connectionString.trim(),
                          ssl: form.ssl,
                        }
                      : {
                          kind: "db2" as const,
                          host: form.host,
                          port: Number(form.port),
                          database: form.database,
                          user: form.user,
                          password: form.password,
                          schema: form.schema.trim() || undefined,
                          ssl: form.ssl,
                        }
                  : form.kind === "oracle"
                    ? form.useConnectionString
                      ? {
                          kind: "oracle" as const,
                          connectionString: form.connectionString.trim(),
                          ssl: form.ssl,
                        }
                      : {
                          kind: "oracle" as const,
                          host: form.host,
                          port: Number(form.port),
                          database: form.database,
                          user: form.user,
                          password: form.password,
                          ssl: form.ssl,
                        }
                  : form.kind === "cockroachdb"
                    ? form.useConnectionString
                      ? {
                          kind: "cockroachdb" as const,
                          connectionString: form.connectionString.trim(),
                          ssl: form.ssl,
                          sslCa: form.sslCa.trim() || undefined,
                        }
                      : {
                          kind: "cockroachdb" as const,
                          host: form.host,
                          port: Number(form.port),
                          database: form.database,
                          user: form.user,
                          password: form.password,
                          ssl: form.ssl,
                          cluster: form.cluster.trim() || undefined,
                          sslCa: form.sslCa.trim() || undefined,
                        }
                  : form.kind === "databricks"
                    ? form.useConnectionString
                      ? {
                          kind: "databricks" as const,
                          connectionString: form.connectionString.trim(),
                        }
                      : {
                          kind: "databricks" as const,
                          host: form.host.trim(),
                          httpPath: form.httpPath.trim(),
                          token: form.token,
                          catalog: form.catalog.trim(),
                          schema: form.schema.trim() || undefined,
                          apiEndpoint: form.apiEndpoint.trim() || undefined,
                        }
                    : form.kind === "stripe"
                      ? form.useConnectionString
                        ? {
                            kind: "stripe" as const,
                            connectionString: form.connectionString.trim(),
                          }
                        : {
                            kind: "stripe" as const,
                            apiKey: form.apiKey,
                            apiEndpoint: form.apiEndpoint.trim() || undefined,
                          }
                    : form.kind === "opensearch"
                      ? form.useConnectionString
                        ? {
                            kind: "opensearch" as const,
                            connectionString: form.connectionString.trim(),
                          }
                        : {
                            kind: "opensearch" as const,
                            node: form.node.trim(),
                            username: form.user.trim() || undefined,
                            password: form.password || undefined,
                            region: form.region.trim() || undefined,
                            service: form.region.trim() ? form.osService : undefined,
                            accessKeyId: form.accessKeyId.trim() || undefined,
                            secretAccessKey: form.secretAccessKey || undefined,
                            sessionToken: form.sessionToken || undefined,
                          }
                    : form.kind === "hana"
                      ? form.useConnectionString
                        ? {
                            kind: "hana" as const,
                            connectionString: form.connectionString.trim(),
                          }
                        : {
                            kind: "hana" as const,
                            host: form.host.trim(),
                            port: Number(form.port),
                            database: form.database.trim() || undefined,
                            schema: form.schema.trim() || undefined,
                            user: form.user.trim(),
                            password: form.password || undefined,
                            encrypt: form.encrypt,
                            sslValidateCertificate: form.validateCertificate,
                          }
                    : form.kind === "couchbase"
                      ? form.useConnectionString
                        ? {
                            kind: "couchbase" as const,
                            connectionString: form.connectionString.trim(),
                            ...(form.tls ? { tls: true } : {}),
                          }
                        : {
                            kind: "couchbase" as const,
                            host: form.host.trim(),
                            port: Number(form.port),
                            bucket: form.bucket.trim(),
                            scope: form.scope.trim() || undefined,
                            user: form.user,
                            password: form.password,
                            ...(form.tls ? { tls: true } : {}),
                          }
                    : form.kind === "neo4j"
                      ? form.useConnectionString
                        ? {
                            kind: "neo4j" as const,
                            connectionString: form.connectionString.trim(),
                          }
                        : {
                            kind: "neo4j" as const,
                            host: form.host,
                            port: Number(form.port),
                            database: form.database,
                            user: form.user,
                            password: form.password,
                            encryption: form.encryption,
                          }
                    : form.kind === "cassandra"
                      ? form.useConnectionString
                        ? {
                            kind: "cassandra" as const,
                            connectionString: form.connectionString.trim(),
                            ssl: form.ssl,
                          }
                        : {
                            kind: "cassandra" as const,
                            host: form.host,
                            port: Number(form.port),
                            keyspace: form.keyspace.trim() || undefined,
                            localDataCenter: form.localDataCenter.trim() || undefined,
                            user: form.user || undefined,
                            password: form.password || undefined,
                            ssl: form.ssl,
                          }
                    : form.kind === "elasticsearch"
                      ? form.useConnectionString
                        ? {
                            kind: "elasticsearch" as const,
                            connectionString: form.connectionString.trim(),
                            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
                            tls: form.tls,
                          }
                        : {
                            kind: "elasticsearch" as const,
                            ...(form.cloudId.trim()
                              ? { cloudId: form.cloudId.trim() }
                              : { host: form.host, port: Number(form.port) }),
                            ...(form.apiKey.trim()
                              ? { apiKey: form.apiKey.trim() }
                              : {
                                  user: form.user || undefined,
                                  password: form.password || undefined,
                                }),
                            tls: form.tls,
                          }
                    : form.kind === "dynamodb"
                      ? form.useConnectionString
                        ? {
                            kind: "dynamodb" as const,
                            connectionString: form.connectionString.trim(),
                            ...(form.sessionToken.trim()
                              ? { sessionToken: form.sessionToken.trim() }
                              : {}),
                          }
                        : {
                            kind: "dynamodb" as const,
                            region: form.region.trim(),
                            accessKeyId: form.accessKeyId.trim(),
                            secretAccessKey: form.secretAccessKey,
                            ...(form.sessionToken.trim()
                              ? { sessionToken: form.sessionToken.trim() }
                              : {}),
                            ...(form.apiEndpoint.trim()
                              ? { endpoint: form.apiEndpoint.trim() }
                              : {}),
                          }
                : form.useConnectionString
                  ? {
                      kind: "postgres" as const,
                      connectionString: form.connectionString.trim(),
                      ssl: form.ssl,
                    }
                  : {
                      kind: "postgres" as const,
                      host: form.host,
                      port: Number(form.port),
                      database: form.database,
                      user: form.user,
                      password: form.password,
                      ssl: form.ssl,
                    };
      return api<{ dataSource: DataSourceRecord }>("/api/data-sources", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          config,
        }),
      });
    },
    onSuccess: async () => {
      setOpen(false);
      setForm(emptyForm);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["data-sources"] });
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : "Could not add data source");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api(`/api/data-sources/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["data-sources"] });
    },
  });

  function usageCount(sourceId: string): number {
    return (dashboards.data ?? []).reduce(
      (count, dashboard) =>
        count + dashboard.widgets.filter((widget) => widget.dataSourceId === sourceId).length,
      0,
    );
  }

  function openAdd() {
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Add a warehouse for dashboards and MCP, or remove one that is no longer needed."
        actions={
          isAdmin ? (
            <Button variant="primary" type="button" onClick={openAdd}>
              Add data source
            </Button>
          ) : null
        }
      />
      <PageBody className="space-y-6">
      <p className="max-w-3xl text-muted-foreground">
        Paste a connection URI, or enter the fields. Dash tests Postgres, MySQL, MariaDB, CockroachDB, IBM Db2,
        SAP HANA, Oracle, Snowflake, MongoDB, Amazon DocumentDB, BigQuery, Databricks SQL, Redshift, Stripe,
        OpenSearch, Couchbase, Neo4j, Cassandra, ClickHouse, and DynamoDB on save.
        {isAdmin ? null : " Only administrators can add or remove sources."}
      </p>

      {sources.isLoading ? (
        <p className="text-muted-foreground">Loading data sources…</p>
      ) : (sources.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No data sources yet."
          action={
            isAdmin ? (
              <Button variant="primary" type="button" onClick={openAdd}>
                Add data source
              </Button>
            ) : null
          }
        >
          Add a connection for PostgreSQL, MySQL, MariaDB, CockroachDB, IBM Db2, SAP HANA, Oracle, Snowflake, MongoDB, BigQuery, Databricks SQL, Redshift, OpenSearch, Couchbase, Neo4j, or Cassandra.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(sources.data ?? []).map((source) => {
            const widgets = usageCount(source.id);
            return (
              <article key={source.id} className="card flex min-w-0 flex-col p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 truncate font-semibold">{source.name}</h2>
                  <Badge>{source.kind}</Badge>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">{source.description || "No description"}</p>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
                  {Object.entries(source.summary).map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd className="truncate" title={String(value)}>
                        {String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <p className="tabular text-xs text-muted-foreground">
                    {widgets === 0
                      ? "Not used in this workspace"
                      : `Used by ${widgets} widget${widgets === 1 ? "" : "s"} in this workspace`}
                  </p>
                  {isAdmin ? (
                    <Button size="sm" className="text-negative" type="button" onClick={() => setPendingDelete(source)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      </PageBody>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-backdrop p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-data-source-title"
            className="max-h-[90dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <h2 id="add-data-source-title" className="text-base font-semibold">Add data source</h2>
            <Field label="Name">
              <TextInput
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Production analytics"
                required
              />
            </Field>
            <Field label="Description">
              <TextArea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="What this warehouse is for"
              />
            </Field>
            <Field label="Kind">
              <Select
                value={form.kind}
                options={KIND_OPTIONS}
                onValueChange={(kind) => {
                  const enteringDatabricks = kind === "databricks" && form.kind !== "databricks";
                  setForm({
                    ...form,
                    kind,
                    connectionString: "",
                    ssl: kind === "redshift" || kind === "cockroachdb" || kind === "clickhouse",
                    encryption: kind === "neo4j" ? form.encryption : false,
                    encrypt: kind === "hana" ? true : form.encrypt,
                    validateCertificate: kind === "hana" ? true : form.validateCertificate,
                    port:
                      kind === "mongodb" || kind === "documentdb"
                        ? "27017"
                        : kind === "postgres"
                          ? "5432"
                          : kind === "mysql" || kind === "mariadb"
                            ? "3306"
                            : kind === "redshift"
                              ? "5439"
                              : kind === "db2"
                                ? "50000"
                                : kind === "hana"
                                  ? "30015"
                                  : kind === "cockroachdb"
                                    ? "26257"
                                    : kind === "couchbase"
                                      ? "11210"
                                      : kind === "neo4j"
                                        ? "7687"
                                        : kind === "cassandra"
                                          ? "9042"
                                          : kind === "oracle"
                                            ? "1521"
                                            : kind === "clickhouse"
                                              ? "8443"
                                              : kind === "elasticsearch"
                                                ? "9200"
                                                : form.port,
                    tls: kind === "elasticsearch" ? true : form.tls,
                    cloudId: kind === "elasticsearch" ? form.cloudId : "",
                    user:
                      kind === "postgres"
                        ? "postgres"
                        : kind === "cockroachdb"
                          ? "root"
                          : kind === "neo4j" && (form.user === "postgres" || form.user === "root" || form.user === "")
                            ? "neo4j"
                            : form.user === "postgres" || form.user === "root"
                              ? ""
                              : form.user,
                    database: kind === "neo4j" && form.database.trim() === "" ? "neo4j" : form.database,
                    schema:
                      kind === "hana"
                        ? ""
                        : kind === "snowflake"
                          ? form.schema || "PUBLIC"
                          : enteringDatabricks
                            ? form.schema === "public" || form.schema === "PUBLIC" || !form.schema
                              ? "default"
                              : form.schema
                            : form.schema,
                    host:
                      kind === "hana" && form.host.trim() === ""
                        ? "localhost"
                        : enteringDatabricks && form.host.trim() === "localhost"
                          ? ""
                          : form.host,
                    apiEndpoint: kind === form.kind ? form.apiEndpoint : "",
                    apiKey: kind === form.kind ? form.apiKey : "",
                    node: "",
                    region: kind === "dynamodb" ? form.region || "us-east-1" : "",
                    osService: "es",
                    accessKeyId: "",
                    secretAccessKey: "",
                    sessionToken: "",
                    authSource: form.authSource || "admin",
                    localDataCenter:
                      kind === "cassandra" ? form.localDataCenter || "datacenter1" : form.localDataCenter,
                    useConnectionString: true,
                  });
                }}
              />
            </Field>
            {form.kind === "postgres" ||
            form.kind === "mysql" ||
            form.kind === "mariadb" ||
            form.kind === "redshift" ||
            form.kind === "db2" ||
            form.kind === "cockroachdb" ||
            form.kind === "clickhouse" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind={form.kind}
                    value={form.connectionString}
                    onChange={(connectionString) => {
                      const ssl =
                        form.kind === "redshift" || form.kind === "cockroachdb"
                          ? sslFromRedshiftUri(connectionString)
                          : form.kind === "db2"
                            ? sslFromDb2Uri(connectionString)
                            : form.kind === "clickhouse"
                              ? sslFromClickHouseUri(connectionString)
                              : undefined;
                      if (
                        form.kind !== "redshift" &&
                        form.kind !== "db2" &&
                        form.kind !== "cockroachdb" &&
                        form.kind !== "clickhouse"
                      ) {
                        setForm({ ...form, connectionString });
                        return;
                      }
                      setForm({
                        ...form,
                        connectionString,
                        ...(ssl === undefined ? {} : { ssl }),
                      });
                    }}
                  />
                ) : null}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                {form.useConnectionString ? null : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Database">
                        <TextInput
                          value={form.database}
                          onChange={(event) =>
                            setForm({ ...form, database: event.target.value })
                          }
                          required
                        />
                      </Field>
                    </div>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          setForm({ ...form, password: event.target.value })
                        }
                      />
                    </Field>
                    {form.kind === "db2" ? (
                      <Field label="Schema">
                        <TextInput
                          value={form.schema}
                          onChange={(event) => setForm({ ...form, schema: event.target.value })}
                          placeholder="Optional. Use the catalog name."
                        />
                      </Field>
                    ) : null}
                    {form.kind === "cockroachdb" ? (
                      <Field label="Cluster">
                        <TextInput
                          value={form.cluster}
                          onChange={(event) => setForm({ ...form, cluster: event.target.value })}
                          placeholder="Optional serverless cluster"
                        />
                      </Field>
                    ) : null}
                  </>
                )}
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.ssl}
                    onChange={(event) => setForm({ ...form, ssl: event.target.checked })}
                  />
                  {form.kind === "cockroachdb"
                    ? "Require TLS and verify the server certificate"
                    : form.kind === "redshift"
                      ? "Require SSL and verify the server certificate"
                      : form.kind === "clickhouse"
                        ? "Use HTTPS"
                        : "Use SSL"}
                </label>
                {form.kind === "clickhouse" ? (
                  <p className="text-[13px] text-muted-foreground">
                    ClickHouse Cloud uses HTTPS on port 8443. Plain HTTP is port 8123.
                  </p>
                ) : null}
                {form.kind === "cockroachdb" ? (
                  <Field label="CA certificate">
                    <TextArea
                      value={form.sslCa}
                      onChange={(event) => setForm({ ...form, sslCa: event.target.value })}
                      placeholder="Optional PEM for a private CA"
                      rows={3}
                      spellCheck={false}
                      className="min-h-16 font-mono text-[13px]"
                    />
                  </Field>
                ) : null}
              </>
            ) : form.kind === "oracle" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="oracle"
                    value={form.connectionString}
                    onChange={(connectionString) => {
                      const ssl = sslFromOracleUri(connectionString);
                      setForm({
                        ...form,
                        connectionString,
                        ...(ssl === undefined ? {} : { ssl }),
                      });
                    }}
                  />
                ) : null}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                {form.useConnectionString ? null : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => {
                            const host = event.target.value;
                            const cloud = oracleCloudHost(host);
                            setForm({
                              ...form,
                              host,
                              port: cloud
                                ? form.port === "1521" || form.port === ""
                                  ? "1522"
                                  : form.port
                                : form.port === "1522"
                                  ? "1521"
                                  : form.port,
                              ssl: cloud ? true : form.ssl,
                            });
                          }}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Service name">
                        <TextInput
                          value={form.database}
                          onChange={(event) => setForm({ ...form, database: event.target.value })}
                          placeholder="FREEPDB1"
                          required
                        />
                      </Field>
                    </div>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                      />
                    </Field>
                  </>
                )}
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.ssl}
                    onChange={(event) => setForm({ ...form, ssl: event.target.checked })}
                  />
                  Use TLS
                </label>
                <p className="text-muted-foreground">
                  Oracle Cloud requires TLS and uses port 1522 when the port is omitted. The service
                  name is the Easy Connect service, such as FREEPDB1.
                </p>
              </>
            ) : form.kind === "snowflake" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="snowflake"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : null}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                {form.useConnectionString ? null : (
                  <>
                    <Field label="Account">
                      <TextInput
                        value={form.account}
                        onChange={(event) => setForm({ ...form, account: event.target.value })}
                        placeholder="xy12345.us-east-1"
                        required
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Warehouse">
                        <TextInput
                          value={form.warehouse}
                          onChange={(event) =>
                            setForm({ ...form, warehouse: event.target.value })
                          }
                          placeholder="COMPUTE_WH"
                          required
                        />
                      </Field>
                      <Field label="Database">
                        <TextInput
                          value={form.database}
                          onChange={(event) =>
                            setForm({ ...form, database: event.target.value })
                          }
                          required
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Schema">
                        <TextInput
                          value={form.schema}
                          onChange={(event) =>
                            setForm({ ...form, schema: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Role">
                        <TextInput
                          value={form.role}
                          onChange={(event) => setForm({ ...form, role: event.target.value })}
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          setForm({ ...form, password: event.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
              </>
            ) : form.kind === "mongodb" ? (
              <>
                {form.useConnectionString ? (
                  <>
                    <ConnectionUriField
                      kind="mongodb"
                      value={form.connectionString}
                      onChange={(connectionString) => setForm({ ...form, connectionString })}
                    />
                    <Field label="Database">
                      <TextInput
                        value={form.database}
                        onChange={(event) =>
                          setForm({ ...form, database: event.target.value })
                        }
                        placeholder="Required when the URI has no database"
                      />
                    </Field>
                  </>
                ) : null}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                {form.useConnectionString ? null : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Database">
                        <TextInput
                          value={form.database}
                          onChange={(event) =>
                            setForm({ ...form, database: event.target.value })
                          }
                          required
                        />
                      </Field>
                    </div>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        placeholder="Optional"
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          setForm({ ...form, password: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Auth database">
                      <TextInput
                        value={form.authSource}
                        onChange={(event) =>
                          setForm({ ...form, authSource: event.target.value })
                        }
                        placeholder="admin"
                      />
                    </Field>
                  </>
                )}
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.tls}
                    onChange={(event) => setForm({ ...form, tls: event.target.checked })}
                  />
                  Use TLS
                </label>
              </>
            ) : form.kind === "documentdb" ? (
              <>
                {form.useConnectionString ? (
                  <>
                    <ConnectionUriField
                      kind="documentdb"
                      value={form.connectionString}
                      onChange={(connectionString) => setForm({ ...form, connectionString })}
                    />
                    <Field label="Database">
                      <TextInput
                        value={form.database}
                        onChange={(event) =>
                          setForm({ ...form, database: event.target.value })
                        }
                        placeholder="Required when the URI has no database"
                      />
                    </Field>
                  </>
                ) : null}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                {form.useConnectionString ? null : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Database">
                        <TextInput
                          value={form.database}
                          onChange={(event) =>
                            setForm({ ...form, database: event.target.value })
                          }
                          required
                        />
                      </Field>
                    </div>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        placeholder="Optional"
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          setForm({ ...form, password: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Auth database">
                      <TextInput
                        value={form.authSource}
                        onChange={(event) =>
                          setForm({ ...form, authSource: event.target.value })
                        }
                        placeholder="admin"
                      />
                    </Field>
                    <Field label="Replica set">
                      <TextInput
                        value={form.replicaSet}
                        onChange={(event) => setForm({ ...form, replicaSet: event.target.value })}
                        placeholder="rs0"
                      />
                    </Field>
                    <Field label="Read preference">
                      <Select
                        value={form.readPreference}
                        options={READ_PREFERENCE_OPTIONS}
                        onValueChange={(readPreference) => setForm({ ...form, readPreference })}
                      />
                    </Field>
                  </>
                )}
                <Field label="CA bundle PEM">
                  <TextArea
                    value={form.caBundle}
                    onChange={(event) => setForm({ ...form, caBundle: event.target.value })}
                    placeholder="Optional. Leave empty for the Amazon RDS global bundle."
                    rows={3}
                    spellCheck={false}
                    className="min-h-16 font-mono text-[13px]"
                  />
                  <p className="text-[13px] text-muted-foreground">
                    TLS is required. Leave the CA bundle empty to use the Amazon RDS bundle. For a
                    cluster, set the replica set to rs0.
                  </p>
                </Field>
              </>
            ) : form.kind === "bigquery" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="bigquery"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <Field label="Project ID">
                      <TextInput
                        value={form.projectId}
                        onChange={(event) => setForm({ ...form, projectId: event.target.value })}
                        placeholder="my-gcp-project"
                        required
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Dataset">
                        <TextInput
                          value={form.bqDataset}
                          onChange={(event) => setForm({ ...form, bqDataset: event.target.value })}
                          placeholder="analytics"
                        />
                      </Field>
                      <Field label="Location">
                        <TextInput
                          value={form.location}
                          onChange={(event) => setForm({ ...form, location: event.target.value })}
                          placeholder="US"
                        />
                      </Field>
                    </div>
                    <Field label="API endpoint">
                      <TextInput
                        value={form.apiEndpoint}
                        onChange={(event) => setForm({ ...form, apiEndpoint: event.target.value })}
                        placeholder="http://127.0.0.1:9059 for the local emulator"
                      />
                    </Field>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                <Field label="Service account JSON">
                  <TextArea
                    value={form.serviceAccountJson}
                    onChange={(event) =>
                      setForm({ ...form, serviceAccountJson: event.target.value })
                    }
                    placeholder="Optional. Leave empty for the emulator or Application Default Credentials."
                  />
                </Field>
              </>
            ) : form.kind === "databricks" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="databricks"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <Field label="Host">
                      <TextInput
                        value={form.host}
                        onChange={(event) => setForm({ ...form, host: event.target.value })}
                        placeholder="adb-000.0.azuredatabricks.net"
                        required
                      />
                    </Field>
                    <Field label="HTTP path">
                      <TextInput
                        value={form.httpPath}
                        onChange={(event) => setForm({ ...form, httpPath: event.target.value })}
                        placeholder="/sql/1.0/warehouses/abc"
                        required
                        spellCheck={false}
                        autoComplete="off"
                        className="font-mono"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Catalog">
                        <TextInput
                          value={form.catalog}
                          onChange={(event) => setForm({ ...form, catalog: event.target.value })}
                          placeholder="main"
                          required
                        />
                      </Field>
                      <Field label="Schema">
                        <TextInput
                          value={form.schema}
                          onChange={(event) => setForm({ ...form, schema: event.target.value })}
                          placeholder="default, or analytics on the local cluster"
                        />
                      </Field>
                    </div>
                    <Field label="API endpoint">
                      <TextInput
                        value={form.apiEndpoint}
                        onChange={(event) => setForm({ ...form, apiEndpoint: event.target.value })}
                        placeholder="http://127.0.0.1:14439"
                      />
                      <p className="text-[13px] text-muted-foreground">
                        Leave this empty for a Databricks workspace. For the local cluster, set the host to
                        127.0.0.1 and the schema to analytics.
                      </p>
                    </Field>
                    <Field label="Access token">
                      <TextInput
                        type="password"
                        value={form.token}
                        onChange={(event) => setForm({ ...form, token: event.target.value })}
                        required
                        autoComplete="off"
                      />
                    </Field>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
              </>
            ) : form.kind === "stripe" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="stripe"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <Field label="Secret key">
                      <TextInput
                        type="password"
                        value={form.apiKey}
                        onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                        required
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="API endpoint">
                      <TextInput
                        value={form.apiEndpoint}
                        onChange={(event) => setForm({ ...form, apiEndpoint: event.target.value })}
                        placeholder="http://127.0.0.1:12119 for the local fixture"
                      />
                      <p className="text-[13px] text-muted-foreground">
                        Leave this empty to call https://api.stripe.com. For the local fixture, use
                        http://127.0.0.1:12119.
                      </p>
                    </Field>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
              </>
            ) : form.kind === "opensearch" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="opensearch"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <Field label="Node URL">
                      <TextInput
                        value={form.node}
                        onChange={(event) => setForm({ ...form, node: event.target.value })}
                        placeholder="https://search-domain.us-east-1.es.amazonaws.com"
                        required
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Username">
                        <TextInput
                          value={form.user}
                          onChange={(event) => setForm({ ...form, user: event.target.value })}
                          autoComplete="off"
                        />
                      </Field>
                      <Field label="Password">
                        <TextInput
                          type="password"
                          value={form.password}
                          onChange={(event) => setForm({ ...form, password: event.target.value })}
                          autoComplete="off"
                        />
                      </Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="AWS region">
                        <TextInput
                          value={form.region}
                          onChange={(event) => setForm({ ...form, region: event.target.value })}
                          placeholder="us-east-1"
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </Field>
                      <Field label="AWS service">
                        <Select
                          value={form.osService}
                          options={[
                            { value: "es", label: "Amazon OpenSearch Service" },
                            { value: "aoss", label: "OpenSearch Serverless" },
                          ]}
                          onValueChange={(osService) => setForm({ ...form, osService })}
                          disabled={!form.region.trim()}
                        />
                      </Field>
                    </div>
                    <Field label="Access key ID">
                      <TextInput
                        value={form.accessKeyId}
                        onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Secret access key">
                      <TextInput
                        type="password"
                        value={form.secretAccessKey}
                        onChange={(event) => setForm({ ...form, secretAccessKey: event.target.value })}
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Session token">
                      <TextInput
                        type="password"
                        value={form.sessionToken}
                        onChange={(event) => setForm({ ...form, sessionToken: event.target.value })}
                        autoComplete="off"
                      />
                      <p className="text-[13px] text-muted-foreground">
                        Leave the region empty for basic auth. Set a region to sign requests with AWS SigV4.
                        Leave the access keys empty. Dash then uses the default AWS credentials. For the local
                        cluster, use http://127.0.0.1:9209.
                      </p>
                    </Field>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
              </>
            ) : form.kind === "hana" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="hana"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : null}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                {form.useConnectionString ? null : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Database">
                        <TextInput
                          value={form.database}
                          onChange={(event) => setForm({ ...form, database: event.target.value })}
                          placeholder="Tenant"
                        />
                      </Field>
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      The tenant database is optional on a single-database system.
                    </p>
                    <Field label="Schema">
                      <TextInput
                        value={form.schema}
                        onChange={(event) => setForm({ ...form, schema: event.target.value })}
                        placeholder="Session schema"
                      />
                    </Field>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                        autoComplete="off"
                      />
                    </Field>
                    <label className="check-row flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.encrypt}
                        onChange={(event) => setForm({ ...form, encrypt: event.target.checked })}
                      />
                      Encrypt the session
                    </label>
                    <label className="check-row flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.validateCertificate}
                        onChange={(event) =>
                          setForm({ ...form, validateCertificate: event.target.checked })
                        }
                      />
                      Validate the server certificate
                    </label>
                    <p className="text-[13px] text-muted-foreground">
                      Encrypt is the default. Clear it only for a local server.
                    </p>
                  </>
                )}
              </>
            ) : form.kind === "couchbase" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="couchbase"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Bucket">
                        <TextInput
                          value={form.bucket}
                          onChange={(event) => setForm({ ...form, bucket: event.target.value })}
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Scope">
                      <TextInput
                        value={form.scope}
                        onChange={(event) => setForm({ ...form, scope: event.target.value })}
                        placeholder="_default"
                      />
                    </Field>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                        required
                        autoComplete="off"
                      />
                    </Field>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.tls}
                    onChange={(event) => setForm({ ...form, tls: event.target.checked })}
                  />
                  Use TLS
                </label>
              </>
            ) : form.kind === "neo4j" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="neo4j"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Database">
                        <TextInput
                          value={form.database}
                          onChange={(event) => setForm({ ...form, database: event.target.value })}
                          placeholder="neo4j"
                          required
                        />
                      </Field>
                    </div>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                        required
                        autoComplete="off"
                      />
                    </Field>
                    <label className="check-row flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.encryption}
                        onChange={(event) => setForm({ ...form, encryption: event.target.checked })}
                      />
                      Encrypt the connection and check the server certificate
                    </label>
                    <p className="text-[13px] text-muted-foreground">
                      Turn this on for bolt+s. Leave it off for the local fixture.
                    </p>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
              </>
            ) : form.kind === "cassandra" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="cassandra"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Host">
                        <TextInput
                          value={form.host}
                          onChange={(event) => setForm({ ...form, host: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Port">
                        <TextInput
                          value={form.port}
                          onChange={(event) => setForm({ ...form, port: event.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Keyspace">
                        <TextInput
                          value={form.keyspace}
                          onChange={(event) => setForm({ ...form, keyspace: event.target.value })}
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Local data center">
                      <TextInput
                        value={form.localDataCenter}
                        onChange={(event) =>
                          setForm({ ...form, localDataCenter: event.target.value })
                        }
                        placeholder="datacenter1"
                      />
                    </Field>
                    <Field label="User">
                      <TextInput
                        value={form.user}
                        onChange={(event) => setForm({ ...form, user: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Password">
                      <TextInput
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                      />
                    </Field>
                  </>
                )}
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.ssl}
                    onChange={(event) => setForm({ ...form, ssl: event.target.checked })}
                  />
                  Use SSL
                </label>
                <p className="text-[13px] text-muted-foreground">
                  The local cluster uses port 39042, keyspace dash, and data center datacenter1.
                </p>
              </>
            ) : form.kind === "dynamodb" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="dynamodb"
                    value={form.connectionString}
                    onChange={(connectionString) => setForm({ ...form, connectionString })}
                  />
                ) : (
                  <>
                    <Field label="Region">
                      <TextInput
                        value={form.region}
                        onChange={(event) => setForm({ ...form, region: event.target.value })}
                        placeholder="us-east-1"
                        autoComplete="off"
                        required
                      />
                    </Field>
                    <Field label="Access key ID">
                      <TextInput
                        value={form.accessKeyId}
                        onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })}
                        autoComplete="off"
                        required
                      />
                    </Field>
                    <Field label="Secret access key">
                      <TextInput
                        type="password"
                        value={form.secretAccessKey}
                        onChange={(event) =>
                          setForm({ ...form, secretAccessKey: event.target.value })
                        }
                        autoComplete="off"
                        required
                      />
                    </Field>
                    <Field label="Endpoint">
                      <TextInput
                        value={form.apiEndpoint}
                        onChange={(event) => setForm({ ...form, apiEndpoint: event.target.value })}
                        placeholder="http://127.0.0.1:8009"
                        autoComplete="off"
                      />
                      <p className="text-[13px] text-muted-foreground">
                        Leave this empty to use the regional HTTPS host. http is only allowed for a
                        loopback address.
                      </p>
                    </Field>
                  </>
                )}
                <Field label="Session token">
                  <TextInput
                    type="password"
                    value={form.sessionToken}
                    onChange={(event) => setForm({ ...form, sessionToken: event.target.value })}
                    autoComplete="off"
                  />
                  <p className="text-[13px] text-muted-foreground">
                    Optional. Temporary credentials only. Never put this in the connection URI.
                  </p>
                </Field>
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
              </>
            ) : form.kind === "elasticsearch" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind="elasticsearch"
                    value={form.connectionString}
                    onChange={(connectionString) => {
                      const tls = tlsFromElasticsearchUri(connectionString);
                      setForm({
                        ...form,
                        connectionString,
                        ...(tls === undefined ? {} : { tls }),
                      });
                    }}
                  />
                ) : (
                  <>
                    <Field label="Cloud ID">
                      <TextInput
                        value={form.cloudId}
                        onChange={(event) => setForm({ ...form, cloudId: event.target.value })}
                        placeholder="name:base64 from Elastic Cloud"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </Field>
                    {form.cloudId.trim() ? null : (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <Field label="Host">
                            <TextInput
                              value={form.host}
                              onChange={(event) => setForm({ ...form, host: event.target.value })}
                              required
                            />
                          </Field>
                        </div>
                        <Field label="Port">
                          <TextInput
                            value={form.port}
                            onChange={(event) => setForm({ ...form, port: event.target.value })}
                            required
                          />
                        </Field>
                      </div>
                    )}
                    {form.apiKey.trim() ? null : (
                      <>
                        <Field label="User">
                          <TextInput
                            value={form.user}
                            onChange={(event) => setForm({ ...form, user: event.target.value })}
                            placeholder="elastic"
                          />
                        </Field>
                        <Field label="Password">
                          <TextInput
                            type="password"
                            value={form.password}
                            onChange={(event) => setForm({ ...form, password: event.target.value })}
                            autoComplete="off"
                          />
                        </Field>
                      </>
                    )}
                  </>
                )}
                <Field label="API key">
                  <TextInput
                    type="password"
                    value={form.apiKey}
                    onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                    placeholder="Encoded token, or id:api_key"
                    autoComplete="off"
                  />
                  <p className="text-[13px] text-muted-foreground">
                    Leave this empty when the URI or the user and password already authenticate.
                    Turn TLS off for an http:// loopback URL such as the local cluster.
                  </p>
                </Field>
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.tls}
                    onChange={(event) => setForm({ ...form, tls: event.target.checked })}
                  />
                  Use TLS
                </label>
                <ConnectionModeToggle
                  usingUri={form.useConnectionString}
                  onChange={(useConnectionString) => setForm({ ...form, useConnectionString })}
                />
              </>
            ) : null}
            {error ? <p className="text-negative">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={create.isPending || !form.name.trim()}>
                {create.isPending ? "Testing connection…" : "Add data source"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-backdrop p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-data-source-title"
            className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-dialog"
          >
            <h2 id="remove-data-source-title" className="text-base font-semibold">Remove data source</h2>
            <p className="mt-2 text-muted-foreground">
              Remove <span className="font-medium text-foreground">{pendingDelete.name}</span>? Dashboards that
              query it will fail until you point those widgets at another source.
              {usageCount(pendingDelete.id) > 0
                ? ` ${usageCount(pendingDelete.id)} widget(s) in this workspace use it. Other workspaces can also use this source.`
                : ""}
            </p>
            {remove.isError ? (
              <p className="mt-3 text-negative">
                {remove.error instanceof Error ? remove.error.message : "Remove failed"}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive"
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(pendingDelete.id)}
              >
                {remove.isPending ? "Removing…" : "Remove source"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
