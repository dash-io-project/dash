import { isChartType } from "@dash/core";
import type { DashView } from "../../mcp-app/contract.ts";
import { dashboardUrl, widgetUrl } from "../../lib/dashboard-links.ts";
import { getDashboard } from "./dashboards.ts";
import { queryDataSource } from "./query.ts";

const activeCallers = new Set<string>();
const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const MAX_VIEW_ROWS = 20_000;

/** Stop JSON serialization before it can build a result above the response budget. */
function withinByteBudget(value: unknown): boolean {
  let remaining = MAX_VIEW_BYTES;
  const exhausted = new Error("View byte budget exhausted");
  const charge = (text: string) => {
    // Check raw bytes before JSON escaping can allocate a larger string.
    if (Buffer.byteLength(text) > remaining) throw exhausted;
    remaining -= Buffer.byteLength(JSON.stringify(text)) + 2;
    if (remaining < 0) throw exhausted;
  };
  try {
    JSON.stringify(value, (key, field) => {
      charge(key);
      if (typeof field === "string") charge(field);
      else {
        remaining -= field !== null && typeof field === "object" ? 2 : 32;
        if (remaining < 0) throw exhausted;
      }
      return field;
    });
    return true;
  } catch {
    return false;
  }
}

/** Limit each caller to one view and each server process to 16 concurrent views. */
export async function resolveDashboardView(workspaceId: string, origin: string, dashboardId: string, mode: DashView["mode"], widgetIds: string[] | undefined, callerId: string): Promise<DashView> {
  if (activeCallers.has(callerId) || activeCallers.size >= 16) {
    return { mode, dashboardId, widgetIds, title: "Dash", url: origin, resolvedAt: new Date().toISOString(), widgets: [], errors: ["A view request is already active or the server is busy. Try again later."] };
  }
  activeCallers.add(callerId);
  try {
    return await resolveView(workspaceId, origin, dashboardId, mode, widgetIds);
  } finally {
    activeCallers.delete(callerId);
  }
}

/** Resolve only the selected widgets after the workspace and membership checks. */
async function resolveView(workspaceId: string, origin: string, dashboardId: string, mode: DashView["mode"], widgetIds?: string[]): Promise<DashView> {
  const resolvedAt = new Date().toISOString();
  const view: DashView = { mode, dashboardId, widgetIds, title: "Dash", url: origin, resolvedAt, errors: [], widgets: [] };
  const dashboard = await getDashboard(workspaceId, dashboardId);
  if (!dashboard) return { ...view, errors: ["Dashboard not found or access denied."] };
  if (widgetIds && (widgetIds.length === 0 || widgetIds.some((id) => !dashboard.widgets.some((widget) => widget.id === id)))) {
    return { ...view, errors: ["Widget not found or access denied."] };
  }
  const selected = widgetIds ? dashboard.widgets.filter((widget) => widgetIds.includes(widget.id)) : dashboard.widgets;
  if (new Set(selected.map((widget) => widget.id)).size !== selected.length || (mode === "widget" && selected.length !== 1)) {
    return { ...view, errors: ["Widget IDs are ambiguous. Repair the dashboard in Dash."] };
  }
  if (selected.length > 20 || selected.filter((widget) => !widget.snapshot).length > 10) {
    return { ...view, errors: ["A view can contain at most 20 widgets and 10 live queries. Select fewer widgets."] };
  }
  let rowCount = 0;
  let budgetExhausted = false;
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
    } else if (budgetExhausted || rowCount >= MAX_VIEW_ROWS || (widget.query.limit ?? 1000) > 10_000) {
      item.error = "The view query budget is exhausted or the saved query limit exceeds 10,000 rows. Open this widget in Dash.";
      item.truncated = true;
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
    rowCount += item.rows.length;
    if (rowCount > MAX_VIEW_ROWS || !withinByteBudget({ ...view, widgets: [...view.widgets, item] })) {
      budgetExhausted = true;
      item.rows = [];
      item.truncated = true;
      item.error = "The widget data exceeds the view row or byte budget. Open this widget in Dash.";
    }
    view.widgets.push(item);
    if (!withinByteBudget(view)) {
      return { ...view, title: "Dash", widgets: [], errors: ["The widget configuration exceeds the view byte budget. Select fewer widgets."] };
    }
  }
  return view;
}
