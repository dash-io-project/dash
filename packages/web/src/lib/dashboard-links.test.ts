import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import { dashboardUrl, parseWidgetIds, widgetUrl } from "./dashboard-links.ts";

const dashboard = (workspaceId: string) => ({ id: "d1", workspaceId });

describe("dashboard links", () => {
  it.each(["123e4567", "1234", "ab12"])("keeps workspace %s a string when the router reads the link", (workspaceId) => {
    const url = new URL(dashboardUrl("https://dash.example.com", dashboard(workspaceId)));
    expect(defaultParseSearch(url.search)).toEqual({ workspace: workspaceId });
  });

  it.each([[["1234"]], [["123e4567"]], [["ab12", "1234"]]])("gives back widget ids %j when the router reads the link", (ids) => {
    const url = new URL(widgetUrl("https://dash.example.com", dashboard("1234"), ids));
    const search: Record<string, unknown> = defaultParseSearch(url.search);
    expect([search.workspace, parseWidgetIds(search.widgets)]).toEqual(["1234", ids]);
  });
});
