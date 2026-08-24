import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const e2ePort = process.env.E2E_PORT || "4173";
const baseURL = externalBaseUrl || `http://127.0.0.1:${e2ePort}`;
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] }
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] }
    }
  ],
  webServer: externalBaseUrl ? undefined : {
    command: "node --import tsx src/server.ts",
    url: `${baseURL}/api/v1/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...inheritedEnvironment,
      DATABASE_URL: process.env.TEST_DATABASE_URL || "",
      PORT: e2ePort,
      NODE_ENV: "test",
      APP_ENV: "development",
      APP_PUBLIC_URL: baseURL,
      CORS_ORIGINS: baseURL,
      LOG_LEVEL: "silent"
    }
  }
});
