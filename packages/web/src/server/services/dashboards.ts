import type { Dashboard, DashboardWidget } from "@dash/core";
import { assertUserExists } from "../auth.ts";
import { dashboards, nowIso, type DashboardDoc } from "../db.ts";
import { randomId } from "../crypto.ts";

function toDashboard(row: DashboardDoc): Dashboard {
  return {
    workspaceId: row.workspaceId,
    id: row._id,
    name: row.name,
    description: row.description,
    widgets: row.widgets,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
  };
}

export async function listDashboards(workspaceId: string): Promise<Dashboard[]> {
  const rows = await (await dashboards()).find({ workspaceId }).sort({ updatedAt: -1 }).toArray();
  return rows.map(toDashboard);
}

export async function getDashboard(workspaceId: string, id: string): Promise<Dashboard | undefined> {
  const row = await (await dashboards()).findOne({ _id: id, workspaceId });
  return row ? toDashboard(row) : undefined;
}

export async function createDashboard(input: {
  workspaceId: string;
  name: string;
  description: string;
  widgets: DashboardWidget[];
  createdBy: string;
}): Promise<Dashboard> {
  await assertUserExists(input.createdBy);
  const id = randomId();
  const createdAt = nowIso();
  await (
    await dashboards()
  ).insertOne({
    _id: id,
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description,
    widgets: input.widgets,
    createdBy: input.createdBy,
    createdAt,
    updatedAt: createdAt,
  });
  return (await getDashboard(input.workspaceId, id))!;
}

export async function updateDashboard(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    description?: string;
    widgets?: DashboardWidget[];
  },
): Promise<Dashboard | undefined> {
  const $set: {
    updatedAt: string;
    name?: string;
    description?: string;
    widgets?: DashboardWidget[];
  } = { updatedAt: nowIso() };
  if (patch.name !== undefined) {
    $set.name = patch.name;
  }
  if (patch.description !== undefined) {
    $set.description = patch.description;
  }
  if (patch.widgets !== undefined) {
    $set.widgets = patch.widgets;
  }
  const row = await (
    await dashboards()
  ).findOneAndUpdate({ _id: id, workspaceId }, { $set, $inc: { version: 1 } }, { returnDocument: "after" });
  return row ? toDashboard(row) : undefined;
}

const APPEND_ATTEMPTS = 5;

/**
 * Add a widget when `fits` accepts the stored widget list. The write applies
 * only when the dashboard did not change after the check. Thus two calls at
 * the same time cannot both use the same space in a budget. The result is
 * "rejected" when `fits` refuses, and undefined when the dashboard is missing.
 */
export async function appendDashboardWidget(
  workspaceId: string,
  id: string,
  widget: DashboardWidget,
  fits: (widgets: readonly DashboardWidget[]) => boolean = () => true,
): Promise<Dashboard | "rejected" | undefined> {
  const collection = await dashboards();
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
    const row = await collection.findOne({ _id: id, workspaceId });
    if (!row) return undefined;
    if (!fits(row.widgets)) return "rejected";
    const updated = await collection.findOneAndUpdate(
      { _id: id, workspaceId, version: row.version === undefined ? { $exists: false } : row.version },
      { $push: { widgets: widget }, $set: { updatedAt: nowIso() }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    if (updated) return toDashboard(updated);
  }
  throw new Error("The dashboard changed during the update. Try again.");
}

export async function deleteDashboard(workspaceId: string, id: string): Promise<boolean> {
  const result = await (await dashboards()).deleteOne({ _id: id, workspaceId });
  return result.deletedCount === 1;
}
