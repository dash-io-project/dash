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
    // 28px in a wide card. In a narrow card the value gets smaller, down to 16px, so it stays on one line.
    <div className="tabular truncate text-[length:clamp(16px,12cqi,28px)] font-semibold leading-none tracking-tight">
      {formatKpi(value, spec.format)}
    </div>
  );
}
