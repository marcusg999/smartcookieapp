import { randomUUID } from "node:crypto";

import Stripe from "stripe";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, enrollTotp, PASSWORD, uniqueEmail } from "./support/supabase";
import { freshTotp } from "./support/totp";

import type { Page } from "@playwright/test";

// Phase 7: the school portal end to end. Each test makes its own school, so
// tests never share state. Runs once, on desktop.
test.skip(({ isMobile }) => isMobile, "school flows run once, on desktop");
test.describe.configure({ mode: "parallel" });

const MOCK = /^(sk|rk)_test_(ci_)?dummy$/.test(process.env.STRIPE_SECRET_KEY ?? "");

/** An approved school with one classroom; returns ids and the admin's email. */
async function createSchool(opts: { onboarded?: boolean; headcount?: number } = {}) {
  const email = uniqueEmail("school");
  const name = `E2E School ${randomUUID().slice(0, 6)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { account_type: "school", organization_name: name },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const { data: org } = await admin.from("organizations").select("id").eq("name", name).single();
  await admin
    .from("organizations")
    .update({
      status: "approved",
      billing_email: `billing-${randomUUID().slice(0, 6)}@example.com`,
      billing_terms_days: 15,
      onboarded_at: opts.onboarded === false ? null : new Date().toISOString(),
      address: { line1: "1 School Way", city: "Pasadena", state: "CA", zip: "91101" },
    })
    .eq("id", org!.id);
  const { data: room } = await admin
    .from("classrooms")
    .insert({
      organization_id: org!.id,
      name: "Room Kiwi",
      headcount: opts.headcount ?? 10,
      dropoff_location: "Front office",
    })
    .select("id")
    .single();
  return { email, orgId: org!.id as string, roomId: room!.id as string, name };
}

/** The first published week still open for changes. */
async function openWeek() {
  const { data: weeks } = await admin
    .from("menu_weeks")
    .select("id, week_start, delivery_dates")
    .eq("status", "published")
    .order("week_start");
  for (const w of weeks ?? []) {
    const { data: cutoff } = await admin.rpc("menu_week_cutoff", { p_week: w.id });
    if (Date.parse(cutoff as string) > Date.now())
      return w as { id: string; week_start: string; delivery_dates: string[] };
  }
  throw new Error("no open week in the seed data");
}

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

async function passStepUp(page: Page, secret: string) {
  const stepUp = page.getByRole("dialog", { name: "Confirm it's you" });
  if (await stepUp.isVisible({ timeout: 4000 }).catch(() => false)) {
    await stepUp.getByLabel("6-digit code").fill(await freshTotp(secret));
    await stepUp.getByRole("button", { name: "Verify", exact: true }).click();
  }
}

test("new school: details → standing order → weekly order, then change a day, skip a day, close a day, add a bulk order", async ({
  page,
}) => {
  test.slow();
  const school = await createSchool({ onboarded: false });
  const week = await openWeek();
  const [day1, day2, day3] = week.delivery_dates;

  // Onboarding: details first.
  await signInWithPassword(page, school.email, "/school");
  await expect(page.getByRole("heading", { name: "Finish setting up your school" })).toBeVisible();
  await page.getByRole("link", { name: "Add details" }).click();
  await page.getByLabel("Street address").fill("1 School Way");
  await page.getByLabel("City").fill("Pasadena");
  await page.getByLabel("ZIP code").fill("91101");
  await page.getByLabel("Entrance").fill("Front office");
  await page.getByLabel("Time window").fill("10:45 to 11:15am");
  await page.getByRole("button", { name: "Save and add classrooms" }).click();
  await expect(page).toHaveURL(/\/school\/classrooms/);
  await expect(page.getByRole("heading", { name: "Room Kiwi" })).toBeVisible();

  // A standing order (chef's choice, per headcount, no buffer).
  await page.goto("/school/standing-orders/new");
  await page.getByLabel("Name", { exact: true }).fill("Kiwi lunch");
  await page.getByLabel("Starts").fill(week.week_start);
  await page.getByRole("button", { name: "Save standing order" }).click();
  await expect(page).toHaveURL(/\/school\/standing-orders$/);
  await expect(page.getByRole("heading", { name: "Kiwi lunch" })).toBeVisible();

  // It's already this week's order: 10 meals a day.
  await page.goto(`/school/orders?week=${week.id}`);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Kiwi lunch" }) });
  await expect(panel.getByText("10 meals · 0 allergy-safe").first()).toBeVisible();

  // Field trip: 5 children on day 1.
  const row1 = panel
    .getByRole("listitem")
    .filter({ hasText: new RegExp(dayName(day1!)) })
    .first();
  await row1.getByText("Change this day").click();
  await row1.getByLabel("Headcount that day").fill("5");
  await row1.getByRole("button", { name: "Update" }).click();
  await expect(row1.getByText("5 meals · 0 allergy-safe")).toBeVisible();
  const { data: order } = await admin
    .from("orders")
    .select("total_cents, order_items ( quantity, unit_price_cents )")
    .eq("organization_id", school.orgId)
    .eq("menu_week_id", week.id)
    .eq("source", "standing_order")
    .single();
  const items = order!.order_items as { quantity: number; unit_price_cents: number }[];
  expect(order!.total_cents).toBe(items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0));

  // Skip day 2.
  const row2 = panel
    .getByRole("listitem")
    .filter({ hasText: new RegExp(dayName(day2!)) })
    .first();
  await row2.getByText("Change this day").click();
  await row2.getByRole("button", { name: "Skip this day" }).click();
  await expect(
    panel
      .getByRole("listitem")
      .filter({ hasText: new RegExp(dayName(day2!)) })
      .getByText("Skipped"),
  ).toBeVisible();

  // Holiday on day 3 from the calendar.
  await page.goto("/school/calendar");
  await page.getByLabel("Date").fill(day3!);
  await page.getByLabel("Reason (optional)").fill("Teacher training");
  await page.getByRole("button", { name: "Mark closed" }).click();
  await expect(page.getByText("Teacher training")).toBeVisible();
  await page.goto(`/school/orders?week=${week.id}`);
  await expect(page.getByText(/School closed/).first()).toBeVisible();

  // A one-off bulk order for the staff room.
  await page.goto("/school/bulk");
  await page.getByLabel("How many").fill("12");
  await page.getByLabel("Where to deliver").fill("Staff room");
  await page.getByRole("button", { name: "Place bulk order" }).click();
  await expect(page).toHaveURL(/\/school\/orders/);
  await expect(page.getByRole("heading", { name: "Bulk order · Staff room" })).toBeVisible();
});

test("school staff see orders but not billing; parents' classroom links need the admin's approval", async ({
  browser,
}) => {
  test.slow();
  const school = await createSchool();
  const staffEmail = uniqueEmail("teacher");
  const staffId = await createUser(staffEmail);
  await admin.from("user_roles").insert({ user_id: staffId, role: "school_staff", organization_id: school.orgId });

  // A parent links their child (with a peanut allergy) to the classroom.
  const parentId = await createUser(uniqueEmail("linker"));
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", parentId).single();
  const { data: child } = await admin
    .from("children")
    .insert({
      household_id: hm!.household_id,
      first_name: "Nia",
      last_initial: "Q",
      school_id: school.orgId,
      classroom_id: school.roomId,
    })
    .select("id, school_link_status")
    .single();
  expect(child!.school_link_status).toBe("pending");
  const { data: peanut } = await admin.from("allergens").select("id").eq("slug", "peanuts").single();
  await admin.from("child_allergens").insert({ child_id: child!.id, allergen_id: peanut!.id, severity: "severe" });

  // Staff: orders and classrooms, no billing, no approvals.
  const staffPage = await (await browser.newContext()).newPage();
  await signInWithPassword(staffPage, staffEmail, "/school");
  await expect(staffPage.getByRole("link", { name: "Weekly orders" })).toBeVisible();
  await expect(staffPage.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await staffPage.goto("/school/classrooms");
  await expect(staffPage.getByRole("heading", { name: "Parent link requests" })).toHaveCount(0);
  const res = await staffPage.goto("/school/billing");
  expect(res?.status()).toBe(404);

  // Admin approves; the child's first name and allergy appear on the classroom.
  const adminPage = await (await browser.newContext()).newPage();
  await signInWithPassword(adminPage, school.email, "/school/classrooms");
  const requests = adminPage
    .locator("section")
    .filter({ has: adminPage.getByRole("heading", { name: "Parent link requests" }) });
  await expect(requests.getByText("Nia Q.")).toBeVisible();
  await requests.getByRole("button", { name: "Approve" }).click();
  const card = adminPage.getByRole("listitem").filter({ has: adminPage.getByRole("heading", { name: "Room Kiwi" }) });
  await expect(card.getByText("Nia Q.")).toBeVisible();
  await expect(card.getByText("Peanuts (severe)")).toBeVisible();
  await expect(card.getByText("1 Peanuts")).toBeVisible();
});

test("owner invoices a school mid-month, the school sees it, and the owner records a check payment", async ({
  browser,
}) => {
  test.slow();
  const school = await createSchool();
  // A delivered (past) school order: 20 meals at $6.50.
  const { data: week } = await admin
    .from("menu_weeks")
    .select("id")
    .eq("status", "published")
    .order("week_start")
    .limit(1)
    .single();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { data: order } = await admin
    .from("orders")
    .insert({
      organization_id: school.orgId,
      menu_week_id: week!.id,
      source: "admin",
      status: "invoiced",
      fulfillment: "school_dropoff",
      subtotal_cents: 13000,
      total_cents: 13000,
      placed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  await admin.from("order_items").insert({
    order_id: order!.id,
    classroom_id: school.roomId,
    delivery_date: yesterday,
    quantity: 20,
    unit_price_cents: 650,
    item_name: "Baked mac & cheese",
  });

  const ownerPage = await (await browser.newContext()).newPage();
  const secret = await signInStaff(ownerPage, "owner");
  await ownerPage.goto(`/admin/schools/${school.orgId}`);
  await ownerPage.getByRole("button", { name: "Create invoice now" }).click();
  const invoices = ownerPage.locator("section").filter({ has: ownerPage.getByRole("heading", { name: "Invoices" }) });
  await expect(invoices.getByRole("cell", { name: "$130.00" })).toBeVisible({ timeout: 30_000 });
  const { data: inv } = await admin
    .from("invoices")
    .select("id, status, total_cents, stripe_invoice_id")
    .eq("organization_id", school.orgId)
    .single();
  expect(inv!.status).toBe("open");
  expect(inv!.total_cents).toBe(13000);
  expect(inv!.stripe_invoice_id).toMatch(MOCK ? /^in_mock_/ : /^in_/);
  const { data: email } = await admin
    .from("notifications_log")
    .select("template_key")
    .eq("organization_id", school.orgId)
    .eq("template_key", "school_invoice");
  expect(email).toHaveLength(1);

  // The school admin sees it on Billing with a Pay now link.
  const schoolPage = await (await browser.newContext()).newPage();
  await signInWithPassword(schoolPage, school.email, "/school/billing");
  await expect(schoolPage.getByText("$130.00").first()).toBeVisible();
  await expect(schoolPage.getByRole("link", { name: /Pay now/ })).toBeVisible();

  // Paid by check: owner, step-up, reference recorded.
  await invoices.getByRole("button", { name: "Paid by check/PO" }).click();
  await invoices.getByLabel("Check or PO number").fill("CHK-2044");
  await invoices.getByRole("button", { name: "Mark paid" }).click();
  await passStepUp(ownerPage, secret);
  await expect(invoices.getByText("check/PO CHK-2044")).toBeVisible({ timeout: 20_000 });
  const { data: paid } = await admin.from("invoices").select("status, paid_out_of_band").eq("id", inv!.id).single();
  expect(paid).toEqual({ status: "paid", paid_out_of_band: true });
});

test("real Stripe: a school invoice is paid by test ACH and the webhook marks it paid", async () => {
  test.skip(MOCK, "real Stripe test mode only");
  test.setTimeout(4 * 60_000);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-11-18.endive",
    httpClient: Stripe.createFetchHttpClient(),
  });
  const school = await createSchool();
  const { data: week } = await admin
    .from("menu_weeks")
    .select("id")
    .eq("status", "published")
    .order("week_start")
    .limit(1)
    .single();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { data: order } = await admin
    .from("orders")
    .insert({
      organization_id: school.orgId,
      menu_week_id: week!.id,
      source: "admin",
      status: "invoiced",
      fulfillment: "school_dropoff",
      subtotal_cents: 5000,
      total_cents: 5000,
      placed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  await admin.from("order_items").insert({
    order_id: order!.id,
    classroom_id: school.roomId,
    delivery_date: yesterday,
    quantity: 10,
    unit_price_cents: 500,
    item_name: "Veggie pasta salad",
  });
  // The monthly job's path, as the service role.
  const { data: invId, error } = await admin.rpc("prepare_school_invoice", {
    p_org: school.orgId,
    p_period_start: yesterday.slice(0, 8) + "01",
    p_period_end: yesterday,
    p_kind: "on_demand",
  });
  expect(error).toBeNull();
  const res = await fetch(
    new URL("/api/cron/school-invoices", process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"),
    {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    },
  );
  expect(res.status).toBe(200);
  const { data: inv } = await admin
    .from("invoices")
    .select("status, stripe_invoice_id, hosted_invoice_url")
    .eq("id", invId)
    .single();
  expect(inv!.status).toBe("open");
  expect(inv!.hosted_invoice_url).toMatch(/^https:\/\/invoice\.stripe\.com\//);
  const stripeInvoice = await stripe.invoices.retrieve(inv!.stripe_invoice_id!);
  expect(stripeInvoice.total).toBe(5000);
  expect(stripeInvoice.payment_settings.payment_method_types).toEqual(["card", "us_bank_account"]);

  // Test ACH: a verified bank account (microdeposits 32/45) with an offline mandate.
  const setup = await stripe.setupIntents.create({
    customer: stripeInvoice.customer as string,
    allowed_payment_method_types: ["us_bank_account"],
    confirm: true,
    payment_method_data: {
      type: "us_bank_account",
      us_bank_account: { routing_number: "110000000", account_number: "000123456789", account_holder_type: "company" },
      billing_details: { name: school.name },
    },
    mandate_data: { customer_acceptance: { type: "offline" } },
  } as Stripe.SetupIntentCreateParams);
  const verified = await stripe.setupIntents.verifyMicrodeposits(setup.id, { amounts: [32, 45] });
  await stripe.invoices.pay(inv!.stripe_invoice_id!, {
    payment_method: verified.payment_method as string,
    mandate: verified.mandate as string,
  });
  await expect
    .poll(async () => (await admin.from("invoices").select("status").eq("id", invId).single()).data?.status, {
      timeout: 120_000,
      intervals: [3000],
    })
    .toBe("paid");
  await stripe.customers.del(stripeInvoice.customer as string).catch(() => undefined);
});

function dayName(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T12:00:00Z`));
}
