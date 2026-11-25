import { randomUUID } from "node:crypto";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, enrollTotp, uniqueEmail } from "./support/supabase";
import { freshTotp } from "./support/totp";

import type { Page } from "@playwright/test";

// Phase 4 admin portal. Runs once (desktop); every test makes its own staff user.
test.skip(({ isMobile }) => isMobile, "admin flows run once, on desktop");
test.describe.configure({ mode: "parallel" });

async function signInStaff(page: Page, roles: string[]) {
  const email = uniqueEmail(roles[0]!);
  await createUser(email, roles);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return secret;
}

test("owner edits the hero, previews the draft, publishes, and the public page shows it", async ({ page, browser }) => {
  test.slow();
  const key = "home.hero.eyebrow";
  const { data: original } = await admin
    .from("content_blocks")
    .select("draft_value, published_value")
    .eq("key", key)
    .single();
  const text = `Fresh test ${randomUUID().slice(0, 8)}`;
  try {
    await signInStaff(page, ["owner"]);
    await page.goto("/admin/content?group=home");
    const block = page.getByRole("region", { name: "Small label above the headline" });
    await block.getByRole("textbox").fill(text);
    await block.getByRole("button", { name: "Save draft" }).click();
    await expect(block.getByText("Draft, not live yet")).toBeVisible();

    // A visitor still sees the published copy.
    const visitor = await browser.newPage();
    await visitor.goto("/");
    await expect(visitor.getByText(text)).toHaveCount(0);

    // The owner previews the draft on the real page.
    await page.goto("/api/preview?path=/");
    await expect(page.getByText(text)).toBeVisible();
    await page.goto("/api/preview?exit=1&next=/admin/content?group=home");

    // Publish, and the public page updates.
    await page
      .getByRole("region", { name: "Small label above the headline" })
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Small label above the headline" }).getByText("Live", { exact: true }),
    ).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByText(text)).toBeVisible();
    await visitor.close();

    // Put the launch copy back through the UI, so the publish also expires the cache.
    const restore = page.getByRole("region", { name: "Small label above the headline" });
    await restore.getByRole("textbox").fill(String(original!.published_value));
    await restore.getByRole("button", { name: "Save draft" }).click();
    await restore.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(restore.getByText("Live", { exact: true })).toBeVisible();
  } finally {
    // Fallback if the test failed midway (the cache then expires within the hour).
    // Restore the seeded copy; the next publish revalidates the cache anyway.
    await admin
      .from("content_blocks")
      .update({ draft_value: original!.draft_value, published_value: original!.published_value })
      .eq("key", key);
  }
});

test("changing a price asks for step-up and stores a new Stripe price id", async ({ page }) => {
  test.slow();
  const slug = `e2e-price-${randomUUID().slice(0, 8)}`;
  // Service role: fixture only (bypasses the owner/step-up price guard by design).
  const { data: item } = await admin
    .from("menu_items")
    .insert({ name: "E2E Price Meal", slug, base_price_cents: 900 })
    .select("id")
    .single();
  const { data: milk } = await admin.from("allergens").select("id").eq("slug", "milk").single();
  await admin
    .from("menu_item_allergens")
    .insert({ menu_item_id: item!.id, allergen_id: milk!.id, presence: "contains" });

  const secret = await signInStaff(page, ["owner"]);
  await page.goto(`/admin/menu/${item!.id}`);
  await page.waitForTimeout(6_000); // the e2e server's step-up window is 5 s
  await page.getByLabel("Family price").fill("10.50");
  await page.getByRole("button", { name: "Save changes" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("6-digit code").fill(await freshTotp(secret));
  await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(
      async () =>
        (await admin.from("menu_items").select("base_price_cents, stripe_price_id").eq("id", item!.id).single()).data,
    )
    .toMatchObject({ base_price_cents: 1050, stripe_price_id: expect.stringMatching(/^price_/) });
  const { data: history } = await admin
    .from("menu_item_price_history")
    .select("base_price_cents, active_to")
    .eq("menu_item_id", item!.id)
    .order("active_from");
  expect(history!.map((h) => h.base_price_cents)).toEqual([900, 1050]);
  expect(history![0]!.active_to).not.toBeNull();
});

test("kitchen staff can't see or open Plans and Settings", async ({ page }) => {
  test.slow();
  await signInStaff(page, ["kitchen"]);
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Kitchen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Plans" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  expect((await page.goto("/admin/plans"))?.status()).toBe(403);
  expect((await page.goto("/admin/settings"))?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
});

test("image upload rejects a renamed .exe", async ({ page }) => {
  test.slow();
  const { data: item } = await admin.from("menu_items").select("id").eq("slug", "baked-mac-and-cheese").single();
  const countImages = async () =>
    (await admin.from("menu_item_images").select("id", { count: "exact", head: true }).eq("menu_item_id", item!.id))
      .count;
  const before = await countImages();
  await signInStaff(page, ["owner"]);
  await page.goto(`/admin/menu/${item!.id}`);
  await page.getByLabel("Describe the photo (alt text)").fill("Not really a photo");
  // "MZ" header: a Windows executable wearing a .jpg name and an image MIME type.
  await page.getByLabel("Choose photos").setInputFiles({
    name: "lunch.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), Buffer.alloc(2048)]),
  });
  await expect(page.getByText("Only JPEG, PNG, WebP or AVIF images can be uploaded.")).toBeVisible();
  expect(await countImages()).toBe(before);
});
