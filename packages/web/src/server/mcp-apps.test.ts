import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "@dash/core";
import { viewSchema, RESOURCE_URI } from "../mcp-app/contract.ts";

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), query: vi.fn(), workspace: vi.fn() }));
vi.mock("./services/dashboards.ts", () => ({ getDashboard: mocks.dashboard, listDashboards: vi.fn(), createDashboard: vi.fn(), appendDashboardWidget: vi.fn() }));
vi.mock("./services/query.ts", () => ({ queryDataSource: mocks.query, schemaForDataSource: vi.fn() }));
vi.mock("./auth.ts", () => ({ findUserById: async () => ({ id: "user" }), toPublicUser: (user: unknown) => user }));
vi.mock("./services/workspaces.ts", () => ({ getWorkspace: mocks.workspace, ensurePersonalWorkspace: async () => "workspace" }));
import { mcpHandler } from "./mcp.ts";

const layout = { x: 0, y: 0, w: 6, h: 4 };
const dashboard: Dashboard = {
  id: "dashboard", workspaceId: "workspace", name: "Synthetic sales", description: "", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "user",
  widgets: [
    { id: "live", title: "Sales", type: "chart", layout, dataSourceId: "source", query: { resource: "sales", filters: [{ column: "open", op: "eq", value: true }], orderBy: [{ column: "sales", direction: "desc" }], limit: 5 }, chart: { type: "bar", encode: { x: "name", y: ["sales", "cost"] } } },
    { id: "saved", title: "Saved count", type: "kpi", layout, kpi: { aggregation: "sum", column: "count", format: "number" }, snapshot: { savedAt: "2026-01-01T00:00:00Z", rows: [{ count: 7 }] } },
    { id: "table", title: "Tickets", type: "table", layout, dataSourceId: "tickets", query: { resource: "tickets" } },
  ],
};
async function request(method: string, params: unknown) {
  const response = await mcpHandler.fetch(new Request("https://dash.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), { authInfo: { clientId: "user", token: "synthetic", scopes: ["read", "mcp"], extra: { workspaceId: "workspace" } } });
  const body = await response.text();
  const data = body.startsWith("event:") ? body.split("\n").find((line) => line.startsWith("data:"))!.slice(5) : body;
  return JSON.parse(data);
}
async function call(name: string, args: unknown) { return (await request("tools/call", { name, arguments: args })).result; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({ id: "workspace", role: "viewer" });
  mocks.dashboard.mockResolvedValue(structuredClone(dashboard));
  mocks.query.mockResolvedValue({ rows: [{ name: "Example", sales: 10, cost: 4 }], columns: [], rowCount: 1, truncated: true });
});
describe("MCP dashboard apps", () => {
  it("discovers read-only tools and reads their bundled resource", async () => {
    const listed = (await request("tools/list", {})).result.tools;
    for (const name of ["show_dashboard", "show_widget"]) {
      const tool = listed.find((tool: { name: string }) => tool.name === name);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool._meta.ui.resourceUri).toBe(RESOURCE_URI);
      expect(tool.outputSchema.properties.widgets).toBeDefined();
      expect(tool.inputSchema.required).toContain("dashboardId");
    }
    expect(listed.find((tool: { name: string }) => tool.name === "get_dashboard")._meta?.ui).toBeUndefined();
    const resources = (await request("resources/list", {})).result.resources;
    expect(resources).toContainEqual(expect.objectContaining({ uri: RESOURCE_URI, mimeType: "text/html;profile=mcp-app" }));
    const resource = (await request("resources/read", { uri: RESOURCE_URI })).result.contents[0];
    expect(resource.text).toContain('<div id="root">');
    expect(resource.text).toContain("<script type=\"module\">");
    expect(resource.text).not.toMatch(/<script[^>]+src=/);
    expect(resource.text).not.toContain("process.env.NODE_ENV");
    expect(resource._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
  });
  it("returns only one live widget and preserves its saved query and encodings", async () => {
    const result = await call("show_widget", { dashboardId: "dashboard", widgetId: "live" });
    const view = viewSchema.parse(result.structuredContent);
    expect(view.mode).toBe("widget");
    expect(view.widgets.map((widget) => widget.id)).toEqual(["live"]);
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith("source", dashboard.widgets[0]!.query);
    expect(mocks.dashboard).toHaveBeenCalledWith("workspace", "dashboard");
    expect(view.widgets[0]).toMatchObject({ truncated: true, chart: dashboard.widgets[0]!.chart, rows: [{ name: "Example", sales: 10, cost: 4 }] });
    expect(view.url).toContain("live");
    expect(JSON.stringify(result)).not.toContain("Saved count");
    expect(JSON.stringify(result)).not.toContain("Tickets");
    expect(result.content[0].text).toContain(view.url);
  });
  it("returns the full dashboard and accepts legacy null chart options", async () => {
    const legacy = structuredClone(dashboard);
    Object.assign(legacy.widgets[0]!.chart!, { smooth: null });
    Object.assign(legacy.widgets[0]!.chart!.encode, { color: null });
    mocks.dashboard.mockResolvedValue(legacy);
    const result = await call("show_dashboard", { dashboardId: "dashboard" });
    const view = viewSchema.parse(result.structuredContent);
    expect(view.widgets.map((widget) => widget.id)).toEqual(["live", "saved", "table"]);
    expect(view.widgets[2]!.rows).toEqual([{ name: "Example", sales: 10, cost: 4 }]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it("refreshes snapshots without a query or a new saved timestamp", async () => {
    for (let refresh = 0; refresh < 2; refresh++) {
      const result = await call("show_widget", { dashboardId: "dashboard", widgetId: "saved" });
      expect(viewSchema.parse(result.structuredContent).widgets[0]).toMatchObject({ source: "snapshot", savedAt: "2026-01-01T00:00:00Z", rows: [{ count: 7 }], kpi: { aggregation: "sum", column: "count", format: "number" } });
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("keeps dashboard order and partial errors without query details", async () => {
    mocks.query.mockRejectedValue(new Error("secret connection details"));
    const result = await call("show_dashboard", { dashboardId: "dashboard", widgetIds: ["saved", "live"] });
    const view = viewSchema.parse(result.structuredContent);
    expect(view.widgets.map((widget) => widget.id)).toEqual(["live", "saved"]);
    expect(view.widgets[0]!.error).toBeDefined();
    expect(view.widgets[1]!.rows).toEqual([{ count: 7 }]);
    expect(JSON.stringify(result)).not.toContain("secret connection details");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("rejects missing widgets before any query and never falls back", async () => {
    for (const [name, args] of [["show_widget", { dashboardId: "dashboard", widgetId: "missing" }], ["show_dashboard", { dashboardId: "dashboard", widgetIds: ["live", "missing"] }]] as const) {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(viewSchema.parse(result.structuredContent).widgets).toEqual([]);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("rechecks access on refresh and rejects a dashboard outside the workspace", async () => {
    await call("show_widget", { dashboardId: "dashboard", widgetId: "saved" });
    mocks.dashboard.mockResolvedValue(undefined);
    const result = await call("show_widget", { dashboardId: "dashboard", widgetId: "saved" });
    expect(result.isError).toBe(true);
    expect(viewSchema.parse(result.structuredContent).widgets).toEqual([]);
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns unsupported widgets without a query and an empty dashboard without failure", async () => {
    const broken = structuredClone(dashboard);
    broken.widgets[0]!.chart = undefined;
    mocks.dashboard.mockResolvedValue(broken);
    expect((await call("show_widget", { dashboardId: "dashboard", widgetId: "live" })).structuredContent.widgets[0].error).toContain("not supported");
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.dashboard.mockResolvedValue({ ...dashboard, widgets: [] });
    expect(viewSchema.parse((await call("show_dashboard", { dashboardId: "dashboard" })).structuredContent).widgets).toEqual([]);
  });
  it("rejects duplicate widget IDs without a query", async () => {
    mocks.dashboard.mockResolvedValue({ ...dashboard, widgets: [dashboard.widgets[0], dashboard.widgets[0]] });
    const result = await call("show_widget", { dashboardId: "dashboard", widgetId: "live" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.widgets).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("bounds the full-dashboard query count before execution", async () => {
    for (const [count, template] of [[11, dashboard.widgets[0]!], [21, dashboard.widgets[1]!]] as const) {
      mocks.dashboard.mockResolvedValue({ ...dashboard, widgets: Array.from({ length: count }, (_, i) => ({ ...template, id: String(i) })) });
      const result = await call("show_dashboard", { dashboardId: "dashboard" });
      expect(result.isError).toBe(true);
      expect(mocks.query).not.toHaveBeenCalled();
    }
  });
  it("rejects concurrent views from the same caller and releases the slot", async () => {
    let release!: (value: unknown) => void;
    mocks.query.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = call("show_widget", { dashboardId: "dashboard", widgetId: "live" });
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
    const second = await call("show_widget", { dashboardId: "dashboard", widgetId: "live" });
    release({ rows: [], truncated: false });
    await first;
    expect(second.isError).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect((await call("show_widget", { dashboardId: "dashboard", widgetId: "saved" })).isError).not.toBe(true);
  });
  it("bounds response bytes and marks omitted data explicitly", async () => {
    mocks.query.mockResolvedValue({ rows: [{ text: "x".repeat(3 * 1024 * 1024) }], truncated: false });
    const result = await call("show_widget", { dashboardId: "dashboard", widgetId: "live" });
    expect(JSON.stringify(result).length).toBeLessThan(2 * 1024 * 1024);
    expect(result.structuredContent.widgets[0]).toMatchObject({ rows: [], truncated: true, error: expect.any(String) });
  });
  it("stops live queries at the total row budget without partial KPI values", async () => {
    mocks.dashboard.mockResolvedValue({ ...dashboard, widgets: Array.from({ length: 3 }, (_, i) => ({ ...dashboard.widgets[0], id: String(i) })) });
    mocks.query.mockResolvedValue({ rows: Array.from({ length: 10_000 }, () => ({ sales: 1 })), truncated: false });
    const result = await call("show_dashboard", { dashboardId: "dashboard" });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(result.structuredContent.widgets[2]).toMatchObject({ rows: [], truncated: true, error: expect.any(String) });
  });
  it("rejects a saved query above the limit without changing it", async () => {
    const large = structuredClone(dashboard);
    large.widgets[0]!.query!.limit = 20_000;
    mocks.dashboard.mockResolvedValue(large);
    const result = await call("show_widget", { dashboardId: "dashboard", widgetId: "live" });
    expect(result.structuredContent.widgets[0].error).toContain("10,000");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("requires IDs and a nonempty selection", async () => {
    for (const [name, args] of [["show_widget", { dashboardId: "dashboard" }], ["show_dashboard", { dashboardId: "dashboard", widgetIds: [] }]] as const) {
      const result = await request("tools/call", { name, arguments: args });
      expect(Boolean(result.error || result.result?.isError)).toBe(true);
    }
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
