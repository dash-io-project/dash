import { createFileRoute } from "@tanstack/react-router";
import { withSeed } from "~/server/guard";
import { oauthPreflight, oauthResponse, tokenRequest } from "~/server/oauth";

/** The OAuth token endpoint. It exchanges a code or a refresh token for new tokens. */
export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => oauthResponse(await withSeed(() => tokenRequest(request))),
      OPTIONS: () => oauthPreflight(),
    },
  },
});
