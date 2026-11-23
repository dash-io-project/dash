import { createFileRoute } from "@tanstack/react-router";
import { isResponse, requireSession } from "~/server/guard";
import { error, json } from "~/server/http";
import { deleteApiUser } from "~/server/services/api-users";

export const Route = createFileRoute("/api/api-users/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const auth = await requireSession(request, "write", "manage tokens");
        if (isResponse(auth)) {
          return auth;
        }
        if (!(await deleteApiUser(auth.user.id, params.id))) {
          return error(404, "API user not found", "not_found");
        }
        return json({ ok: true });
      },
    },
  },
});
