import { dashboards, getDb, nowIso } from "./db.ts";
import { getSettings } from "./services/settings.ts";

/**
 * The built-in sample warehouse (`kind: "demo"`) is gone. Older app databases
 * can still hold one, and its config has no adapter now. This step runs once:
 * it deletes those sources and the widgets that read them. A dashboard with
 * no widget left is deleted too. The demo source held no data of its own.
 */
async function retireDemoSources(): Promise<void> {
  const db = await getDb();
  const marker = db.collection<{ _id: string; complete: boolean }>("settings");
  if (await marker.findOne({ _id: "demo-retired" })) return;
  const sources = db.collection<{ _id: string; kind: string }>("data_sources");
  const ids = (await sources.find({ kind: "demo" }).project<{ _id: string }>({ _id: 1 }).toArray()).map((row) => row._id);
  if (ids.length > 0) {
    const boards = await dashboards();
    for (const board of await boards.find({ "widgets.dataSourceId": { $in: ids } }).toArray()) {
      const widgets = board.widgets.filter((widget) => !ids.includes(widget.dataSourceId));
      if (widgets.length === 0) {
        await boards.deleteOne({ _id: board._id });
      } else {
        await boards.updateOne({ _id: board._id }, { $set: { widgets, updatedAt: nowIso() } });
      }
    }
    await sources.deleteMany({ _id: { $in: ids } });
  }
  await marker.updateOne({ _id: "demo-retired" }, { $set: { complete: true } }, { upsert: true });
}

let seedTask: Promise<void> | undefined;

export function resetSeedForTests(): void {
  seedTask = undefined;
}

async function seedOnce(): Promise<void> {
  await getSettings();
  await retireDemoSources();
}

export function ensureSeeded(): Promise<void> {
  if (!seedTask) {
    seedTask = seedOnce().catch((error: unknown) => {
      seedTask = undefined;
      throw error;
    });
  }
  return seedTask;
}
