import { expect, newContext, signInWithPassword, test } from "./support/fixtures";
import { drainEmailQueue } from "./support/cron";
import { admin, createUser, uniqueEmail } from "./support/supabase";

// Phase 9: emails go through the queue → worker → Mailpit (local stand-in
// for Resend). Owner-editable copy, idempotent sends, opt-outs, one-click
// unsubscribe and the California auto-renewal disclosure.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
test.describe.configure({ mode: "serial" });

type Msg = { ID: string; Subject: string };
async function inbox(to: string): Promise<Msg[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages: Msg[] }).messages;
}
async function message(id: string) {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string; Text: string };
}
async function headers(id: string) {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}/headers`)).json()) as Record<string, string[]>;
}

async function family(onboarded = true) {
  const email = uniqueEmail("mail");
  const userId = await createUser(email);
  await admin.from("profiles").update({ full_name: "Priya Test" }).eq("id", userId);
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const householdId = hm!.household_id as string;
  if (onboarded)
    await admin.from("households").update({ onboarded_at: new Date().toISOString() }).eq("id", householdId);
  return { email, userId, householdId };
}

test("order confirmation: sent once with order details, even when queued twice @local-only", async () => {
  const f = await family();
  const { data: order } = await admin
    .from("orders")
    .select("id, order_number")
    .not("household_id", "is", null)
    .limit(1)
    .single();
  // A replayed webhook / re-run job queues the same email again: the dedupe key absorbs it.
  for (let i = 0; i < 2; i++) {
    await admin.rpc("queue_email", {
      p_template: "order_confirmation",
      p_to: f.email,
      p_payload: { order_id: order!.id },
      p_dedupe: `e2e-confirm:${f.userId}`,
      p_household: f.householdId,
      p_org: null,
      p_user: f.userId,
    });
  }
  const { count } = await admin
    .from("notifications_log")
    .select("id", { count: "exact", head: true })
    .eq("dedupe_key", `e2e-confirm:${f.userId}`);
  expect(count).toBe(1);

  await drainEmailQueue();
  await drainEmailQueue();
  await expect.poll(async () => (await inbox(f.email)).length).toBe(1);
  const [msg] = await inbox(f.email);
  expect(msg!.Subject).toContain(order!.order_number as string);
  const full = await message(msg!.ID);
  expect(full.Text).toContain("Hi Priya");
  expect(full.HTML).toContain(`/orders/${order!.id}`);

  // Once handled, the log keeps only a hash of the address.
  const { data: row } = await admin
    .from("notifications_log")
    .select("status, to_address, recipient_hash")
    .eq("dedupe_key", `e2e-confirm:${f.userId}`)
    .single();
  expect(row).toMatchObject({ status: "sent", to_address: null });
  expect(row!.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
});

test("marketing email: one-click unsubscribe header, opt-out respected, unsubscribe page works signed out @local-only", async ({
  page,
  browser,
}) => {
  const f = await family();
  const { data: week } = await admin.from("menu_weeks").select("id, week_start").order("week_start").limit(1).single();
  const queueMenu = (tag: string) =>
    admin.rpc("queue_email", {
      p_template: "menu_published",
      p_to: f.email,
      p_payload: { menu_week_id: week!.id, week_start: week!.week_start },
      p_dedupe: `e2e-menu:${tag}:${f.userId}`,
      p_household: f.householdId,
      p_org: null,
      p_user: f.userId,
    });

  await queueMenu("1");
  await drainEmailQueue();
  await expect.poll(async () => (await inbox(f.email)).length).toBe(1);
  const [msg] = await inbox(f.email);
  const h = await headers(msg!.ID);
  expect(h["List-Unsubscribe"]?.[0]).toMatch(/^<http.+\/api\/unsubscribe\?token=[0-9a-f-]{36}&topic=menu_published>$/);
  expect(h["List-Unsubscribe-Post"]?.[0]).toBe("List-Unsubscribe=One-Click");

  // Turn new-menu emails off in the account → the next one is skipped.
  await signInWithPassword(page, f.email, "/account/notifications");
  await expect(page.getByRole("heading", { name: "Email preferences" })).toBeVisible();
  await page.getByRole("checkbox", { name: /New weekly menu/ }).uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await queueMenu("2");
  await drainEmailQueue();
  const { data: skipped } = await admin
    .from("notifications_log")
    .select("status")
    .eq("dedupe_key", `e2e-menu:2:${f.userId}`)
    .single();
  expect(skipped!.status).toBe("skipped");
  expect(await inbox(f.email)).toHaveLength(1);

  // The footer link, signed out: opening it changes nothing; the button does.
  const { data: token } = await admin.rpc("_ensure_email_preferences", { p_user: f.userId });
  const ctx = await newContext(browser);
  const anon = await ctx.newPage();
  await anon.goto(`/unsubscribe?token=${token}&topic=cutoff_reminders`);
  let prefs = (await admin.from("email_preferences").select("cutoff_reminders").eq("user_id", f.userId).single()).data;
  expect(prefs!.cutoff_reminders).toBe(true);
  await anon.getByRole("button", { name: "Unsubscribe", exact: true }).click();
  await expect(anon.getByText(/You won't get these emails any more/)).toBeVisible();
  prefs = (await admin.from("email_preferences").select("cutoff_reminders").eq("user_id", f.userId).single()).data;
  expect(prefs!.cutoff_reminders).toBe(false);

  // RFC 8058 one-click POST (what Gmail sends): no cookies needed.
  await admin.from("email_preferences").update({ menu_published: true }).eq("user_id", f.userId);
  const res = await anon.request.post(`/api/unsubscribe?token=${token}&topic=menu_published`, {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(res.status()).toBe(200);
  const after = (await admin.from("email_preferences").select("menu_published").eq("user_id", f.userId).single()).data;
  expect(after!.menu_published).toBe(false);
  await ctx.close();
});

test("plans show the auto-renewal terms and need consent before starting", async ({ page }) => {
  const f = await family();
  await admin.from("children").insert({ household_id: f.householdId, first_name: "Sunny" });
  await signInWithPassword(page, f.email, "/subscription");
  const card = page.getByRole("listitem").filter({ hasText: "3 Lunches / week / child" });
  await expect(card.getByText("Automatic renewal")).toBeVisible();
  await expect(card.getByText(/renews automatically every week .* until you cancel/)).toBeVisible();
  await expect(card.getByText(/Cancel any time online/)).toBeVisible();
  await card.getByRole("button", { name: "Start this plan" }).click();
  await expect(page.getByText("Please tick the box to agree to automatic renewal first.")).toBeVisible();
  const { count } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", f.householdId);
  expect(count).toBe(0);
});
