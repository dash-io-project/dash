import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Link2 } from "lucide-react";
import type { DashboardWidget } from "@dash/core";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { Chart } from "./Chart";
import { DataTable } from "./DataTable";
import { KpiCard } from "./KpiCard";
import { PANEL_SLIDE_MS, panelRevealPlan, panelSettleMs } from "./panel-reveal";
import { Badge, ICON_STROKE, IconButton } from "./ui";

const savedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

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

/** Tells the viewer that the widget shows saved rows, and when Dash saved them. */
function SnapshotLabel({ savedAt, className }: { savedAt: string; className?: string }) {
  const saved = new Date(savedAt);
  return (
    // In a narrow card the text gets shorter and ends with an ellipsis.
    <Badge className={cn("min-w-0", className)} title="Saved data. It does not refresh.">
      <span className="truncate">
        Snapshot
        {Number.isNaN(saved.getTime()) ? null : (
          <>
            {" · "}
            <time dateTime={savedAt}>{savedDate.format(saved)}</time>
          </>
        )}
      </span>
    </Badge>
  );
}

/** Copies a link that opens only this widget. */
function CopyLinkButton({ getUrl }: { getUrl: () => string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    const url = getUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The clipboard needs a secure context and permission. Show the link instead.
      window.prompt("Copy this widget link", url);
    }
  }

  return (
    <>
      <IconButton
        size="sm"
        label="Copy link"
        title="Copy a link that opens only this widget"
        onClick={() => void copy()}
      >
        {copied ? (
          <Check size={15} strokeWidth={ICON_STROKE} aria-hidden className="text-positive" />
        ) : (
          <Link2 size={15} strokeWidth={ICON_STROKE} aria-hidden />
        )}
      </IconButton>
      <span role="status" className="sr-only">
        {copied ? "Widget link copied" : ""}
      </span>
    </>
  );
}

export function WidgetCard({
  widget,
  index = 0,
  getShareUrl,
}: {
  widget: DashboardWidget;
  index?: number;
  getShareUrl?: () => string;
}) {
  const snapshot = widget.snapshot;
  const query = useQuery({
    queryKey: ["widget", widget.id, widget.dataSourceId, widget.query],
    enabled: !snapshot,
    queryFn: async () => {
      const payload = await api<{ result: { rows: Record<string, unknown>[] } }>(
        `/api/data-sources/${widget.dataSourceId}/query`,
        { method: "POST", body: JSON.stringify(widget.query) },
      );
      return payload.result.rows;
    },
  });

  const rows = snapshot?.rows ?? query.data ?? [];
  const loading = !snapshot && query.isLoading;
  const failed = !snapshot && query.isError;
  const { open, settled } = usePanelReveal(loading, failed, index);
  const style = {
    gridColumn: `span ${widget.layout.w} / span ${widget.layout.w}`,
    gridRow: `span ${widget.layout.h} / span ${widget.layout.h}`,
    "--panel-slide-duration": `${PANEL_SLIDE_MS}ms`,
  } as CSSProperties;
  const isKpi = widget.type === "kpi";
  // Only a KPI card that shows its value has the Snapshot label in the body.
  const kpiValue = isKpi && widget.kpi;

  let body: ReactNode = null;
  if (!loading) {
    if (failed) {
      body = (
        <div className="grid h-full place-items-center text-center text-negative">
          {(query.error as Error).message}
        </div>
      );
    } else if (kpiValue) {
      body = (
        <>
          {snapshot ? (
            <SnapshotLabel savedAt={snapshot.savedAt} className="mb-2 max-w-full self-start" />
          ) : null}
          <KpiCard rows={rows} spec={kpiValue} />
        </>
      );
    } else if (widget.type === "table") {
      body = <DataTable rows={rows} />;
    } else if (widget.chart) {
      body = <Chart spec={widget.chart} rows={rows} label={widget.title} />;
    } else {
      body = <div className="text-muted-foreground">This widget is missing a chart spec.</div>;
    }
  }

  return (
    // A KPI card is a size container: its value gets smaller when the card is narrow.
    <section
      style={style}
      aria-busy={!settled}
      className={cn(
        "card widget-panel flex min-h-0 min-w-0 flex-col",
        isKpi && "widget-kpi @container",
        settled && "is-settled",
      )}
    >
      {loading ? <span className="sr-only">Loading {widget.title}</span> : null}
      <div className="widget-reveal" inert={settled ? undefined : true}>
        {/* The header row: the title at the left, the actions at the right. A KPI label can
            use two lines, because two KPI cards share a row on a small screen. */}
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 pl-4 pr-2 pt-1">
          <h2
            className={cn(
              "min-w-0",
              isKpi
                ? "line-clamp-2 text-[13px] leading-snug text-muted-foreground"
                : "truncate font-medium",
            )}
            title={widget.title}
          >
            {widget.title}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {/* A KPI card shows the Snapshot label above its value. The header row of a
                narrow KPI card has no room for it. */}
            {snapshot && !kpiValue ? (
              <SnapshotLabel savedAt={snapshot.savedAt} className="shrink-0" />
            ) : null}
            {getShareUrl ? <CopyLinkButton getUrl={getShareUrl} /> : null}
          </div>
        </div>
        {/* A KPI value is at the bottom of its card, so a tall card looks deliberate. */}
        <div className={cn("flex min-h-0 flex-1 flex-col px-4 pb-4", isKpi && "justify-end")}>
          {body}
        </div>
      </div>
      {settled ? null : (
        <div className={`widget-mask${open ? " is-open" : ""}`} aria-hidden="true" />
      )}
    </section>
  );
}
