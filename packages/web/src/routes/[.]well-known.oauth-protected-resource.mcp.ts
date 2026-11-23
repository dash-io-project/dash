import { createFileRoute } from "@tanstack/react-router";
import { oauthPreflight, oauthResponse, protectedResourceMetadata } from "~/server/oauth";

/** RFC 9728 section 3.1: the path of the resource `/mcp` follows the well-known name. */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => oauthResponse({ status: 200, body: protectedResourceMetadata(request) }),
      OPTIONS: () => oauthPreflight(),
    },
  },
});
