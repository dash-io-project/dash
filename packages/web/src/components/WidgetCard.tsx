import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Link2 } from "lucide-react";
import type { DashboardWidget } from "@dash/core";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { Chart } from "./Chart";
import { DataTable } from "./DataTable";
import { KpiCard } from "./KpiCard";
import { Badge, ICON_STROKE, IconButton } from "./ui";

const savedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

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

export function WidgetCard({ widget, getShareUrl }: { widget: DashboardWidget; getShareUrl?: () => string }) {
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
  const style = {
    gridColumn: `span ${widget.layout.w} / span ${widget.layout.w}`,
    gridRow: `span ${widget.layout.h} / span ${widget.layout.h}`,
  };
  const isKpi = widget.type === "kpi";

  return (
    // A KPI card is a size container: its value gets smaller when the card is narrow.
    <section
      style={style}
      className={cn("card flex min-h-0 min-w-0 flex-col overflow-hidden", isKpi && "widget-kpi @container")}
    >
      {/* The header row: the title at the left, the actions at the right. A KPI label can
          use two lines, because two KPI cards share a row on a small screen. */}
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 pl-4 pr-2 pt-1">
        <h2
          className={cn(
            "min-w-0",
            isKpi ? "line-clamp-2 text-[13px] leading-snug text-muted-foreground" : "truncate font-medium",
          )}
          title={widget.title}
        >
          {widget.title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {/* A KPI card shows the Snapshot label above its value. The header row of a
              narrow KPI card has no room for it. */}
          {snapshot && !isKpi ? <SnapshotLabel savedAt={snapshot.savedAt} className="shrink-0" /> : null}
          {getShareUrl ? <CopyLinkButton getUrl={getShareUrl} /> : null}
        </div>
      </div>
      {/* A KPI value is at the bottom of its card, so a tall card looks deliberate. */}
      <div className={cn("flex min-h-0 flex-1 flex-col px-4 pb-4", isKpi && "justify-end")}>
        {query.isLoading ? (
          <div className="grid h-full place-items-center text-muted-foreground">Loading…</div>
        ) : query.isError ? (
          <div className="grid h-full place-items-center text-center text-negative">
            {(query.error as Error).message}
          </div>
        ) : widget.type === "kpi" && widget.kpi ? (
          <>
            {snapshot ? (
              <SnapshotLabel savedAt={snapshot.savedAt} className="mb-2 max-w-full self-start" />
            ) : null}
            <KpiCard rows={rows} spec={widget.kpi} />
          </>
        ) : widget.type === "table" ? (
          <DataTable rows={rows} />
        ) : widget.chart ? (
          <Chart spec={widget.chart} rows={rows} label={widget.title} />
        ) : (
          <div className="text-muted-foreground">This widget is missing a chart spec.</div>
        )}
      </div>
    </section>
  );
}
