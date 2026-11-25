import {
  test as base,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

import { PASSWORD } from "./supabase";

/**
 * Each test gets its own client IP (x-forwarded-for) so the per-IP auth rate
 * limiter (5/min) doesn't throttle a test run from a single machine.
 */
async function giveOwnIp(context: BrowserContext) {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  const ip = `10.${octet()}.${octet()}.${octet()}`;
  // Only on requests to the app: a custom header on third-party requests
  // (Stripe.js, hCaptcha) would fail their CORS preflight.
  await context.route(
    (url) => url.hostname === "localhost" || url.hostname === "127.0.0.1",
    (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await giveOwnIp(context);
    await use(context);
  },
});

/** An extra browser context (a second user in the same test), with its own client IP too. */
export async function newContext(browser: Browser, options?: BrowserContextOptions): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await giveOwnIp(context);
  return context;
}

export { expect } from "@playwright/test";

export async function signInWithPassword(page: Page, email: string, next?: string) {
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
