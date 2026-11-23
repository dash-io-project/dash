import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    browserName: "chromium",
    launchOptions: { executablePath: process.env.DASH_TEST_CHROMIUM_PATH },
    screenshot: "only-on-failure",
  },
});
