import { createFileRoute } from "@tanstack/react-router";
import { isResponse, requireSession } from "~/server/guard";
import { error, json } from "~/server/http";
import { revokeApiUserToken } from "~/server/services/api-users";

export const Route = createFileRoute("/api/api-users/$id/tokens/$tokenId")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const auth = await requireSession(request, "write", "manage tokens");
        if (isResponse(auth)) {
          return auth;
        }
        if (!(await revokeApiUserToken(auth.user.id, params.id, params.tokenId))) {
          return error(404, "Token not found", "not_found");
        }
        return json({ ok: true });
      },
    },
  },
});
