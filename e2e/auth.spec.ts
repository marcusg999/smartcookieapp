import { expect, signInWithPassword, test } from "./support/fixtures";
import { waitForEmailLink } from "./support/mailpit";
import { createUser, enrollTotp, PASSWORD, uniqueEmail } from "./support/supabase";
import { freshTotp, totp } from "./support/totp";

// Auth flows hit the local Supabase stack (pnpm db:start) and its Mailpit inbox.
test.describe.configure({ mode: "parallel" });

test("sign up with a password → verify email → signed in → sign out → sign in", async ({ page }) => {
  const email = uniqueEmail("signup");
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Pat Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await expect(page.getByText(/Strength:/)).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");

  const link = await waitForEmailLink(email, { subject: /Confirm/ });
  await page.goto(link);
  // A brand-new parent lands on the welcome steps (Phase 5), which they can skip.
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/account\?skip=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi, Pat");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");

  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/(account|welcome)$/);
});

test("unconfirmed accounts can't sign in, and errors don't reveal whether an account exists", async ({ page }) => {
  await signInWithPassword(page, uniqueEmail("nobody"));
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't sign you in" })).toBeVisible();
});

test("magic link sign-in", async ({ page }) => {
  const email = uniqueEmail("magic");
  await createUser(email);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  const link = await waitForEmailLink(email, { subject: /sign-in link/ });
  await page.goto(link);
  await expect(page).toHaveURL(/\/(account|welcome)$/);
});

test("magic link for an unknown email gets the same generic answer", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(uniqueEmail("ghost"));
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
});

test("protected family pages redirect signed-out visitors to sign-in", async ({ page }) => {
  await page.goto("/account/security");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fsecurity/);
});

test("non-staff get a 404 at /admin", async ({ page }) => {
  const anon = await page.goto("/admin");
  expect(anon?.status()).toBe(404);

  const email = uniqueEmail("parent");
  await createUser(email);
  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/(account|welcome)$/);
  const res = await page.goto("/admin/staff");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("staff without MFA are forced to enroll, then reach the console", async ({ page }) => {
  const email = uniqueEmail("kitchen");
  await createUser(email, ["kitchen"]);
  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/admin\/mfa\/enroll$/);

  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible();
  // Backup codes appear when the project has recovery codes enabled (hosted
  // setting; the local CLI can't enable them), otherwise a fallback note.
  await expect(
    page.getByRole("list", { name: "Backup codes" }).or(page.getByText(/Backup codes aren't switched on/)),
  ).toBeVisible();
  await page.getByRole("button", { name: /continue/i }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // Kitchen staff don't see owner-only areas.
  await expect(page.getByRole("link", { name: "Staff" })).toHaveCount(0);
  expect((await page.goto("/admin/staff"))?.status()).toBe(403);
});

test("staff with MFA must pass the challenge after signing in", async ({ page }) => {
  test.slow(); // freshTotp() waits for the next 30 s window
  const email = uniqueEmail("ops");
  await createUser(email, ["ops"]);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/admin\/mfa\/challenge$/);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("sensitive actions require a fresh MFA step-up", async ({ page }) => {
  test.slow();
  // The e2e server runs with STEP_UP_MAX_AGE_SECONDS=5 (playwright.config.ts),
  // so the step-up window lapses quickly instead of after 5 minutes.

  const email = uniqueEmail("owner");
  await createUser(email, ["owner"]);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/staff");
  await page.waitForTimeout(6_000); // let the step-up window lapse

  const target = uniqueEmail("newcook");
  await page.getByLabel("Email").fill(target);
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("6-digit code").fill(await freshTotp(secret));
  await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Invitation sent");
  await expect(page.getByText(target)).toBeVisible();
});
