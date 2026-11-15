import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Link2 } from "lucide-react";
import type { DashboardWidget } from "@dash/core";
import { api } from "~/lib/api";
import { Chart } from "./Chart";
import { DataTable } from "./DataTable";
import { KpiCard } from "./KpiCard";

const savedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Tells the viewer that the widget shows saved rows, and when Dash saved them. */
function SnapshotLabel({ savedAt }: { savedAt: string }) {
  const saved = new Date(savedAt);
  return (
    <span
      className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-mist"
      title="Saved data. It does not refresh."
    >
      Snapshot
      {Number.isNaN(saved.getTime()) ? null : (
        <>
          {" · "}
          <time dateTime={savedAt}>{savedDate.format(saved)}</time>
        </>
      )}
    </span>
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
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-mist hover:border-accent/40 hover:text-paper"
      title="Copy a link that opens only this widget"
    >
      {copied ? <Check size={12} aria-hidden /> : <Link2 size={12} aria-hidden />}
      {copied ? "Copied" : "Copy link"}
      <span role="status" className="sr-only">
        {copied ? "Widget link copied" : ""}
      </span>
    </button>
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

  return (
    <section
      style={style}
      className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel/90 p-4 shadow-[0_20px_60px_rgb(0_0_0_/0.25)]"
    >
      {widget.type !== "kpi" || snapshot || getShareUrl ? (
        <div className="mb-3 flex items-start justify-between gap-2">
          {widget.type !== "kpi" ? <h2 className="text-sm font-medium text-paper">{widget.title}</h2> : <span />}
          {/* A global rule gives each button `font: inherit`, so the button takes this size. */}
          <div className="flex shrink-0 items-center gap-2 text-xs">
            {snapshot ? <SnapshotLabel savedAt={snapshot.savedAt} /> : null}
            {getShareUrl ? <CopyLinkButton getUrl={getShareUrl} /> : null}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {query.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-mist">Loading…</div>
        ) : query.isError ? (
          <div className="grid h-full place-items-center text-sm text-rose-300">
            {(query.error as Error).message}
          </div>
        ) : widget.type === "kpi" && widget.kpi ? (
          <KpiCard title={widget.title} rows={rows} spec={widget.kpi} />
        ) : widget.type === "table" ? (
          <DataTable rows={rows} />
        ) : widget.chart ? (
          <Chart
            spec={widget.chart}
            rows={rows}
            height={widget.layout.h * 52}
            label={widget.title}
          />
        ) : (
          <div className="text-sm text-mist">This widget is missing a chart spec.</div>
        )}
      </div>
    </section>
  );
}
