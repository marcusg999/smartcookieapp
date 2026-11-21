"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { check, familyAction } from "@/lib/family/action";
import { getChildren, getFavorites, getLastOrderLines, getZoneForZip } from "@/lib/family/queries";
import { getPublishedWeeks, type PublicWeek } from "@/lib/menu/queries";
import { blockingAllergens, normalizeLines, planRepeat, type CartLine } from "@/lib/ordering/logic";
import { getPaymentProvider } from "@/lib/payments/provider";
import {
  addressSchema,
  cartLinesSchema,
  childSchema,
  householdSchema,
  placeOrderSchema,
  zipSchema,
} from "@/lib/validation/family";

const uuid = z.uuid();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function refresh(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

async function openWeek(weekId: string): Promise<PublicWeek | null> {
  const weeks = await getPublishedWeeks().catch(() => []);
  const week = weeks.find((w) => w.id === weekId);
  if (!week || !week.cutoff || Date.parse(week.cutoff) <= Date.now()) return null;
  return week;
}

const toRow = (l: CartLine) => ({
  child_id: l.childId,
  menu_item_id: l.menuItemId,
  delivery_date: l.deliveryDate,
  quantity: l.quantity,
});

/**
 * Keep only lines that are valid for this week: a real child of the
 * household, a family meal on the menu, a delivery day of the week, and no
 * allergy block (CLAUDE.md §6). The database re-checks all of this at
 * placement; filtering here means a blocked meal never sits in a cart.
 */
async function cleanLines(householdId: string, week: PublicWeek, lines: CartLine[]) {
  const children = await getChildren(householdId);
  const kids = new Map(children.map((c) => [c.id, c]));
  const meals = new Map(week.meals.filter((m) => m.available_for !== "schools").map((m) => [m.id, m]));
  const blocked: string[] = [];
  const kept = normalizeLines(lines).filter((l) => {
    const child = kids.get(l.childId);
    const meal = meals.get(l.menuItemId);
    if (!child || !meal || !week.delivery_dates.includes(l.deliveryDate)) return false;
    const hits = blockingAllergens(child, { id: meal.id, contains: meal.contains, mayContain: meal.may_contain });
    if (hits.length) blocked.push(`${child.first_name}: ${meal.name} (${hits.join(", ")})`);
    return hits.length === 0;
  });
  return { kept, blocked };
}

// ─── Onboarding / household ──────────────────────────────────────────────────

export async function saveHousehold(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: householdSchema, input }, async (data, { supabase, householdId, user }) => {
    check(await supabase.from("households").update({ name: data.name }).eq("id", householdId));
    check(
      await supabase
        .from("profiles")
        .update({ phone: data.phone || null })
        .eq("id", user.id),
    );
    refresh("/account", "/welcome");
  });
}

export async function checkZip(
  input: unknown,
): Promise<ActionResult<{ covered: boolean; zone?: string; days?: string }>> {
  return familyAction({ schema: z.object({ zip: zipSchema }), input }, async ({ zip }) => {
    const zone = await getZoneForZip(zip);
    if (!zone) return { ok: true, data: { covered: false } };
    const days = zone.deliveryWeekdays.map((d) => WEEKDAYS[d % 7]).join(", ");
    return { ok: true, data: { covered: true, zone: zone.name, days } };
  });
}

export async function saveAddress(input: unknown): Promise<ActionResult<{ id: string; covered: boolean }>> {
  return familyAction({ schema: addressSchema, input }, async (data, { supabase, householdId }) => {
    const zone = await getZoneForZip(data.zip);
    const row = {
      household_id: householdId,
      line1: data.line1,
      line2: data.line2 || null,
      city: data.city,
      state: data.state,
      zip: data.zip,
      delivery_notes: data.deliveryNotes || null,
    };
    if (data.makeDefault) {
      check(
        await supabase
          .from("addresses")
          .update({ is_default: false })
          .eq("household_id", householdId)
          .eq("is_default", true),
      );
    }
    const saved = data.id
      ? check(
          await supabase
            .from("addresses")
            .update({ ...row, is_default: data.makeDefault })
            .eq("id", data.id)
            .select("id")
            .single(),
        )
      : check(
          await supabase
            .from("addresses")
            .insert({ ...row, is_default: data.makeDefault })
            .select("id")
            .single(),
        );
    if (data.makeDefault) {
      check(
        await supabase
          .from("households")
          .update({ default_address_id: saved.id, default_zone_id: zone?.id ?? null })
          .eq("id", householdId),
      );
    }
    refresh("/account/addresses", "/checkout", "/welcome");
    return { ok: true, data: { id: saved.id as string, covered: Boolean(zone) } };
  });
}

export async function setDefaultAddress(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: z.object({ id: uuid }), input }, async ({ id }, { supabase, householdId }) => {
    const addr = check(await supabase.from("addresses").select("id, zip").eq("id", id).single());
    const zone = await getZoneForZip(addr.zip as string);
    check(
      await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("household_id", householdId)
        .eq("is_default", true),
    );
    check(await supabase.from("addresses").update({ is_default: true }).eq("id", id));
    check(
      await supabase
        .from("households")
        .update({ default_address_id: id, default_zone_id: zone?.id ?? null })
        .eq("id", householdId),
    );
    refresh("/account/addresses", "/checkout");
  });
}

export async function deleteAddress(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: z.object({ id: uuid }), input }, async ({ id }, { supabase }) => {
    check(await supabase.from("addresses").delete().eq("id", id));
    refresh("/account/addresses", "/checkout");
  });
}

export async function joinWaitlist(input: unknown): Promise<ActionResult> {
  return familyAction(
    { schema: z.object({ zip: zipSchema }), input },
    async ({ zip }, { supabase, householdId, user }) => {
      if (!user.email) return fail("validation", "We need an email address to let you know.");
      const { error } = await supabase
        .from("zone_waitlist")
        .insert({ household_id: householdId, email: user.email, zip });
      if (error && error.code !== "23505") throw error; // already on the list is fine
    },
  );
}

export async function setOrderingPreference(input: unknown): Promise<ActionResult> {
  return familyAction(
    {
      schema: z.object({ preference: z.enum(["a_la_carte", "subscription"]), planId: uuid.optional().nullable() }),
      input,
    },
    async ({ preference, planId }, { supabase, householdId }) => {
      check(
        await supabase
          .from("households")
          .update({
            ordering_preference: preference,
            preferred_plan_id: preference === "subscription" ? (planId ?? null) : null,
          })
          .eq("id", householdId),
      );
    },
  );
}

export async function completeOnboarding(): Promise<ActionResult> {
  return familyAction({ schema: z.undefined(), input: undefined }, async (_d, { supabase, householdId }) => {
    check(await supabase.from("households").update({ onboarded_at: new Date().toISOString() }).eq("id", householdId));
    refresh("/account", "/order");
  });
}

// ─── Children ────────────────────────────────────────────────────────────────

export type Conflict = { order_number: string; item_name: string; delivery_date: string; allergens: string };

export async function saveChild(input: unknown): Promise<ActionResult<{ id: string; conflicts: Conflict[] }>> {
  return familyAction({ schema: childSchema, input }, async (data, { supabase, householdId }) => {
    const row = {
      household_id: householdId,
      first_name: data.firstName,
      last_initial: data.lastInitial ? data.lastInitial.toUpperCase() : null,
      grade: data.grade || null,
      school_id: data.schoolId || null,
      classroom_id: data.schoolId && data.classroomId ? data.classroomId : null,
      dietary_preferences: data.dietary,
      notes: data.notes || null,
    };
    const saved = data.id
      ? check(await supabase.from("children").update(row).eq("id", data.id).select("id").single())
      : check(await supabase.from("children").insert(row).select("id").single());
    const childId = saved.id as string;

    // Replace the allergy list. Delete-then-insert under the parent's RLS.
    check(await supabase.from("child_allergens").delete().eq("child_id", childId));
    if (data.allergies.length) {
      check(
        await supabase
          .from("child_allergens")
          .insert(data.allergies.map((a) => ({ child_id: childId, allergen_id: a.allergenId, severity: a.severity }))),
      );
    }
    // Editing allergies re-checks upcoming orders (Phase 5 §6).
    const { data: conflicts } = await supabase.rpc("upcoming_allergy_conflicts", { p_child: childId });
    refresh("/children", "/order", "/account", "/welcome");
    return { ok: true, data: { id: childId, conflicts: (conflicts ?? []) as Conflict[] } };
  });
}

export async function removeChild(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: z.object({ id: uuid }), input }, async ({ id }, { supabase }) => {
    check(await supabase.from("children").update({ archived_at: new Date().toISOString() }).eq("id", id));
    refresh("/children", "/order", "/account");
  });
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export async function saveCart(input: unknown): Promise<ActionResult<{ lines: CartLine[]; blocked: string[] }>> {
  return familyAction(
    { schema: z.object({ weekId: uuid, lines: cartLinesSchema }), input },
    async ({ weekId, lines }, { supabase, householdId }) => {
      const week = await openWeek(weekId);
      if (!week) return fail("validation", "Ordering for this week is closed.");
      const { kept, blocked } = await cleanLines(householdId, week, lines);
      check(
        await supabase
          .from("carts")
          .upsert(
            { household_id: householdId, menu_week_id: weekId, lines: kept.map(toRow) },
            { onConflict: "household_id,menu_week_id" },
          ),
      );
      return { ok: true, data: { lines: kept, blocked } };
    },
  );
}

export async function clearCart(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: z.object({ weekId: uuid }), input }, async ({ weekId }, { supabase, householdId }) => {
    check(await supabase.from("carts").delete().eq("household_id", householdId).eq("menu_week_id", weekId));
    refresh("/order", "/checkout");
  });
}

export async function toggleFavorite(input: unknown): Promise<ActionResult<{ favorite: boolean }>> {
  return familyAction(
    { schema: z.object({ menuItemId: uuid, childId: uuid.nullable() }), input },
    async ({ menuItemId, childId }, { supabase, householdId }) => {
      let q = supabase.from("favorites").select("id").eq("household_id", householdId).eq("menu_item_id", menuItemId);
      q = childId ? q.eq("child_id", childId) : q.is("child_id", null);
      const { data: existing } = await q.maybeSingle();
      if (existing) {
        check(await supabase.from("favorites").delete().eq("id", existing.id));
      } else {
        check(
          await supabase
            .from("favorites")
            .insert({ household_id: householdId, menu_item_id: menuItemId, child_id: childId }),
        );
      }
      refresh("/favorites");
      return { ok: true, data: { favorite: !existing } };
    },
  );
}

type Swap = { childId: string; deliveryDate: string; fromName: string; toId: string };

export async function repeatLastWeek(
  input: unknown,
): Promise<ActionResult<{ lines: CartLine[]; swaps: Swap[]; dropped: { childId: string; fromName: string }[] }>> {
  return familyAction({ schema: z.object({ weekId: uuid }), input }, async ({ weekId }, { supabase, householdId }) => {
    const week = await openWeek(weekId);
    if (!week) return fail("validation", "Ordering for this week is closed.");
    const last = await getLastOrderLines(householdId, week.week_start);
    if (!last || last.lines.length === 0) return { ok: true, data: { lines: [], swaps: [], dropped: [] } };
    const children = await getChildren(householdId);
    const kids = new Map(children.map((c) => [c.id, c]));
    const menu = week.meals
      .filter((m) => m.available_for !== "schools")
      .map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        isSnack: m.is_snack,
        contains: m.contains,
        mayContain: m.may_contain,
      }));
    const plan = planRepeat({
      lastLines: last.lines.filter((l) => kids.has(l.childId)),
      lastWeekStart: last.weekStart,
      weekStart: week.week_start,
      deliveryDates: week.delivery_dates,
      menu,
      isBlocked: (childId, meal) => blockingAllergens(kids.get(childId)!, meal).length > 0,
    });
    const { kept } = await cleanLines(householdId, week, plan.lines);
    check(
      await supabase
        .from("carts")
        .upsert(
          { household_id: householdId, menu_week_id: weekId, lines: kept.map(toRow) },
          { onConflict: "household_id,menu_week_id" },
        ),
    );
    return { ok: true, data: { lines: kept, swaps: plan.swaps, dropped: plan.dropped } };
  });
}

export async function fillWithFavorites(input: unknown): Promise<ActionResult<{ lines: CartLine[]; added: number }>> {
  return familyAction(
    { schema: z.object({ weekId: uuid, lines: cartLinesSchema }), input },
    async ({ weekId, lines }, { supabase, householdId }) => {
      const week = await openWeek(weekId);
      if (!week) return fail("validation", "Ordering for this week is closed.");
      const [children, favorites] = await Promise.all([getChildren(householdId), getFavorites(householdId)]);
      const onMenu = new Map(
        week.meals.filter((m) => m.available_for !== "schools" && !m.is_snack).map((m) => [m.id, m]),
      );
      const days = [...week.delivery_dates].sort();
      const next = [...lines];
      let added = 0;
      for (const child of children) {
        const picks = favorites
          .filter((f) => (f.childId === child.id || f.childId === null) && onMenu.has(f.menuItemId))
          .sort((a, b) => Number(a.childId === null) - Number(b.childId === null))
          .map((f) => onMenu.get(f.menuItemId)!)
          .filter(
            (m) => blockingAllergens(child, { id: m.id, contains: m.contains, mayContain: m.may_contain }).length === 0,
          );
        const unique = [...new Map(picks.map((m) => [m.id, m])).values()];
        if (!unique.length) continue;
        days.forEach((day, i) => {
          const hasMain = next.some(
            (l) => l.childId === child.id && l.deliveryDate === day && onMenu.has(l.menuItemId),
          );
          if (hasMain) return;
          next.push({ childId: child.id, menuItemId: unique[i % unique.length]!.id, deliveryDate: day, quantity: 1 });
          added++;
        });
      }
      const { kept } = await cleanLines(householdId, week, next);
      check(
        await supabase
          .from("carts")
          .upsert(
            { household_id: householdId, menu_week_id: weekId, lines: kept.map(toRow) },
            { onConflict: "household_id,menu_week_id" },
          ),
      );
      return { ok: true, data: { lines: kept, added } };
    },
  );
}

// ─── Saved orders ("Monday–Wednesday usual") ─────────────────────────────────

export async function saveNamedOrder(input: unknown): Promise<ActionResult<{ id: string }>> {
  return familyAction(
    {
      schema: z.object({ name: z.string().trim().min(1, "Give it a name.").max(80), lines: cartLinesSchema.min(1) }),
      input,
    },
    async ({ name, lines }, { supabase, householdId }) => {
      const payload = lines.map((l) => ({
        child_id: l.childId,
        menu_item_id: l.menuItemId,
        quantity: l.quantity,
        weekday: new Date(`${l.deliveryDate}T12:00:00Z`).getUTCDay(),
      }));
      const saved = check(
        await supabase.from("saved_orders").insert({ household_id: householdId, name, payload }).select("id").single(),
      );
      refresh("/order");
      return { ok: true, data: { id: saved.id as string } };
    },
  );
}

export async function applySavedOrder(input: unknown): Promise<ActionResult<{ lines: CartLine[]; skipped: number }>> {
  return familyAction(
    { schema: z.object({ id: uuid, weekId: uuid, lines: cartLinesSchema }), input },
    async ({ id, weekId, lines }, { supabase, householdId }) => {
      const week = await openWeek(weekId);
      if (!week) return fail("validation", "Ordering for this week is closed.");
      const saved = check(await supabase.from("saved_orders").select("payload").eq("id", id).single());
      const byWeekday = new Map(week.delivery_dates.map((d) => [new Date(`${d}T12:00:00Z`).getUTCDay(), d]));
      const payload = saved.payload as { child_id: string; menu_item_id: string; quantity: number; weekday: number }[];
      const mapped: CartLine[] = payload.flatMap((p) => {
        const day = byWeekday.get(p.weekday);
        return day
          ? [{ childId: p.child_id, menuItemId: p.menu_item_id, deliveryDate: day, quantity: p.quantity }]
          : [];
      });
      const { kept } = await cleanLines(householdId, week, [...lines, ...mapped]);
      check(
        await supabase
          .from("carts")
          .upsert(
            { household_id: householdId, menu_week_id: weekId, lines: kept.map(toRow) },
            { onConflict: "household_id,menu_week_id" },
          ),
      );
      return { ok: true, data: { lines: kept, skipped: payload.length - mapped.length } };
    },
  );
}

export async function deleteSavedOrder(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: z.object({ id: uuid }), input }, async ({ id }, { supabase }) => {
    check(await supabase.from("saved_orders").delete().eq("id", id));
    refresh("/order");
  });
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export async function previewDiscount(input: unknown): Promise<ActionResult<{ discountCents: number }>> {
  return familyAction(
    {
      schema: z.object({
        code: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[A-Za-z0-9_-]+$/),
        subtotalCents: z.number().int().min(0),
      }),
      input,
      limiter: "codeCheck",
    },
    async ({ code, subtotalCents }, { supabase }) => {
      const { data, error } = await supabase.rpc("preview_discount", { p_code: code, p_subtotal_cents: subtotalCents });
      if (error || data === null) return fail("validation", "That code isn't valid.");
      return { ok: true, data: { discountCents: data as number } };
    },
  );
}

/**
 * placeOrder: the client sends only the week, delivery choice, code and the
 * allergy confirmation. The lines come from the server-side cart, and
 * place_family_order re-validates everything (cutoff in DB time, menu,
 * capacity under row locks, allergies, prices, zone fee, plan allowance).
 */
export async function placeOrder(
  input: unknown,
): Promise<ActionResult<{ orderId: string; orderNumber: string; totalCents: number; status: string }>> {
  return familyAction(
    { schema: placeOrderSchema, input, limiter: "checkout" },
    async (data, { supabase, householdId }) => {
      const { data: cart } = await supabase
        .from("carts")
        .select("lines, replaces_order_id")
        .eq("household_id", householdId)
        .eq("menu_week_id", data.weekId)
        .maybeSingle();
      const lines = (cart?.lines ?? []) as { child_id: string }[];
      if (lines.length === 0) return fail("validation", "Your cart is empty.");
      const kidsInCart = [...new Set(lines.map((l) => l.child_id))];
      if (kidsInCart.some((id) => !data.confirmedChildIds.includes(id))) {
        return fail("validation", "Please confirm each child's allergies.");
      }

      const { data: orderId, error } = await supabase.rpc("place_family_order", {
        p_household: householdId,
        p_menu_week: data.weekId,
        p_items: cart!.lines,
        p_fulfillment: data.fulfillment,
        p_address: data.fulfillment === "delivery" ? (data.addressId ?? null) : null,
        p_discount_code: data.discountCode || null,
        p_allergies_confirmed: true,
        p_notes: data.notes || null,
        p_replace_order: (cart!.replaces_order_id as string | null) ?? null,
      });
      if (error) throw error;
      const order = check(
        await supabase
          .from("orders")
          .select("id, order_number, total_cents, status")
          .eq("id", orderId as string)
          .single(),
      );
      check(await supabase.from("carts").delete().eq("household_id", householdId).eq("menu_week_id", data.weekId));
      refresh("/orders", "/account", "/order");
      return {
        ok: true,
        data: {
          orderId: order.id as string,
          orderNumber: order.order_number as string,
          totalCents: order.total_cents as number,
          status: order.status as string,
        },
      };
    },
  );
}

export async function payOrder(input: unknown): Promise<ActionResult> {
  return familyAction(
    { schema: z.object({ orderId: uuid }), input, limiter: "checkout" },
    async ({ orderId }, { supabase }) => {
      // RLS: the parent can only read their own household's orders.
      const { data: order } = await supabase.from("orders").select("id, status").eq("id", orderId).maybeSingle();
      if (!order || order.status !== "pending_payment")
        return fail("validation", "This order isn't waiting for payment.");
      const result = await getPaymentProvider().payOrder(orderId);
      if (!result.ok) return fail("validation", result.message);
      refresh("/orders", `/orders/${orderId}`, "/account");
    },
  );
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function cancelOrder(input: unknown): Promise<ActionResult> {
  return familyAction({ schema: z.object({ orderId: uuid }), input }, async ({ orderId }, { supabase }) => {
    const { error } = await supabase.rpc("cancel_family_order", { p_order: orderId });
    if (error) throw error;
    refresh("/orders", `/orders/${orderId}`, "/account", "/order");
  });
}

/** Load an order back into the cart for changes; checkout re-prices it in place. */
export async function modifyOrder(input: unknown): Promise<ActionResult<{ weekId: string }>> {
  return familyAction(
    { schema: z.object({ orderId: uuid }), input },
    async ({ orderId }, { supabase, householdId }) => {
      const order = check(
        await supabase
          .from("orders")
          .select("id, status, menu_week_id, order_items ( child_id, menu_item_id, delivery_date, quantity )")
          .eq("id", orderId)
          .single(),
      );
      const week = await openWeek(order.menu_week_id as string);
      if (!week || !["pending_payment", "paid"].includes(order.status as string)) {
        return fail("validation", "This order can't be changed any more.");
      }
      const items = (
        order.order_items as {
          child_id: string | null;
          menu_item_id: string | null;
          delivery_date: string | null;
          quantity: number;
        }[]
      )
        .filter((i) => i.child_id && i.menu_item_id && i.delivery_date)
        .map((i) => ({
          childId: i.child_id!,
          menuItemId: i.menu_item_id!,
          deliveryDate: i.delivery_date!,
          quantity: i.quantity,
        }));
      const lines = normalizeLines(items);
      check(
        await supabase
          .from("carts")
          .upsert(
            { household_id: householdId, menu_week_id: week.id, lines: lines.map(toRow), replaces_order_id: orderId },
            { onConflict: "household_id,menu_week_id" },
          ),
      );
      return { ok: true, data: { weekId: week.id } };
    },
  );
}

// ─── Subscription (Stripe connects in Phase 6) ───────────────────────────────

export async function choosePlan(input: unknown): Promise<ActionResult> {
  return familyAction(
    { schema: z.object({ planId: uuid }), input, limiter: "checkout" },
    async ({ planId }, { supabase, householdId }) => {
      const { data: subId, error } = await supabase.rpc("create_pending_subscription", {
        p_household: householdId,
        p_plan: planId,
      });
      if (error) throw error;
      const result = await getPaymentProvider().startSubscription(subId as string);
      if (!result.ok) return fail("validation", result.message);
      check(
        await supabase
          .from("households")
          .update({ ordering_preference: "subscription", preferred_plan_id: planId })
          .eq("id", householdId),
      );
      refresh("/subscription", "/order", "/account");
    },
  );
}

export async function setWeekSkip(input: unknown): Promise<ActionResult> {
  return familyAction(
    { schema: z.object({ subscriptionId: uuid, weekId: uuid, skip: z.boolean() }), input },
    async ({ subscriptionId, weekId, skip }, { supabase }) => {
      const { error } = await supabase.rpc("set_subscription_week_skip", {
        p_subscription: subscriptionId,
        p_week: weekId,
        p_skip: skip,
      });
      if (error) throw error;
      refresh("/subscription", "/order", "/account");
    },
  );
}

export async function changeSubscription(input: unknown): Promise<ActionResult> {
  return familyAction(
    {
      schema: z.object({
        subscriptionId: uuid,
        action: z.enum(["pause", "resume", "cancel", "reactivate"]),
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      input,
    },
    async ({ subscriptionId, action, until }, { supabase }) => {
      const { error } = await supabase.rpc("request_subscription_change", {
        p_subscription: subscriptionId,
        p_action: action,
        p_until: until ? `${until}T12:00:00Z` : null,
      });
      if (error) throw error;
      refresh("/subscription", "/order", "/account");
    },
  );
}

export async function changePlan(input: unknown): Promise<ActionResult> {
  return familyAction(
    { schema: z.object({ subscriptionId: uuid, planId: uuid }), input },
    async ({ subscriptionId, planId }, { supabase }) => {
      const { error } = await supabase.rpc("request_plan_change", { p_subscription: subscriptionId, p_plan: planId });
      if (error) throw error;
      refresh("/subscription");
    },
  );
}
