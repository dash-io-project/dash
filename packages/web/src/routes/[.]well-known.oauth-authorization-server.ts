import { createFileRoute } from "@tanstack/react-router";
import { authorizationServerMetadata, oauthPreflight, oauthResponse } from "~/server/oauth";

/** RFC 8414 authorization server metadata. */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: ({ request }) => oauthResponse({ status: 200, body: authorizationServerMetadata(request) }),
      OPTIONS: () => oauthPreflight(),
    },
  },
});
