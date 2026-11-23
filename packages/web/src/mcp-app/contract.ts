import { z } from "zod";

const row = z.record(z.string(), z.unknown());
export const viewSchema = z.object({
  mode: z.enum(["dashboard", "widget"]),
  dashboardId: z.string(),
  widgetIds: z.array(z.string()).optional(),
  title: z.string(),
  url: z.string(),
  resolvedAt: z.string(),
  errors: z.array(z.string()),
  widgets: z.array(z.object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    layout: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    chart: z.object({
      type: z.string(),
      title: z.string().optional(),
      encode: z.object({ x: z.string().optional(), y: z.union([z.string(), z.array(z.string())]).optional(), color: z.string().optional(), name: z.string().optional(), value: z.string().optional() }),
      stacked: z.boolean().optional(), smooth: z.boolean().optional(),
    }).optional(),
    kpi: z.object({ aggregation: z.enum(["sum", "avg", "count", "min", "max"]), column: z.string(), format: z.enum(["number", "currency", "percent"]).optional() }).optional(),
    rows: z.array(row),
    truncated: z.boolean(),
    source: z.enum(["live", "snapshot"]),
    savedAt: z.string().optional(),
    resolvedAt: z.string(),
    error: z.string().optional(),
    url: z.string(),
  })),
});
export type DashView = z.infer<typeof viewSchema>;
export const RESOURCE_URI = "ui://dash/dashboard-v2.html";
