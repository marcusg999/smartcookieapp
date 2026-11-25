// Phase 10 load sanity: the Thursday-night cutoff rush.
//
//   pnpm load:cutoff            (local Supabase only; see docs/qa.md)
//
// Creates N test families (default 200), puts a capacity limit on one meal
// in the open week, then has every family place an order for it at the same
// moment, straight through the same database function the checkout uses
// (place_family_order: allergy checks, cutoff, zone, capacity, pricing).
// Passes when nothing oversells and p95 latency is under 1.5 s.
//
// Session tokens are minted with the local stack's published development
// JWT secret (Supabase rate-limits real sign-ins to 30 per 5 minutes per IP),
// so this script refuses to run against anything but localhost.
import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const N = Number(process.env.LOAD_FAMILIES ?? 200);
const CAPACITY = Number(process.env.LOAD_CAPACITY ?? 150);
const P95_LIMIT_MS = 1500;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error("Load test runs against local Supabase only.");

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub,
    role: "authenticated",
    aud: "authenticated",
    aal: "aal1",
    iat: now,
    exp: now + 3600,
    session_id: randomUUID(),
  });
  const sig = createHmac("sha256", LOCAL_JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function openWeek() {
  const { data } = await admin
    .from("menu_weeks")
    .select("id, delivery_dates, ordering_opens_at")
    .eq("status", "published")
    .order("week_start");
  for (const w of data ?? []) {
    const { data: cutoff } = await admin.rpc("menu_week_cutoff", { p_week: w.id });
    if (
      Date.parse(cutoff as string) > Date.now() &&
      (!w.ordering_opens_at || Date.parse(w.ordering_opens_at) <= Date.now())
    )
      return w;
  }
  throw new Error("No open week (run against the seeded local database).");
}

async function makeFamily(i: number, run: string) {
  const email = `load-${run}-${i}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser");
  const { data: hm } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", data.user.id)
    .single();
  const householdId = hm!.household_id as string;
  const { data: addr } = await admin
    .from("addresses")
    .insert({
      household_id: householdId,
      line1: `${i} Load Test Way`,
      city: "Pasadena",
      zip: "91105",
      is_default: true,
    })
    .select("id")
    .single();
  await admin
    .from("households")
    .update({ default_address_id: addr!.id, onboarded_at: new Date().toISOString() })
    .eq("id", householdId);
  const { data: child } = await admin
    .from("children")
    .insert({ household_id: householdId, first_name: `Kid${i}` })
    .select("id")
    .single();
  return { userId: data.user.id, householdId, addressId: addr!.id as string, childId: child!.id as string };
}

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;

async function main() {
  const run = Date.now().toString(36);
  const week = await openWeek();
  const { data: items } = await admin
    .from("menu_week_items")
    .select("menu_item_id, capacity, price_override_cents, menu_items!inner ( name, base_price_cents )")
    .eq("menu_week_id", week.id);
  type Row = {
    menu_item_id: string;
    capacity: number | null;
    price_override_cents: number | null;
    menu_items: { name: string; base_price_cents: number };
  };
  // Test children have no allergies, so any meal without its own capacity limit works.
  const safe = ((items ?? []) as unknown as Row[]).filter((r) => r.capacity == null);
  const target = safe[0]!;
  // A second meal tops each order up past the delivery minimum.
  const filler = safe[1]!;
  const fillerQty = Math.ceil(3000 / (filler.price_override_cents ?? filler.menu_items.base_price_cents));
  const live = ["pending_payment", "paid", "invoiced", "fulfilled", "partially_refunded"];
  const reserved = async () => {
    const { data } = await admin
      .from("order_items")
      .select("quantity, orders!inner ( menu_week_id, status )")
      .eq("menu_item_id", target.menu_item_id)
      .eq("orders.menu_week_id", week.id)
      .in("orders.status", live);
    return (data ?? []).reduce((s, r) => s + (r.quantity as number), 0);
  };
  const already = await reserved();
  const capacity = already + CAPACITY;
  await admin
    .from("menu_week_items")
    .update({ capacity })
    .eq("menu_week_id", week.id)
    .eq("menu_item_id", target.menu_item_id);
  console.log(
    `Week ${week.id}: "${target.menu_items.name}" capped at ${capacity} (${already} already reserved, ${CAPACITY} left).`,
  );

  console.log(`Creating ${N} families…`);
  const families: Awaited<ReturnType<typeof makeFamily>>[] = [];
  for (let i = 0; i < N; i += 20)
    families.push(
      ...(await Promise.all(Array.from({ length: Math.min(20, N - i) }, (_, j) => makeFamily(i + j, run)))),
    );

  console.log(`Placing ${N} orders at once…`);
  const started = Date.now();
  const results = await Promise.all(
    families.map(async (f) => {
      const t0 = performance.now();
      const res = await fetch(`${url}/rest/v1/rpc/place_family_order`, {
        method: "POST",
        headers: { apikey: publishable, authorization: `Bearer ${jwt(f.userId)}`, "content-type": "application/json" },
        body: JSON.stringify({
          p_household: f.householdId,
          p_menu_week: week.id,
          p_items: [
            {
              child_id: f.childId,
              menu_item_id: target.menu_item_id,
              quantity: 1,
              delivery_date: week.delivery_dates[0],
            },
            {
              child_id: f.childId,
              menu_item_id: filler.menu_item_id,
              quantity: fillerQty,
              delivery_date: week.delivery_dates[0],
            },
          ],
          p_fulfillment: "delivery",
          p_address: f.addressId,
          p_allergies_confirmed: true,
        }),
      });
      const ms = performance.now() - t0;
      const body = res.ok ? null : ((await res.json()) as { message?: string }).message;
      return { ok: res.ok, ms, body };
    }),
  );
  const wall = Date.now() - started;
  const ok = results.filter((r) => r.ok).length;
  const rejected = results.filter((r) => !r.ok);
  const reasons = Object.entries(
    rejected.reduce<Record<string, number>>((m, r) => ((m[r.body ?? "?"] = (m[r.body ?? "?"] ?? 0) + 1), m), {}),
  );
  const lat = results.map((r) => r.ms);
  const after = await reserved();
  const p50 = pct(lat, 50);
  const p95 = pct(lat, 95);
  console.log(`\n${ok} placed, ${rejected.length} refused in ${wall} ms (wall).`);
  for (const [reason, n] of reasons) console.log(`  refused ×${n}: ${reason}`);
  console.log(`Latency: p50 ${p50.toFixed(0)} ms · p95 ${p95.toFixed(0)} ms · max ${Math.max(...lat).toFixed(0)} ms`);
  console.log(`Reserved for "${target.menu_items.name}": ${after} of ${capacity}.`);

  // Restore the meal's capacity.
  await admin
    .from("menu_week_items")
    .update({ capacity: target.capacity })
    .eq("menu_week_id", week.id)
    .eq("menu_item_id", target.menu_item_id);

  const failures: string[] = [];
  if (after > capacity) failures.push(`OVERSOLD: ${after} > ${capacity}`);
  if (ok !== Math.min(N, CAPACITY)) failures.push(`expected ${Math.min(N, CAPACITY)} orders to succeed, got ${ok}`);
  if (rejected.some((r) => !/sold out|capacity|left/i.test(r.body ?? "")))
    failures.push("some refusals weren't capacity refusals");
  if (p95 > P95_LIMIT_MS) failures.push(`p95 ${p95.toFixed(0)} ms is over ${P95_LIMIT_MS} ms`);
  if (failures.length) {
    console.error(`\nFAIL\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nPASS: no overselling, every refusal was a capacity refusal, p95 under 1.5 s.");
}

await main();
