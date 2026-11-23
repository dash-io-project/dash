import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardWidget } from "@dash/core";
import { api } from "~/lib/api";
import { Chart } from "./Chart";
import { DataTable } from "./DataTable";
import { KpiCard } from "./KpiCard";
import { PANEL_SLIDE_MS, panelRevealPlan, panelSettleMs } from "./panel-reveal";

function usePanelReveal(loading: boolean, failed: boolean, index: number) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (loading) {
      setOpen(false);
      setSettled(false);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plan = panelRevealPlan(index, { reduceMotion: reduce, failed });
    if (plan.settleImmediately) {
      setOpen(true);
      setSettled(true);
      return;
    }
    const openTimer = window.setTimeout(() => setOpen(true), plan.waitMs);
    const settleTimer = window.setTimeout(() => setSettled(true), panelSettleMs(plan.waitMs));
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(settleTimer);
    };
  }, [loading, failed, index]);

  return { open, settled };
}

export function WidgetCard({ widget, index = 0 }: { widget: DashboardWidget; index?: number }) {
  const query = useQuery({
    queryKey: ["widget", widget.id, widget.dataSourceId, widget.query],
    queryFn: async () => {
      const payload = await api<{ result: { rows: Record<string, unknown>[] } }>(
        `/api/data-sources/${widget.dataSourceId}/query`,
        { method: "POST", body: JSON.stringify(widget.query) },
      );
      return payload.result.rows;
    },
  });

  const rows = query.data ?? [];
  const { open, settled } = usePanelReveal(query.isLoading, query.isError, index);
  const style = {
    gridColumn: `span ${widget.layout.w} / span ${widget.layout.w}`,
    gridRow: `span ${widget.layout.h} / span ${widget.layout.h}`,
    "--panel-slide-duration": `${PANEL_SLIDE_MS}ms`,
  } as CSSProperties;

  let body: ReactNode = null;
  if (!query.isLoading) {
    if (query.isError) {
      body = (
        <div className="grid h-full place-items-center text-sm text-rose-300">
          {(query.error as Error).message}
        </div>
      );
    } else if (widget.type === "kpi" && widget.kpi) {
      body = <KpiCard title={widget.title} rows={rows} spec={widget.kpi} />;
    } else if (widget.type === "table") {
      body = <DataTable rows={rows} />;
    } else if (widget.chart) {
      body = (
        <Chart spec={widget.chart} rows={rows} height={widget.layout.h * 52} label={widget.title} />
      );
    } else {
      body = <div className="text-sm text-mist">This widget is missing a chart spec.</div>;
    }
  }

  return (
    <section
      style={style}
      aria-busy={!settled}
      className={`widget-panel flex min-h-0 flex-col rounded-2xl border border-line bg-panel p-4 shadow-[0_20px_60px_rgb(0_0_0_/0.25)]${settled ? " is-settled" : ""}`}
    >
      {query.isLoading ? <span className="sr-only">Loading {widget.title}</span> : null}
      <div className="widget-reveal" inert={settled ? undefined : true}>
        {widget.type !== "kpi" ? (
          <h2 className="mb-3 text-sm font-medium text-paper">{widget.title}</h2>
        ) : null}
        <div className="min-h-0 flex-1">{body}</div>
      </div>
      {settled ? null : (
        <div className={`widget-mask${open ? " is-open" : ""}`} aria-hidden="true" />
      )}
    </section>
  );
}
