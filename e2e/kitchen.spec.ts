import { randomUUID } from "node:crypto";

import { expect, newContext, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, enrollTotp, uniqueEmail } from "./support/supabase";
import { freshTotp } from "./support/totp";

import type { Page } from "@playwright/test";

// Phase 8: the kitchen screens. Each test makes its own family and order in
// the first open seeded week, so tests never share state. Desktop only.
test.skip(({ isMobile }) => isMobile, "kitchen flows run on desktop / iPad width");
test.describe.configure({ mode: "parallel" });

async function signInStaff(page: Page, role: string) {
  const email = uniqueEmail(role);
  await createUser(email, [role]);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return secret;
}

async function openWeek() {
  const { data: weeks } = await admin
    .from("menu_weeks")
    .select("id, delivery_dates")
    .eq("status", "published")
    .order("week_start");
  for (const w of weeks ?? []) {
    const { data: cutoff } = await admin.rpc("menu_week_cutoff", { p_week: w.id });
    if (Date.parse(cutoff as string) > Date.now()) return w as { id: string; delivery_dates: string[] };
  }
  throw new Error("no open week in the seed data");
}

/** A family with one child (and optional allergy) and a paid order for one meal. */
async function familyWithOrder(opts: {
  first: string;
  allergy?: { slug: string; severity: string };
  mealSlug: string;
}) {
  const week = await openWeek();
  const userId = await createUser(uniqueEmail("kfam"));
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const household = hm!.household_id as string;
  await admin
    .from("households")
    .update({ name: `The ${opts.first} family` })
    .eq("id", household);
  const initial = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const { data: child } = await admin
    .from("children")
    .insert({ household_id: household, first_name: opts.first, last_initial: initial })
    .select("id")
    .single();
  if (opts.allergy) {
    const { data: a } = await admin.from("allergens").select("id").eq("slug", opts.allergy.slug).single();
    await admin
      .from("child_allergens")
      .insert({ child_id: child!.id, allergen_id: a!.id, severity: opts.allergy.severity });
  }
  const { data: meal } = await admin
    .from("menu_items")
    .select("id, name, base_price_cents")
    .eq("slug", opts.mealSlug)
    .single();
  const { data: allergens } = await admin
    .from("menu_item_allergens")
    .select("presence, allergens ( name )")
    .eq("menu_item_id", meal!.id);
  const names = (p: string) =>
    (allergens ?? []).filter((x) => x.presence === p).map((x) => (x.allergens as unknown as { name: string }).name);
  const { data: order } = await admin
    .from("orders")
    .insert({
      household_id: household,
      menu_week_id: week.id,
      status: "paid",
      fulfillment: "delivery",
      subtotal_cents: meal!.base_price_cents,
      total_cents: meal!.base_price_cents,
      amount_paid_cents: meal!.base_price_cents,
      placed_at: new Date().toISOString(),
      address_snapshot: { line1: "9 Kitchen Test Rd", city: "Pasadena", zip: "91101" },
      delivery_zone_id: "d1000000-0000-4000-8000-000000000001",
    })
    .select("id, order_number")
    .single();
  await admin.from("order_items").insert({
    order_id: order!.id,
    child_id: child!.id,
    menu_item_id: meal!.id,
    delivery_date: week.delivery_dates[0],
    quantity: 1,
    unit_price_cents: meal!.base_price_cents,
    item_name: meal!.name,
    allergens_contained: names("contains"),
    may_contain: names("may_contain"),
  });
  return {
    week,
    household,
    childId: child!.id as string,
    name: `${opts.first} ${initial}.`,
    meal: meal!.name as string,
    order: order!,
  };
}

/** Text drawn by pdfkit with the standard fonts is hex-encoded Latin-1 in uncompressed streams. */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  return [...raw.matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
}

test("kitchen staff see the week and the cook list, but no prices, payment or contact pages", async ({ page }) => {
  test.slow();
  const fam = await familyWithOrder({ first: `Kip${randomUUID().slice(0, 4)}`, mealSlug: "baked-mac-and-cheese" });
  await signInStaff(page, "kitchen");
  await page.goto(`/admin?week=${fam.week.id}`);
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByText(fam.name).first()).toBeVisible();
  await expect(main.getByRole("columnheader", { name: "Payment" })).toHaveCount(0);
  await expect(main.getByText("Paid · invoiced · unpaid")).toHaveCount(0);
  await expect(main).not.toContainText("$");
  await expect(main).not.toContainText("9 Kitchen Test Rd");

  await page.goto(`/admin/kitchen?week=${fam.week.id}`);
  await expect(page.getByRole("heading", { name: "Cook list" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Baked mac & cheese" }).first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("$");

  expect((await page.goto("/admin/kitchen/manifest"))?.status()).toBe(403);
  expect((await page.goto("/admin/kitchen/payments"))?.status()).toBe(403);
  await expect(page.getByRole("link", { name: "Delivery manifest" })).toHaveCount(0);
});

test("a severe allergy is on the allergy board (prep check logged) and on the label PDF", async ({ page }) => {
  test.slow();
  const fam = await familyWithOrder({
    first: `Sev${randomUUID().slice(0, 4)}`,
    allergy: { slug: "sesame", severity: "severe" },
    mealSlug: "baked-mac-and-cheese",
  });
  await signInStaff(page, "kitchen");
  await page.goto(`/admin/kitchen/allergies?week=${fam.week.id}`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: fam.name }) });
  await expect(card.getByLabel("Severe allergy")).toBeVisible();
  await expect(card.getByText("Sesame (severe)")).toBeVisible();
  await expect(card.getByText("Prepare allergy-safe for: Sesame")).toBeVisible();
  await card.getByRole("checkbox", { name: new RegExp(`Prepared allergy-safe: ${fam.name}`) }).check();
  await expect(card.getByText(/^Checked by/)).toBeVisible();
  const { data: check } = await admin
    .from("prep_checks")
    .select("checked_by, checked_at")
    .limit(1)
    .order("checked_at", { ascending: false });
  expect(check?.[0]?.checked_by).toBeTruthy();

  const res = await page.request.get(`/admin/kitchen-export?kind=labels&week=${fam.week.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const text = pdfText(await res.body());
  const at = text.indexOf(fam.name);
  expect(at).toBeGreaterThanOrEqual(0);
  const label = text.slice(at, at + 400);
  expect(label).toContain("PREPARED ALLERGY-SAFE FOR: Sesame");
  expect(label).toContain("SEVERE ALLERGY - CHECK BEFORE SERVING");
  expect(label).toContain("CONTAINS: Milk, Wheat");
});

test("an allergy added after ordering surfaces in Needs attention, is left off the cook list, and emails owner + parent", async ({
  page,
}) => {
  test.slow();
  const fam = await familyWithOrder({ first: `Late${randomUUID().slice(0, 4)}`, mealSlug: "turkey-avocado-wrap" });
  // After the order: the child turns out to be allergic to wheat (the wrap contains wheat).
  const { data: wheat } = await admin.from("allergens").select("id").eq("slug", "wheat").single();
  await admin.from("child_allergens").insert({ child_id: fam.childId, allergen_id: wheat!.id, severity: "allergy" });

  await signInStaff(page, "ops");
  await page.goto(`/admin?week=${fam.week.id}`);
  const banner = page.getByRole("alert").filter({ hasText: "Needs attention" });
  await expect(banner).toContainText(fam.name);
  await expect(banner).toContainText("contains Wheat");

  await page.goto(`/admin/kitchen/allergies?week=${fam.week.id}`);
  await page.getByRole("button", { name: "Check for new conflicts" }).click();
  await expect(page.getByText(/new conflict\(s\) found|No new conflicts/)).toBeVisible();
  const attention = page.locator("section").filter({ has: page.getByRole("heading", { name: "Needs attention" }) });
  await expect(attention.getByText(fam.name)).toBeVisible();
  const { data: emails } = await admin
    .from("notifications_log")
    .select("payload")
    .eq("template_key", "allergy_conflict")
    .contains("payload", { order_id: fam.order.id });
  expect((emails ?? []).map((e) => (e.payload as { audience: string }).audience).sort()).toEqual(["owner", "parent"]);

  // Not cooked, not labelled.
  const csv = await (await page.request.get(`/admin/kitchen-export?kind=cook-csv&week=${fam.week.id}`)).text();
  const labels = pdfText(
    await (await page.request.get(`/admin/kitchen-export?kind=labels&week=${fam.week.id}`)).body(),
  );
  expect(labels).not.toContain(fam.name);
  expect(csv.startsWith("Delivery date,Item,Total")).toBe(true);
});

test("ops mark a stop delivered from the manifest on a phone, and the family is emailed", async ({ browser }) => {
  test.slow();
  const fam = await familyWithOrder({ first: `Dlv${randomUUID().slice(0, 4)}`, mealSlug: "veggie-pasta-salad" });
  const context = await newContext(browser, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signInStaff(page, "ops");
  await page.goto(`/admin/kitchen/manifest?week=${fam.week.id}&day=${fam.week.delivery_dates[0]}`);
  const stop = page.getByRole("listitem").filter({ hasText: `The ${fam.name.split(" ")[0]} family` });
  await expect(stop.getByText("9 Kitchen Test Rd, Pasadena, 91101")).toBeVisible();
  await stop.getByRole("button", { name: /Mark delivered/ }).click();
  await expect(stop.getByRole("button", { name: /Undo delivered/ })).toBeVisible();
  const { data: order } = await admin.from("orders").select("status").eq("id", fam.order.id).single();
  expect(order!.status).toBe("fulfilled");
  const { data: emails } = await admin
    .from("notifications_log")
    .select("id")
    .eq("template_key", "order_delivered")
    .contains("payload", { order_id: fam.order.id });
  expect(emails).toHaveLength(1);
  await context.close();
});

test("print view: navigation and buttons are hidden, the cook list stays", async ({ page }) => {
  test.slow();
  const fam = await familyWithOrder({ first: `Prn${randomUUID().slice(0, 4)}`, mealSlug: "baked-mac-and-cheese" });
  await signInStaff(page, "kitchen");
  await page.goto(`/admin/kitchen?week=${fam.week.id}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Admin" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Cook list" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Baked mac & cheese" }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("cook-list-print.png"), fullPage: true });
});

test("owner allows a late order for one family; that family can open the closed week, others can't", async ({
  browser,
}) => {
  test.slow();
  // A closed week whose cutoff has passed but whose deliveries are still ahead.
  const weekStart = "2027-03-01";
  await admin.from("menu_weeks").upsert(
    {
      week_start: weekStart,
      delivery_dates: ["2027-03-01", "2027-03-02"],
      ordering_opens_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      cutoff_at: new Date(Date.now() - 3_600_000).toISOString(),
      status: "closed",
    },
    { onConflict: "week_start" },
  );
  const { data: week } = await admin.from("menu_weeks").select("id").eq("week_start", weekStart).single();
  const { data: mac } = await admin.from("menu_items").select("id").eq("slug", "baked-mac-and-cheese").single();
  await admin
    .from("menu_week_items")
    .upsert({ menu_week_id: week!.id, menu_item_id: mac!.id }, { onConflict: "menu_week_id,menu_item_id" });

  const parentEmail = uniqueEmail("late");
  const parentId = await createUser(parentEmail);
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", parentId).single();
  await admin.from("households").update({ onboarded_at: new Date().toISOString() }).eq("id", hm!.household_id);
  await admin.from("children").insert({ household_id: hm!.household_id, first_name: "Lark" });

  const ownerPage = await (await newContext(browser)).newPage();
  await signInStaff(ownerPage, "owner");
  await ownerPage.goto(`/admin/customers/${hm!.household_id}`);
  const tool = ownerPage
    .locator("section")
    .filter({ has: ownerPage.getByRole("heading", { name: "Late order exception" }) });
  await tool.getByLabel("Week").selectOption(week!.id);
  await tool.getByLabel("Reason").fill("Forgot to order, owner approved");
  await tool.getByRole("button", { name: "Allow late order" }).click();
  await expect(tool.getByText("Forgot to order, owner approved")).toBeVisible();
  const { data: audit } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", "kitchen.late_order_granted")
    .limit(1);
  expect(audit).toHaveLength(1);

  const parentPage = await (await newContext(browser)).newPage();
  await signInWithPassword(parentPage, parentEmail, `/order?week=${week!.id}`);
  await expect(parentPage.getByRole("heading", { name: /week of March 1/ })).toBeVisible();

  // Another family doesn't get the closed week.
  const otherEmail = uniqueEmail("nolate");
  const otherId = await createUser(otherEmail);
  const { data: hm2 } = await admin.from("household_members").select("household_id").eq("user_id", otherId).single();
  await admin.from("households").update({ onboarded_at: new Date().toISOString() }).eq("id", hm2!.household_id);
  const otherPage = await (await newContext(browser)).newPage();
  await signInWithPassword(otherPage, otherEmail, `/order?week=${week!.id}`);
  await expect(otherPage.getByRole("heading", { name: /week of March 1/ })).toHaveCount(0);
});
