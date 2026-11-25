-- Phase 6: payments. Stripe is the source of truth for money; these tables
-- mirror what its webhooks report. App users never write payment state: the
-- webhook (service role) calls the stripe_* functions below, each one atomic.
-- CLAUDE.md §5.8: amounts are computed server-side only, events idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders: what has been collected, credit applied, expiry for unpaid orders
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.orders
  add column credit_cents integer not null default 0 check (credit_cents >= 0),
  add column amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  add column amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  -- Bumped each time a changed order is re-priced; part of the PaymentIntent idempotency key.
  add column payment_version integer not null default 1 check (payment_version >= 1),
  add column expires_at timestamptz,
  add column payment_failed_at timestamptz,
  add column last_payment_error text check (char_length(last_payment_error) <= 300);
alter table public.orders drop constraint orders_total_matches;
alter table public.orders
  add constraint orders_total_matches check (total_cents = subtotal_cents + delivery_fee_cents + tax_cents - discount_cents - credit_cents);
create index orders_expiring_idx on public.orders (expires_at) where status = 'pending_payment' and expires_at is not null;

-- Every PaymentIntent for an order: the first charge, and any top-up after a change.
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  stripe_payment_intent_id text not null unique,
  kind text not null check (kind in ('charge', 'adjustment')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  status text not null default 'requires_payment'
    check (status in ('requires_payment', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled')),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_payments_order_idx on public.order_payments (order_id);
alter table public.order_payments enable row level security;
revoke all on public.order_payments from anon;
revoke insert, update, delete on public.order_payments from authenticated;
create policy "Account members read order payments" on public.order_payments
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and public.can_view_account(o.household_id, o.organization_id)));
create trigger order_payments_touch before update on public.order_payments for each row execute function public.touch_updated_at();

-- Refunds: requested by ops/owner (RLS proves the role, step-up and limit),
-- then sent to Stripe; the webhook confirms them.
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  reason text not null check (char_length(reason) between 3 and 300),
  order_item_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'canceled')),
  stripe_refund_id text unique,
  error text check (char_length(error) <= 300),
  requested_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_refunds_order_idx on public.order_refunds (order_id);
alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from anon;
revoke update, delete on public.order_refunds from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Settings: ops refund limit (owner-only, step-up), Customer Portal config id
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.site_settings
  add column ops_refund_limit_cents integer not null default 5000 check (ops_refund_limit_cents between 0 and 1000000),
  add column stripe_portal_configuration_id text;
drop trigger site_settings_tax_guard on public.site_settings;
create trigger site_settings_tax_guard before update on public.site_settings
  for each row execute function public.guard_price_columns('tax_settings', 'ops_refund_limit_cents');

-- Can the caller refund this much? Owner: up to what's been collected.
-- Ops: also capped per refund by the owner's limit. Both need a fresh MFA.
create function public.can_refund(p_order uuid, p_amount integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_recent_mfa(300)
     and exists (
       select 1 from public.orders o
       where o.id = p_order
         and p_amount <= o.amount_paid_cents - o.amount_refunded_cents
           - coalesce((select sum(r.amount_cents) from public.order_refunds r where r.order_id = o.id and r.status = 'pending'), 0)
     )
     and (public.is_owner_aal2()
          or (public.is_ops_or_owner_aal2() and p_amount <= (select s.ops_refund_limit_cents from public.site_settings s where s.id)));
$$;

create policy "Account members read refunds" on public.order_refunds
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and public.can_view_account(o.household_id, o.organization_id)));
create policy "Ops and owner request refunds within their limit (AAL2 + step-up)" on public.order_refunds
  for insert to authenticated
  with check (public.is_ops_or_owner_aal2() and requested_by = (select auth.uid()) and public.can_refund(order_id, amount_cents));
create trigger order_refunds_touch before update on public.order_refunds for each row execute function public.touch_updated_at();
create trigger order_refunds_audit after insert or update on public.order_refunds
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Subscriptions and allowances
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.subscriptions
  add column stripe_event_at timestamptz,          -- newest Stripe event applied (drops stale, out-of-order ones)
  add column payment_failed_at timestamptz;
alter table public.subscription_allowances
  add column skip_credit_txn_id text,
  add column skip_credit_cents integer not null default 0 check (skip_credit_cents >= 0);

-- Webhook claim bookkeeping (a failed event can be retried; one worker at a time).
alter table public.stripe_events
  add column locked_at timestamptz,
  add column attempts integer not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Order pricing (Phase 5's _write_family_order) with three changes: a plan
-- covers `quantity` children, account credit pays first, and "paid" means the
-- net amount collected covers the (possibly changed) total.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._write_family_order(
  p_household uuid,
  p_menu_week uuid,
  p_items jsonb,
  p_fulfillment public.fulfillment_method,
  p_address uuid,
  p_discount_code text,
  p_allergies_confirmed boolean,
  p_notes text,
  p_replace_order uuid,
  p_system boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s public.site_settings;
  w public.menu_weeks;
  v_sub public.subscriptions;
  v_plan public.plans;
  v_existing public.orders;
  v_item jsonb;
  v_child public.children;
  v_menu public.menu_items;
  v_week_item public.menu_week_items;
  v_zone public.delivery_zones;
  v_addr public.addresses;
  v_disc public.discount_codes;
  v_order uuid;
  v_qty integer;
  v_date date;
  v_price integer;
  v_blocking text;
  v_override uuid;
  v_reserved integer;
  v_meal_share integer := 0;
  v_snack_share integer := 0;
  v_children integer := 0;
  v_pool_meals integer := 0;      -- household-wide cap (share × subscription quantity)
  v_pool_snacks integer := 0;
  v_credit integer := 0;
  v_balance integer := 0;
  v_total integer := 0;
  v_net_paid integer := 0;
  v_skipped boolean := false;
  v_unit_key text;
  v_used jsonb := '{}'::jsonb;    -- allowance used so far, keyed by child id (or 'household')
  v_snack_used jsonb := '{}'::jsonb;
  v_left integer;
  v_covered integer;
  v_gross integer := 0;           -- every line at its menu price (fee / minimum thresholds)
  v_subtotal integer := 0;        -- what the family pays for meals
  v_any_covered boolean := false;
  v_fee integer := 0;
  v_discount integer := 0;
  v_tax integer := 0;
  v_rate integer;
  v_line_count integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Add at least one meal' using errcode = 'check_violation';
  end if;
  if not p_system and not coalesce(p_allergies_confirmed, false) then
    raise exception 'Please confirm each child''s allergies before placing the order' using errcode = 'check_violation';
  end if;

  select * into s from public.site_settings where id;
  if not p_system and not s.ordering_enabled then
    raise exception 'Ordering is paused right now' using errcode = 'check_violation';
  end if;

  -- Lock the week, then its menu rows, so two parents can't both take the
  -- last portion. Order of locks is always week → items.
  select * into w from public.menu_weeks where id = p_menu_week for update;
  if w.id is null or w.status <> 'published' then
    raise exception 'This week''s menu isn''t open for orders' using errcode = 'check_violation';
  end if;
  if not p_system and ((w.ordering_opens_at is not null and now() < w.ordering_opens_at)
     or now() >= public.menu_week_cutoff(w.id)) then
    raise exception 'Ordering for this week is closed' using errcode = 'check_violation';
  end if;
  perform 1 from public.menu_week_items where menu_week_id = w.id for update;

  -- Modify: same household, same week, still open.
  if p_replace_order is not null then
    select * into v_existing from public.orders where id = p_replace_order for update;
    if v_existing.id is null or v_existing.household_id is distinct from p_household or v_existing.menu_week_id <> w.id
       or v_existing.status not in ('pending_payment', 'paid') then
      raise exception 'This order can''t be changed any more' using errcode = 'check_violation';
    end if;
    delete from public.order_items where order_id = v_existing.id;
  end if;

  -- Fulfillment: delivery needs a household address inside an active zone.
  if p_fulfillment = 'delivery' then
    select * into v_addr from public.addresses where id = p_address and household_id = p_household;
    if v_addr.id is null then
      raise exception 'Choose a delivery address' using errcode = 'check_violation';
    end if;
    select * into v_zone from public.delivery_zones z
      where z.is_active and z.archived_at is null and v_addr.zip = any (z.zip_codes)
      order by z.sort_order limit 1;
    if v_zone.id is null then
      raise exception 'We don''t deliver to % yet', v_addr.zip using errcode = 'check_violation';
    end if;
  end if;

  -- Subscription allowance for this week (skipped weeks have none).
  v_sub := public._live_subscription(p_household);
  if v_sub.id is not null then
    select * into v_plan from public.plans where id = v_sub.plan_id;
    select count(*) into v_children from public.children where household_id = p_household and archived_at is null;
    v_meal_share := public.plan_weekly_share(v_plan.meals_per_interval, v_plan.billing_interval);
    v_snack_share := case when v_plan.includes_snacks then public.plan_weekly_share(v_plan.snacks_per_interval, v_plan.billing_interval) else 0 end;
    insert into public.subscription_allowances (subscription_id, menu_week_id, meals_allowed, snacks_allowed)
      values (v_sub.id, w.id,
              v_meal_share * case when v_plan.allowance_unit = 'per_child' then greatest(v_sub.quantity, 1) else 1 end,
              v_snack_share * case when v_plan.allowance_unit = 'per_child' then greatest(v_sub.quantity, 1) else 1 end)
      on conflict (subscription_id, menu_week_id) do update
        set meals_allowed = excluded.meals_allowed, snacks_allowed = excluded.snacks_allowed
      returning skipped into v_skipped;
    perform 1 from public.subscription_allowances where subscription_id = v_sub.id and menu_week_id = w.id for update;
    if v_skipped then
      v_meal_share := 0;
      v_snack_share := 0;
    end if;
    -- The plan pays for `quantity` children: per-child shares, capped in total.
    v_pool_meals := v_meal_share * case when v_plan.allowance_unit = 'per_child' then greatest(v_sub.quantity, 1) else 1 end;
    v_pool_snacks := v_snack_share * case when v_plan.allowance_unit = 'per_child' then greatest(v_sub.quantity, 1) else 1 end;

    -- Allowance already used this week by the household's OTHER live orders.
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_used from (
      select case when v_plan.allowance_unit = 'per_child' then coalesce(oi.child_id::text, 'household') else 'household' end as k,
             sum(oi.quantity) as n
      from public.order_items oi join public.orders o on o.id = oi.order_id
      left join public.menu_items m on m.id = oi.menu_item_id
      where o.household_id = p_household and o.menu_week_id = w.id and oi.covered_by_subscription
        and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled') and not coalesce(m.is_snack, false)
      group by 1) t;
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_snack_used from (
      select case when v_plan.allowance_unit = 'per_child' then coalesce(oi.child_id::text, 'household') else 'household' end as k,
             sum(oi.quantity) as n
      from public.order_items oi join public.orders o on o.id = oi.order_id
      left join public.menu_items m on m.id = oi.menu_item_id
      where o.household_id = p_household and o.menu_week_id = w.id and oi.covered_by_subscription
        and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled') and coalesce(m.is_snack, false)
      group by 1) t;
    v_pool_meals := greatest(v_pool_meals - coalesce((select sum(value::integer) from jsonb_each_text(v_used)), 0), 0);
    v_pool_snacks := greatest(v_pool_snacks - coalesce((select sum(value::integer) from jsonb_each_text(v_snack_used)), 0), 0);
  end if;

  if v_existing.id is not null then
    v_order := v_existing.id;
    update public.orders
      set fulfillment = p_fulfillment,
          address_snapshot = case when v_addr.id is not null then jsonb_build_object(
            'line1', v_addr.line1, 'line2', v_addr.line2, 'city', v_addr.city, 'state', v_addr.state,
            'zip', v_addr.zip, 'delivery_notes', v_addr.delivery_notes) end,
          delivery_zone_id = v_zone.id, notes = left(p_notes, 1000)
      where id = v_order;
  else
    insert into public.orders (household_id, menu_week_id, source, status, fulfillment, address_snapshot, delivery_zone_id,
                               placed_at, placed_by, notes)
    values (
      p_household, w.id, 'a_la_carte', 'pending_payment', p_fulfillment,
      case when v_addr.id is not null then jsonb_build_object(
        'line1', v_addr.line1, 'line2', v_addr.line2, 'city', v_addr.city, 'state', v_addr.state,
        'zip', v_addr.zip, 'delivery_notes', v_addr.delivery_notes) end,
      v_zone.id, now(), v_user, left(p_notes, 1000)
    )
    returning id into v_order;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty < 1 or v_qty > 20 then
      raise exception 'Quantity must be between 1 and 20' using errcode = 'check_violation';
    end if;

    select * into v_child from public.children
      where id = (v_item ->> 'child_id')::uuid and household_id = p_household and archived_at is null;
    if v_child.id is null then
      raise exception 'Unknown child' using errcode = 'check_violation';
    end if;
    if p_fulfillment = 'school_dropoff' and v_child.school_id is null then
      raise exception 'School drop-off needs a school on %''s profile', v_child.first_name using errcode = 'check_violation';
    end if;

    select * into v_week_item from public.menu_week_items
      where menu_week_id = w.id and menu_item_id = (v_item ->> 'menu_item_id')::uuid and available_for in ('families', 'both');
    select * into v_menu from public.menu_items where id = v_week_item.menu_item_id and is_active and archived_at is null;
    if v_week_item.id is null or v_menu.id is null then
      raise exception 'That meal isn''t on this week''s menu' using errcode = 'check_violation';
    end if;

    v_date := nullif(v_item ->> 'delivery_date', '')::date;
    if v_date is null or not (v_date = any (w.delivery_dates)) then
      raise exception 'Pick a delivery day from this week''s menu' using errcode = 'check_violation';
    end if;
    if p_fulfillment = 'delivery' and not (extract(isodow from v_date)::smallint = any (v_zone.delivery_weekdays)) then
      raise exception 'We don''t deliver to your area on that day' using errcode = 'check_violation';
    end if;

    -- Allergy block (CLAUDE.md §6), re-checked at placement every time.
    v_blocking := public._blocking_allergens(v_child.id, v_menu.id);
    if v_blocking is not null then
      raise exception 'ALLERGY_BLOCK: % can''t have %: it contains %', v_child.first_name, v_menu.name, v_blocking
        using errcode = 'P0001', hint = 'allergy_block';
    end if;
    select o.id into v_override from public.allergy_overrides o
      where o.child_id = v_child.id and o.menu_item_id = v_menu.id and o.revoked_at is null;

    -- Capacity across every live order for this week (rows are locked above).
    if v_week_item.capacity is not null then
      select coalesce(sum(oi.quantity), 0) into v_reserved
        from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.menu_week_id = w.id and oi.menu_item_id = v_menu.id
          and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled');
      if v_reserved + v_qty > v_week_item.capacity then
        raise exception '% is sold out this week', v_menu.name using errcode = 'check_violation';
      end if;
    end if;

    v_price := coalesce(v_week_item.price_override_cents, v_menu.base_price_cents);
    v_gross := v_gross + v_price * v_qty;

    -- Allowance: how many of these units does the plan cover?
    v_covered := 0;
    if v_sub.id is not null then
      v_unit_key := case when v_plan.allowance_unit = 'per_child' then v_child.id::text else 'household' end;
      if v_menu.is_snack then
        v_left := least(greatest(v_snack_share - coalesce((v_snack_used ->> v_unit_key)::integer, 0), 0), v_pool_snacks);
        v_covered := least(v_left, v_qty);
        v_pool_snacks := v_pool_snacks - v_covered;
        v_snack_used := v_snack_used || jsonb_build_object(v_unit_key, coalesce((v_snack_used ->> v_unit_key)::integer, 0) + v_covered);
      else
        v_left := least(greatest(v_meal_share - coalesce((v_used ->> v_unit_key)::integer, 0), 0), v_pool_meals);
        v_covered := least(v_left, v_qty);
        v_pool_meals := v_pool_meals - v_covered;
        v_used := v_used || jsonb_build_object(v_unit_key, coalesce((v_used ->> v_unit_key)::integer, 0) + v_covered);
      end if;
    end if;

    -- Covered units and paid extras are separate lines (the kitchen sees one
    -- meal either way; billing sees what's included and what's an add-on).
    if v_covered > 0 then
      v_any_covered := true;
      insert into public.order_items (order_id, child_id, classroom_id, menu_item_id, delivery_date, quantity, unit_price_cents,
                                      currency, item_name, allergens_contained, may_contain, badges, covered_by_subscription,
                                      allergy_override_id)
      select v_order, v_child.id, v_child.classroom_id, v_menu.id, v_date, v_covered, 0, v_menu.currency, v_menu.name,
             snap.contains, snap.may, snap.badges, true, v_override
      from (select
        coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
          join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = v_menu.id and mia.presence = 'contains'), '{}') as contains,
        coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
          join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = v_menu.id and mia.presence = 'may_contain'), '{}') as may,
        coalesce((select array_agg(b.name order by b.sort_order) from public.menu_item_badges mib
          join public.dietary_badges b on b.id = mib.badge_id where mib.menu_item_id = v_menu.id), '{}') as badges) snap;
      v_line_count := v_line_count + 1;
    end if;
    if v_qty - v_covered > 0 then
      v_subtotal := v_subtotal + v_price * (v_qty - v_covered);
      insert into public.order_items (order_id, child_id, classroom_id, menu_item_id, delivery_date, quantity, unit_price_cents,
                                      currency, item_name, allergens_contained, may_contain, badges, covered_by_subscription,
                                      allergy_override_id)
      select v_order, v_child.id, v_child.classroom_id, v_menu.id, v_date, v_qty - v_covered, v_price, v_menu.currency, v_menu.name,
             snap.contains, snap.may, snap.badges, false, v_override
      from (select
        coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
          join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = v_menu.id and mia.presence = 'contains'), '{}') as contains,
        coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
          join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = v_menu.id and mia.presence = 'may_contain'), '{}') as may,
        coalesce((select array_agg(b.name order by b.sort_order) from public.menu_item_badges mib
          join public.dietary_badges b on b.id = mib.badge_id where mib.menu_item_id = v_menu.id), '{}') as badges) snap;
      v_line_count := v_line_count + 1;
    end if;
  end loop;

  -- Delivery fee and minimum use the full menu value, so a subscriber whose
  -- meals are included still qualifies for free delivery.
  if p_fulfillment = 'delivery' then
    if not v_any_covered and v_gross < v_zone.min_order_cents then
      raise exception 'The minimum order for delivery to your area is $%', to_char(v_zone.min_order_cents / 100.0, 'FM999990.00')
        using errcode = 'check_violation';
    end if;
    v_fee := case when v_zone.free_over_cents is not null and v_gross >= v_zone.free_over_cents then 0 else v_zone.fee_cents end;
  end if;

  -- Discount code: on the meals the family pays for (never the fee).
  if nullif(btrim(p_discount_code), '') is not null then
    select * into v_disc from public.discount_codes
      where code = upper(btrim(p_discount_code)) and is_active
        and (expires_at is null or expires_at > now())
        and (max_redemptions is null or times_redeemed < max_redemptions)
      for update;
    if v_disc.id is null or coalesce(v_disc.applies_to ->> 'scope', 'all') <> 'all' then
      raise exception 'That discount code isn''t valid' using errcode = 'check_violation';
    end if;
    v_discount := case when v_disc.type = 'percent' then (v_subtotal * v_disc.value) / 100 else least(v_disc.value, v_subtotal) end;
    if v_existing.id is null or v_existing.discount_cents = 0 then
      update public.discount_codes set times_redeemed = times_redeemed + 1 where id = v_disc.id;
    end if;
  end if;

  -- Tax: a flat rate from settings when enabled. With Stripe Tax on, the app
  -- asks Stripe after placement and records it (stripe_set_order_tax).
  if coalesce((s.tax_settings ->> 'enabled')::boolean, false) and not coalesce((s.tax_settings ->> 'use_stripe_tax')::boolean, false) then
    v_rate := coalesce((s.tax_settings ->> 'rate_bps')::integer, 0);
    v_tax := round((v_subtotal - v_discount) * v_rate / 10000.0)::integer;
  end if;

  v_total := v_subtotal + v_fee + v_tax - v_discount;

  -- Account credit (owner-issued, refunds-as-credit) pays first. Re-pricing a
  -- changed order puts back what it used before, then takes what it needs now.
  if v_existing.id is not null and v_existing.credit_cents > 0 then
    insert into public.account_credits (household_id, amount_cents, reason, order_id, created_by)
      values (p_household, v_existing.credit_cents, 'Returned from changed order ' || v_existing.order_number, v_order,
              coalesce(v_user, v_existing.placed_by));
  end if;
  select coalesce(sum(amount_cents), 0) into v_balance from public.account_credits where household_id = p_household;
  v_credit := least(greatest(v_balance, 0), v_total);
  if v_credit > 0 then
    insert into public.account_credits (household_id, amount_cents, reason, order_id, created_by)
      values (p_household, -v_credit, 'Applied to order', v_order,
              coalesce(v_user, (select primary_user_id from public.households where id = p_household)));
  end if;

  v_net_paid := coalesce(v_existing.amount_paid_cents, 0) - coalesce(v_existing.amount_refunded_cents, 0);

  update public.orders
    set subtotal_cents = v_subtotal, delivery_fee_cents = v_fee, discount_cents = v_discount, tax_cents = v_tax,
        credit_cents = v_credit,
        total_cents = v_total - v_credit,
        source = case when v_any_covered then 'subscription'::public.order_source else 'a_la_carte'::public.order_source end,
        allergy_confirmed_at = case when p_system then allergy_confirmed_at else now() end,
        allergy_confirmed_by = case when p_system then allergy_confirmed_by else v_user end,
        -- Paid means: what's been collected (net of refunds) covers the new total.
        -- The app charges or refunds any difference through Stripe (Phase 6).
        status = case when v_net_paid >= v_total - v_credit then 'paid'::public.order_status
                      else 'pending_payment'::public.order_status end,
        payment_version = case when v_existing.id is not null then payment_version + 1 else payment_version end,
        -- Unpaid new orders hold capacity for 30 minutes (expire_pending_orders).
        expires_at = case when v_net_paid = 0 and v_total - v_credit > 0 and not p_system then now() + interval '30 minutes' end
    where id = v_order;

  if v_sub.id is not null then
    perform public._recount_allowance(v_sub.id, w.id);
  end if;
  return v_order;
end;
$$;

-- Cancel before cutoff: also gives back any account credit the order used.
create or replace function public.cancel_family_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_sub public.subscriptions;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.household_id is null or not public.is_household_member(o.household_id) then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if o.status not in ('pending_payment', 'paid') or now() >= public.menu_week_cutoff(o.menu_week_id) then
    raise exception 'This order can''t be cancelled any more' using errcode = 'check_violation';
  end if;
  update public.orders set status = 'cancelled', expires_at = null where id = o.id;
  if o.credit_cents > 0 then
    insert into public.account_credits (household_id, amount_cents, reason, order_id, created_by)
      values (o.household_id, o.credit_cents, 'Returned from cancelled order ' || o.order_number, o.id, (select auth.uid()));
  end if;
  v_sub := public._live_subscription(o.household_id);
  if v_sub.id is not null then
    perform public._recount_allowance(v_sub.id, o.menu_week_id);
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stripe bookkeeping (service role only). Each function is one transaction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Record an event and claim it for processing. False = already processed
-- (or another worker holds it): answer 200 and skip.
create function public.stripe_claim_event(p_event_id text, p_type text, p_livemode boolean, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed text;
begin
  insert into public.stripe_events (event_id, type, livemode, payload)
    values (p_event_id, p_type, p_livemode, p_payload)
    on conflict (event_id) do nothing;
  update public.stripe_events
    set locked_at = now(), attempts = attempts + 1
    where event_id = p_event_id and processed_at is null
      and (locked_at is null or locked_at < now() - interval '2 minutes')
    returning event_id into v_claimed;
  return v_claimed is not null;
end;
$$;

create function public.stripe_finish_event(p_event_id text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_events
    set processed_at = case when p_error is null then now() end,
        error = left(p_error, 500),
        locked_at = null
    where event_id = p_event_id;
$$;

-- The app created a PaymentIntent for an order (amount read from the order).
create function public.stripe_record_payment_intent(p_order uuid, p_payment_intent text, p_kind text, p_amount integer, p_currency text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_payments (order_id, stripe_payment_intent_id, kind, amount_cents, currency)
    values (p_order, p_payment_intent, p_kind, p_amount, p_currency)
    on conflict (stripe_payment_intent_id) do update set amount_cents = excluded.amount_cents;
  if p_kind = 'charge' then
    update public.orders set stripe_payment_intent_id = p_payment_intent where id = p_order;
  end if;
end;
$$;

-- payment_intent.succeeded. Returns what the app should do next:
-- 'paid', 'partial' (still owed), 'refund_expired' (order was cancelled
-- while the customer paid: refund it), or 'ignored' (unknown intent).
create function public.stripe_payment_succeeded(p_payment_intent text, p_amount_received integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.order_payments;
  o public.orders;
begin
  select * into p from public.order_payments where stripe_payment_intent_id = p_payment_intent for update;
  if p.id is null then
    return 'ignored';
  end if;
  select * into o from public.orders where id = p.order_id for update;
  if p.status <> 'succeeded' then
    update public.order_payments set status = 'succeeded', last_error = null where id = p.id;
    update public.orders
      set amount_paid_cents = amount_paid_cents + p_amount_received, payment_failed_at = null, last_payment_error = null
      where id = o.id
      returning * into o;
  end if;
  if o.status in ('cancelled', 'refunded') then
    return 'refund_expired';
  end if;
  if o.amount_paid_cents - o.amount_refunded_cents >= o.total_cents then
    update public.orders set status = 'paid', expires_at = null where id = o.id and status = 'pending_payment';
    return 'paid';
  end if;
  return 'partial';
end;
$$;

create function public.stripe_payment_failed(p_payment_intent text, p_error text, p_requires_action boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.order_payments;
begin
  select * into p from public.order_payments where stripe_payment_intent_id = p_payment_intent for update;
  if p.id is null or p.status = 'succeeded' then
    return;
  end if;
  update public.order_payments
    set status = case when p_requires_action then 'requires_action' else 'failed' end, last_error = left(p_error, 300)
    where id = p.id;
  update public.orders set payment_failed_at = now(), last_payment_error = left(p_error, 300) where id = p.order_id;
end;
$$;

create function public.stripe_payment_canceled(p_payment_intent text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.order_payments set status = 'canceled' where stripe_payment_intent_id = p_payment_intent and status <> 'succeeded';
$$;

-- charge.refunded / refund.updated: total refunded so far on one intent.
create function public.stripe_payment_refunded(p_payment_intent text, p_refunded_total integer, p_refund_id text default null,
                                               p_refund_status text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.order_payments;
  o public.orders;
begin
  if p_refund_id is not null then
    update public.order_refunds set status = coalesce(p_refund_status, status) where stripe_refund_id = p_refund_id;
  end if;
  select * into p from public.order_payments where stripe_payment_intent_id = p_payment_intent for update;
  if p.id is null then
    return;
  end if;
  update public.order_payments set refunded_cents = greatest(refunded_cents, p_refunded_total) where id = p.id;
  update public.orders
    set amount_refunded_cents = (select coalesce(sum(refunded_cents), 0) from public.order_payments where order_id = p.order_id)
    where id = p.order_id
    returning * into o;
  if o.amount_refunded_cents > 0 and o.amount_refunded_cents >= o.amount_paid_cents then
    update public.orders set status = 'refunded' where id = o.id and status in ('paid', 'fulfilled', 'cancelled', 'partially_refunded');
  elsif o.amount_refunded_cents > 0 and o.status in ('fulfilled') then
    update public.orders set status = 'partially_refunded' where id = o.id;
  end if;
end;
$$;

-- The app recorded a refund it sent to Stripe (or that failed).
create function public.stripe_record_refund(p_refund uuid, p_stripe_refund text, p_status text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.order_refunds
    set stripe_refund_id = coalesce(p_stripe_refund, stripe_refund_id), status = p_status, error = left(p_error, 300)
    where id = p_refund;
$$;

-- Stripe Tax result for an order (when the owner turns Stripe Tax on).
create function public.stripe_set_order_tax(p_order uuid, p_tax integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders
    set tax_cents = p_tax, total_cents = subtotal_cents + delivery_fee_cents + p_tax - discount_cents - credit_cents
    where id = p_order and status = 'pending_payment' and amount_paid_cents = 0;
$$;

-- customer.subscription.* → our row. Stale events (older than the newest
-- applied) are ignored, so out-of-order delivery can't roll state back.
create function public.stripe_sync_subscription(
  p_subscription uuid,
  p_stripe_subscription text,
  p_status public.subscription_status,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_paused_until timestamptz,
  p_quantity integer,
  p_stripe_price text,
  p_event_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_plan uuid;
begin
  select id into v_id from public.subscriptions
    where id = p_subscription or (p_stripe_subscription is not null and stripe_subscription_id = p_stripe_subscription)
    order by (id = p_subscription) desc limit 1
    for update;
  if v_id is null then
    return null;
  end if;
  select pl.id into v_plan from public.plans pl
    where pl.stripe_price_id = p_stripe_price
       or exists (select 1 from public.plan_price_history h where h.plan_id = pl.id and h.stripe_price_id = p_stripe_price)
    limit 1;
  update public.subscriptions
    set stripe_subscription_id = coalesce(p_stripe_subscription, stripe_subscription_id),
        status = p_status,
        current_period_start = coalesce(p_period_start, current_period_start),
        current_period_end = coalesce(p_period_end, current_period_end),
        cancel_at_period_end = p_cancel_at_period_end,
        paused_until = p_paused_until,
        quantity = greatest(coalesce(p_quantity, quantity), 1),
        plan_id = coalesce(v_plan, plan_id),
        pending_plan_id = case when v_plan is not null and v_plan = pending_plan_id then null else pending_plan_id end,
        stripe_event_at = p_event_at
    where id = v_id and (stripe_event_at is null or stripe_event_at <= p_event_at);
  return v_id;
end;
$$;

-- invoice.paid → the subscription is in good standing, and every menu week
-- that starts inside the paid period gets its allowance row.
create function public.stripe_invoice_paid(p_subscription uuid, p_stripe_subscription text, p_period_start timestamptz,
                                           p_period_end timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  pl public.plans;
  v_tz text := (select timezone from public.site_settings where id);
  v_mult integer;
  v_rows integer := 0;
begin
  select * into s from public.subscriptions
    where id = p_subscription or (p_stripe_subscription is not null and stripe_subscription_id = p_stripe_subscription)
    order by (id = p_subscription) desc limit 1
    for update;
  if s.id is null then
    return 0;
  end if;
  update public.subscriptions
    set status = case when status in ('incomplete', 'past_due', 'unpaid') then 'active'::public.subscription_status else status end,
        stripe_subscription_id = coalesce(stripe_subscription_id, p_stripe_subscription),
        current_period_start = coalesce(p_period_start, current_period_start),
        current_period_end = coalesce(p_period_end, current_period_end),
        payment_failed_at = null
    where id = s.id
    returning * into s;
  select * into pl from public.plans where id = s.plan_id;
  v_mult := case when pl.allowance_unit = 'per_child' then greatest(s.quantity, 1) else 1 end;
  insert into public.subscription_allowances (subscription_id, menu_week_id, meals_allowed, snacks_allowed)
  select s.id, w.id,
         public.plan_weekly_share(pl.meals_per_interval, pl.billing_interval) * v_mult,
         case when pl.includes_snacks then public.plan_weekly_share(pl.snacks_per_interval, pl.billing_interval) * v_mult else 0 end
  from public.menu_weeks w
  where w.week_start >= (p_period_start at time zone v_tz)::date
    and w.week_start < (p_period_end at time zone v_tz)::date
  on conflict (subscription_id, menu_week_id) do update
    set meals_allowed = excluded.meals_allowed, snacks_allowed = excluded.snacks_allowed;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- invoice.payment_failed → flag it and queue the "update your card" email.
create function public.stripe_invoice_failed(p_subscription uuid, p_stripe_subscription text, p_attempt integer, p_next_attempt timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  v_email text;
begin
  select * into s from public.subscriptions
    where id = p_subscription or (p_stripe_subscription is not null and stripe_subscription_id = p_stripe_subscription)
    order by (id = p_subscription) desc limit 1;
  if s.id is null or s.household_id is null then
    return;
  end if;
  update public.subscriptions set payment_failed_at = now() where id = s.id;
  select u.email into v_email from public.households h join auth.users u on u.id = h.primary_user_id where h.id = s.household_id;
  insert into public.notifications_log (to_address, template_key, status, household_id, payload)
    values (coalesce(v_email, 'unknown@invalid'), 'payment_failed', 'queued', s.household_id,
            jsonb_build_object('attempt', p_attempt, 'next_attempt', p_next_attempt, 'final', p_next_attempt is null));
end;
$$;

-- Skip-week credit bookkeeping (the app creates the Stripe balance transaction).
create function public.stripe_set_skip_credit(p_subscription uuid, p_week uuid, p_txn text, p_cents integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscription_allowances
    set skip_credit_txn_id = p_txn, skip_credit_cents = coalesce(p_cents, 0)
    where subscription_id = p_subscription and menu_week_id = p_week;
$$;

-- Abandoned checkouts: an unpaid order holds capacity for 30 minutes, then
-- it's cancelled (pg_cron, every 5 minutes). Credit it used goes back.
create function public.expire_pending_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_sub public.subscriptions;
  v_count integer := 0;
begin
  if not public.is_trusted_writer() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  for o in
    select * from public.orders
    where status = 'pending_payment' and expires_at is not null and expires_at < now() and amount_paid_cents = 0
    for update skip locked
  loop
    update public.orders set status = 'cancelled', expires_at = null, notes = coalesce(notes || E'\n', '') || 'Expired: not paid within 30 minutes.'
      where id = o.id;
    if o.credit_cents > 0 and o.household_id is not null then
      insert into public.account_credits (household_id, amount_cents, reason, order_id, created_by)
        values (o.household_id, o.credit_cents, 'Returned from expired order ' || o.order_number, o.id,
                coalesce(o.placed_by, (select primary_user_id from public.households where id = o.household_id)));
    end if;
    if o.household_id is not null then
      v_sub := public._live_subscription(o.household_id);
      if v_sub.id is not null then
        perform public._recount_allowance(v_sub.id, o.menu_week_id);
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

select cron.schedule('expire-pending-orders', '*/5 * * * *', $$select public.expire_pending_orders()$$);

-- Grants: Stripe bookkeeping is for the webhook / server jobs only.
revoke execute on function
  public.stripe_claim_event(text, text, boolean, jsonb), public.stripe_finish_event(text, text),
  public.stripe_record_payment_intent(uuid, text, text, integer, text),
  public.stripe_payment_succeeded(text, integer), public.stripe_payment_failed(text, text, boolean),
  public.stripe_payment_canceled(text), public.stripe_payment_refunded(text, integer, text, text),
  public.stripe_record_refund(uuid, text, text, text), public.stripe_set_order_tax(uuid, integer),
  public.stripe_sync_subscription(uuid, text, public.subscription_status, timestamptz, timestamptz, boolean, timestamptz, integer, text, timestamptz),
  public.stripe_invoice_paid(uuid, text, timestamptz, timestamptz), public.stripe_invoice_failed(uuid, text, integer, timestamptz),
  public.stripe_set_skip_credit(uuid, uuid, text, integer), public.expire_pending_orders()
  from public, anon, authenticated;
grant execute on function
  public.stripe_claim_event(text, text, boolean, jsonb), public.stripe_finish_event(text, text),
  public.stripe_record_payment_intent(uuid, text, text, integer, text),
  public.stripe_payment_succeeded(text, integer), public.stripe_payment_failed(text, text, boolean),
  public.stripe_payment_canceled(text), public.stripe_payment_refunded(text, integer, text, text),
  public.stripe_record_refund(uuid, text, text, text), public.stripe_set_order_tax(uuid, integer),
  public.stripe_sync_subscription(uuid, text, public.subscription_status, timestamptz, timestamptz, boolean, timestamptz, integer, text, timestamptz),
  public.stripe_invoice_paid(uuid, text, timestamptz, timestamptz), public.stripe_invoice_failed(uuid, text, integer, timestamptz),
  public.stripe_set_skip_credit(uuid, uuid, text, integer), public.expire_pending_orders()
  to service_role;
revoke execute on function public.can_refund(uuid, integer) from public, anon;
grant execute on function public.can_refund(uuid, integer) to authenticated;
