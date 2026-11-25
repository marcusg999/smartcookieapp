import AxeBuilder from "@axe-core/playwright";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { createUser, enrollTotp, uniqueEmail } from "./support/supabase";
import { freshTotp } from "./support/totp";

// Phase 8 accessibility: WCAG 2.2 AA (the target for California's ADA /
// Unruh Act exposure) on every kitchen and fulfillment screen, as owner (who
// sees everything). Zero serious or critical violations allowed.
test.skip(({ isMobile }) => isMobile, "runs once, on desktop");

const PAGES = [
  "/admin",
  "/admin/kitchen",
  "/admin/kitchen/allergies",
  "/admin/kitchen/dietary",
  "/admin/kitchen/labels",
  "/admin/kitchen/packing",
  "/admin/kitchen/manifest",
  "/admin/kitchen/payments",
];

test("kitchen screens have no serious or critical WCAG 2.2 AA violations", async ({ page }) => {
  test.slow();
  const email = uniqueEmail("a11y-owner");
  await createUser(email, ["owner"]);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
      problems.push(
        `${path}: ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
      );
    }
  }
  expect(problems).toEqual([]);
});
