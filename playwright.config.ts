import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Test helpers talk to the local Supabase stack with the same keys as the app.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Locally you can point at an already-installed Chromium with
// PW_CHROMIUM_EXECUTABLE; CI installs Playwright's own browser.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "off",
    // Local runs behind an HTTPS-intercepting proxy (Stripe.js, real test
    // payments): PLAYWRIGHT_PROXY=http://127.0.0.1:PORT. Never set in CI.
    ...(process.env.PLAYWRIGHT_PROXY
      ? { proxy: { server: process.env.PLAYWRIGHT_PROXY, bypass: "localhost,127.0.0.1" }, ignoreHTTPSErrors: true }
      : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // Against staging (E2E_TARGET=staging) skip tests that read email from the
  // local Mailpit or depend on local-only settings.
  grepInvert: process.env.E2E_TARGET === "staging" ? /@local-only/ : undefined,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Auth flows are browser-agnostic and stateful; run them once.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: /auth\.spec\.ts/ },
  ],
  // Runs against a production build (`pnpm build` first) so security headers
  // and the CSP match what ships.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Shrink the 5-minute step-up window so the step-up test runs quickly.
        // A fixed cron secret so tests can run the email worker (e2e/support/cron.ts).
        env: {
          STEP_UP_MAX_AGE_SECONDS: "5",
          CRON_SECRET: process.env.CRON_SECRET ?? "e2e-only-cron-secret-not-used-in-production-000",
        },
      },
});
