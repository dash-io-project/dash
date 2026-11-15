import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardWidget } from "@dash/core";
import { createSession, createUser } from "./auth.ts";
import { createDashboard } from "./services/dashboards.ts";
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
});
