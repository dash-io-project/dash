import { afterEach, describe, expect, it } from "vitest";
import { createUser } from "./auth.ts";
import { getAuthBootstrap } from "./bootstrap.ts";
import { updateSettings } from "./services/settings.ts";
import { destroyAppDatabase, useFreshAppDatabase } from "./test-db.ts";

describe("auth bootstrap", () => {
  afterEach(async () => {
    await destroyAppDatabase();
  });

  it("opens first-account registration when the organization has no users", async () => {
    await useFreshAppDatabase();
    await updateSettings({ allowRegistration: false });

    const empty = await getAuthBootstrap();
    expect(empty).toEqual({
      needsSetup: true,
      allowRegistration: true,
      allowedEmailDomains: [],
    });

    await createUser({
      email: "ada@example.com",
      name: "Ada",
      password: "password123",
      role: "admin",
    });
    await updateSettings({ allowRegistration: false });

    const closed = await getAuthBootstrap();
    expect(closed.needsSetup).toBe(false);
    expect(closed.allowRegistration).toBe(false);
  });
});
