import type { Page } from "@playwright/test";

import { drainEmailQueueFully as drainEmailQueue } from "./support/cron";
import { expect, newContext, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, enrollTotp, uniqueEmail } from "./support/supabase";
import { freshTotp } from "./support/totp";

// Phase 10 pilot program: owner invites a founding family (emailed code),
// adds a family to the pilot, the family sends feedback, the owner sees it.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
test.describe.configure({ mode: "serial" });

async function signInOwner(page: Page) {
  const email = uniqueEmail("owner-pilot");
  await createUser(email, ["owner"]);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("owner invites a founding family, adds a family to the pilot, and reads their feedback @local-only", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInOwner(page);
  await page.getByRole("link", { name: "Pilot" }).click();
  await expect(page.getByRole("heading", { name: "Success criteria" })).toBeVisible();

  // 1) Email an invite: the family gets a code and a sign-up link with it filled in.
  const invitee = uniqueEmail("founding");
  await page.getByLabel("Family's email (optional)").fill(invitee);
  await page.getByLabel("Note for you (optional)").fill("e2e founding family");
  await page.getByRole("button", { name: "Email invite" }).click();
  await expect(page.getByText(/Invitation emailed with code SC-/)).toBeVisible();
  const { data: invite } = await admin.from("pilot_invites").select("code").eq("email", invitee).single();
  await drainEmailQueue();
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${invitee}"`)}`);
  const [msg] = ((await res.json()) as { messages: { ID: string; Subject: string }[] }).messages;
  expect(msg!.Subject).toContain("invited");
  const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg!.ID}`)).json()) as { HTML: string };
  expect(full.HTML).toContain(invite!.code);
  const signupUrl = full.HTML.match(/href="([^"]+\/sign-up\?code=[^"]+)"/)![1]!.replace(/&amp;/g, "&");
  await page.reload();
  await expect(page.getByRole("button", { name: `Copy invite code ${invite!.code}` })).toBeVisible();

  // The sign-up link pre-fills the code (shown when pilot mode is on).
  expect(new URL(signupUrl).searchParams.get("code")).toBe(invite!.code);

  // 2) Add an existing family to the pilot from their customer page.
  const parentEmail = uniqueEmail("pilot-parent");
  const parentId = await createUser(parentEmail);
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", parentId).single();
  await admin.from("households").update({ onboarded_at: new Date().toISOString() }).eq("id", hm!.household_id);
  await page.goto(`/admin/customers/${hm!.household_id}`);
  await page.getByRole("button", { name: "Add to pilot" }).click();
  await expect(page.getByRole("button", { name: "Remove from pilot" })).toBeVisible();

  // 3) The family sees the feedback button and sends a rating and a note.
  const ctx = await newContext(browser);
  const family = await ctx.newPage();
  await signInWithPassword(family, parentEmail, "/orders");
  await expect(family).toHaveURL(/\/orders/);
  await family.getByRole("button", { name: "Feedback" }).click();
  await family.getByRole("dialog").locator("label").filter({ hasText: /^4$/ }).click();
  await expect(family.getByRole("radio", { name: /^4/ })).toBeChecked();
  await family.getByLabel("Anything to add? (optional)").fill("Ordering was quick.");
  await family.getByRole("button", { name: "Send rating" }).click();
  await expect(family.getByText("Thank you! We read every one.")).toBeVisible();
  await family.getByRole("button", { name: "Feedback" }).click();
  const question = `Where do I change the delivery address? (${parentEmail})`;
  await family.getByLabel("Something confusing?").fill(question);
  await family.getByRole("button", { name: "Send", exact: true }).click();
  await expect(family.getByText("Thank you! We read every one.").first()).toBeVisible();
  await ctx.close();

  // 4) The owner sees both on the pilot page and marks one handled.
  await page.goto("/admin/pilot");
  await expect(page.getByText("Weekly rating: 4 / 5").first()).toBeVisible();
  const note = page.getByRole("listitem").filter({ hasText: question });
  await expect(note).toContainText("on /orders");
  await note.getByRole("button", { name: "Mark handled" }).click();
  await expect(note.getByRole("button", { name: "Reopen" })).toBeVisible();
});

test("families outside the pilot don't see the feedback button", async ({ page }) => {
  const email = uniqueEmail("not-pilot");
  await createUser(email);
  await signInWithPassword(page, email, "/orders");
  await expect(page).toHaveURL(/\/orders/);
  await expect(page.getByRole("button", { name: "Feedback" })).toHaveCount(0);
});
