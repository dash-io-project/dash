import { createFileRoute } from "@tanstack/react-router";
import { oauthPreflight, oauthResponse, protectedResourceMetadata } from "~/server/oauth";

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) => oauthResponse({ status: 200, body: protectedResourceMetadata(request) }),
      OPTIONS: () => oauthPreflight(),
    },
  },
});
