import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdapterSchema, Dashboard, DashboardWidget, DataSourceRecord } from "@dash/core";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { WidgetCard } from "~/components/WidgetCard";
import { WidgetEditor } from "~/components/WidgetEditor";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Button, EmptyState, TextInput } from "~/components/ui";
import { parseWidgetIds, widgetUrl } from "~/lib/dashboard-links";

export const Route = createFileRoute("/_authed/dashboards/$dashboardId")({
  // `widgets` holds widget ids with commas between them. With it, the page
  // shows only those widgets. A shared widget link uses this value.
  validateSearch: (search: Record<string, unknown>): { widgets?: string } => ({
    widgets: typeof search.widgets === "string" && search.widgets ? search.widgets : undefined,
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { dashboardId } = Route.useParams();
  const { workspace, workspaceApi: api } = useWorkspace();
  const canEdit = workspace.role !== "viewer";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const selected = parseWidgetIds(Route.useSearch().widgets);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", workspace.id, dashboardId],
    queryFn: async () => {
      const payload = await api<{ dashboard: Dashboard }>(`/api/dashboards/${dashboardId}`);
      return payload.dashboard;
    },
  });
  const sourcesQuery = useQuery({
    queryKey: ["data-sources"],
    queryFn: async () => {
      const payload = await api<{ dataSources: DataSourceRecord[] }>("/api/data-sources");
      return payload.dataSources;
    },
  });

  const schemas = useQuery({
    queryKey: ["schemas", sourcesQuery.data?.map((source) => source.id)],
    enabled: Boolean(sourcesQuery.data),
    queryFn: async () => {
      const entries = await Promise.all(
        (sourcesQuery.data ?? []).map(async (source) => {
          const payload = await api<{ schema: AdapterSchema }>(
            `/api/data-sources/${source.id}/schema`,
          );
          return [source.id, payload.schema] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, AdapterSchema>;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<Dashboard>) => {
      const payload = await api<{ dashboard: Dashboard }>(`/api/dashboards/${dashboardId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return payload.dashboard;
    },
    onSuccess: (dashboard) => {
      queryClient.setQueryData(["dashboard", workspace.id, dashboardId], dashboard);
      void queryClient.invalidateQueries({ queryKey: ["dashboards", workspace.id] });
    },
  });

  const dashboard = dashboardQuery.data;
  if (dashboardQuery.isLoading) {
    return <PageBody className="text-muted-foreground">Loading dashboard…</PageBody>;
  }
  if (!dashboard) {
    return <PageBody className="text-negative">Dashboard not found.</PageBody>;
  }
  // A focused view keeps the dashboard order. One widget fills the width.
  const shown = selected ? dashboard.widgets.filter((widget) => selected.includes(widget.id)) : dashboard.widgets;
  const shareUrl = (widgetId: string) => widgetUrl(window.location.origin, dashboard, [widgetId]);

  async function addWidget(widget: DashboardWidget) {
    const current = dashboardQuery.data;
    if (!current) {
      return;
    }
    const maxY = current.widgets.reduce(
      (max, item) => Math.max(max, item.layout.y + item.layout.h),
      0,
    );
    const next = {
      ...widget,
      layout: { ...widget.layout, y: maxY },
    };
    await save.mutateAsync({ widgets: [...current.widgets, next] });
    setAdding(false);
  }

  async function removeDashboard() {
    if (!confirm("Delete this dashboard?")) {
      return;
    }
    await api(`/api/dashboards/${dashboardId}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["dashboards", workspace.id] });
    await navigate({ to: "/dashboards" });
  }

  return (
    <>
      <PageHeader
        title={
          editing ? (
            <TextInput
              aria-label="Dashboard name"
              value={dashboard.name}
              onChange={(event) =>
                queryClient.setQueryData(["dashboard", workspace.id, dashboardId], {
                  ...dashboard,
                  name: event.target.value,
                })
              }
            />
          ) : (
            dashboard.name
          )
        }
        description={
          editing ? (
            <TextInput
              aria-label="Dashboard description"
              className="mt-2"
              value={dashboard.description}
              onChange={(event) =>
                queryClient.setQueryData(["dashboard", workspace.id, dashboardId], {
                  ...dashboard,
                  description: event.target.value,
                })
              }
            />
          ) : (
            dashboard.description
          )
        }
        actions={
          canEdit && !selected ? (
            <>
              {editing ? (
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => {
                    void save.mutateAsync({
                      name: dashboard.name,
                      description: dashboard.description,
                    });
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
              ) : (
                <Button type="button" onClick={() => setEditing(true)}>
                  Rename
                </Button>
              )}
              <Button type="button" onClick={() => setAdding(true)}>
                Add widget
              </Button>
              <Button type="button" onClick={() => void removeDashboard()}>
                Delete
              </Button>
            </>
          ) : null
        }
      />
      <PageBody className="space-y-4">
        {save.error ? (
          <p role="alert" className="text-negative">
            {save.error.message}
          </p>
        ) : null}
        {selected ? (
          <div className="card flex flex-wrap items-center gap-3 bg-surface px-4 py-2.5 text-muted-foreground">
            <span className="tabular">
              {shown.length === 0
                ? "The linked widgets are not on this dashboard now."
                : `Showing ${shown.length} of ${dashboard.widgets.length} widgets.`}
            </span>
            <Link
              to="/dashboards/$dashboardId"
              params={{ dashboardId }}
              search={(previous) => ({ ...previous, widgets: undefined })}
              className="link"
            >
              Show all widgets
            </Link>
          </div>
        ) : null}
        <div className="dash-grid">
          {shown.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={shown.length === 1 && selected ? { ...widget, layout: { ...widget.layout, w: 12 } } : widget}
              getShareUrl={() => shareUrl(widget.id)}
            />
          ))}
        </div>
        {dashboard.widgets.length === 0 && !selected ? (
          <EmptyState title="This dashboard has no widgets.">
            Add a widget or ask Dash MCP to generate a chart.
          </EmptyState>
        ) : null}
      </PageBody>
      {adding ? (
        <WidgetEditor
          dataSources={sourcesQuery.data ?? []}
          schemas={schemas.data ?? {}}
          onAdd={(widget) => void addWidget(widget)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}
