-- Phase 5: family experience. Onboarding, server-side carts, the zone
-- waitlist, subscription allowances, placing / modifying / cancelling
-- orders, skip / pause, subscription auto-fill at cutoff, and pilot-mode
-- sign-up. Every price and allowance is recomputed here (CLAUDE.md §5.8);
-- the client only ever says what, for whom and when.

-- ─────────────────────────────────────────────────────────────────────────────
-- Onboarding state on the household
-- ─────────────────────────────────────────────────────────────────────────────
create type public.ordering_preference as enum ('a_la_carte', 'subscription');

alter table public.households
  add column onboarded_at timestamptz,
  add column ordering_preference public.ordering_preference,
  add column preferred_plan_id uuid references public.plans (id) on delete set null;
grant update (onboarded_at, ordering_preference, preferred_plan_id) on public.households to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- "Not in your area yet" waitlist
-- ─────────────────────────────────────────────────────────────────────────────
create table public.zone_waitlist (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  zip text not null check (zip ~ '^\d{5}(-\d{4})?$'),
  created_at timestamptz not null default now(),
  unique (email, zip)
);
alter table public.zone_waitlist enable row level security;
revoke all on public.zone_waitlist from anon;
create policy "Members join the waitlist for their household" on public.zone_waitlist
  for insert to authenticated
  with check (household_id is not null and public.is_household_member(household_id));
create policy "Members read their waitlist entries" on public.zone_waitlist
  for select to authenticated using (household_id is not null and public.is_household_member(household_id));
create policy "Ops and owner read the waitlist (AAL2)" on public.zone_waitlist
  for select to authenticated using (public.is_ops_or_owner_aal2());

-- ─────────────────────────────────────────────────────────────────────────────
-- Carts: one per household per menu week, kept on the server so a parent can
-- start on a phone and finish on a laptop. Lines only, never prices.
-- lines: [{ "child_id", "menu_item_id", "delivery_date", "quantity" }]
-- ─────────────────────────────────────────────────────────────────────────────
create table public.carts (
  household_id uuid not null references public.households (id) on delete cascade,
  menu_week_id uuid not null references public.menu_weeks (id) on delete cascade,
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 100),
  replaces_order_id uuid references public.orders (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (household_id, menu_week_id)
);
alter table public.carts enable row level security;
revoke all on public.carts from anon;
create policy "Members manage their carts" on public.carts
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create trigger carts_touch before update on public.carts for each row execute function public.touch_updated_at();

-- Saved orders get a check on shape (name + array) already; favourites a lookup index.
create index favorites_household_idx on public.favorites (household_id, child_id);

-- Parents read their own children directly by household. (can_view_child()
-- looks the child up in the table, so it can't see a row inserted in the same
-- statement, which broke INSERT … RETURNING for a new child.)
create policy "Members read their children" on public.children
  for select to authenticated using (public.is_household_member(household_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Subscriptions: a plan change waits for the next period (Phase 6 prorates).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.subscriptions
  add column pending_plan_id uuid references public.plans (id) on delete set null;

-- Auto-fill marker and notification payloads.
alter table public.menu_weeks add column auto_filled_at timestamptz;
alter table public.notifications_log
  add column household_id uuid references public.households (id) on delete set null,
  add column payload jsonb;
alter table public.notifications_log drop constraint notifications_log_status_check;
alter table public.notifications_log
  add constraint notifications_log_status_check check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed'));
create index notifications_log_queued_idx on public.notifications_log (sent_at) where status = 'queued';

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helpers (not callable by app users)
-- ─────────────────────────────────────────────────────────────────────────────

-- Allergy names that block this child + item. Unlike meal_allergy_conflicts,
-- this does NOT check the caller's access, so system jobs (auto-fill) get the
-- real answer instead of an empty one. Callers must authorize first.
create function public._blocking_allergens(p_child uuid, p_item uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(a.name, ', ' order by a.sort_order)
  from public.child_allergens ca
  join public.menu_item_allergens mia on mia.allergen_id = ca.allergen_id and mia.menu_item_id = p_item
  join public.allergens a on a.id = ca.allergen_id
  left join public.allergy_overrides o on o.child_id = p_child and o.menu_item_id = p_item and o.revoked_at is null
  where ca.child_id = p_child
    and (mia.presence = 'contains' or ca.severity = 'severe')
    and o.id is null;
$$;

-- Meals (or snacks) a plan includes in ONE menu week, per allowance unit.
-- Longer billing intervals are spread evenly across weeks (rounded up).
create function public.plan_weekly_share(p_count integer, p_interval public.billing_interval)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_interval
    when 'week' then p_count
    when 'two_weeks' then ceil(p_count / 2.0)::integer
    else ceil(p_count * 12 / 52.0)::integer
  end;
$$;

-- The household's subscription that covers meals right now, if any.
create function public._live_subscription(p_household uuid)
returns public.subscriptions
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.subscriptions s
  where s.household_id = p_household
    and s.status in ('active', 'trialing')
    and (s.paused_until is null or s.paused_until <= now())
  order by s.created_at desc
  limit 1;
$$;

-- Recount a subscription's allowance for a week from the live orders.
create function public._recount_allowance(p_subscription uuid, p_week uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.subscriptions where id = p_subscription;
  update public.subscription_allowances sa
    set meals_used = coalesce((
          select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
          left join public.menu_items m on m.id = oi.menu_item_id
          where o.household_id = v_household and o.menu_week_id = p_week and oi.covered_by_subscription
            and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled') and not coalesce(m.is_snack, false)), 0),
        snacks_used = coalesce((
          select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
          left join public.menu_items m on m.id = oi.menu_item_id
          where o.household_id = v_household and o.menu_week_id = p_week and oi.covered_by_subscription
            and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled') and coalesce(m.is_snack, false)), 0)
    where sa.subscription_id = p_subscription and sa.menu_week_id = p_week;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The one place an order is priced. Used by place_family_order (a parent)
-- and auto_fill_week (system). Inside one transaction it:
--   1. locks the week's menu rows (capacity is checked and taken atomically),
--   2. validates every line (menu, delivery day, zone, child, allergies),
--   3. applies the subscription allowance per child or per household,
--   4. recomputes subtotal, delivery fee, discount and tax from the database.
-- p_items: [{ "child_id": uuid, "menu_item_id": uuid, "quantity": int, "delivery_date": "YYYY-MM-DD" }]
-- ─────────────────────────────────────────────────────────────────────────────
create function public._write_family_order(
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
              v_meal_share * case when v_plan.allowance_unit = 'per_child' then greatest(v_children, 1) else 1 end,
              v_snack_share * case when v_plan.allowance_unit = 'per_child' then greatest(v_children, 1) else 1 end)
      on conflict (subscription_id, menu_week_id) do update
        set meals_allowed = excluded.meals_allowed, snacks_allowed = excluded.snacks_allowed
      returning skipped into v_skipped;
    perform 1 from public.subscription_allowances where subscription_id = v_sub.id and menu_week_id = w.id for update;
    if v_skipped then
      v_meal_share := 0;
      v_snack_share := 0;
    end if;

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
        v_left := greatest(v_snack_share - coalesce((v_snack_used ->> v_unit_key)::integer, 0), 0);
        v_covered := least(v_left, v_qty);
        v_snack_used := v_snack_used || jsonb_build_object(v_unit_key, coalesce((v_snack_used ->> v_unit_key)::integer, 0) + v_covered);
      else
        v_left := greatest(v_meal_share - coalesce((v_used ->> v_unit_key)::integer, 0), 0);
        v_covered := least(v_left, v_qty);
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

  -- Tax: a flat rate from settings when enabled (Stripe Tax arrives in Phase 6).
  if coalesce((s.tax_settings ->> 'enabled')::boolean, false) and not coalesce((s.tax_settings ->> 'use_stripe_tax')::boolean, false) then
    v_rate := coalesce((s.tax_settings ->> 'rate_bps')::integer, 0);
    v_tax := round((v_subtotal - v_discount) * v_rate / 10000.0)::integer;
  end if;

  update public.orders
    set subtotal_cents = v_subtotal, delivery_fee_cents = v_fee, discount_cents = v_discount, tax_cents = v_tax,
        total_cents = v_subtotal + v_fee + v_tax - v_discount,
        source = case when v_any_covered then 'subscription'::public.order_source else 'a_la_carte'::public.order_source end,
        allergy_confirmed_at = case when p_system then allergy_confirmed_at else now() end,
        allergy_confirmed_by = case when p_system then allergy_confirmed_by else v_user end,
        -- A paid order whose new total differs goes back to pending until Phase 6 settles the difference.
        status = case
          when v_existing.id is not null and v_existing.status = 'paid'
               and v_existing.total_cents = v_subtotal + v_fee + v_tax - v_discount then 'paid'::public.order_status
          when v_subtotal + v_fee + v_tax - v_discount = 0 then 'paid'::public.order_status
          else 'pending_payment'::public.order_status end
    where id = v_order;

  if v_sub.id is not null then
    perform public._recount_allowance(v_sub.id, w.id);
  end if;
  return v_order;
end;
$$;

-- What a parent calls (via the placeOrder Server Action).
create function public.place_family_order(
  p_household uuid,
  p_menu_week uuid,
  p_items jsonb,
  p_fulfillment public.fulfillment_method default 'delivery',
  p_address uuid default null,
  p_discount_code text default null,
  p_allergies_confirmed boolean default false,
  p_notes text default null,
  p_replace_order uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_household_member(p_household) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return public._write_family_order(p_household, p_menu_week, p_items, p_fulfillment, p_address, p_discount_code,
                                    p_allergies_confirmed, p_notes, p_replace_order, false);
end;
$$;

-- Checkout preview of a discount code (no redemption).
create function public.preview_discount(p_code text, p_subtotal_cents integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_disc public.discount_codes;
begin
  if (select auth.uid()) is null then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_disc from public.discount_codes
    where code = upper(btrim(p_code)) and is_active and (expires_at is null or expires_at > now())
      and (max_redemptions is null or times_redeemed < max_redemptions)
      and coalesce(applies_to ->> 'scope', 'all') = 'all';
  if v_disc.id is null then
    return null;
  end if;
  return case when v_disc.type = 'percent' then (greatest(p_subtotal_cents, 0) * v_disc.value) / 100
              else least(v_disc.value, greatest(p_subtotal_cents, 0)) end;
end;
$$;

-- Cancel before the cutoff (refunds follow the CMS policy; Stripe in Phase 6).
create function public.cancel_family_order(p_order uuid)
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
  update public.orders set status = 'cancelled' where id = o.id;
  v_sub := public._live_subscription(o.household_id);
  if v_sub.id is not null then
    perform public._recount_allowance(v_sub.id, o.menu_week_id);
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Subscription self-service. Stripe is connected in Phase 6; until then these
-- record the family's intent and the webhook / provider finishes the job.
-- ─────────────────────────────────────────────────────────────────────────────
create function public.set_subscription_week_skip(p_subscription uuid, p_week uuid, p_skip boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_plan public.plans;
  w public.menu_weeks;
  v_skips integer;
begin
  select * into v_sub from public.subscriptions where id = p_subscription;
  if v_sub.id is null or v_sub.household_id is null or not public.is_household_member(v_sub.household_id) then
    raise exception 'Subscription not found' using errcode = 'no_data_found';
  end if;
  select * into v_plan from public.plans where id = v_sub.plan_id;
  select * into w from public.menu_weeks where id = p_week;
  if w.id is null or w.status <> 'published' or now() >= public.menu_week_cutoff(w.id) then
    raise exception 'It''s too late to change this week' using errcode = 'check_violation';
  end if;

  if p_skip then
    if not v_plan.allow_skip then
      raise exception 'Your plan doesn''t allow skipping weeks' using errcode = 'check_violation';
    end if;
    select count(*) into v_skips from public.subscription_allowances sa join public.menu_weeks mw on mw.id = sa.menu_week_id
      where sa.subscription_id = v_sub.id and sa.skipped and sa.menu_week_id <> w.id
        and date_trunc('month', mw.week_start) = date_trunc('month', w.week_start);
    if v_skips >= v_plan.max_skips_per_month then
      raise exception 'You''ve used all % skips for this month', v_plan.max_skips_per_month using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
               where o.household_id = v_sub.household_id and o.menu_week_id = w.id and oi.covered_by_subscription
                 and o.status in ('pending_payment', 'paid')) then
      raise exception 'Cancel this week''s order first, then skip the week' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.subscription_allowances (subscription_id, menu_week_id, skipped)
    values (v_sub.id, w.id, p_skip)
    on conflict (subscription_id, menu_week_id) do update set skipped = excluded.skipped;
end;
$$;

create function public.request_subscription_change(p_subscription uuid, p_action text, p_until timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_plan public.plans;
begin
  select * into v_sub from public.subscriptions where id = p_subscription for update;
  if v_sub.id is null or v_sub.household_id is null or not public.is_household_member(v_sub.household_id) then
    raise exception 'Subscription not found' using errcode = 'no_data_found';
  end if;
  select * into v_plan from public.plans where id = v_sub.plan_id;

  case p_action
    when 'pause' then
      if not v_plan.allow_pause then
        raise exception 'Your plan can''t be paused' using errcode = 'check_violation';
      end if;
      if p_until is null or p_until <= now() or p_until > now() + interval '12 weeks' then
        raise exception 'Choose a resume date within the next 12 weeks' using errcode = 'check_violation';
      end if;
      update public.subscriptions set paused_until = p_until where id = v_sub.id;
    when 'resume' then
      update public.subscriptions set paused_until = null where id = v_sub.id;
    when 'cancel' then
      if v_plan.min_commitment_intervals > 0 and v_sub.created_at > now() - (v_plan.min_commitment_intervals * case v_plan.billing_interval
           when 'week' then interval '1 week' when 'two_weeks' then interval '2 weeks' else interval '1 month' end) then
        raise exception 'Your plan has a minimum of % billing periods', v_plan.min_commitment_intervals using errcode = 'check_violation';
      end if;
      update public.subscriptions set cancel_at_period_end = true where id = v_sub.id;
    when 'reactivate' then
      update public.subscriptions set cancel_at_period_end = false where id = v_sub.id;
    else
      raise exception 'Unknown action' using errcode = 'check_violation';
  end case;
end;
$$;

create function public.request_plan_change(p_subscription uuid, p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where id = p_subscription for update;
  if v_sub.id is null or v_sub.household_id is null or not public.is_household_member(v_sub.household_id) then
    raise exception 'Subscription not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and is_active and archived_at is null and audience = 'family') then
    raise exception 'That plan isn''t available' using errcode = 'check_violation';
  end if;
  update public.subscriptions set pending_plan_id = nullif(p_plan, v_sub.plan_id) where id = v_sub.id;
end;
$$;

-- A family picks a plan: an `incomplete` subscription the payment provider
-- activates (mock locally, Stripe Checkout in Phase 6).
create function public.create_pending_subscription(p_household uuid, p_plan uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null or not public.is_household_member(p_household) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and is_active and archived_at is null and audience = 'family') then
    raise exception 'That plan isn''t available' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.subscriptions where household_id = p_household
             and status in ('active', 'trialing', 'past_due', 'paused')) then
    raise exception 'You already have a plan. Change it from your subscription page.' using errcode = 'check_violation';
  end if;
  -- Re-use an unfinished one rather than piling them up.
  delete from public.subscriptions where household_id = p_household and status = 'incomplete' and stripe_subscription_id is null;
  insert into public.subscriptions (household_id, plan_id, status) values (p_household, p_plan, 'incomplete')
    returning id into v_id;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-fill at cutoff (plan.auto_fill_strategy: favourites → chef's choice).
-- System job only: pg_cron (below) and the service role. Every pick passes
-- the same allergy check as a parent's order; a household we can't fill
-- safely gets an email instead of a guess.
-- ─────────────────────────────────────────────────────────────────────────────
create function public.auto_fill_week(p_week uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.menu_weeks;
  r record;
  c record;
  v_plan public.plans;
  v_share integer;
  v_items jsonb;
  v_dates date[];
  v_zone public.delivery_zones;
  v_addr public.addresses;
  v_fulfillment public.fulfillment_method;
  v_pick uuid;
  v_picked uuid[];
  v_order uuid;
  v_email text;
  v_created integer := 0;
  v_needed integer;
  i integer;
begin
  if not public.is_trusted_writer() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into w from public.menu_weeks where id = p_week;
  if w.id is null or w.status <> 'published' then
    return 0;
  end if;

  for r in
    select s.id as subscription_id, s.household_id, s.plan_id, h.default_address_id, h.primary_user_id
    from public.subscriptions s join public.households h on h.id = s.household_id
    where s.status in ('active', 'trialing') and (s.paused_until is null or s.paused_until <= now())
      and not exists (select 1 from public.subscription_allowances sa
                      where sa.subscription_id = s.id and sa.menu_week_id = w.id and sa.skipped)
      and not exists (select 1 from public.orders o where o.household_id = s.household_id and o.menu_week_id = w.id
                      and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled'))
  loop
    select * into v_plan from public.plans where id = r.plan_id;
    continue when v_plan.auto_fill_strategy = 'none';
    select u.email into v_email from auth.users u where u.id = r.primary_user_id;

    v_addr := null;
    v_zone := null;
    select * into v_addr from public.addresses where id = r.default_address_id;
    if v_addr.id is not null then
      select * into v_zone from public.delivery_zones z
        where z.is_active and z.archived_at is null and v_addr.zip = any (z.zip_codes) order by z.sort_order limit 1;
    end if;

    v_share := public.plan_weekly_share(v_plan.meals_per_interval, v_plan.billing_interval);
    v_items := '[]'::jsonb;
    v_fulfillment := case when v_zone.id is not null then 'delivery'::public.fulfillment_method else 'school_dropoff'::public.fulfillment_method end;

    for c in
      select ch.* from public.children ch where ch.household_id = r.household_id and ch.archived_at is null order by ch.created_at
    loop
      -- School drop-off only works when every child has a school.
      if v_fulfillment = 'school_dropoff' and c.school_id is null then
        v_items := '[]'::jsonb;
        exit;
      end if;
      v_dates := array(
        select d from unnest(w.delivery_dates) d
        where v_fulfillment = 'school_dropoff' or extract(isodow from d)::smallint = any (v_zone.delivery_weekdays)
        order by d);
      continue when coalesce(array_length(v_dates, 1), 0) = 0;
      v_needed := case when v_plan.allowance_unit = 'per_child' then v_share
                       else greatest(v_share - jsonb_array_length(v_items), 0) end;
      v_picked := '{}';
      for i in 1 .. v_needed loop
        v_pick := null;
        -- Favourites first (this child's, then the household's), skipping repeats.
        if v_plan.auto_fill_strategy = 'favorites' then
          select wi.menu_item_id into v_pick
          from public.favorites f
          join public.menu_week_items wi on wi.menu_item_id = f.menu_item_id and wi.menu_week_id = w.id
            and wi.available_for in ('families', 'both')
          join public.menu_items m on m.id = wi.menu_item_id and m.is_active and m.archived_at is null and not m.is_snack
          where f.household_id = r.household_id and (f.child_id = c.id or f.child_id is null)
            and not (wi.menu_item_id = any (v_picked))
            and public._blocking_allergens(c.id, wi.menu_item_id) is null
          order by (f.child_id is null), f.created_at
          limit 1;
        end if;
        -- Chef's choice: the menu's own order.
        if v_pick is null then
          select wi.menu_item_id into v_pick
          from public.menu_week_items wi
          join public.menu_items m on m.id = wi.menu_item_id and m.is_active and m.archived_at is null and not m.is_snack
          where wi.menu_week_id = w.id and wi.available_for in ('families', 'both')
            and not (wi.menu_item_id = any (v_picked))
            and public._blocking_allergens(c.id, wi.menu_item_id) is null
          order by wi.sort_order
          limit 1;
        end if;
        exit when v_pick is null;
        v_picked := v_picked || v_pick;
        v_items := v_items || jsonb_build_object('child_id', c.id, 'menu_item_id', v_pick, 'quantity', 1,
          'delivery_date', v_dates[1 + ((i - 1) % array_length(v_dates, 1))]);
      end loop;
    end loop;

    if jsonb_array_length(v_items) = 0 then
      insert into public.notifications_log (to_address, template_key, status, household_id, payload)
        values (coalesce(v_email, 'unknown@invalid'), 'subscription_autofill_failed', 'queued', r.household_id,
                jsonb_build_object('week_start', w.week_start));
      continue;
    end if;

    begin
      v_order := public._write_family_order(r.household_id, w.id, v_items, v_fulfillment,
        case when v_fulfillment = 'delivery' then v_addr.id end, null, null, null, null, true);
      insert into public.notifications_log (to_address, template_key, status, household_id, payload)
        values (coalesce(v_email, 'unknown@invalid'), 'subscription_autofill', 'queued', r.household_id,
                jsonb_build_object('order_id', v_order, 'week_start', w.week_start));
      v_created := v_created + 1;
    exception when others then
      insert into public.notifications_log (to_address, template_key, status, household_id, payload, error)
        values (coalesce(v_email, 'unknown@invalid'), 'subscription_autofill_failed', 'queued', r.household_id,
                jsonb_build_object('week_start', w.week_start), left(sqlerrm, 300));
    end;
  end loop;

  update public.menu_weeks set auto_filled_at = now() where id = w.id;
  return v_created;
end;
$$;

-- Weeks whose cutoff just passed and haven't been filled yet.
create function public.auto_fill_due_weeks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_total integer := 0;
begin
  if not public.is_trusted_writer() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  for r in
    select w.id from public.menu_weeks w
    where w.status = 'published' and w.auto_filled_at is null
      and public.menu_week_cutoff(w.id) <= now() and public.menu_week_cutoff(w.id) > now() - interval '1 day'
  loop
    v_total := v_total + public.auto_fill_week(r.id);
  end loop;
  return v_total;
end;
$$;

select cron.schedule('auto-fill-subscriptions', '*/15 * * * *', $$select public.auto_fill_due_weeks()$$);

-- ─────────────────────────────────────────────────────────────────────────────
-- Allergy edits: which upcoming orders now clash? (CLAUDE.md §6)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.upcoming_allergy_conflicts(p_child uuid)
returns table (order_id uuid, order_number text, item_name text, delivery_date date, allergens text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, oi.item_name, oi.delivery_date, public._blocking_allergens(p_child, oi.menu_item_id)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.child_id = p_child
    and public.can_view_child(p_child)
    and o.status in ('pending_payment', 'paid')
    and coalesce(oi.delivery_date, o.delivery_date) >= (now() at time zone (select s.timezone from public.site_settings s where s.id))::date
    and oi.menu_item_id is not null
    and public._blocking_allergens(p_child, oi.menu_item_id) is not null
  order by oi.delivery_date;
$$;

-- Is this ZIP inside an active delivery zone? (Onboarding, before an address exists.)
create function public.zone_for_zip(p_zip text)
returns table (zone_id uuid, name text, delivery_weekdays smallint[], delivery_window_label text, fee_cents integer,
               free_over_cents integer, min_order_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select z.id, z.name, z.delivery_weekdays, z.delivery_window_label, z.fee_cents, z.free_over_cents, z.min_order_cents
  from public.delivery_zones z
  where z.is_active and z.archived_at is null and left(btrim(p_zip), 5) = any (z.zip_codes)
  order by z.sort_order
  limit 1;
$$;

-- Partner schools a parent can link a child to: approved, with classrooms.
-- Only names and classroom labels; nothing about other families.
create function public.partner_schools()
returns table (organization_id uuid, name text, classroom_id uuid, classroom_name text, grade text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, c.id, c.name, c.grade
  from public.organizations o
  join public.classrooms c on c.organization_id = o.id and c.archived_at is null
  where o.status = 'approved' and o.archived_at is null and o.type in ('school', 'daycare')
    and (select auth.uid()) is not null
  order by o.name, c.name;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pilot mode: sign-up needs an unused invite code (Phase 10 builds the admin
-- side). Staff invited by the owner (invited_at set by the Auth admin API,
-- which a sign-up form can't set) are exempt.
-- ─────────────────────────────────────────────────────────────────────────────
create function public.pilot_code_is_valid(p_code text, p_email text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pilot_invites pi
    where pi.code = upper(btrim(p_code)) and pi.used_at is null
      and (pi.email is null or lower(pi.email) = lower(btrim(p_email)))
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(btrim(left(coalesce(v_meta ->> 'full_name', v_meta ->> 'name'), 120)), '');
  v_org_name text := nullif(btrim(left(v_meta ->> 'organization_name', 120)), '');
  v_code text := upper(btrim(coalesce(v_meta ->> 'pilot_code', '')));
  v_org_id uuid;
  v_household uuid;
begin
  if new.invited_at is null and (select pilot_mode from public.site_settings where id) then
    update public.pilot_invites
      set used_by = new.id, used_at = now()
      where code = v_code and used_at is null and (email is null or lower(email) = lower(new.email));
    if not found then
      raise exception 'PILOT_CODE_INVALID' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.profiles (id, full_name) values (new.id, v_name);

  if v_meta ->> 'account_type' = 'school' and v_org_name is not null and char_length(v_org_name) >= 2 then
    insert into public.organizations (name, created_by) values (v_org_name, new.id) returning id into v_org_id;
    insert into public.user_roles (user_id, role, organization_id) values (new.id, 'school_admin', v_org_id);
  else
    insert into public.user_roles (user_id, role) values (new.id, 'parent');
    insert into public.households (name, primary_user_id)
      values (coalesce(split_part(v_name, ' ', 1) || '''s household', 'My household'), new.id)
      returning id into v_household;
    insert into public.household_members (household_id, user_id, role) values (v_household, new.id, 'owner');
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Replace the Phase 3 entry point (its logic now lives in _write_family_order).
-- ─────────────────────────────────────────────────────────────────────────────
drop function public.create_family_order(uuid, uuid, jsonb, public.fulfillment_method, uuid, text);

-- Grants: internals are never callable from the API.
revoke execute on function public._blocking_allergens(uuid, uuid), public._live_subscription(uuid),
  public._recount_allowance(uuid, uuid),
  public._write_family_order(uuid, uuid, jsonb, public.fulfillment_method, uuid, text, boolean, text, uuid, boolean),
  public.auto_fill_week(uuid), public.auto_fill_due_weeks()
  from public, anon, authenticated;
revoke execute on function public.place_family_order(uuid, uuid, jsonb, public.fulfillment_method, uuid, text, boolean, text, uuid),
  public.preview_discount(text, integer), public.cancel_family_order(uuid),
  public.set_subscription_week_skip(uuid, uuid, boolean), public.request_subscription_change(uuid, text, timestamptz),
  public.request_plan_change(uuid, uuid), public.create_pending_subscription(uuid, uuid),
  public.upcoming_allergy_conflicts(uuid), public.zone_for_zip(text), public.partner_schools(),
  public.pilot_code_is_valid(text, text), public.plan_weekly_share(integer, public.billing_interval)
  from public, anon;
grant execute on function public.place_family_order(uuid, uuid, jsonb, public.fulfillment_method, uuid, text, boolean, text, uuid),
  public.preview_discount(text, integer), public.cancel_family_order(uuid),
  public.set_subscription_week_skip(uuid, uuid, boolean), public.request_subscription_change(uuid, text, timestamptz),
  public.request_plan_change(uuid, uuid), public.create_pending_subscription(uuid, uuid),
  public.upcoming_allergy_conflicts(uuid), public.zone_for_zip(text), public.partner_schools(),
  public.plan_weekly_share(integer, public.billing_interval)
  to authenticated;
-- Sign-up (anon) checks a pilot code before creating the account; the
-- trigger above re-checks and redeems it. Rate limited + Turnstile in the app.
grant execute on function public.pilot_code_is_valid(text, text) to anon, authenticated;
grant execute on function public.auto_fill_week(uuid), public.auto_fill_due_weeks() to service_role;
