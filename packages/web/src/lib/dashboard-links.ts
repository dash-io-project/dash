import { defaultStringifySearch } from "@tanstack/react-router";

interface DashboardRef {
  id: string;
  workspaceId: string;
}

/**
 * The browser address of a dashboard. The `workspace` search value opens the
 * workspace that owns the dashboard. The router encodes each search value, so
 * that a hex id such as `123e4567` stays a string and does not become a number.
 */
export function dashboardUrl(origin: string, dashboard: DashboardRef): string {
  const url = new URL(`/dashboards/${encodeURIComponent(dashboard.id)}`, origin);
  url.search = defaultStringifySearch({ workspace: dashboard.workspaceId });
  return url.href;
}

/**
 * The browser address of a focused dashboard view. The view shows only the
 * given widgets. The `widgets` search value holds their ids, with commas
 * between them.
 */
export function widgetUrl(origin: string, dashboard: DashboardRef, widgetIds: readonly string[]): string {
  const url = new URL(dashboardUrl(origin, dashboard));
  url.search = defaultStringifySearch({ workspace: dashboard.workspaceId, widgets: widgetIds.join(",") });
  return url.href;
}

/** The widget ids in a `widgets` search value, or undefined for the full dashboard. */
export function parseWidgetIds(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}
