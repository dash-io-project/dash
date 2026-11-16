import { expect, it } from "vitest";
import { ViewController } from "./controller.ts";
import type { DashView } from "./contract.ts";
const view: DashView = { mode: "widget", dashboardId: "d", widgetIds: ["w"], title: "Synthetic", url: "https://dash.example", resolvedAt: "2026-01-01", errors: [], widgets: [] };
it("refreshes the selected view and ignores an older response after new input", async () => {
  const controller = new ViewController(() => {});
  controller.result({ structuredContent: view });
  let complete!: (value: { structuredContent: DashView }) => void;
  const refresh = controller.refresh(async (request) => {
    expect(request).toEqual({ name: "show_widget", arguments: { dashboardId: "d", widgetId: "w" } });
    return new Promise((resolve) => { complete = resolve; });
  });
  expect(controller.state.busy).toBe(true);
  controller.input();
  controller.result({ structuredContent: { ...view, title: "New view" } });
  complete({ structuredContent: view });
  await refresh;
  expect(controller.state.view?.title).toBe("New view");
});
it("clears stale data after a failed refresh or invalid host result", async () => {
  const controller = new ViewController(() => {});
  controller.result({ structuredContent: view });
  await controller.refresh(async () => ({ isError: true, structuredContent: { ...view, errors: ["Access denied"] } }));
  expect(controller.state).toEqual({ busy: false, error: "Access denied" });
  controller.result({});
  expect(controller.state.view).toBeUndefined();
  expect(controller.state.error).toBeDefined();
});
it("preserves dashboard selection and handles unsupported tool calls", async () => {
  const controller = new ViewController(() => {});
  controller.result({ structuredContent: { ...view, mode: "dashboard" } });
  await controller.refresh(async (request) => {
    expect(request).toEqual({ name: "show_dashboard", arguments: { dashboardId: "d", widgetIds: ["w"] } });
    throw new Error("unsupported");
  });
  expect(controller.state.view).toBeUndefined();
  expect(controller.state.error).toContain("Refresh failed");
});
