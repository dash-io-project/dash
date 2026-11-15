import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import { createUser } from "./auth.ts";
import { createDashboard, getDashboard } from "./services/dashboards.ts";
import { createWorkspace, ensurePersonalWorkspace, setWorkspaceMember } from "./services/workspaces.ts";
import { mcpHandler } from "./mcp.ts";
import { destroyAppDatabase, useFreshAppDatabase } from "./test-db.ts";
import { parseWidgetIds } from "../lib/dashboard-links.ts";

function mcpRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });
}

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

/** Call one tool as a writer in `workspaceId`, behind a proxy at https://dash.example.com. */
async function callTool(userId: string, workspaceId: string, name: string, args: unknown): Promise<ToolResult> {
  const response = await mcpHandler.fetch(
    mcpRequest(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "dash.example.com",
    }),
    { authInfo: { token: "test-token", clientId: userId, scopes: ["read", "write", "mcp"], extra: { workspaceId } } },
  );
  expect(response.status).toBe(200);
  return JSON.parse(jsonFromBody(await response.text())).result;
}

describe("mcp handler", () => {
  beforeEach(async () => {
    await useFreshAppDatabase();
  });

  afterEach(async () => {
    await destroyAppDatabase();
  });

  it("rejects a body over 1 MiB", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { pad: "x".repeat(1_048_576) },
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(1_048_576);
    const response = await mcpHandler.fetch(mcpRequest(body));
    expect(response.status).toBe(413);
  });

  it("builds a server per request for an authenticated caller", async () => {
    const user = await createUser({
      email: "mcp@example.com",
      name: "MCP",
      password: "password123",
      role: "admin",
    });
    const response = await mcpHandler.fetch(
      mcpRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "dash-test", version: "0.0.0" },
          },
        }),
      ),
      {
        authInfo: {
          token: "test-token",
          clientId: user.id,
          scopes: ["read", "mcp"],
        },
      },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const payload = JSON.parse(jsonFromBody(text)) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(payload.result?.serverInfo?.name).toBe("dash");
  });

  it("rejects a tool call with too many input elements", async () => {
    const user = await createUser({
      email: "mcp-limit@example.com",
      name: "MCP",
      password: "password123",
      role: "admin",
    });
    const response = await mcpHandler.fetch(
      mcpRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "query_data",
            arguments: {
              dataSourceId: "demo",
              resource: "orders",
              columns: Array.from({ length: 10_001 }, () => "id"),
            },
          },
        }),
      ),
      {
        authInfo: {
          token: "test-token",
          clientId: user.id,
          scopes: ["read", "mcp"],
        },
      },
    );
    expect(response.status).toBe(200);
    const payload = JSON.parse(jsonFromBody(await response.text())) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text).toContain("10000");
  });

  it("scopes MCP reads and writes to the selected workspace", async () => {
    const user = await createUser({ email: "mcp-workspace@example.com", name: "MCP", password: "password123", role: "admin" });
    const personal = await ensurePersonalWorkspace(user.id);
    const shared = await createWorkspace(user, "Shared");
    const privateDashboard = await createDashboard({ workspaceId: personal, name: "Private", description: "", widgets: [], createdBy: user.id });
    const info = { token: "test-token", clientId: user.id, scopes: ["read", "write", "mcp"], extra: { workspaceId: shared.id } };
    async function call(name: string, args = {}) {
      const response = await mcpHandler.fetch(mcpRequest(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
      })), { authInfo: info });
      expect(response.status).toBe(200);
      return JSON.parse(jsonFromBody(await response.text())).result;
    }
    expect(JSON.parse((await call("list_dashboards")).content[0].text)).toEqual([]);
    expect((await call("get_dashboard", { dashboardId: privateDashboard.id })).isError).toBe(true);
    expect((await call("add_chart_widget", { dashboardId: privateDashboard.id, title: "No", dataSourceId: "demo", resource: "sales", chartType: "bar" })).isError).toBe(true);
    const dashboard = JSON.parse((await call("create_dashboard", { name: "Shared dashboard" })).content[0].text);
    expect(dashboard.workspaceId).toBe(shared.id);
    const updated = JSON.parse((await call("add_chart_widget", { dashboardId: dashboard.id, title: "Sales", dataSourceId: "demo", resource: "sales", chartType: "bar" })).content[0].text);
    expect(updated.widgets).toHaveLength(1);
    expect((await getDashboard(personal, privateDashboard.id))?.widgets).toEqual([]);
    expect(JSON.parse((await call("list_dashboards")).content[0].text).map((item: { id: string }) => item.id)).toEqual([dashboard.id]);
  });

  it("saves a snapshot chart from rows and links to the dashboard and to each widget", async () => {
    const user = await createUser({ email: "mcp-snapshot@example.com", name: "MCP", password: "password123", role: "admin" });
    const shared = await createWorkspace(user, "Support");
    const created = JSON.parse((await callTool(user.id, shared.id, "create_dashboard", { name: "Support load" })).content[0]!.text);
    const link = new URL(created.dashboardUrl);
    expect(link.origin).toBe("https://dash.example.com");
    expect(link.pathname).toBe(`/dashboards/${created.id}`);
    expect(defaultParseSearch(link.search)).toEqual({ workspace: shared.id });

    const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, weekday_average: hour / 2, weekend_average: hour / 4 }));
    const result = await callTool(user.id, shared.id, "add_chart_widget", {
      dashboardId: created.id,
      title: "Tickets by hour",
      chartType: "line",
      x: "hour",
      y: ["weekday_average", "weekend_average"],
      rows,
    });
    expect(result.isError).toBeUndefined();
    const added = JSON.parse(result.content[0]!.text);
    expect(added.dashboardUrl).toBe(created.dashboardUrl);
    const chart = new URL(added.chartUrl);
    expect(`${chart.origin}${chart.pathname}`).toBe(`${link.origin}${link.pathname}`);
    const search: Record<string, unknown> = defaultParseSearch(chart.search);
    expect([search.workspace, parseWidgetIds(search.widgets)]).toEqual([shared.id, [added.widgetId]]);

    const [widget] = (await getDashboard(shared.id, created.id))!.widgets;
    expect(widget).toMatchObject({ id: added.widgetId, snapshot: { rows } });
    expect(widget!.chart).toStrictEqual({ type: "line", encode: { x: "hour", y: ["weekday_average", "weekend_average"] } });
    expect(widget).not.toHaveProperty("dataSourceId");
    expect(Date.parse(widget!.snapshot!.savedAt)).not.toBeNaN();
    const fetched = JSON.parse((await callTool(user.id, shared.id, "get_dashboard", { dashboardId: created.id })).content[0]!.text);
    const listed = JSON.parse((await callTool(user.id, shared.id, "list_dashboards", {})).content[0]!.text);
    expect([fetched.dashboardUrl, listed[0].dashboardUrl]).toEqual([created.dashboardUrl, created.dashboardUrl]);
    expect([added.widgets[0].widgetUrl, fetched.widgets[0].widgetUrl, listed[0].widgets[0].widgetUrl]).toEqual([
      added.chartUrl,
      added.chartUrl,
      added.chartUrl,
    ]);
  });

  it("refuses a chart that has no source, two sources, or rows that do not match", async () => {
    const user = await createUser({ email: "mcp-snapshot-bad@example.com", name: "MCP", password: "password123", role: "admin" });
    const workspaceId = await ensurePersonalWorkspace(user.id);
    const dashboard = await createDashboard({ workspaceId, name: "Bad", description: "", widgets: [], createdBy: user.id });
    const chart = { dashboardId: dashboard.id, title: "Hourly", chartType: "line", x: "hour", y: "weekday_average" };
    const cases: Array<[unknown, string]> = [
      [{ ...chart }, "Give `dataSourceId` and `resource`"],
      [{ ...chart, dataSourceId: "warehouse" }, "Give `dataSourceId` and `resource`"],
      [{ ...chart, rows: [{ hour: 0, weekday_average: 1 }], dataSourceId: "warehouse" }, "Do not give both"],
      [{ ...chart, rows: [{ hour: 0, weekend_average: 1 }] }, "weekday_average"],
      [{ ...chart, rows: [{ hour: 0, weekday_average: { total: 1 } }] }, "rows.0.weekday_average"],
    ];
    for (const [args, message] of cases) {
      const result = await callTool(user.id, workspaceId, "add_chart_widget", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0]!.text).toContain(message);
    }
    expect((await getDashboard(workspaceId, dashboard.id))?.widgets).toEqual([]);
  });

  it("checks MCP membership again after a role change or removal", async () => {
    const owner = await createUser({ email: "owner@example.com", name: "Owner", password: "password123", role: "member" });
    const guest = await createUser({ email: "guest@example.com", name: "Guest", password: "password123", role: "admin" });
    const workspaceId = await ensurePersonalWorkspace(owner.id);
    await setWorkspaceMember(owner, workspaceId, guest.id, "editor");
    async function listTools() {
      return mcpHandler.fetch(mcpRequest(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })), {
        authInfo: { token: "test-token", clientId: guest.id, scopes: ["read", "write", "mcp"], extra: { workspaceId } },
      });
    }
    const editor = JSON.parse(jsonFromBody(await (await listTools()).text()));
    expect(editor.result.tools.map((tool: { name: string }) => tool.name)).toContain("create_dashboard");
    await setWorkspaceMember(owner, workspaceId, guest.id, "viewer");
    const viewer = JSON.parse(jsonFromBody(await (await listTools()).text()));
    expect(viewer.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("create_dashboard");
    await setWorkspaceMember(owner, workspaceId, guest.id, null);
    const removed = await listTools();
    expect(removed.status).toBeGreaterThanOrEqual(400);
  });
});

function jsonFromBody(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const dataLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error(`No JSON body in MCP response: ${text.slice(0, 200)}`);
  return dataLine.slice(dataLine.indexOf("{"));
}
