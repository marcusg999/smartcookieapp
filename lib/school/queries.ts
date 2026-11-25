import "server-only";

import { cache } from "react";

import { getUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import type { SchoolRole } from "./action";

export type School = {
  id: string;
  name: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  billing_email: string | null;
  billing_terms_days: number;
  tax_exempt: boolean;
  use_school_pricing: boolean;
  address: { line1?: string; city?: string; state?: string; zip?: string } | null;
  contact_phone: string | null;
  dropoff_instructions: string | null;
  dropoff_entrance: string | null;
  dropoff_contact: string | null;
  dropoff_window: string | null;
  onboarded_at: string | null;
};

export type Classroom = {
  id: string;
  name: string;
  teacher_name: string | null;
  grade: string | null;
  headcount: number;
  dropoff_location: string | null;
};

export type AllergyCount = {
  classroom_id: string;
  allergen_id: string;
  allergen_name: string;
  linked_count: number;
  manual_count: number;
};
export type RosterChild = {
  child_id: string;
  first_name: string;
  last_initial: string | null;
  classroom_id: string | null;
  link_status: "pending" | "approved" | "rejected";
  allergens: string[];
  requested_at: string;
};

export type StandingOrder = {
  id: string;
  classroom_id: string | null;
  name: string;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  status: "draft" | "active" | "paused" | "ended";
  quantity_mode: "per_headcount" | "fixed";
  fixed_quantity: number | null;
  buffer_percent: number;
  menu_selection_mode: "chefs_choice" | "specific_items" | "category_rotation";
  day_items: Record<string, string[]>;
  rotation: { category_id: string; count: number }[];
  notes: string | null;
};

export type MenuWeek = { id: string; week_start: string; delivery_dates: string[]; cutoff: string; status: string };
export type SchoolMenuItem = {
  id: string;
  name: string;
  category_id: string | null;
  is_snack: boolean;
  allergens: string[];
  may_contain: string[];
};

export type OrderLine = {
  id: string;
  delivery_date: string;
  item_name: string;
  quantity: number;
  unit_price_cents: number;
  safe_for_allergens: string[];
  classroom_id: string | null;
  child: { first_name: string; last_initial: string | null } | null;
};
export type SchoolOrder = {
  id: string;
  order_number: string;
  source: "standing_order" | "school_bulk" | string;
  status: string;
  standing_order_id: string | null;
  menu_week_id: string;
  total_cents: number;
  needs_review: boolean;
  review_notes: string[];
  school_reviewed_at: string | null;
  dropoff_location: string | null;
  notes: string | null;
  lines: OrderLine[];
};

/** The signed-in user's school and their role in it (one school per user). */
export const getSchoolContext = cache(async (): Promise<{ school: School; role: SchoolRole } | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role, organization_id")
    .eq("user_id", user.id)
    .in("role", ["school_admin", "school_staff"]);
  const m =
    (roles ?? []).find((r) => r.role === "school_admin") ?? (roles ?? []).find((r) => r.role === "school_staff");
  if (!m?.organization_id) return null;
  const { data: school } = await supabase
    .from("organizations")
    .select(
      "id, name, status, billing_email, billing_terms_days, tax_exempt, use_school_pricing, address, contact_phone, dropoff_instructions, dropoff_entrance, dropoff_contact, dropoff_window, onboarded_at",
    )
    .eq("id", m.organization_id)
    .maybeSingle();
  return school ? { school: school as School, role: m.role as SchoolRole } : null;
});

export const getClassrooms = cache(async (orgId: string): Promise<Classroom[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classrooms")
    .select("id, name, teacher_name, grade, headcount, dropoff_location")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name");
  return (data ?? []) as Classroom[];
});

export const getAllergySummary = cache(async (orgId: string): Promise<AllergyCount[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("classroom_allergy_summary", { p_org: orgId });
  return (data ?? []) as AllergyCount[];
});

export const getRoster = cache(async (orgId: string): Promise<RosterChild[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("school_roster", { p_org: orgId });
  return (data ?? []) as RosterChild[];
});

export const getStandingOrders = cache(async (orgId: string): Promise<StandingOrder[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("standing_orders")
    .select(
      "id, classroom_id, name, weekdays, start_date, end_date, status, quantity_mode, fixed_quantity, buffer_percent, menu_selection_mode, day_items, rotation, notes",
    )
    .eq("organization_id", orgId)
    .order("status")
    .order("name");
  return (data ?? []) as StandingOrder[];
});

/** Published weeks around now (recent + upcoming), with their cutoffs. */
export const getSchoolWeeks = cache(async (): Promise<MenuWeek[]> => {
  const supabase = await createClient();
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("menu_weeks")
    .select("id, week_start, delivery_dates, status, cutoff_at")
    .in("status", ["published", "closed", "fulfilled"])
    .gte("week_start", since)
    .order("week_start")
    .limit(8);
  const weeks = data ?? [];
  const cutoffs = await Promise.all(
    weeks.map(async (w) => (await supabase.rpc("menu_week_cutoff", { p_week: w.id })).data as string | null),
  );
  return weeks.map((w, i) => ({
    id: w.id as string,
    week_start: w.week_start as string,
    delivery_dates: (w.delivery_dates as string[]) ?? [],
    status: w.status as string,
    cutoff: cutoffs[i] ?? (w.cutoff_at as string),
  }));
});

/** School-available items on one week's menu (for swaps and bulk orders). */
export const getWeekSchoolItems = cache(async (weekId: string): Promise<SchoolMenuItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("menu_week_items")
    .select(
      "sort_order, available_for, menu_items ( id, name, category_id, is_snack, menu_item_allergens ( presence, allergens ( name ) ) )",
    )
    .eq("menu_week_id", weekId)
    .in("available_for", ["schools", "both"])
    .order("sort_order");
  return toItems((data ?? []).map((r) => r.menu_items));
});

/** Every active item (specific-item standing orders pick from the catalog). */
export const getSchoolCatalog = cache(async (): Promise<SchoolMenuItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("menu_items")
    .select("id, name, category_id, is_snack, menu_item_allergens ( presence, allergens ( name ) )")
    .order("name");
  return toItems(data ?? []);
});

type RawItem = {
  id: string;
  name: string;
  category_id: string | null;
  is_snack: boolean;
  menu_item_allergens: { presence: string; allergens: { name: string } | null }[] | null;
};
function toItems(rows: unknown[]): SchoolMenuItem[] {
  return (rows as (RawItem | null)[])
    .filter((r): r is RawItem => Boolean(r))
    .map((r) => ({
      id: r.id,
      name: r.name,
      category_id: r.category_id,
      is_snack: r.is_snack,
      allergens: (r.menu_item_allergens ?? [])
        .filter((a) => a.presence === "contains")
        .map((a) => a.allergens?.name ?? ""),
      may_contain: (r.menu_item_allergens ?? [])
        .filter((a) => a.presence === "may_contain")
        .map((a) => a.allergens?.name ?? ""),
    }));
}

export const getCategories = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("menu_categories").select("id, name, slug").order("sort_order");
  return (data ?? []) as { id: string; name: string; slug: string }[];
});

export const getWeekOrders = cache(async (orgId: string, weekId: string): Promise<SchoolOrder[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_number, source, status, standing_order_id, menu_week_id, total_cents, needs_review, review_notes, school_reviewed_at, dropoff_location, notes, order_items ( id, delivery_date, item_name, quantity, unit_price_cents, safe_for_allergens, classroom_id, child_id )",
    )
    .eq("organization_id", orgId)
    .eq("menu_week_id", weekId)
    .neq("status", "cancelled")
    .order("created_at");
  // Child names on allergy-safe lines come from the roster (the school can't
  // read the children table).
  const roster = await getRoster(orgId);
  const names = new Map(roster.map((r) => [r.child_id, { first_name: r.first_name, last_initial: r.last_initial }]));
  return (data ?? []).map((o) => ({
    ...(o as unknown as Omit<SchoolOrder, "lines">),
    lines: ((o.order_items ?? []) as (Omit<OrderLine, "child"> & { child_id: string | null })[])
      .map(({ child_id, ...l }) => ({ ...l, child: child_id ? (names.get(child_id) ?? null) : null }))
      .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.item_name.localeCompare(b.item_name)),
  }));
});

export const getAdjustments = cache(async (soIds: string[]) => {
  if (soIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("standing_order_adjustments")
    .select("standing_order_id, delivery_date, headcount, skip, items, note")
    .in("standing_order_id", soIds);
  return (data ?? []) as {
    standing_order_id: string;
    delivery_date: string;
    headcount: number | null;
    skip: boolean;
    items: string[] | null;
    note: string | null;
  }[];
});

export const getClosures = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("school_closures")
    .select("id, closure_date, reason")
    .eq("organization_id", orgId)
    .order("closure_date");
  return (data ?? []) as { id: string; closure_date: string; reason: string | null }[];
});

export type Invoice = {
  id: string;
  number: string | null;
  period_start: string;
  period_end: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  kind: string;
  total_cents: number;
  amount_paid_cents: number;
  due_date: string | null;
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  paid_out_of_band: boolean;
  payment_reference: string | null;
  overdue_flagged_at: string | null;
  created_at: string;
};

export const INVOICE_COLUMNS =
  "id, number, period_start, period_end, status, kind, total_cents, amount_paid_cents, due_date, hosted_invoice_url, pdf_url, paid_out_of_band, payment_reference, overdue_flagged_at, created_at";

export const getInvoices = cache(async (orgId: string): Promise<Invoice[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("organization_id", orgId)
    .neq("status", "draft")
    .order("period_start", { ascending: false })
    .limit(36);
  return (data ?? []) as Invoice[];
});

export const getSpend = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("school_spend", { p_org: orgId });
  return (data ?? []) as { month: string; group_label: string; meals: number; amount_cents: number }[];
});

export const getMembers = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("school_members", { p_org: orgId });
  return (data ?? []) as {
    user_id: string;
    role: SchoolRole;
    email: string;
    full_name: string | null;
    granted_at: string;
  }[];
});
