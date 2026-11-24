import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/installed",
  testMatch: "*.spec.ts",
  timeout: 120000,
  workers: 1,
  retries: 0,
  expect: { timeout: 20000 },
  use: {
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
});
