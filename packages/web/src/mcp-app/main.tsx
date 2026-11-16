import { App } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { Component, useState, type ReactNode } from "react";
import { isChartType } from "@dash/core";
import { Chart } from "../components/Chart.tsx";
import { DataTable } from "../components/DataTable.tsx";
import { KpiCard } from "../components/KpiCard.tsx";
import { ViewController, type ViewState } from "./controller.ts";
import type { DashView } from "./contract.ts";
import "../styles/app.css";
import "./view.css";

const app = new App({ name: "Dash", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
let notify: (state: ViewState) => void = () => {};
const controller = new ViewController((state) => notify(state));
let hostChanged = () => {};
class WidgetBoundary extends Component<{ children: ReactNode; revision: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { revision: string }) {
    if (this.state.failed && previous.revision !== this.props.revision) this.setState({ failed: false });
  }
  render() { return this.state.failed ? <p role="alert">This widget cannot display its data.</p> : this.props.children; }
}
function Widget({ widget }: { widget: DashView["widgets"][number] }) {
  const chart = widget.chart;
  return <section className="card mcp-widget" style={{ gridColumn: `span ${Math.max(1, Math.min(12, widget.layout.w))}`, minHeight: Math.max(180, Math.min(600, widget.layout.h * 60)) }}>
    <h2>{widget.title}</h2>
    {widget.source === "snapshot" ? <p>Saved data · <time dateTime={widget.savedAt}>{widget.savedAt}</time>. Refresh does not recalculate these rows.</p> : <p>Retrieved <time dateTime={widget.resolvedAt}>{widget.resolvedAt}</time></p>}
    {widget.truncated && <p role="status">Incomplete results. The data source returned a limited row set. KPI values use only these rows.</p>}
    <div className="mcp-content">
      {widget.error ? <p role="alert">{widget.error}</p> : <WidgetBoundary revision={widget.resolvedAt}>
        {widget.type === "table" ? <DataTable rows={widget.rows} /> : widget.type === "kpi" && widget.kpi ? <KpiCard rows={widget.rows} spec={widget.kpi} /> : widget.type === "chart" && chart && isChartType(chart.type) ? <Chart rows={widget.rows} spec={{ ...chart, type: chart.type }} label={widget.title} /> : <p>This widget is not supported.</p>}
      </WidgetBoundary>}
    </div>
  </section>;
}
function View() {
  const [state, setState] = useState(controller.state);
  const [, setHost] = useState(0);
  const [actionError, setActionError] = useState("");
  notify = setState;
  hostChanged = () => setHost((value) => value + 1);
  const context = app.getHostContext();
  const view = state.view;
  const expand = context?.availableDisplayModes?.includes("fullscreen");
  async function open() {
    if (!view) return;
    try { const result = await app.openLink({ url: view.url }); if (result.isError) setActionError(`Open this link in your browser: ${view.url}`); } catch { setActionError(`Open this link in your browser: ${view.url}`); }
  }
  return <main aria-busy={state.busy}>
    <header><h1>{view?.title ?? "Dash"}</h1>{view && <nav aria-label="View actions">
      <button disabled={state.busy} onClick={() => void controller.refresh((request) => app.callServerTool(request))}>Refresh</button>
      <button onClick={() => void open()}>Open in Dash</button>
      {expand && <button onClick={() => void app.requestDisplayMode({ mode: context?.displayMode === "fullscreen" ? "inline" : "fullscreen" }).catch(() => setActionError("The host cannot change the display mode."))}>{context?.displayMode === "fullscreen" ? "Collapse" : "Expand"}</button>}
    </nav>}</header>
    {state.busy && <p role="status">Loading…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {view && <><div className={`mcp-grid ${view.mode === "widget" ? "mcp-single" : ""}`}>{view.widgets.map((widget) => <Widget key={widget.id} widget={widget} />)}</div>{view.widgets.length === 0 && <p>This dashboard has no widgets.</p>}</>}
  </main>;
}
app.ontoolinput = () => controller.input();
app.ontoolresult = (result) => controller.result(result);
app.ontoolcancelled = () => controller.fail("The request was cancelled.");
function theme() {
  const context = app.getHostContext();
  document.documentElement.classList.toggle("dark", context?.theme === "dark");
  const dimensions = context?.containerDimensions;
  const height = dimensions && ("height" in dimensions ? dimensions.height : dimensions.maxHeight);
  document.documentElement.style.setProperty("--host-height", height ? `${height}px` : "700px");
  const width = dimensions && ("width" in dimensions ? dimensions.width : dimensions.maxWidth);
  document.documentElement.style.setProperty("--host-width", width ? `${width}px` : "100%");
  document.body.classList.toggle("compact", Boolean(width && width < 640));
  const insets = context?.safeAreaInsets;
  document.body.style.padding = insets ? `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px` : "0";
  hostChanged();
}
app.onhostcontextchanged = theme;
createRoot(document.getElementById("root")!).render(<View />);
void app.connect().then(theme).catch(() => controller.fail("Connect this view through an MCP Apps host. Use the Dash link in the tool response."));
