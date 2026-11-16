import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import html from "../../.mcp-app/view.html?raw";
import { RESOURCE_URI, viewSchema, type DashView } from "../mcp-app/contract.ts";
import { resolveDashboardView } from "./services/dashboard-view.ts";
import type { WorkspaceAuthContext } from "./http.ts";

export function registerDashboardApps(server: McpServer, auth: WorkspaceAuthContext, origin: string) {
  const metadata = { ui: { csp: { connectDomains: [], resourceDomains: [] } } };
  registerAppResource(server, "Dash dashboard view", RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE, _meta: metadata }, async () => ({
    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: metadata }],
  }));
  const shared = {
    outputSchema: viewSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  };
  async function display(dashboardId: string, mode: DashView["mode"], widgetIds?: string[]) {
    const view = await resolveDashboardView(auth.workspace.id, origin, dashboardId, mode, widgetIds, auth.user.id);
    const structuredContent = viewSchema.parse(view);
    const summary = view.errors.length ? view.errors.join(" ") : `${view.title}: ${view.widgets.length} widget(s). ${view.widgets.filter((widget) => widget.error).length} failed.`;
    return {
      structuredContent,
      content: [{ type: "text" as const, text: `${summary}\nOpen in Dash: ${view.url}` }],
      ...(view.errors.length ? { isError: true } : {}),
    };
  }
  registerAppTool(server, "show_dashboard", {
    ...shared, title: "Show dashboard",
    description: "Display a Dash dashboard or selected widgets. Use list_dashboards or get_dashboard to find IDs. Never guess IDs. This tool does not change data.",
    inputSchema: z.object({ dashboardId: z.string().min(1), widgetIds: z.array(z.string().min(1)).min(1).max(100).optional() }),
  }, ({ dashboardId, widgetIds }) => display(dashboardId, "dashboard", widgetIds));
  registerAppTool(server, "show_widget", {
    ...shared, title: "Show widget",
    description: "Display exactly one existing Dash chart, table, or KPI. Use list_dashboards or get_dashboard to find IDs. This tool queries only that widget.",
    inputSchema: z.object({ dashboardId: z.string().min(1), widgetId: z.string().min(1) }),
  }, ({ dashboardId, widgetId }) => display(dashboardId, "widget", [widgetId]));
}
