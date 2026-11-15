import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { API_USER_SCOPES } from "@dash/core";
import { isResponse, requireSession, requireWorkspace } from "~/server/guard";
import { error, json } from "~/server/http";
import { createApiUser, listApiUsers } from "~/server/services/api-users";

const tokenSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_USER_SCOPES)).min(1),
  token: tokenSchema.optional(),
});

function asksForMcp(body: unknown): boolean {
  const scopes = (body as { scopes?: unknown } | null)?.scopes;
  return Array.isArray(scopes) && scopes.includes("mcp");
}

export const Route = createFileRoute("/api/api-users/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request, "read", "manage tokens");
        if (isResponse(auth)) {
          return auth;
        }
        return json({ apiUsers: await listApiUsers(auth.user.id) });
      },
      POST: async ({ request }) => {
        const auth = await requireWorkspace(request, "read");
        if (isResponse(auth)) {
          return auth;
        }
        if (auth.via === "token") {
          return error(403, "Session authentication required to manage tokens", "forbidden");
        }
        const body: unknown = await request.json().catch(() => null);
        if (asksForMcp(body)) {
          return error(400, "An API user cannot have the mcp scope. Connect agents on the Agents page.", "invalid_scope");
        }
        const parsed = createSchema.safeParse(body);
        if (!parsed.success) {
          return error(400, "Invalid API user payload", "invalid_body");
        }
        if (parsed.data.scopes.includes("write") && auth.workspace.role === "viewer") {
          return error(403, "Editor access required for a write token", "forbidden");
        }
        const created = await createApiUser({
          ownerId: auth.user.id,
          workspaceId: auth.workspace.id,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          token: parsed.data.token,
        });
        return json(created, { status: 201 });
      },
    },
  },
});
