import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "~/lib/api";
import { Badge, Button, Card, Field, Panel, Select } from "~/components/ui";

type Size = "small" | "standard";
type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface PlanResponse {
  plan: {
    planId: string;
    size: Size;
    assignments: { domain: string; label: string; sourceId: string; sourceName: string; kind: string; namespace: string }[];
    sources: { id: string; name: string; kind: string; status: "target" | "unused" | "unsupported" | "refused"; reason: string | null; domains: string[] }[];
  };
  state: {
    status: "idle" | "running" | "succeeded" | "failed";
    action: "seed" | "remove" | null;
    size: Size | null;
    asOf: string | null;
    finishedAt: string | null;
    error: string | null;
    steps: { domain: string; label: string; sourceName: string; namespace: string; status: StepStatus; rows: number; error: string | null }[];
    workspaceId: string | null;
    dashboards: { id: string; name: string }[];
    hasSeedData: boolean;
  };
}

const SIZE_LABELS: Record<Size, string> = {
  small: "Small: about 23,000 rows, fast",
  standard: "Standard: about 190,000 rows",
};

const DOMAIN_LABELS: Record<string, string> = {
  app: "Product database",
  billing: "Billing",
  crm: "Sales CRM",
  finance: "Finance warehouse",
  product: "Product analytics",
  marketing: "Marketing analytics",
  support: "Customer support",
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />;
  if (status === "done") return <CheckCircle2 aria-hidden className="size-4 text-positive" />;
  if (status === "failed") return <XCircle aria-hidden className="size-4 text-negative" />;
  if (status === "skipped") return <MinusCircle aria-hidden className="size-4 text-muted-foreground" />;
  return <Circle aria-hidden className="size-4 text-muted-foreground" />;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Seeds the configured data sources with the Fernway sample company. The
 * server answers 404 unless DEMO_ENVIRONMENT is true, so the panel stays hidden.
 */
export function DevSeedPanel() {
  const queryClient = useQueryClient();
  const [size, setSize] = useState<Size>("standard");
  const [confirming, setConfirming] = useState<"seed" | "remove" | null>(null);
  const query = useQuery({
    queryKey: ["dev-seed", size],
    queryFn: async () => {
      try {
        return await api<PlanResponse>(`/api/dev-seed?size=${size}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    refetchInterval: (current) => (current.state.data?.state.status === "running" ? 1500 : false),
  });
  const status = query.data?.state.status;
  const previous = useRef(status);
  useEffect(() => {
    // A finished run can add a workspace and dashboards.
    if (previous.current === "running" && status !== "running") {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
    }
    previous.current = status;
  }, [status, queryClient]);

  const start = useMutation({
    mutationFn: async () =>
      api("/api/dev-seed", { method: "POST", body: JSON.stringify({ planId: query.data?.plan.planId, size }) }),
    onSettled: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ["dev-seed"] });
    },
  });
  const remove = useMutation({
    mutationFn: async () => api("/api/dev-seed", { method: "DELETE" }),
    onSettled: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ["dev-seed"] });
    },
  });

  if (query.data === null) return null;
  if (query.isError) {
    return (
      <Panel title="Sample company data">
        <p role="alert" className="text-negative">{errorText(query.error, "Could not load the seed plan.")}</p>
      </Panel>
    );
  }
  if (!query.data) return null;

  const { plan, state } = query.data;
  const running = state.status === "running";
  const hasTargets = plan.assignments.length > 0;

  return (
    <Panel
      aria-labelledby="dev-seed-title"
      title={
        <span className="flex items-center gap-2">
          <span id="dev-seed-title">Sample company data</span>
          <Badge tone="warning">Demo</Badge>
        </span>
      }
      note={
        <>
          Fernway, Inc. is a fictional B2B SaaS company. Seeding writes 36 months of its data into your data sources
          and adds six dashboards in the shared <strong className="font-medium text-foreground">Fernway</strong> workspace. The numbers
          agree across sources. For example, finance MRR equals the subscriptions in the product database.
        </>
      }
    >
      <Card className="overflow-hidden">
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Where each part of the dataset goes</caption>
          <thead>
            <tr>
              <th scope="col">Data source</th>
              <th scope="col">Kind</th>
              <th scope="col">Receives</th>
            </tr>
          </thead>
          <tbody>
            {plan.sources.map((source) => (
              <tr key={source.id} className="align-top">
                <td>{source.name}</td>
                <td className="text-muted-foreground">{source.kind}</td>
                <td>
                  {source.status === "target" ? (
                    source.domains.map((domain) => DOMAIN_LABELS[domain] ?? domain).join(", ")
                  ) : (
                    <span className={source.status === "refused" ? "text-negative" : "text-muted-foreground"}>{source.reason}</span>
                  )}
                </td>
              </tr>
            ))}
            {plan.sources.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-muted-foreground">No data sources yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="space-y-5 border-t border-border p-5">

      {!hasTargets ? (
        <p className="text-muted-foreground">
          Add a Postgres, MongoDB, or BigQuery data source on the{" "}
          <Link to="/data-sources" className="link">Data sources</Link> page first.
        </p>
      ) : null}

      <Field label="Dataset size">
        <Select value={size} onChange={(event) => setSize(event.target.value as Size)} disabled={running}>
          {(Object.keys(SIZE_LABELS) as Size[]).map((value) => (
            <option key={value} value={value}>{SIZE_LABELS[value]}</option>
          ))}
        </Select>
      </Field>

      {confirming === "seed" ? (
        <div className="space-y-3 rounded-md border border-border bg-surface p-4" role="group" aria-label="Confirm seed">
          <p>Dash will create or replace these targets. It refuses any target that holds data it did not create.</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {plan.assignments.map((item) => (
              <li key={item.domain}>
                <span className="text-foreground">{item.label}</span>: <code>{item.namespace}</code> in {item.sourceName}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button variant="primary" type="button" onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? "Starting…" : "Seed data sources"}
            </Button>
            <Button type="button" onClick={() => setConfirming(null)}>Cancel</Button>
          </div>
        </div>
      ) : confirming === "remove" ? (
        <div className="space-y-3 rounded-md border border-negative-border bg-negative-soft p-4" role="group" aria-label="Confirm removal">
          <p>Dash will drop the seeded schemas, datasets, and collections, and delete the seeded dashboards.</p>
          <div className="flex gap-2">
            <Button variant="destructive" type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? "Starting…" : "Remove sample data"}
            </Button>
            <Button type="button" onClick={() => setConfirming(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="button" onClick={() => setConfirming("seed")} disabled={!hasTargets || running}>
            Seed data sources
          </Button>
          {state.hasSeedData ? (
            <Button type="button" onClick={() => setConfirming("remove")} disabled={running}>
              Remove sample data
            </Button>
          ) : null}
        </div>
      )}

      {start.isError || remove.isError ? (
        <p role="alert" className="text-negative">
          {errorText(start.error ?? remove.error, "Could not start the run.")}
        </p>
      ) : null}

      {state.steps.length > 0 ? (
        <div role="status" aria-live="polite" className="space-y-2">
          <h3 className="font-medium">
            {state.action === "remove" ? "Removal" : "Seed run"}
            {running ? " in progress" : state.status === "succeeded" ? " finished" : state.status === "failed" ? " failed" : ""}
          </h3>
          <ul className="space-y-1.5">
            {state.steps.map((step) => (
              <li key={`${step.domain}-${step.namespace}`} className="flex items-start gap-2">
                <span className="mt-0.5"><StepIcon status={step.status} /></span>
                <span>
                  <span className="text-foreground">{step.label}</span>
                  <span className="text-muted-foreground"> → {step.namespace} in {step.sourceName}</span>
                  {step.rows > 0 ? <span className="tabular text-muted-foreground"> · {step.rows.toLocaleString()} rows</span> : null}
                  {step.error ? (
                    <span className={step.status === "skipped" ? "block text-muted-foreground" : "block text-negative"}>{step.error}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {state.error ? <p className="text-negative">{state.error}</p> : null}
        </div>
      ) : null}

      {!running && state.dashboards.length > 0 && state.workspaceId ? (
        <div className="space-y-2">
          <h3 className="font-medium">Dashboards</h3>
          <ul className="flex flex-wrap gap-2">
            {state.dashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <Link
                  to="/dashboards/$dashboardId"
                  params={{ dashboardId: dashboard.id }}
                  search={{ workspace: state.workspaceId ?? undefined }}
                  className="btn btn-sm"
                >
                  {dashboard.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>
      </Card>
    </Panel>
  );
}
