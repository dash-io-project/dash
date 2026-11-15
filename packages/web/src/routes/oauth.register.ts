import { createFileRoute } from "@tanstack/react-router";
import { withSeed } from "~/server/guard";
import { oauthPreflight, oauthResponse, registerClient } from "~/server/oauth";

/** RFC 7591 dynamic client registration. */
export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body: unknown = await request.json().catch(() => undefined);
        return oauthResponse(await withSeed(() => registerClient(body)));
      },
      OPTIONS: () => oauthPreflight(),
    },
  },
});
