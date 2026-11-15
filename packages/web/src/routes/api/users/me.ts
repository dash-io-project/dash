import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { updateUser } from "~/server/auth";
import { isResponse, requireSession } from "~/server/guard";
import { error, json, readJson } from "~/server/http";

const bodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  password: z.string().min(8).optional(),
});

export const Route = createFileRoute("/api/users/me")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        // A token cannot change the password, so a leaked token cannot take over the account.
        const auth = await requireSession(request, "write", "change your profile");
        if (isResponse(auth)) {
          return auth;
        }
        const parsed = bodySchema.safeParse(await readJson(request));
        if (!parsed.success) {
          return error(400, "Invalid profile payload", "invalid_body");
        }
        const user = await updateUser(auth.user.id, parsed.data);
        return json({ user });
      },
    },
  },
});
