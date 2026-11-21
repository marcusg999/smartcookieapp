-- Phase 3 (4/5): plans, subscriptions, orders, favorites, saved orders,
-- allergy overrides. Orders and their totals are never written directly by
-- app users: they're created by `create_family_order` (migration 5), which
-- recomputes every price server-side (CLAUDE.md §5.8), or by the service role.

-- ─────────────────────────────────────────────────────────────────────────────
-- Plans (owner-configurable, no code needed for a new plan)
-- ─────────────────────────────────────────────────────────────────────────────
create type public.plan_audience as enum ('family', 'school');
create type public.billing_interval as enum ('week', 'two_weeks', 'month');
create type public.allowance_unit as enum ('per_child', 'per_household');
create type public.auto_fill_strategy as enum ('favorites', 'chefs_choice', 'none');

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  description_rich jsonb,
  audience public.plan_audience not null default 'family',
  billing_interval public.billing_interval not null default 'week',
  meals_per_interval integer not null check (meals_per_interval between 1 and 100),
  allowance_unit public.allowance_unit not null default 'per_child',
  price_cents integer not null check (price_cents >= 0),
  price_per_extra_meal_cents integer check (price_per_extra_meal_cents is null or price_per_extra_meal_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  includes_snacks boolean not null default false,
  snacks_per_interval integer not null default 0 check (snacks_per_interval >= 0),
  allow_skip boolean not null default true,
  max_skips_per_month smallint not null default 2 check (max_skips_per_month between 0 and 31),
  allow_pause boolean not null default true,
  rollover_unused boolean not null default false,
  max_rollover integer not null default 0 check (max_rollover >= 0),
  auto_fill_strategy public.auto_fill_strategy not null default 'favorites',
  min_commitment_intervals smallint not null default 0 check (min_commitment_intervals >= 0),
  trial_intervals smallint not null default 0 check (trial_intervals >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  stripe_product_id text unique,
  stripe_price_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Stripe Prices are immutable: every price change adds a row here.
create table public.plan_price_history (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete restrict,
  stripe_price_id text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  active_from timestamptz not null default now(),
  active_to timestamptz check (active_to is null or active_to >= active_from)
);
create index plan_price_history_plan_idx on public.plan_price_history (plan_id, active_from desc);

create function public.record_plan_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.price_cents is distinct from old.price_cents or new.stripe_price_id is distinct from old.stripe_price_id then
    update public.plan_price_history set active_to = now() where plan_id = new.id and active_to is null;
    insert into public.plan_price_history (plan_id, stripe_price_id, price_cents, currency)
      values (new.id, new.stripe_price_id, new.price_cents, new.currency);
  end if;
  return new;
end;
$$;

alter table public.plans enable row level security;
alter table public.plan_price_history enable row level security;
revoke all on public.plan_price_history from anon;

create policy "Anyone reads active plans" on public.plans
  for select to anon, authenticated using (is_active and archived_at is null);
create policy "Staff read all plans (AAL2)" on public.plans
  for select to authenticated using (public.is_staff_aal2());
create policy "Owner manages plans (AAL2)" on public.plans
  for all to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2());
create policy "Ops and owner read price history (AAL2)" on public.plan_price_history
  for select to authenticated using (public.is_ops_or_owner_aal2());

-- "Changing prices or plans" needs a fresh MFA step-up (CLAUDE.md §5.5).
create trigger plans_guard before insert or update on public.plans
  for each row execute function public.guard_price_columns(
    'price_cents', 'price_per_extra_meal_cents', 'meals_per_interval', 'billing_interval', 'allowance_unit',
    'snacks_per_interval', 'is_active', 'archived_at');
create trigger plans_price_history after insert or update on public.plans
  for each row execute function public.record_plan_price();
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
create trigger plans_audit after insert or update or delete on public.plans
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Subscriptions (mirrored from Stripe by the webhook)
-- ─────────────────────────────────────────────────────────────────────────────
create type public.subscription_status as enum (
  'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete restrict,
  organization_id uuid references public.organizations (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  stripe_subscription_id text unique,
  status public.subscription_status not null default 'incomplete',
  quantity integer not null default 1 check (quantity between 1 and 50),
  current_period_start timestamptz,
  current_period_end timestamptz,
  paused_until timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_one_owner check ((household_id is null) <> (organization_id is null))
);
create index subscriptions_household_idx on public.subscriptions (household_id);
create index subscriptions_org_idx on public.subscriptions (organization_id);

create table public.subscription_allowances (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  menu_week_id uuid not null references public.menu_weeks (id) on delete restrict,
  meals_allowed integer not null default 0 check (meals_allowed >= 0),
  meals_used integer not null default 0 check (meals_used >= 0),
  snacks_allowed integer not null default 0 check (snacks_allowed >= 0),
  snacks_used integer not null default 0 check (snacks_used >= 0),
  rolled_over_in integer not null default 0 check (rolled_over_in >= 0),
  skipped boolean not null default false,
  unique (subscription_id, menu_week_id),
  constraint allowances_not_overused check (meals_used <= meals_allowed + rolled_over_in and snacks_used <= snacks_allowed)
);

create function public.can_view_account(p_household uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_household is not null and public.is_household_member(p_household))
      or (p_org is not null and p_org in (select public.my_organization_ids()))
      or public.is_ops_or_owner_aal2();
$$;

alter table public.subscriptions enable row level security;
alter table public.subscription_allowances enable row level security;
revoke all on public.subscriptions, public.subscription_allowances from anon;

create policy "Account members read subscriptions" on public.subscriptions
  for select to authenticated using (public.can_view_account(household_id, organization_id));
create policy "Account members read allowances" on public.subscription_allowances
  for select to authenticated using (
    exists (select 1 from public.subscriptions s where s.id = subscription_id
      and public.can_view_account(s.household_id, s.organization_id)));
-- Writes: Stripe webhook / server jobs only (service role).
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders
-- ─────────────────────────────────────────────────────────────────────────────
create type public.order_source as enum ('a_la_carte', 'subscription', 'standing_order', 'admin');
create type public.order_status as enum (
  'draft', 'pending_payment', 'paid', 'invoiced', 'fulfilled', 'cancelled', 'refunded', 'partially_refunded'
);
create type public.fulfillment_method as enum ('delivery', 'school_dropoff');

create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Human-friendly, e.g. SC-2026-001001.
  order_number text not null unique
    default 'SC-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
  household_id uuid references public.households (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete restrict,
  menu_week_id uuid not null references public.menu_weeks (id) on delete restrict,
  source public.order_source not null default 'a_la_carte',
  status public.order_status not null default 'draft',
  fulfillment public.fulfillment_method not null default 'delivery',
  address_snapshot jsonb,
  delivery_zone_id uuid references public.delivery_zones (id) on delete set null,
  delivery_date date,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  stripe_payment_intent_id text unique,
  stripe_invoice_id text,
  allergy_confirmed_at timestamptz,
  allergy_confirmed_by uuid references auth.users (id) on delete set null,
  placed_at timestamptz,
  placed_by uuid references auth.users (id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An order belongs to a household or a school; an anonymized order (account
  -- deleted) keeps neither but stays for accounting.
  constraint orders_single_owner check (not (household_id is not null and organization_id is not null)),
  constraint orders_total_matches check (total_cents = subtotal_cents + delivery_fee_cents + tax_cents - discount_cents)
);
create index orders_household_idx on public.orders (household_id, created_at desc);
create index orders_org_idx on public.orders (organization_id, created_at desc);
create index orders_week_idx on public.orders (menu_week_id, status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  child_id uuid references public.children (id) on delete set null, -- null for school bulk lines
  classroom_id uuid references public.classrooms (id) on delete set null,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  delivery_date date,
  quantity integer not null default 1 check (quantity between 1 and 1000),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  -- Snapshot at purchase (CLAUDE.md §4): later menu edits never rewrite history.
  item_name text not null,
  allergens_contained text[] not null default '{}',
  may_contain text[] not null default '{}',
  badges text[] not null default '{}',
  covered_by_subscription boolean not null default false,
  allergy_override_id uuid,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_child_idx on public.order_items (child_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders, public.order_items from anon;
-- Users can't insert/delete orders or touch money columns; ops/owner may
-- change status, notes and delivery date (RLS limits who).
revoke insert, update, delete on public.orders, public.order_items from authenticated;
grant update (status, notes, delivery_date) on public.orders to authenticated;

create policy "Account members read orders" on public.orders
  for select to authenticated using (public.can_view_account(household_id, organization_id));
create policy "Ops and owner update orders (AAL2)" on public.orders
  for update to authenticated using (public.is_ops_or_owner_aal2()) with check (public.is_ops_or_owner_aal2());
create policy "Account members read order items" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and public.can_view_account(o.household_id, o.organization_id)));

create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
create trigger orders_audit after update or delete on public.orders
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Favorites, saved orders (one-tap reorder)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid references public.children (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique nulls not distinct (household_id, child_id, menu_item_id)
);

create table public.saved_orders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- [{ child_id, menu_item_id, quantity, weekday }] — prices are NOT stored;
  -- they are recomputed when the saved order is placed.
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.favorites enable row level security;
alter table public.saved_orders enable row level security;
revoke all on public.favorites, public.saved_orders from anon;
create policy "Members manage favorites" on public.favorites
  for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Members manage saved orders" on public.saved_orders
  for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create trigger saved_orders_touch before update on public.saved_orders for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Allergy overrides (CLAUDE.md §6): only the owner, with a fresh MFA check,
-- can approve a specific child + item exception. Always audited.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.allergy_overrides (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  approved_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (child_id, menu_item_id)
);
alter table public.order_items
  add constraint order_items_override_fk foreign key (allergy_override_id) references public.allergy_overrides (id) on delete set null;

alter table public.allergy_overrides enable row level security;
revoke all on public.allergy_overrides from anon;
create policy "Child viewers read overrides" on public.allergy_overrides
  for select to authenticated using (public.can_view_child(child_id));
create policy "Owner approves overrides (AAL2 + step-up)" on public.allergy_overrides
  for insert to authenticated with check (public.is_owner_aal2() and public.has_recent_mfa(300) and approved_by = (select auth.uid()));
create policy "Owner revokes overrides (AAL2 + step-up)" on public.allergy_overrides
  for update to authenticated using (public.is_owner_aal2() and public.has_recent_mfa(300))
  with check (public.is_owner_aal2() and public.has_recent_mfa(300));
create trigger allergy_overrides_audit after insert or update or delete on public.allergy_overrides
  for each row execute function public.audit_row_change();

revoke execute on function public.record_plan_price() from public, anon, authenticated;
grant execute on function public.can_view_account(uuid, uuid) to authenticated;
