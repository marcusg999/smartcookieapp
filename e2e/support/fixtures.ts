import { test as base, type Page } from "@playwright/test";

import { PASSWORD } from "./supabase";

/**
 * Each test gets its own client IP (x-forwarded-for) so the per-IP auth rate
 * limiter (5/min) doesn't throttle a test run from a single machine.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    // Only on requests to the app: a custom header on third-party requests
    // (Stripe.js, hCaptcha) would fail their CORS preflight.
    await context.route(
      (url) => url.hostname === "localhost" || url.hostname === "127.0.0.1",
      (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
    );
    await use(context);
  },
});

export { expect } from "@playwright/test";

export async function signInWithPassword(page: Page, email: string, next?: string) {
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
