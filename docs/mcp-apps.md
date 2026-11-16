# MCP Apps

Dash has two read-only tools. Both tools use one resource, `ui://dash/dashboard-v1.html`.

| Tool | Input | Result |
| --- | --- | --- |
| `show_dashboard` | `dashboardId`, optional `widgetIds` | The dashboard or its selected widgets |
| `show_widget` | `dashboardId`, `widgetId` | Exactly one chart, table, or KPI |

Use `list_dashboards` or `get_dashboard` to find IDs. Do not guess an ID.
A missing dashboard or widget produces an explicit error. The tools do not change saved data or access settings.
`get_dashboard` and `query_data` remain data tools.

The response contains a text summary, a Dash link, and structured data that matches the output schema.
Clients without MCP Apps can use these fields. A widget link opens only that widget in Dash.

## Data and access

Each MCP request uses the existing OAuth, user, and workspace checks. The resolver checks dashboard access and widget membership before a query.
It rejects ambiguous widget IDs before any query.
A view permits at most 20 widgets, 10 live queries, 20,000 rows, and 2 MiB of structured data.
A saved live query above 10,000 rows produces an error; the service does not change its limit.
Oversized widget data produces an explicit error without partial KPI values.
Rejected rows consume the request budget. An oversized result stops all later live queries in that request.
The JSON check stops at a conservative byte budget before it builds an oversized response string.
The existing adapters buffer a query result before they return it. The 2 MiB limit is a response limit, not a driver-memory limit.
Source-side field limits and any configured adapter timeouts still govern the first query. This change does not add streaming to the shared adapter interface.
Each server process permits one active view per caller and 16 active views in total.
These limits are process-local; multiple server processes do not share the concurrency counter.
An active query holds its slot until the backend completes or fails.
It queries only the selected widgets. Data sources use the existing installation-wide access model.
The resolver passes each saved query to the existing query service without changes.
The renderer uses the existing chart, table, and KPI components. KPI aggregation uses the returned rows, as in Dash.
A truncated result has a warning. A query error stays within its widget. The error text does not expose adapter connection details.

Snapshots use saved rows and their saved timestamp. Refresh reads the snapshot again; it does not recalculate the rows.
The table retains its filter and sort state on a successful refresh. A failed refresh clears old data.
An older response cannot replace a newer view.

## Build and compatibility

`@modelcontextprotocol/ext-apps` 2.0.4 declares SDK v2 peer dependencies. Dash uses server, client, and core 2.4.0.
Do not use SDK v1 examples without a compatibility check.

Run `pnpm --filter @dash/web build:mcp` after a renderer change during development.
The web build, test, and dev scripts run this step automatically.
Vite bundles the renderer and CSS into one HTML resource. The server bundle contains that resource.
No CDN, external frame, browser credential, or `window.openai` API is required.

The resource requests no CSP network domains and uses the default host sandbox origin.
No OpenAI domain value is sent to Claude. OpenAI directory submission can require a dedicated origin; that is outside this change.
The view starts inline. It requests a larger mode only after a user action and only when the host offers that mode.
Host dimensions control the view size. Claude can report `fullscreen` for both a side panel and a full-screen view.

The layout preserves widget order and relative widths. It does not reproduce empty cells or absolute dashboard grid positions.
One widget fills the available width. Tables use bounded scroll areas and the existing row filter.

## Verification

Local tests use synthetic data and mocks. No real data-source credentials belong in the AI workspace.
Run credentialed end-to-end tests only in the approved CI setup.

Run these local checks:

```sh
pnpm typecheck
pnpm lint
pnpm --filter @dash/web build:mcp
pnpm --filter @dash/web exec vitest run src/server/mcp-apps.test.ts src/mcp-app/controller.test.ts src/lib/kpi.test.ts src/lib/chart/tanstack.test.ts
pnpm --filter @dash/web build
pnpm --filter @dash/site build
```

The full CI suite also starts the Docker test services, runs all tests, and checks server shutdown.
The AI workspace has no Docker executable, so that suite cannot run here.

### Manual host checks

Use an approved test deployment with synthetic dashboards. Do not use production data for these checks.

1. In ChatGPT, refresh the connector tool list after the server update. Reconnect the connector if the new tools do not appear.
2. In Claude web, refresh the connector after the update. Disconnect and reconnect it if its tool list stays stale.
3. In Claude Desktop, refresh the connector and reload the main window. Reconnect it if the new tools remain absent.
4. In each host, ask to show the sales dashboard. Confirm that the UI actually renders.
5. Ask to show a leaderboard chart, a ticket table, and a ticket-count KPI separately. Confirm that each view contains only that widget.
6. Test a chart with several series. Compare its encodings and values with Dash.
7. Refresh a live view. Confirm that its data changes and its table filter stays set.
8. Refresh a snapshot. Confirm that its saved rows and saved timestamp stay unchanged.
9. Open each view in Dash. Confirm that a single-widget link opens only that widget.
10. Test light and dark themes, narrow widths, keyboard focus, table scroll, and empty results.
11. Test one failed query within a dashboard and a truncated result. Confirm that the other widgets remain visible.
12. Revoke workspace access in the approved test setup. Refresh the view and confirm that old data disappears.
13. Test a missing widget ID. Confirm an error with no dashboard fallback.
14. Expand where supported. In Claude, resize the side panel and test full screen separately.
15. In a host without expansion support, confirm that the inline view works and the Expand control is absent.
16. In Claude Code, confirm the text, structured data, and link fallback. Do not count this as a UI test.

| Host | Status in this change |
| --- | --- |
| ChatGPT | Not tested in the actual host |
| Claude web | Not tested in the actual host |
| Claude Desktop | Not tested in the actual host |
| Claude Code | Not tested; no UI claim |

Passing protocol tests or an MCP Inspector check does not prove that a host rendered the UI.

## References

- [MCP Apps quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html)
- [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI reference](https://developers.openai.com/plugins/reference)
- [Claude MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started)
- [Claude display modes](https://claude.com/docs/connectors/building/mcp-apps/display-modes)
