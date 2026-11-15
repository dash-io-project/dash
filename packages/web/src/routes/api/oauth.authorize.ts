import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isResponse, requireUser, requireWorkspace } from "~/server/guard";
import { error, json } from "~/server/http";
import {
  approveAuthorization,
  checkAuthorizationRequest,
  denyAuthorization,
} from "~/server/oauth";

const decisionSchema = z.object({
  /** The query string of the authorization request, as the browser received it. */
  query: z.string().max(8_192),
  decision: z.enum(["approve", "deny"]),
  name: z.string().trim().min(1).max(80).optional(),
  write: z.boolean().optional(),
});

function sessionOnly() {
  return error(403, "Sign in to Dash in the browser to create an agent", "forbidden");
}

/**
 * The consent page calls this route. GET checks the authorization request and
 * describes the client. POST records the decision of the signed-in user and
 * returns the client redirect.
 */
export const Route = createFileRoute("/api/oauth/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request, "read");
        if (isResponse(auth)) return auth;
        if (auth.via !== "session") return sessionOnly();
        const check = await checkAuthorizationRequest(new URL(request.url).searchParams, request);
        if (!check.ok) {
          return json({ error: { message: check.message }, redirectTo: check.redirectTo ?? null });
        }
        const { client, redirectUri, requestedScopes } = check.request;
        return json({
          client: { name: client.name, redirectHost: new URL(redirectUri).host || redirectUri },
          requestedScopes,
        });
      },
      POST: async ({ request }) => {
        const auth = await requireWorkspace(request, "read");
        if (isResponse(auth)) return auth;
        if (auth.via !== "session") return sessionOnly();
        const parsed = decisionSchema.safeParse(await request.json().catch(() => undefined));
        if (!parsed.success) return error(400, "Invalid authorization payload", "invalid_body");
        const check = await checkAuthorizationRequest(new URLSearchParams(parsed.data.query), request);
        if (!check.ok) {
          return error(400, check.message, "invalid_request");
        }
        if (parsed.data.decision === "deny") {
          return json({ redirectTo: denyAuthorization(check.request) });
        }
        if (parsed.data.write && auth.workspace.role === "viewer") {
          return error(403, "Editor access required", "forbidden");
        }
        const redirectTo = await approveAuthorization({
          request: check.request,
          userId: auth.user.id,
          workspaceId: auth.workspace.id,
          name: parsed.data.name ?? check.request.client.name,
          write: parsed.data.write ?? false,
        });
        return json({ redirectTo });
      },
    },
  },
});
