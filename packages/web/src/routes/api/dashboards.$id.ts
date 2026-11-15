import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isResponse, requireWorkspace } from "~/server/guard";
import { error, json, readJson } from "~/server/http";
import { stampSnapshots, widgetListSchema } from "~/server/widget-schema";
import { nowIso } from "~/server/db";
import {
  deleteDashboard,
  getDashboard,
  updateDashboard,
} from "~/server/services/dashboards";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  widgets: widgetListSchema.optional(),
});

export const Route = createFileRoute("/api/dashboards/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireWorkspace(request, "read");
        if (isResponse(auth)) {
          return auth;
        }
        const dashboard = await getDashboard(auth.workspace.id, params.id);
        if (!dashboard) {
          return error(404, "Dashboard not found", "not_found");
        }
        return json({ dashboard });
      },
      PATCH: async ({ request, params }) => {
        const auth = await requireWorkspace(request, "write");
        if (isResponse(auth)) {
          return auth;
        }
        const parsed = patchSchema.safeParse(await readJson(request));
        if (!parsed.success) {
          return error(400, "Invalid dashboard payload", "invalid_body");
        }
        const { widgets, ...fields } = parsed.data;
        const current = widgets ? await getDashboard(auth.workspace.id, params.id) : undefined;
        const dashboard = await updateDashboard(auth.workspace.id, params.id, {
          ...fields,
          ...(widgets ? { widgets: stampSnapshots(widgets, current?.widgets ?? [], nowIso()) } : {}),
        });
        if (!dashboard) {
          return error(404, "Dashboard not found", "not_found");
        }
        return json({ dashboard });
      },
      DELETE: async ({ request, params }) => {
        const auth = await requireWorkspace(request, "write");
        if (isResponse(auth)) {
          return auth;
        }
        if (!(await deleteDashboard(auth.workspace.id, params.id))) {
          return error(404, "Dashboard not found", "not_found");
        }
        return json({ ok: true });
      },
    },
  },
});
