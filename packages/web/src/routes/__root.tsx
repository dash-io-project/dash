import { useEffect, type ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  retainSearchParams,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { APPEARANCE_SCRIPT, followAppearance } from "~/lib/appearance";
import appCss from "~/styles/app.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: (search: Record<string, unknown>): { workspace?: string } => ({
    workspace: typeof search.workspace === "string" && search.workspace ? search.workspace : undefined,
  }),
  search: { middlewares: [retainSearchParams(["workspace"])] },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      {
        title: "Dash — AI-first analytics",
      },
      {
        name: "description",
        content:
          "Dash is an AI-first analytics workspace: dashboards, data sources, charts, and MCP.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/logo.png", type: "image/png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  // Keep the page in step with the device and with the other tabs.
  useEffect(() => followAppearance(), []);
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The head script sets the `dark` class, `data-appearance` and `color-scheme` on
    // <html> before React starts. `suppressHydrationWarning` tells React to keep them.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* The server sends the full page, and it does not know the Appearance choice.
            This script runs before the first paint, so the page does not show the wrong
            colors and then change. Dash sets no `script-src` policy (only
            `frame-ancestors` on /oauth/authorize), so the browser runs an inline script.
            A media query alone is not sufficient here: it cannot read a Light or Dark
            choice that is different from the device. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
