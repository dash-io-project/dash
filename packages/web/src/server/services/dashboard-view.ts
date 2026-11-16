import { isChartType } from "@dash/core";
import type { DashView } from "../../mcp-app/contract.ts";
import { dashboardUrl, widgetUrl } from "../../lib/dashboard-links.ts";
import { getDashboard } from "./dashboards.ts";
import { queryDataSource } from "./query.ts";

/** Resolve only the selected widgets after the workspace and membership checks. */
export async function resolveDashboardView(workspaceId: string, origin: string, dashboardId: string, mode: DashView["mode"], widgetIds?: string[]): Promise<DashView> {
  const resolvedAt = new Date().toISOString();
  const view: DashView = { mode, dashboardId, widgetIds, title: "Dash", url: origin, resolvedAt, errors: [], widgets: [] };
  const dashboard = await getDashboard(workspaceId, dashboardId);
  if (!dashboard) return { ...view, errors: ["Dashboard not found or access denied."] };
  if (widgetIds && (widgetIds.length === 0 || widgetIds.some((id) => !dashboard.widgets.some((widget) => widget.id === id)))) {
    return { ...view, errors: ["Widget not found or access denied."] };
  }
  const selected = widgetIds ? dashboard.widgets.filter((widget) => widgetIds.includes(widget.id)) : dashboard.widgets;
  view.title = mode === "widget" ? selected[0]!.title : dashboard.name;
  view.url = widgetIds ? widgetUrl(origin, dashboard, widgetIds) : dashboardUrl(origin, dashboard);
  for (const widget of selected) {
    const item: DashView["widgets"][number] = {
      id: widget.id, title: widget.title, type: widget.type, layout: widget.layout,
      chart: widget.chart ? {
        ...Object.fromEntries(Object.entries(widget.chart).filter(([, value]) => value != null)),
        type: widget.chart.type,
        encode: Object.fromEntries(Object.entries(widget.chart.encode).filter(([, value]) => value != null)),
      } : undefined, kpi: widget.kpi, rows: [], truncated: false,
      source: widget.snapshot ? "snapshot" : "live", savedAt: widget.snapshot?.savedAt,
      resolvedAt, url: widgetUrl(origin, dashboard, [widget.id]),
    };
    if (!(widget.type === "table" || (widget.type === "kpi" && widget.kpi) || (widget.type === "chart" && widget.chart && isChartType(widget.chart.type)))) {
      item.error = "This widget type or configuration is not supported.";
    } else if (widget.snapshot) {
      item.rows = widget.snapshot.rows;
    } else {
      try {
        const result = await queryDataSource(widget.dataSourceId, widget.query);
        item.rows = result.rows;
        item.truncated = result.truncated;
      } catch {
        // Adapter errors can contain connection details. Do not send them to the host.
        item.error = "The widget query failed. Check its data source in Dash.";
      }
    }
    view.widgets.push(item);
  }
  return view;
}
