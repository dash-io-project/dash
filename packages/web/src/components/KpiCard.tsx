import { aggregateKpi, formatKpi } from "~/lib/kpi";
import type { KpiSpec } from "@dash/core";

/** The value of a KPI widget. The widget card shows the title above it. */
export function KpiCard({
  rows,
  spec,
}: {
  rows: Record<string, unknown>[];
  spec: KpiSpec;
}) {
  const value = aggregateKpi(rows, spec);
  return (
    <div className="tabular truncate text-[28px] font-semibold leading-none tracking-tight">
      {formatKpi(value, spec.format)}
    </div>
  );
}
