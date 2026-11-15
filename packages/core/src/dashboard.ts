import type { AdapterQuery } from "./adapter.ts";
import type { ChartSpec } from "./chart.ts";

export interface GridLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WidgetType = "chart" | "table" | "kpi";

export interface KpiSpec {
  aggregation: "sum" | "avg" | "count" | "min" | "max";
  column: string;
  format?: "number" | "currency" | "percent";
}

/** One value in a snapshot row. */
export type SnapshotCell = string | number | boolean | null;

/** The most rows that one snapshot widget can keep. */
export const MAX_SNAPSHOT_ROWS = 1_000;

/** The most columns that one snapshot row can have. */
export const MAX_SNAPSHOT_COLUMNS = 50;

/**
 * Rows that the caller calculated and saved with the widget. Dash shows
 * these rows as they are. They do not refresh.
 */
export interface WidgetSnapshot {
  rows: Record<string, SnapshotCell>[];
  /** ISO time when Dash saved the rows. */
  savedAt: string;
}

interface WidgetBase {
  id: string;
  type: WidgetType;
  title: string;
  layout: GridLayout;
  chart?: ChartSpec;
  kpi?: KpiSpec;
}

/** A widget that runs its query on a data source each time that it renders. */
export interface QueryWidget extends WidgetBase {
  dataSourceId: string;
  query: AdapterQuery;
  snapshot?: undefined;
}

/** A widget that shows saved rows and does not read a data source. */
export interface SnapshotWidget extends WidgetBase {
  snapshot: WidgetSnapshot;
  dataSourceId?: undefined;
  query?: undefined;
}

export type DashboardWidget = QueryWidget | SnapshotWidget;

export interface Dashboard {
  workspaceId: string;
  id: string;
  name: string;
  description: string;
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
