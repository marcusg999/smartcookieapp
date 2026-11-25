import AxeBuilder from "@axe-core/playwright";

import { expect, signInWithPassword, test } from "./support/fixtures";

import type { Page } from "@playwright/test";

// Accessibility (WCAG 2.2 AA, the bar for California ADA / Unruh Act claims):
// public site, family area and school portal, on phone and desktop. Zero
// serious or critical violations allowed. Uses the seeded local accounts.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SEED_PASSWORD = "SmartCookie-local-2026!";

async function audit(page: Page, paths: string[]) {
  const problems: string[] = [];
  // Audit the final rendered state: scroll-driven reveal animations start at
  // opacity 0 below the fold, which isn't what anyone reads.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
      problems.push(
        `${path}: ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
      );
    }
  }
  return problems;
}

async function signInSeed(page: Page, email: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next));
}

test("public pages", async ({ page }) => {
  test.slow();
  expect(await audit(page, ["/", "/menu", "/plans", "/schools", "/faq", "/sign-in", "/sign-up"])).toEqual([]);
});

test("family area", async ({ page }) => {
  test.slow();
  await signInSeed(page, "parent@smartcookie.test", "/account");
  expect(await audit(page, ["/account", "/order", "/children", "/orders", "/favorites", "/subscription"])).toEqual([]);
});

test("school portal", async ({ page }) => {
  test.slow();
  await signInSeed(page, "school@smartcookie.test", "/school");
  expect(
    await audit(page, [
      "/school",
      "/school/orders",
      "/school/classrooms",
      "/school/standing-orders",
      "/school/standing-orders/new",
      "/school/calendar",
      "/school/bulk",
      "/school/billing",
      "/school/staff",
      "/school/setup",
    ]),
  ).toEqual([]);
});

void signInWithPassword;
