import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardWidget } from "@dash/core";
import { createSession, createUser } from "./auth.ts";
import { createDashboard, getDashboard } from "./services/dashboards.ts";
import { ensurePersonalWorkspace } from "./services/workspaces.ts";
import { destroyAppDatabase, useFreshAppDatabase } from "./test-db.ts";
import { Route as DashboardItem } from "../routes/api/dashboards.$id.ts";

type Handler = (input: { request: Request; params: { id: string } }) => Promise<Response>;

async function call(method: string, session: string, workspaceId: string, id: string, body?: unknown) {
  const headers = new Headers({ "content-type": "application/json", cookie: `dash_session=${session}`, "x-dash-workspace-id": workspaceId });
  const request = new Request("http://localhost/api", { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const handlers = DashboardItem.options.server!.handlers as Record<string, Handler>;
  return handlers[method]!({ request, params: { id } });
}

describe("dashboard widget payloads", () => {
  beforeEach(useFreshAppDatabase);
  afterEach(destroyAppDatabase);

  it("saves the widget list of a dashboard that MCP wrote, and keeps its snapshot rows", async () => {
    const user = await createUser({ email: "snapshot@example.com", name: "Snapshot", password: "password123", role: "admin" });
    const session = await createSession(user.id);
    const workspaceId = await ensurePersonalWorkspace(user.id);
    const snapshot: DashboardWidget = {
      id: "hourly",
      type: "chart",
      title: "Tickets by hour",
      layout: { x: 0, y: 0, w: 12, h: 5 },
      chart: { type: "line", encode: { x: "hour", y: ["weekday_average", "weekend_average"] } },
      snapshot: { rows: [{ hour: 0, weekday_average: 1.5, weekend_average: null }], savedAt: "2026-11-15T08:00:00.000Z" },
    };
    // Before this change, MCP saved each unset chart field. MongoDB stores it as null.
    const stored = { ...snapshot, chart: { ...snapshot.chart!, encode: { ...snapshot.chart!.encode, color: null, name: null, value: null }, stacked: null, smooth: null } };
    const dashboard = await createDashboard({ workspaceId, name: "Support", description: "", widgets: [stored as unknown as DashboardWidget], createdBy: user.id });

    // The page sends each widget as it got it, plus the new widget.
    const loaded = (await (await call("GET", session, workspaceId, dashboard.id)).json()).dashboard;
    const added = { id: "orders", type: "table", title: "Orders", layout: { x: 0, y: 5, w: 6, h: 4 }, dataSourceId: "warehouse", query: { resource: "orders" } };
    const saved = await call("PATCH", session, workspaceId, dashboard.id, { widgets: [...loaded.widgets, added] });

    expect(saved.status).toBe(200);
    expect((await saved.json()).dashboard.widgets).toEqual([snapshot, added]);
  });

  it("refuses a widget list whose snapshots are over the dashboard budget", async () => {
    const user = await createUser({ email: "snapshot-budget@example.com", name: "Snapshot", password: "password123", role: "admin" });
    const session = await createSession(user.id);
    const workspaceId = await ensurePersonalWorkspace(user.id);
    const dashboard = await createDashboard({ workspaceId, name: "Big", description: "", widgets: [], createdBy: user.id });
    // Each table has 253,001 bytes of rows, under the 256 KiB budget for one snapshot.
    // Nine tables are over the 2 MiB budget for one dashboard.
    const rows = Array.from({ length: 1000 }, () => ({ label: "x".repeat(240) }));
    const widgets = Array.from({ length: 9 }, (_, index) => ({
      id: `table-${index}`,
      type: "table",
      title: "Labels",
      layout: { x: 0, y: index * 4, w: 12, h: 4 },
      snapshot: { rows, savedAt: "2026-11-15T08:00:00.000Z" },
    }));

    expect((await call("PATCH", session, workspaceId, dashboard.id, { widgets })).status).toBe(400);
    expect((await call("PATCH", session, workspaceId, dashboard.id, { widgets: widgets.slice(0, 8) })).status).toBe(200);
    expect((await getDashboard(workspaceId, dashboard.id))?.widgets).toHaveLength(8);
  });

  it("sets the snapshot save date on the server, and keeps it while the rows stay the same", async () => {
    const user = await createUser({ email: "snapshot-date@example.com", name: "Snapshot", password: "password123", role: "admin" });
    const session = await createSession(user.id);
    const workspaceId = await ensurePersonalWorkspace(user.id);
    const saved = "2026-11-15T08:00:00.000Z";
    const table = (id: string, rows: Record<string, number>[]): DashboardWidget => ({
      id,
      type: "table",
      title: id,
      layout: { x: 0, y: 0, w: 6, h: 4 },
      snapshot: { rows, savedAt: saved },
    });
    const stored = [table("same", [{ value: 1 }]), table("reordered", [{ a: 1, b: 2 }]), table("changed", [{ value: 1 }])];
    const dashboard = await createDashboard({ workspaceId, name: "Dates", description: "", widgets: stored, createdBy: user.id });
    const forged = "2000-01-01T00:00:00.000Z";
    const before = Date.now();

    // The same rows with a new key order are not a change.
    const sent = [table("same", [{ value: 1 }]), table("reordered", [{ b: 2, a: 1 }]), table("changed", [{ value: 2 }]), table("added", [{ value: 1 }])];
    const widgets = sent.map((widget) => ({ ...widget, snapshot: { ...widget.snapshot!, savedAt: forged } }));
    const response = await call("PATCH", session, workspaceId, dashboard.id, { widgets });

    expect(response.status).toBe(200);
    const dates = ((await response.json()).dashboard.widgets as DashboardWidget[]).map((widget) => widget.snapshot!.savedAt);
    expect(dates.slice(0, 2)).toEqual([saved, saved]);
    expect(dates.slice(2).every((date) => Date.parse(date) >= before)).toBe(true);
  });

  it("refuses a widget id with a comma, which a widget link cannot name", async () => {
    const user = await createUser({ email: "widget-id@example.com", name: "Widget", password: "password123", role: "admin" });
    const session = await createSession(user.id);
    const workspaceId = await ensurePersonalWorkspace(user.id);
    const dashboard = await createDashboard({ workspaceId, name: "Ids", description: "", widgets: [], createdBy: user.id });
    const widget = { id: "orders,refunds", type: "table", title: "Orders", layout: { x: 0, y: 0, w: 6, h: 4 }, dataSourceId: "warehouse", query: { resource: "orders" } };

    expect((await call("PATCH", session, workspaceId, dashboard.id, { widgets: [widget] })).status).toBe(400);
    expect((await getDashboard(workspaceId, dashboard.id))?.widgets).toEqual([]);
  });
});
