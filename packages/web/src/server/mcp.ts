import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type ApiTokenScope, type Dashboard, type DashboardWidget, isChartType } from "@dash/core";
import { ensurePersonalWorkspace, getWorkspace } from "./services/workspaces.ts";
import { findUserById, toPublicUser } from "./auth.ts";
import { randomId } from "./crypto.ts";
import type { WorkspaceAuthContext } from "./http.ts";
import { nowIso } from "./db.ts";
import { publicOrigin } from "./oauth.ts";
import { jsonBytes, MAX_DASHBOARD_SNAPSHOT_BYTES, snapshotBytes, snapshotRowsSchema } from "./widget-schema.ts";
import { dashboardUrl, widgetUrl } from "../lib/dashboard-links.ts";
import {
  createDashboard,
  getDashboard,
  listDashboards,
  appendDashboardWidget,
} from "./services/dashboards.ts";
import { listDataSources } from "./services/data-sources.ts";
import { queryDataSource, schemaForDataSource } from "./services/query.ts";

/** Combined array elements and object members allowed in one tools/call payload. */
const MAX_TOOL_INPUT_ELEMENTS = 10_000;

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** Drop the undefined fields. MongoDB stores an undefined field as null. */
function definedFields<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

/**
 * Build the tools for one request. `origin` is the public address of Dash.
 * Each dashboard in a response gets a `dashboardUrl`, and each widget gets a
 * `widgetUrl` that opens only that widget.
 */
function buildServer(auth: WorkspaceAuthContext, origin: string): McpServer {
  const linked = (dashboard: Dashboard) => ({
    ...dashboard,
    dashboardUrl: dashboardUrl(origin, dashboard),
    widgets: dashboard.widgets.map((widget) => ({ ...widget, widgetUrl: widgetUrl(origin, dashboard, [widget.id]) })),
  });

  const server = new McpServer(
    {
      name: "dash",
      version: "0.0.0",
    },
    // GHSA-46jr-4wx8-v453: the 2.3 limit is off unless set. Reject oversized
    // tool arguments before schema validation can exhaust memory.
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
  );

  server.registerTool(
    "list_data_sources",
    {
      description: "List configured Dash data sources the caller can query.",
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await listDataSources(), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "get_schema",
    {
      description: "Introspect tables/collections and columns for a data source.",
      inputSchema: z.object({
        dataSourceId: z.string(),
      }),
    },
    async ({ dataSourceId }) => {
      const schema = await schemaForDataSource(dataSourceId);
      return { content: [{ type: "text", text: JSON.stringify(schema, null, 2) }] };
    },
  );

  server.registerTool(
    "query_data",
    {
      description:
        "Run a structured query against a data source. Identifiers are validated; values are bound as parameters.",
      inputSchema: z.object({
        dataSourceId: z.string(),
        resource: z.string(),
        columns: z.array(z.string()).optional(),
        filters: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "like", "ilike"]),
              value: z.unknown(),
            }),
          )
          .optional(),
        orderBy: z
          .array(
            z.object({
              column: z.string(),
              direction: z.enum(["asc", "desc"]),
            }),
          )
          .optional(),
        limit: z.number().int().positive().max(10000).optional(),
      }),
    },
    async (input) => {
      const result = await queryDataSource(input.dataSourceId, {
        resource: input.resource,
        columns: input.columns,
        filters: input.filters,
        orderBy: input.orderBy,
        limit: input.limit,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "list_dashboards",
    {
      description:
        "List dashboard pages in this Dash workspace. Each dashboard has a `dashboardUrl`, and each widget has a `widgetUrl`. The user can open these links.",
    },
    async () => textResult((await listDashboards(auth.workspace.id)).map(linked)),
  );

  server.registerTool(
    "get_dashboard",
    {
      description: [
        "Get one dashboard and its widgets. The dashboard has a `dashboardUrl`.",
        "Each widget has a `widgetUrl` that opens only that widget, for example one table or one chart.",
        "To show more than one widget, put their ids in the `widgets` value of the link, with commas between them.",
      ].join(" "),
      inputSchema: z.object({ dashboardId: z.string() }),
    },
    async ({ dashboardId }) => {
      const dashboard = await getDashboard(auth.workspace.id, dashboardId);
      if (!dashboard) {
        return errorResult("Dashboard not found");
      }
      return textResult(linked(dashboard));
    },
  );

  if (auth.scopes.includes("write") && auth.workspace.role !== "viewer") {
    server.registerTool(
      "create_dashboard",
      {
        description:
          "Create an empty dashboard page. The response has a `dashboardUrl`. Give this link to the user.",
        inputSchema: z.object({
          name: z.string(),
          description: z.string().optional(),
        }),
      },
      async ({ name, description }) => {
        const dashboard = await createDashboard({
          workspaceId: auth.workspace.id,
          name,
          description: description ?? "",
          widgets: [],
          createdBy: auth.user.id,
        });
        return textResult(linked(dashboard));
      },
    );

    server.registerTool(
      "add_chart_widget",
      {
        description: [
          "Add a chart widget to a dashboard.",
          "For a live chart, give `dataSourceId` and `resource`. Query the data first, so that the encode fields match the returned columns.",
          "For a snapshot chart, give `rows` that you calculated. Dash saves the rows with the chart. The rows do not refresh.",
          "The response has `dashboardUrl` and `chartUrl`. `chartUrl` opens only the new chart. Give these links to the user.",
        ].join(" "),
        inputSchema: z.object({
          dashboardId: z.string(),
          title: z.string(),
          dataSourceId: z.string().optional().describe("Live chart: the data source to query. Use with `resource`."),
          resource: z.string().optional().describe("Live chart: the table, view, or collection to query."),
          rows: snapshotRowsSchema
            .optional()
            .describe(
              'Snapshot chart: 1 to 1,000 rows of calculated data, up to 256 KiB of JSON, for example [{"hour": 0, "weekday_average": 1.5}]. Do not use with `dataSourceId` or `resource`.',
            ),
          chartType: z.string(),
          x: z.string().optional(),
          y: z.union([z.string(), z.array(z.string())]).optional(),
          color: z.string().optional(),
          name: z.string().optional(),
          value: z.string().optional(),
          stacked: z.boolean().optional(),
          smooth: z.boolean().optional(),
        }),
      },
      async (input) => {
        if (!isChartType(input.chartType)) {
          return errorResult(`Unsupported chart type: ${input.chartType}`);
        }
        const live = input.dataSourceId !== undefined || input.resource !== undefined;
        if (input.rows && live) {
          return errorResult("Give `rows` for a snapshot chart, or `dataSourceId` and `resource` for a live chart. Do not give both.");
        }
        if (!input.rows && (!input.dataSourceId || !input.resource)) {
          return errorResult("Give `dataSourceId` and `resource` for a live chart, or `rows` for a snapshot chart.");
        }
        const columns = [input.x, input.name, input.value]
          .concat(Array.isArray(input.y) ? input.y : input.y ? [input.y] : [])
          .concat(input.color ? [input.color] : [])
          .filter((column): column is string => Boolean(column));
        if (input.rows) {
          const present = new Set(input.rows.flatMap((row) => Object.keys(row)));
          const missing = columns.filter((column) => !present.has(column));
          if (missing.length > 0) {
            return errorResult(`These encode fields are not columns in \`rows\`: ${missing.join(", ")}`);
          }
        }
        const dashboard = await getDashboard(auth.workspace.id, input.dashboardId);
        if (!dashboard) {
          return errorResult("Dashboard not found");
        }
        const y = dashboard.widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);
        const base = {
          id: randomId(),
          type: "chart" as const,
          title: input.title,
          layout: { x: 0, y, w: 12, h: 5 },
          chart: {
            type: input.chartType,
            encode: definedFields({
              x: input.x,
              y: input.y,
              color: input.color,
              name: input.name,
              value: input.value,
            }),
            ...definedFields({ stacked: input.stacked, smooth: input.smooth }),
          },
        };
        const widget: DashboardWidget = input.rows
          ? { ...base, snapshot: { rows: input.rows, savedAt: nowIso() } }
          : { ...base, dataSourceId: input.dataSourceId!, query: { resource: input.resource!, columns } };
        const rowBytes = input.rows ? jsonBytes(input.rows) : 0;
        const updated = await appendDashboardWidget(
          auth.workspace.id,
          input.dashboardId,
          widget,
          (widgets) => rowBytes === 0 || snapshotBytes(widgets) + rowBytes <= MAX_DASHBOARD_SNAPSHOT_BYTES,
        );
        if (updated === "rejected") {
          return errorResult(
            `The snapshots on one dashboard can use at most ${MAX_DASHBOARD_SNAPSHOT_BYTES / 1024 / 1024} MiB of JSON. Give fewer rows, or add the chart to a different dashboard.`,
          );
        }
        if (!updated) {
          return errorResult("Dashboard not found");
        }
        return textResult({
          ...linked(updated),
          widgetId: widget.id,
          chartUrl: widgetUrl(origin, updated, [widget.id]),
        });
      },
    );
  }

  return server;
}

export const mcpHandler = createMcpHandler(
  async ({ authInfo, requestInfo }) => {
    if (!authInfo?.clientId) {
      throw new Error("MCP requires authentication");
    }
    if (!requestInfo) {
      throw new Error("MCP requires an HTTP request");
    }
    const row = await findUserById(authInfo.clientId);
    if (!row) {
      throw new Error("Unknown MCP user");
    }
    const user = toPublicUser(row);
    const workspaceId = authInfo.extra?.workspaceId;
    const workspace = await getWorkspace(user, typeof workspaceId === "string" ? workspaceId : await ensurePersonalWorkspace(user.id));
    const auth: WorkspaceAuthContext = {
      workspace,
      user,
      scopes: (authInfo.scopes ?? ["read", "mcp"]) as ApiTokenScope[],
      via: "token",
    };
    return buildServer(auth, publicOrigin(requestInfo));
  },
  // Tool payloads are small structured queries. Cap the body well under the
  // SDK default so a single request cannot force a multi-megabyte parse.
  { maxRequestBodySize: 1_048_576 },
);
