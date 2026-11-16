import { viewSchema, type DashView } from "./contract.ts";

type Result = { isError?: boolean; structuredContent?: unknown; content?: unknown[] };
export type ViewState = { view?: DashView; busy: boolean; error?: string };

/** Keep one view and discard responses from an older request. */
export class ViewController {
  private revision = 0;
  state: ViewState = { busy: true };
  constructor(private changed: (state: ViewState) => void) {}
  private update(state: ViewState) { this.state = state; this.changed(state); }
  input() { this.revision++; this.update({ busy: true }); }
  result(result: Result) { this.revision++; this.accept(result); }
  fail(message: string) { this.revision++; this.update({ busy: false, error: message }); }
  private accept(result: Result) {
    const parsed = viewSchema.safeParse(result.structuredContent);
    if (!parsed.success || result.isError || parsed.data.errors.length) {
      this.update({ busy: false, error: parsed.success ? parsed.data.errors.join(" ") || "Access denied or request failed." : "The host returned no valid Dash view." });
    } else this.update({ busy: false, view: parsed.data });
  }
  async refresh(call: (request: { name: string; arguments: Record<string, unknown> }) => Promise<Result>) {
    const view = this.state.view;
    if (!view || this.state.busy) return;
    const revision = ++this.revision;
    this.update({ view, busy: true });
    try {
      const result = await call(view.mode === "widget"
        ? { name: "show_widget", arguments: { dashboardId: view.dashboardId, widgetId: view.widgetIds![0] } }
        : { name: "show_dashboard", arguments: { dashboardId: view.dashboardId, ...(view.widgetIds ? { widgetIds: view.widgetIds } : {}) } });
      if (revision === this.revision) this.accept(result);
    } catch {
      if (revision === this.revision) this.fail("Refresh failed. Check the connector and request the view again.");
    }
  }
}
