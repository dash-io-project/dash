import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isResponse, requireWorkspace } from "~/server/guard";
import { error, json, readJson } from "~/server/http";
import { widgetListSchema } from "~/server/widget-schema";
import { createDashboard, listDashboards } from "~/server/services/dashboards";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  widgets: widgetListSchema.optional(),
});

export const Route = createFileRoute("/api/dashboards/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireWorkspace(request, "read");
        if (isResponse(auth)) {
          return auth;
        }
        return json({ dashboards: await listDashboards(auth.workspace.id) });
      },
      POST: async ({ request }) => {
        const auth = await requireWorkspace(request, "write");
        if (isResponse(auth)) {
          return auth;
        }
        const parsed = createSchema.safeParse(await readJson(request));
        if (!parsed.success) {
          return error(400, "Invalid dashboard payload", "invalid_body");
        }
        const dashboard = await createDashboard({
          workspaceId: auth.workspace.id,
          name: parsed.data.name,
          description: parsed.data.description ?? "",
          widgets: parsed.data.widgets ?? [],
          createdBy: auth.user.id,
        });
        return json({ dashboard }, { status: 201 });
      },
    },
  },
});
