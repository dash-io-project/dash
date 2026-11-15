import { findUserByEmail } from "./auth.ts";
import { verifyPassword } from "./crypto.ts";
import { apiTokens, apiUsers, dashboards, getDb, nowIso, sessions, users } from "./db.ts";
import { getSettings } from "./services/settings.ts";

/** The published demo account. Startup removes it only while this password still matches. */
const LEGACY_DEMO_EMAIL = "admin@dash.dev";
const LEGACY_DEMO_PASSWORD = "dashadmin";

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

/**
 * Keep one admin when the legacy account is the only admin.
 * The oldest active member receives the role. A pending account stays pending.
 */
async function keepAnotherAdmin(removedId: string): Promise<void> {
  const collection = await users();
  const others = await collection.countDocuments({
    _id: { $ne: removedId },
    role: "admin",
    accountState: { $ne: "pending" },
  });
  if (others > 0) return;
  await collection.findOneAndUpdate(
    {
      _id: { $ne: removedId },
      role: { $ne: "admin" },
      accountState: { $ne: "pending" },
    },
    { $set: { role: "admin" } },
    { sort: { createdAt: 1, _id: 1 } },
  );
}

/**
 * Drop a first-admin record whose account is already gone.
 * A live account keeps the record. A later member stays a member.
 */
async function releaseOrphanBootstrap(): Promise<void> {
  const marker = (await getDb()).collection<{ _id: string; adminUserId?: string }>("settings");
  const bootstrap = await marker.findOne({ _id: "bootstrap" });
  if (!bootstrap?.adminUserId) return;
  if (await (await users()).findOne({ _id: bootstrap.adminUserId })) return;
  await marker.deleteOne({ _id: "bootstrap", adminUserId: bootstrap.adminUserId });
}

/**
 * Older installs can still hold admin@dash.dev with the published password.
 * This step runs once. It deletes that account, its sessions, its tokens, and its API users
 * when the password still matches. An account with a different password stays.
 * When that account is the only admin, another active member becomes admin first.
 * The first-admin record goes before the account, so a stopped run can finish.
 */
async function retireLegacyDemoAdmin(): Promise<void> {
  const db = await getDb();
  const marker = db.collection<{ _id: string; complete: boolean; adminUserId?: string }>("settings");
  if (await marker.findOne({ _id: "demo-admin-retired" })) return;
  const user = await findUserByEmail(LEGACY_DEMO_EMAIL);
  if (user && (await verifyPassword(LEGACY_DEMO_PASSWORD, user.passwordHash))) {
    if (user.role === "admin") await keepAnotherAdmin(user._id);
    await (await sessions()).deleteMany({ userId: user._id });
    await (await apiTokens()).updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: nowIso() } },
    );
    await (await apiUsers()).updateMany(
      { ownerId: user._id, deletedAt: null },
      { $set: { deletedAt: nowIso(), updatedAt: nowIso() } },
    );
    await marker.deleteOne({ _id: "bootstrap", adminUserId: user._id });
    await (await users()).deleteOne({ _id: user._id });
  }
  await releaseOrphanBootstrap();
  await marker.updateOne({ _id: "demo-admin-retired" }, { $set: { complete: true } }, { upsert: true });
}

let seedTask: Promise<void> | undefined;

export function resetSeedForTests(): void {
  seedTask = undefined;
}

async function seedOnce(): Promise<void> {
  await getSettings();
  await retireDemoSources();
  await retireLegacyDemoAdmin();
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
