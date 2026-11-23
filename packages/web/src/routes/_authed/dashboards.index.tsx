import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { Dashboard } from "@dash/core";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Button, EmptyState, ICON_STROKE } from "~/components/ui";
import { McpConnectionBanner } from "~/components/mcp-connection-banner";

export const Route = createFileRoute("/_authed/dashboards/")({
  component: DashboardsPage,
});

function DashboardsPage() {
  const { workspace, workspaceApi: api } = useWorkspace();
  const canEdit = workspace.role !== "viewer";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboards = useQuery({
    queryKey: ["dashboards", workspace.id],
    queryFn: async () => {
      const payload = await api<{ dashboards: Dashboard[] }>("/api/dashboards");
      return payload.dashboards;
    },
  });

  async function createDashboard() {
    const payload = await api<{ dashboard: Dashboard }>("/api/dashboards", {
      method: "POST",
      body: JSON.stringify({
        name: "Untitled dashboard",
        description: "Generated in Dash. Add charts from the page or via MCP.",
        widgets: [],
      }),
    });
    await queryClient.invalidateQueries({ queryKey: ["dashboards", workspace.id] });
    await navigate({
      to: "/dashboards/$dashboardId",
      params: { dashboardId: payload.dashboard.id },
    });
  }

  return (
    <>
      <PageHeader
        title="Dashboards"
        description={`The dashboards of the workspace ${workspace.name}.`}
        actions={
          canEdit ? (
            <Button variant="primary" type="button" onClick={() => void createDashboard()}>
              <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /> New dashboard
            </Button>
          ) : null
        }
      />
      <PageBody className="space-y-6">
      {dashboards.error ? <p role="alert" className="text-negative">{dashboards.error.message}</p> : null}
      <McpConnectionBanner />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(dashboards.data ?? []).map((dashboard) => (
          <Link
            key={dashboard.id}
            to="/dashboards/$dashboardId"
            params={{ dashboardId: dashboard.id }}
            className="card flex flex-col p-4 hover:bg-row-hover"
          >
            <h2 className="font-semibold">{dashboard.name}</h2>
            <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
              {dashboard.description || "No description"}
            </p>
            <p className="tabular mt-auto pt-4 text-xs text-muted-foreground">
              {dashboard.widgets.length} widgets · updated{" "}
              {new Date(dashboard.updatedAt).toLocaleString()}
            </p>
          </Link>
        ))}
      </div>
      {dashboards.data?.length === 0 ? (
        <EmptyState
          title="No dashboards yet."
          action={
            canEdit ? (
              <Button type="button" onClick={() => void createDashboard()}>
                Create the first page
              </Button>
            ) : null
          }
        />
      ) : null}
      </PageBody>
    </>
  );
}
