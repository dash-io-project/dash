import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../.mcp-app/view.html", import.meta.url), "utf8");
const view = {
  mode: "widget", dashboardId: "synthetic", widgetIds: ["staffing"], title: "Synthetic staffing",
  url: "https://dash.example/dashboard/synthetic", resolvedAt: "2026-01-01T00:00:00Z", errors: [],
  widgets: [{
    id: "staffing", title: "Synthetic staffing", type: "chart", layout: { x: 0, y: 0, w: 12, h: 5 },
    chart: { type: "bar", encode: { x: "day", y: ["scheduled", "required"] } },
    rows: [{ day: "Monday", scheduled: 8, required: 10 }, { day: "Tuesday", scheduled: 12, required: 9 }],
    truncated: false, source: "snapshot", savedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-01T00:00:00Z",
    url: "https://dash.example/dashboard/synthetic?widgets=staffing",
  }],
};

for (const width of [800, 320]) {
  test(`the bundled app renders styled chart bars at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<iframe title="Synthetic MCP host" sandbox="allow-scripts" style="height:800px;border:0"></iframe>');
    await page.evaluate(({ html, view, width }) => {
      const frame = document.querySelector("iframe")!;
      frame.style.width = `${width}px`;
      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow) return;
        const request = event.data;
        const send = (message: unknown) => frame.contentWindow!.postMessage(message, "*");
        if (request.method === "ui/initialize") send({ jsonrpc: "2.0", id: request.id, result: {
          protocolVersion: request.params.protocolVersion,
          hostInfo: { name: "Synthetic test host", version: "1" }, hostCapabilities: { serverTools: {} },
          hostContext: { theme: "light", displayMode: "inline", availableDisplayModes: ["inline"], containerDimensions: { width, maxHeight: 700 } },
        } });
        if (request.method === "ui/notifications/initialized") {
          send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [], structuredContent: view } });
        }
        if (request.method === "tools/call") {
          frame.dataset.refreshCalls = String(Number(frame.dataset.refreshCalls ?? 0) + 1);
          send({ jsonrpc: "2.0", id: request.id, result: { content: [], structuredContent: view } });
        }
      });
      frame.srcdoc = html;
    }, { html, view, width });
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("heading", { level: 1, name: view.title })).toBeVisible();
    // Test actual SVG marks, not only a tool result or an empty chart container.
    const bars = frame.locator('.mcp-content .ts-chart__bar');
    await expect.poll(async () => bars.evaluateAll((nodes) => nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(node).fill !== "none";
    }).length)).toBe(4);
    await expect(frame.getByRole("button", { name: "Refresh" })).toHaveCSS("border-top-width", "1px");
    await expect(frame.getByRole("heading", { name: view.title })).toHaveCount(1);
    expect(await frame.locator(".mcp-content").evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(160);
    await frame.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("iframe")).toHaveAttribute("data-refresh-calls", "1");
    await expect(frame.locator("main")).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => document.querySelector("iframe")!.contentWindow!.postMessage({
      jsonrpc: "2.0", method: "ui/notifications/host-context-changed",
      params: { theme: "dark", displayMode: "fullscreen", containerDimensions: { width: 320, height: 400 } },
    }, "*"));
    await expect(frame.locator("html")).toHaveClass("dark");
    await expect(frame.locator(".mcp-content")).toHaveCSS("height", "220px");
    await expect(bars.first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}
