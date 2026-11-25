-- Phase 8: chef dashboard and fulfillment. One role-aware source of order
-- lines for the kitchen (no prices, addresses or phones), an ops-only order
-- view with payment and delivery details, prep checks, deliveries, the
-- "needs attention" allergy conflict check, the week lifecycle (auto close at
-- cutoff, fulfilled, owner late-order exceptions) and label settings.

-- ─────────────────────────────────────────────────────────────────────────────
-- Settings and menu item fields used on labels
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.site_settings
  -- exclude_unpaid: unpaid à-la-carte orders stay off the cook list after cutoff
  -- (shown in a separate list). label_sheet: avery_5163 | avery_5164.
  add column kitchen_settings jsonb not null
    default '{"exclude_unpaid": true, "label_sheet": "avery_5163", "use_by_days": 3, "meals_per_bag": 12}';

alter table public.menu_items
  add column reheat_instructions text check (char_length(reheat_instructions) <= 160),
  add column use_by_days smallint check (use_by_days is null or use_by_days between 1 and 14);

-- ─────────────────────────────────────────────────────────────────────────────
-- Allergy conflicts: a line whose child (now) has an allergen the meal
-- contains, or a severe allergy to something it may contain, with no
-- owner-approved override. Same rule as ordering (CLAUDE.md §6).
-- ─────────────────────────────────────────────────────────────────────────────
create function public._line_conflict(p_child uuid, p_item uuid, p_contains text[], p_may text[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(a.name, ', ' order by a.sort_order)
  from public.child_allergens ca
  join public.allergens a on a.id = ca.allergen_id
  where ca.child_id = p_child
    and (a.name = any (coalesce(p_contains, '{}')) or (ca.severity = 'severe' and a.name = any (coalesce(p_may, '{}'))))
    and not exists (select 1 from public.allergy_overrides o
                    where o.child_id = p_child and o.menu_item_id = p_item and o.revoked_at is null);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Prep checks: "prepared allergy-safe" confirmations per flagged meal
-- ─────────────────────────────────────────────────────────────────────────────
create table public.prep_checks (
  order_item_id uuid primary key references public.order_items (id) on delete cascade,
  checked_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  checked_at timestamptz not null default now()
);
alter table public.prep_checks enable row level security;
revoke all on public.prep_checks from anon;
create policy "Kitchen, ops and owner read prep checks (AAL2)" on public.prep_checks
  for select to authenticated using (public.is_staff_aal2());
create policy "Kitchen, ops and owner record prep checks (AAL2)" on public.prep_checks
  for insert to authenticated with check (public.is_staff_aal2() and checked_by = (select auth.uid()));
create policy "Kitchen, ops and owner clear prep checks (AAL2)" on public.prep_checks
  for delete to authenticated using (public.is_staff_aal2());
create trigger prep_checks_audit after insert or delete on public.prep_checks
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Deliveries: one row per order per delivery day, marked by ops
-- ─────────────────────────────────────────────────────────────────────────────
create table public.deliveries (
  order_id uuid not null references public.orders (id) on delete cascade,
  delivery_date date not null,
  delivered_at timestamptz not null default now(),
  delivered_by uuid references auth.users (id) on delete set null,
  primary key (order_id, delivery_date)
);
alter table public.deliveries enable row level security;
revoke all on public.deliveries from anon, authenticated;
grant select on public.deliveries to authenticated;
create policy "Staff read deliveries (AAL2)" on public.deliveries
  for select to authenticated using (public.is_staff_aal2());
create policy "Account members read their deliveries" on public.deliveries
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and public.can_view_account(o.household_id, o.organization_id)));
create trigger deliveries_audit after insert or delete on public.deliveries
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Allergy conflict alerts (emails are sent once per line)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.allergy_conflict_alerts (
  order_item_id uuid primary key references public.order_items (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  child_id uuid references public.children (id) on delete set null,
  allergens text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.allergy_conflict_alerts enable row level security;
revoke all on public.allergy_conflict_alerts from anon, authenticated;
grant select on public.allergy_conflict_alerts to authenticated;
create policy "Staff read conflict alerts (AAL2)" on public.allergy_conflict_alerts
  for select to authenticated using (public.is_staff_aal2());

-- ─────────────────────────────────────────────────────────────────────────────
-- Late-order exceptions (owner only, audited): one household may still
-- order for a week after its cutoff, until the exception expires.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.late_order_exceptions (
  id uuid primary key default gen_random_uuid(),
  menu_week_id uuid not null references public.menu_weeks (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  expires_at timestamptz not null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index late_order_exceptions_lookup on public.late_order_exceptions (household_id, menu_week_id);
alter table public.late_order_exceptions enable row level security;
revoke all on public.late_order_exceptions from anon, authenticated;
grant select on public.late_order_exceptions to authenticated;
create policy "Household members read their late-order exceptions" on public.late_order_exceptions
  for select to authenticated using (public.is_household_member(household_id));
create policy "Ops and owner read late-order exceptions (AAL2)" on public.late_order_exceptions
  for select to authenticated using (public.is_ops_or_owner_aal2());
create trigger late_order_exceptions_audit after insert or update on public.late_order_exceptions
  for each row execute function public.audit_row_change();

create function public._late_exception_active(p_household uuid, p_week uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.late_order_exceptions e
                 where e.household_id = p_household and e.menu_week_id = p_week
                   and e.revoked_at is null and e.expires_at > now());
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Read models
-- ═════════════════════════════════════════════════════════════════════════════

-- Every meal line of a week for the kitchen: who, what, where (household or
-- school/classroom), allergy flags, prep checks. Deliberately NO prices,
-- street addresses, phones or emails (CLAUDE.md §2: kitchen sees first name,
-- classroom and allergies only). Kitchen, ops and owner at AAL2.
create function public.fulfillment_lines(p_week uuid)
returns table (
  order_item_id uuid, order_id uuid, order_number text, order_status public.order_status, order_source text,
  fulfillment public.fulfillment_method, delivery_date date, menu_item_id uuid, item_name text, quantity integer,
  allergens_contained text[], may_contain text[], badges text[], safe_for_allergens text[],
  has_allergy_override boolean, override_reason text,
  child_id uuid, child_first_name text, child_last_initial text, child_allergens jsonb, child_dietary text[],
  classroom_id uuid, classroom_name text, organization_id uuid, organization_name text,
  household_id uuid, household_name text, zone_name text, dropoff_location text, order_notes text,
  reheat_instructions text, use_by_days smallint, conflict text,
  prep_checked_at timestamptz, prep_checked_by text, delivered boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select oi.id, o.id, o.order_number, o.status, o.source::text, o.fulfillment,
    coalesce(oi.delivery_date, o.delivery_date, wk.delivery_dates[1], wk.week_start), oi.menu_item_id, oi.item_name, oi.quantity,
    oi.allergens_contained, oi.may_contain, oi.badges, oi.safe_for_allergens,
    oi.allergy_override_id is not null, ao.reason,
    c.id, c.first_name, c.last_initial,
    coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'severity', ca.severity) order by a.sort_order)
              from public.child_allergens ca join public.allergens a on a.id = ca.allergen_id
              where ca.child_id = c.id), '[]'::jsonb),
    coalesce(c.dietary_preferences, '{}'),
    cl.id, cl.name, org.id, org.name,
    h.id, h.name, z.name, coalesce(o.dropoff_location, cl.dropoff_location), o.notes,
    m.reheat_instructions, m.use_by_days,
    case when c.id is not null then public._line_conflict(c.id, oi.menu_item_id, oi.allergens_contained, oi.may_contain) end,
    pc.checked_at, coalesce(p.full_name, 'staff'),
    exists (select 1 from public.deliveries d where d.order_id = o.id
            and d.delivery_date = coalesce(oi.delivery_date, o.delivery_date, wk.delivery_dates[1], wk.week_start))
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.menu_weeks wk on wk.id = o.menu_week_id
  left join public.children c on c.id = oi.child_id
  left join public.classrooms cl on cl.id = coalesce(oi.classroom_id, c.classroom_id)
  left join public.organizations org on org.id = coalesce(o.organization_id, case when o.fulfillment = 'school_dropoff' then c.school_id end)
  left join public.households h on h.id = o.household_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  left join public.menu_items m on m.id = oi.menu_item_id
  left join public.allergy_overrides ao on ao.id = oi.allergy_override_id
  left join public.prep_checks pc on pc.order_item_id = oi.id
  left join public.profiles p on p.id = pc.checked_by
  where o.menu_week_id = p_week
    and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled', 'partially_refunded')
    and public.has_any_role_aal2(array['kitchen', 'ops', 'owner']::public.app_role[])
  order by 7, o.order_number, c.first_name, oi.item_name;
$$;

-- Order-level view for ops/owner: payment, address, phone, delivery state.
create function public.fulfillment_orders(p_week uuid)
returns table (
  order_id uuid, order_number text, status public.order_status, source text, fulfillment public.fulfillment_method,
  total_cents integer, amount_paid_cents integer, amount_refunded_cents integer, payment_failed_at timestamptz,
  last_payment_error text, household_id uuid, household_name text, organization_id uuid, organization_name text,
  address jsonb, zone_name text, zip text, phone text, dropoff jsonb, notes text, placed_at timestamptz,
  delivered_dates date[], reminder_sent_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status, o.source::text, o.fulfillment,
    o.total_cents, o.amount_paid_cents, o.amount_refunded_cents, o.payment_failed_at, o.last_payment_error,
    h.id, h.name, org.id, org.name,
    coalesce(o.address_snapshot, org.address), z.name,
    coalesce(o.address_snapshot ->> 'zip', org.address ->> 'zip'),
    coalesce(org.contact_phone, p.phone),
    case when org.id is not null then jsonb_build_object('entrance', org.dropoff_entrance, 'contact', org.dropoff_contact,
      'window', org.dropoff_window, 'instructions', org.dropoff_instructions) end,
    o.notes, o.placed_at,
    coalesce((select array_agg(d.delivery_date order by d.delivery_date) from public.deliveries d where d.order_id = o.id), '{}'),
    (select max(n.sent_at) from public.notifications_log n
      where n.template_key = 'payment_reminder' and n.payload ->> 'order_id' = o.id::text)
  from public.orders o
  left join public.households h on h.id = o.household_id
  left join public.organizations org on org.id = o.organization_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  left join public.profiles p on p.id = h.primary_user_id
  where o.menu_week_id = p_week
    and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled', 'partially_refunded')
    and public.is_ops_or_owner_aal2()
  order by o.order_number;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Actions
-- ═════════════════════════════════════════════════════════════════════════════

-- Ops marks a stop delivered (one or many orders, one day). Families get the
-- "Your meals were delivered" email once per order per day; an order whose
-- every delivery day is done becomes fulfilled.
create function public.mark_delivered(p_orders uuid[], p_date date, p_delivered boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_email text;
  v_n integer := 0;
  v_days date[];
begin
  if not public.is_ops_or_owner_aal2() then
    raise exception 'Only ops or the owner can mark deliveries' using errcode = 'insufficient_privilege';
  end if;
  for o in select * from public.orders where id = any (p_orders) for update loop
    if not p_delivered then
      delete from public.deliveries where order_id = o.id and delivery_date = p_date;
      continue;
    end if;
    insert into public.deliveries (order_id, delivery_date, delivered_by)
      values (o.id, p_date, (select auth.uid()))
      on conflict (order_id, delivery_date) do nothing;
    if not found then
      continue;
    end if;
    v_n := v_n + 1;
    if o.household_id is not null then
      select u.email into v_email from public.households h join auth.users u on u.id = h.primary_user_id where h.id = o.household_id;
      if v_email is not null then
        insert into public.notifications_log (to_address, template_key, status, household_id, payload)
          values (v_email, 'order_delivered', 'queued', o.household_id,
                  jsonb_build_object('order_id', o.id, 'delivery_date', p_date));
      end if;
    end if;
    select coalesce(array_agg(distinct coalesce(oi.delivery_date, o.delivery_date)), '{}') into v_days
      from public.order_items oi where oi.order_id = o.id;
    if o.status in ('paid', 'invoiced') and not exists (
         select 1 from unnest(v_days) d where d is not null
           and not exists (select 1 from public.deliveries x where x.order_id = o.id and x.delivery_date = d)) then
      update public.orders set status = 'fulfilled' where id = o.id;
    end if;
  end loop;
  return v_n;
end;
$$;

-- "Needs attention": find lines that now clash with a child's allergies
-- (e.g. an allergy added after ordering) in weeks still to be delivered.
-- New ones email the owner and the parent once; fixed ones are resolved.
create function public.detect_allergy_conflicts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_today date := (now() at time zone (select timezone from public.site_settings where id))::date;
  v_owner text := (select contact_email from public.site_settings where id);
  v_parent text;
  v_new integer := 0;
begin
  if not (public.is_trusted_writer() or public.is_ops_or_owner_aal2()) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  for r in
    select oi.id as item_id, o.id as order_id, o.order_number, o.household_id, c.id as child_id, c.first_name,
           oi.item_name, coalesce(oi.delivery_date, o.delivery_date) as delivery_date,
           public._line_conflict(c.id, oi.menu_item_id, oi.allergens_contained, oi.may_contain) as conflict
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.menu_weeks w on w.id = o.menu_week_id
    join public.children c on c.id = oi.child_id
    where w.status in ('published', 'closed')
      and o.status in ('pending_payment', 'paid', 'invoiced', 'partially_refunded')
      and coalesce(oi.delivery_date, o.delivery_date, w.week_start) >= v_today
  loop
    if r.conflict is null then
      update public.allergy_conflict_alerts set resolved_at = now() where order_item_id = r.item_id and resolved_at is null;
      continue;
    end if;
    insert into public.allergy_conflict_alerts (order_item_id, order_id, child_id, allergens)
      values (r.item_id, r.order_id, r.child_id, r.conflict)
      on conflict (order_item_id) do update set allergens = excluded.allergens, resolved_at = null
      where public.allergy_conflict_alerts.resolved_at is not null or public.allergy_conflict_alerts.allergens <> excluded.allergens;
    if not found then
      continue;
    end if;
    v_new := v_new + 1;
    select u.email into v_parent from public.households h join auth.users u on u.id = h.primary_user_id where h.id = r.household_id;
    insert into public.notifications_log (to_address, template_key, status, household_id, payload)
    select x.addr, 'allergy_conflict', 'queued', r.household_id,
           jsonb_build_object('order_id', r.order_id, 'order_item_id', r.item_id, 'order_number', r.order_number,
                              'child_first_name', r.first_name, 'meal', r.item_name, 'allergens', r.conflict,
                              'delivery_date', r.delivery_date, 'audience', x.who)
    from (values (v_owner, 'owner'), (v_parent, 'parent')) x(addr, who)
    where x.addr is not null;
  end loop;
  -- Lines that left the week (cancelled, swapped) are resolved too.
  update public.allergy_conflict_alerts a set resolved_at = now()
    where a.resolved_at is null and not exists (
      select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.id = a.order_item_id and o.status in ('pending_payment', 'paid', 'invoiced', 'partially_refunded'));
  return v_new;
end;
$$;

-- Unpaid order reminder (ops/owner), at most once every 12 hours per order.
create function public.send_payment_reminder(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_email text;
begin
  if not public.is_ops_or_owner_aal2() then
    raise exception 'Only ops or the owner can send reminders' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.orders where id = p_order;
  if o.id is null or o.household_id is null or o.status <> 'pending_payment' then
    raise exception 'Only unpaid family orders get payment reminders' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.notifications_log where template_key = 'payment_reminder'
             and payload ->> 'order_id' = o.id::text and sent_at > now() - interval '12 hours') then
    raise exception 'A reminder was sent in the last 12 hours' using errcode = 'check_violation';
  end if;
  select u.email into v_email from public.households h join auth.users u on u.id = h.primary_user_id where h.id = o.household_id;
  if v_email is null then
    raise exception 'This family has no email address' using errcode = 'check_violation';
  end if;
  insert into public.notifications_log (to_address, template_key, status, household_id, payload)
    values (v_email, 'payment_reminder', 'queued', o.household_id, jsonb_build_object('order_id', o.id));
end;
$$;

-- ─── Week lifecycle ─────────────────────────────────────────────────────────
-- Automatic close at cutoff (pg_cron), after subscription auto-fill ran.
create function public.close_due_weeks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.menu_weeks w set status = 'closed'
    where w.status = 'published' and public.menu_week_cutoff(w.id) <= now()
      and (w.auto_filled_at is not null or public.menu_week_cutoff(w.id) < now() - interval '1 day');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Manual close (owner, fresh MFA): moves the cutoff to now, runs the
-- subscription auto-fill, then closes the week.
create function public.close_week_now(p_week uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.menu_weeks;
  v_claims text;
begin
  if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
    raise exception 'Only the owner, with a fresh MFA check, can close a week early' using errcode = 'insufficient_privilege';
  end if;
  select * into w from public.menu_weeks where id = p_week for update;
  if w.id is null or w.status <> 'published' then
    raise exception 'Only a published week can be closed' using errcode = 'check_violation';
  end if;
  if public.menu_week_cutoff(w.id) > now() then
    update public.menu_weeks
      set cutoff_at = now(),
          ordering_opens_at = case when ordering_opens_at >= now() then now() - interval '1 second' else ordering_opens_at end
      where id = w.id;
  end if;
  -- auto_fill_week is a trusted job: run it without the owner's JWT, then
  -- put the JWT back for the rest of this statement.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '', true);
  perform public.auto_fill_week(w.id);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  update public.menu_weeks set status = 'closed' where id = w.id;
end;
$$;

-- Mark a week fulfilled (ops/owner): every paid / invoiced order is done.
create function public.mark_week_fulfilled(p_week uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.is_ops_or_owner_aal2() then
    raise exception 'Only ops or the owner can do this' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.menu_weeks where id = p_week and status in ('published', 'closed')
                 and public.menu_week_cutoff(id) <= now()) then
    raise exception 'A week can be marked fulfilled after its cutoff' using errcode = 'check_violation';
  end if;
  update public.orders set status = 'fulfilled' where menu_week_id = p_week and status in ('paid', 'invoiced');
  get diagnostics v_n = row_count;
  update public.menu_weeks set status = 'fulfilled' where id = p_week;
  return v_n;
end;
$$;

-- Late order for one family (owner only, audited by the table trigger).
create function public.grant_late_order(p_week uuid, p_household uuid, p_reason text, p_hours integer default 24)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner_aal2() then
    raise exception 'Only the owner can allow a late order' using errcode = 'insufficient_privilege';
  end if;
  if p_hours not between 1 and 72 then
    raise exception 'Allow between 1 and 72 hours' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.menu_weeks where id = p_week and status in ('published', 'closed')) then
    raise exception 'That week isn''t open or closed' using errcode = 'check_violation';
  end if;
  insert into public.late_order_exceptions (menu_week_id, household_id, reason, expires_at, created_by)
    values (p_week, p_household, btrim(p_reason), now() + make_interval(hours => p_hours), (select auth.uid()))
    returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_late_order(p_exception uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner_aal2() then
    raise exception 'Only the owner can do this' using errcode = 'insufficient_privilege';
  end if;
  update public.late_order_exceptions set revoked_at = now() where id = p_exception and revoked_at is null;
end;
$$;

-- Ordering honours late-order exceptions (two changed conditions, marked).
create or replace function public._write_family_order(p_household uuid, p_menu_week uuid, p_items jsonb, p_fulfillment fulfillment_method, p_address uuid, p_discount_code text, p_allergies_confirmed boolean, p_notes text, p_replace_order uuid, p_system boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_late boolean := false;
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
  -- Phase 8: an owner-approved late-order exception reopens the week for
  -- this household only, until it expires.
  v_late := not p_system and public._late_exception_active(p_household, p_menu_week);
  if w.id is null or (w.status <> 'published' and not (w.status = 'closed' and v_late)) then
    raise exception 'This week''s menu isn''t open for orders' using errcode = 'check_violation';
  end if;
  if not p_system and ((w.ordering_opens_at is not null and now() < w.ordering_opens_at)
     or (now() >= public.menu_week_cutoff(w.id) and not v_late)) then
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
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Schedules, email templates, privileges
-- ═════════════════════════════════════════════════════════════════════════════
select cron.schedule('close-due-weeks', '*/15 * * * *', $$select public.close_due_weeks()$$);
select cron.schedule('detect-allergy-conflicts', '*/15 * * * *', $$select public.detect_allergy_conflicts()$$);

insert into public.email_templates (key, subject, preheader, body_rich) values
  ('allergy_conflict', 'Allergy check needed: {{child_first_name}}''s {{meal}}', 'Please review this order.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"{{child_first_name}}''s {{meal}} on {{delivery_date}} (order {{order_number}}) now clashes with their allergies ({{allergens}}). We won''t serve it as it is. We''ll be in touch to swap it, or reply to this email."}]}]}'),
  ('order_delivered', 'Your Smart Cookie meals were delivered', 'Enjoy!',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi {{first_name}}, today''s meals (order {{order_number}}) were just delivered. Keep them refrigerated and enjoy!"}]}]}'),
  ('payment_reminder', 'Reminder: please pay for order {{order_number}}', 'Your meals are waiting.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi {{first_name}}, your order {{order_number}} isn''t paid yet. Pay here so we can cook it: {{pay_url}}"}]}]}')
on conflict (key) do nothing;

revoke execute on function public._line_conflict(uuid, uuid, text[], text[]), public._late_exception_active(uuid, uuid),
  public.close_due_weeks()
  from public, anon, authenticated;
revoke execute on function public.fulfillment_lines(uuid), public.fulfillment_orders(uuid),
  public.mark_delivered(uuid[], date, boolean), public.detect_allergy_conflicts(), public.send_payment_reminder(uuid),
  public.close_week_now(uuid), public.mark_week_fulfilled(uuid), public.grant_late_order(uuid, uuid, text, integer),
  public.revoke_late_order(uuid)
  from public, anon;
grant execute on function public.fulfillment_lines(uuid), public.fulfillment_orders(uuid),
  public.mark_delivered(uuid[], date, boolean), public.detect_allergy_conflicts(), public.send_payment_reminder(uuid),
  public.close_week_now(uuid), public.mark_week_fulfilled(uuid), public.grant_late_order(uuid, uuid, text, integer),
  public.revoke_late_order(uuid)
  to authenticated;
grant execute on function public.close_due_weeks(), public.detect_allergy_conflicts() to service_role;
