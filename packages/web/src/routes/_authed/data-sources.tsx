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
  | "db2"
  | "snowflake"
  | "mongodb"
  | "bigquery"
  | "databricks"
  | "redshift"
  | "stripe";

const KIND_OPTIONS: SelectOption<SourceKind>[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "db2", label: "IBM Db2" },
  { value: "redshift", label: "Amazon Redshift" },
  { value: "snowflake", label: "Snowflake" },
  { value: "mongodb", label: "MongoDB" },
  { value: "bigquery", label: "Google BigQuery" },
  { value: "databricks", label: "Databricks SQL" },
  { value: "stripe", label: "Stripe" },
];

const URI_PLACEHOLDER: Record<SourceKind, string> = {
  postgres: "postgres://user:password@localhost:5432/analytics",
  mysql: "mysql://user:password@localhost:3306/analytics",
  db2: "db2://db2inst1:password@localhost:50000/DASH?schema=DASH",
  redshift: "redshift://user:password@cluster.redshift.amazonaws.com:5439/analytics?sslmode=require",
  snowflake: "snowflake://user:password@account/database/schema?warehouse=COMPUTE_WH",
  mongodb: "mongodb://user:password@host:27017/analytics?authSource=admin",
  bigquery: "bigquery://project/dataset?location=US&endpoint=http://127.0.0.1:9059",
  databricks:
    "databricks://token:dapi000@adb-000.0.azuredatabricks.net/sql/1.0/warehouses/abc?catalog=main&schema=default",
  stripe: "stripe://sk_test_000@api.stripe.com",
};

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
              : form.kind === "mysql"
                ? form.useConnectionString
                  ? {
                      kind: "mysql" as const,
                      connectionString: form.connectionString.trim(),
                      ssl: form.ssl,
                    }
                  : {
                      kind: "mysql" as const,
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
        Paste a connection URI, or enter the fields. Dash tests Postgres, MySQL, IBM Db2, Snowflake, MongoDB,
        BigQuery, Databricks SQL, Redshift, and Stripe on save.
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
          Add a PostgreSQL, MySQL, IBM Db2, Snowflake, MongoDB, BigQuery, Databricks SQL, or Redshift connection to start querying.
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
                    ssl: kind === "redshift",
                    port:
                      kind === "mongodb"
                        ? "27017"
                        : kind === "postgres"
                          ? "5432"
                          : kind === "mysql"
                            ? "3306"
                            : kind === "redshift"
                              ? "5439"
                              : kind === "db2"
                                ? "50000"
                                : form.port,
                    user: kind === "postgres" ? "postgres" : form.user === "postgres" ? "" : form.user,
                    schema:
                      kind === "snowflake"
                        ? form.schema || "PUBLIC"
                        : enteringDatabricks
                          ? form.schema === "public" || form.schema === "PUBLIC" || !form.schema
                            ? "default"
                            : form.schema
                          : form.schema,
                    host: enteringDatabricks && form.host.trim() === "localhost" ? "" : form.host,
                    apiEndpoint: kind === form.kind ? form.apiEndpoint : "",
                    apiKey: kind === form.kind ? form.apiKey : "",
                    authSource: form.authSource || "admin",
                    useConnectionString: true,
                  });
                }}
              />
            </Field>
            {form.kind === "postgres" || form.kind === "mysql" || form.kind === "redshift" || form.kind === "db2" ? (
              <>
                {form.useConnectionString ? (
                  <ConnectionUriField
                    kind={form.kind}
                    value={form.connectionString}
                    onChange={(connectionString) => {
                      const ssl =
                        form.kind === "redshift"
                          ? sslFromRedshiftUri(connectionString)
                          : form.kind === "db2"
                            ? sslFromDb2Uri(connectionString)
                            : undefined;
                      if (form.kind !== "redshift" && form.kind !== "db2") {
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
                  </>
                )}
                <label className="check-row flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.ssl}
                    onChange={(event) => setForm({ ...form, ssl: event.target.checked })}
                  />
                  {form.kind === "redshift"
                    ? "Require SSL and verify the server certificate"
                    : "Use SSL"}
                </label>
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
