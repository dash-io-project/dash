import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isResponse, requireSession } from "~/server/guard";
import { error, json } from "~/server/http";
import { ApiUserError, issueApiUserToken } from "~/server/services/api-users";
import { WorkspaceError } from "~/server/services/workspaces";

const issueSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const Route = createFileRoute("/api/api-users/$id/tokens/")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireSession(request, "read", "manage tokens");
        if (isResponse(auth)) {
          return auth;
        }
        const parsed = issueSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return error(400, "Invalid token payload", "invalid_body");
        }
        try {
          return json(await issueApiUserToken(auth.user, params.id, parsed.data), { status: 201 });
        } catch (cause) {
          if (cause instanceof ApiUserError) return error(cause.status, cause.message, cause.code);
          if (cause instanceof WorkspaceError) return error(cause.status, cause.message, "workspace_access");
          throw cause;
        }
      },
    },
  },
});
