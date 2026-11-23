import type { AuthBootstrap } from "../lib/bootstrap.ts";
import { countUsers } from "./auth.ts";
import { ensureSeeded } from "./seed.ts";
import { getSettings } from "./services/settings.ts";

export async function getAuthBootstrap(): Promise<AuthBootstrap> {
  await ensureSeeded();
  const needsSetup = (await countUsers()) === 0;
  const settings = await getSettings();
  return {
    needsSetup,
    allowRegistration: needsSetup || settings.allowRegistration,
    allowedEmailDomains: settings.allowedEmailDomains,
  };
}
