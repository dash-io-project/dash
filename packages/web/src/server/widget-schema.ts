import { z } from "zod";
import {
  type DashboardWidget,
  FILTER_OPERATORS,
  isChartType,
  MAX_SNAPSHOT_COLUMNS,
  MAX_SNAPSHOT_ROWS,
} from "@dash/core";

/** The longest text value that a snapshot cell can hold. */
const MAX_SNAPSHOT_TEXT = 1_000;

/** The most bytes of JSON that the rows of one snapshot can use. */
export const MAX_SNAPSHOT_BYTES = 256 * 1024;

/**
 * The most bytes of JSON that all snapshots on one dashboard can use. The
 * rows are part of the dashboard document, and MongoDB refuses a document
 * over 16 MiB. This budget keeps a dashboard well below that limit.
 */
export const MAX_DASHBOARD_SNAPSHOT_BYTES = 2 * 1024 * 1024;

/** The UTF-8 size of a value as JSON. */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** The bytes of JSON that the snapshot rows of these widgets use. */
export function snapshotBytes(widgets: readonly { id: string; snapshot?: { rows: unknown } }[]): number {
  return widgets.reduce((total, widget) => total + (widget.snapshot ? jsonBytes(widget.snapshot.rows) : 0), 0);
}

/**
 * A snapshot column name. The name is a key in a stored MongoDB document, so
 * it cannot start with `$` or contain `.`. Zod drops a `__proto__` key from a
 * parsed record.
 */
const snapshotColumnSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/, "Use 1 to 64 letters, digits, `_`, or `-` for a column name");

const snapshotCellSchema = z.union([z.string().max(MAX_SNAPSHOT_TEXT), z.number(), z.boolean(), z.null()]);

const snapshotRowSchema = z
  .record(snapshotColumnSchema, snapshotCellSchema)
  .refine((row) => Object.keys(row).length > 0, "A row needs at least one column")
  .refine(
    (row) => Object.keys(row).length <= MAX_SNAPSHOT_COLUMNS,
    `A row can have at most ${MAX_SNAPSHOT_COLUMNS} columns`,
  );

export const snapshotRowsSchema = z
  .array(snapshotRowSchema)
  .min(1)
  .max(MAX_SNAPSHOT_ROWS)
  .refine(
    (rows) => jsonBytes(rows) <= MAX_SNAPSHOT_BYTES,
    `The rows can use at most ${MAX_SNAPSHOT_BYTES / 1024} KiB of JSON`,
  );

const layoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const querySchema = z.object({
  resource: z.string(),
  columns: z.array(z.string()).optional(),
  filters: z
    .array(
      z.object({
        column: z.string(),
        op: z.enum(FILTER_OPERATORS),
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
  limit: z.number().optional(),
  offset: z.number().optional(),
});

type WithoutNull<T> = { [K in keyof T]: Exclude<T[K], null> };

/** Drop the fields that are null or undefined. */
function withoutUnset<T extends Record<string, unknown>>(value: T): WithoutNull<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== null && field !== undefined),
  ) as WithoutNull<T>;
}

// MongoDB stores an undefined field as null. Thus a chart that `add_chart_widget`
// saved before this schema can have null in each unset field. The schema accepts
// null and drops the field, so the page can save that dashboard again.
const chartSchema = z
  .object({
    type: z.string().refine((value) => isChartType(value)),
    title: z.string().nullish(),
    encode: z
      .object({
        x: z.string().nullish(),
        y: z.union([z.string(), z.array(z.string())]).nullish(),
        color: z.string().nullish(),
        name: z.string().nullish(),
        value: z.string().nullish(),
      })
      .transform(withoutUnset),
    stacked: z.boolean().nullish(),
    smooth: z.boolean().nullish(),
  })
  .transform(withoutUnset);

const kpiSchema = z.object({
  aggregation: z.enum(["sum", "avg", "count", "min", "max"]),
  column: z.string(),
  format: z.enum(["number", "currency", "percent"]).optional(),
});

const widgetBase = {
  // A widget link puts ids in one search value, with commas between them.
  id: z.string().regex(/^[^,\s]+$/, "A widget id cannot contain a comma or whitespace"),
  type: z.enum(["chart", "table", "kpi"]),
  title: z.string(),
  layout: layoutSchema,
  chart: chartSchema.optional(),
  kpi: kpiSchema.optional(),
};

// Dash owns `savedAt`. The schema drops the value that a client sends, and
// `stampSnapshots` sets it.
const snapshotWidgetSchema = z.object({
  ...widgetBase,
  snapshot: z.object({ rows: snapshotRowsSchema }),
});

const queryWidgetSchema = z.object({
  ...widgetBase,
  dataSourceId: z.string(),
  query: querySchema,
});

/**
 * A dashboard widget in a REST request body. The snapshot form comes first:
 * a widget with saved rows keeps them, and Dash drops its query fields.
 */
export const widgetSchema = z.union([snapshotWidgetSchema, queryWidgetSchema]);

type ParsedWidget = z.output<typeof widgetSchema>;

/**
 * Give each snapshot its save date. A snapshot keeps its stored date when its
 * rows did not change. Each other snapshot gets `now`. Thus a client cannot
 * make the rows look older or newer than they are.
 */
export function stampSnapshots(
  widgets: readonly ParsedWidget[],
  stored: readonly DashboardWidget[],
  now: string,
): DashboardWidget[] {
  const before = new Map(stored.flatMap((widget) => (widget.snapshot ? [[widget.id, widget.snapshot] as const] : [])));
  return widgets.map((widget) => {
    if (!("snapshot" in widget)) return widget;
    const previous = before.get(widget.id);
    const unchanged = previous && JSON.stringify(previous.rows) === JSON.stringify(widget.snapshot.rows);
    return { ...widget, snapshot: { rows: widget.snapshot.rows, savedAt: unchanged ? previous.savedAt : now } };
  });
}

/** The widget list of one dashboard in a REST request body. */
export const widgetListSchema = z
  .array(widgetSchema)
  .refine(
    (widgets) => snapshotBytes(widgets) <= MAX_DASHBOARD_SNAPSHOT_BYTES,
    `The snapshots on one dashboard can use at most ${MAX_DASHBOARD_SNAPSHOT_BYTES / 1024 / 1024} MiB of JSON`,
  );
