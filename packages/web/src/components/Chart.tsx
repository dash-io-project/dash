import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Chart as TanStackChart } from "@tanstack/charts/react";
import type { ChartSpec } from "@dash/core";
import { toChartDefinition } from "~/lib/chart/tanstack";

/**
 * A chart that fills the height of its container. TanStack Charts needs the height as
 * a number, so this component measures the container.
 */
export function Chart({
  spec,
  rows,
  label,
}: {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const definition = useMemo(
    () => (rows.length === 0 ? null : toChartDefinition(spec, rows)),
    [spec, rows],
  );
  const ariaLabel = label || spec.title || "Chart";

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    // The chart takes the height of its card, also when the card is small. A larger
    // chart is clipped by the card.
    const measure = () => setHeight(Math.floor(element.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="h-full min-h-0 overflow-hidden">
      {!definition ? (
        <div
          className="grid h-full place-items-center text-muted-foreground"
          role="img"
          aria-label={ariaLabel}
        >
          No rows
        </div>
      ) : height > 0 ? (
        <TanStackChart
          definition={definition}
          height={height}
          ariaLabel={ariaLabel}
          className="dash-chart"
        />
      ) : null}
    </div>
  );
}
