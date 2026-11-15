# ADR 0015: Snapshot charts and dashboard links in MCP

## Status

Accepted

## Context

An agent can calculate chart data that the saved query of a widget cannot express. An example is the average number of tickets for each hour of the day, with weekdays and weekends in different series. The saved query selects, filters, sorts, and limits rows. It cannot group timestamps, convert time zones, or divide counts by a number of days.

Before this change, `add_chart_widget` accepted only a data source and a resource. Thus the agent could not save the chart that it calculated. The MCP responses also did not include a link, so the agent could not give the dashboard to the user.

## Decision

- A widget has one of two data forms. A query widget has `dataSourceId` and `query`. A snapshot widget has `snapshot: { rows, savedAt }` and no query. `DashboardWidget` in `@dash/core` is a union of `QueryWidget` and `SnapshotWidget`.
- `add_chart_widget` accepts `rows`. The agent gives `rows`, or `dataSourceId` and `resource`. The tool refuses both, and it refuses neither. Each encode field must be a column in one or more rows.
- A snapshot has 1 to 1,000 rows. A row has 1 to 50 columns. A column name starts with a letter or `_`, and it has 1 to 64 letters, digits, `_`, or `-`. A value is a string of up to 1,000 characters, a number, a boolean, or null. The rows of one snapshot can use 256 KiB of JSON. The snapshots on one dashboard can use 2 MiB of JSON in total. The rows are part of the dashboard document, and MongoDB refuses a document over 16 MiB. Thus the REST routes and `add_chart_widget` check both budgets before Dash saves the rows. The MCP limits of 1 MiB for each request and 10,000 input elements also apply.
- Dash sets `savedAt` when it saves the rows. The widget card shows a **Snapshot** label with that date. The card does not send a query for a snapshot widget.
- The REST dashboard routes use one widget schema. When the dashboard page sends its widget list back, each snapshot keeps its rows. When a widget has both forms, Dash keeps the snapshot and drops the query fields.
- MongoDB stores an undefined field as null. `add_chart_widget` does not store unset chart fields. The REST widget schema accepts null in the optional chart fields and drops those fields, so a chart from an earlier version does not block a save.
- The MCP dashboard responses include `dashboardUrl`, and `widgetUrl` for each widget. `add_chart_widget` also returns `widgetId` and `chartUrl`. The links use the public origin from [ADR 0014](0014-mcp-oauth.md).
- A dashboard link has the `workspace` search value, so it opens the workspace that owns the dashboard. The router encodes each search value, so a hex id such as `123e4567` stays a string.
- A widget link adds the `widgets` search value to the dashboard link. The value holds widget ids, with commas between them. The page then shows only those widgets, in dashboard order, with a **Show all widgets** link. One widget fills the width. The view does not show the edit controls. `chartUrl` is the widget link of the new chart.
- Each widget card has a **Copy link** button that copies its widget link. The link works for each widget type.
- When a signed-out user opens a Dash page, the login page returns to that page after sign-in.

## Consequences

An agent can save a chart from data that it calculated, and it can give the user a link to the chart. A user can share one widget, or a set of widgets, with a member of the workspace. A snapshot does not refresh. To show new data, the agent adds a new chart.

A link opens only for a signed-in member of the workspace. A public link for a person without a Dash account needs a different access model, and this ADR does not add one.

A live chart still cannot group by hour of day, convert time zones, split weekdays from weekends, divide by a number of days, or show empty buckets. These transforms need a change to `AdapterQuery` and to each adapter. A later ADR can define them.
