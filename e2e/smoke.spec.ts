import { expect, test } from "@playwright/test";

// Public shells. The signed-in shells (family account, school, admin) are
// covered by e2e/auth.spec.ts.
const shells = [
  { path: "/", shell: "marketing", heading: /home-cooked meals/i },
  { path: "/menu", shell: "family", heading: "This week's menu" },
  { path: "/sign-in", shell: "auth", heading: "Sign in" },
  { path: "/sign-up", shell: "auth", heading: "Create your account" },
];

for (const { path, shell, heading } of shells) {
  test(`${path} renders the ${shell} shell`, async ({ page }) => {
    const cspViolations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) cspViolations.push(msg.text());
    });

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator(`[data-shell="${shell}"]`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("main#main")).toBeVisible();

    // The page hydrated (client JS ran under the CSP) and nothing was blocked.
    await page.waitForLoadState("networkidle");
    expect(cspViolations).toEqual([]);
  });
}

test("no horizontal scroll at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const { path } of shells) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
  }
});

test("skip link moves focus to main content", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});

test("PWA manifest is served and valid", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Smart Cookie", display: "standalone", start_url: "/menu" });
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("Stripe webhook stub rejects requests until implemented", async ({ request }) => {
  const res = await request.post("/api/webhooks/stripe", { data: {} });
  expect(res.status()).toBe(501);
});
