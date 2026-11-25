-- Phase 7: school portal. Organizations onboard and get approved with
-- billing terms; classrooms carry headcounts and an allergy summary (linked
-- children + counts the school enters); standing orders materialize into
-- real `invoiced` orders for each published week before cutoff; schools
-- adjust days, mark closures and place one-off bulk orders; everything is
-- billed monthly through Stripe Invoicing (card + ACH).
--
-- All school data is scoped by organization in RLS (org_role() /
-- my_organization_ids()). Writes that need business rules (cutoff locks,
-- re-pricing) go through security-definer functions; the tables themselves
-- only allow reads to school members.

alter type public.order_source add value if not exists 'school_bulk';

-- ─────────────────────────────────────────────────────────────────────────────
-- Settings
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.site_settings
  -- Day of the month (business timezone) the monthly school invoices run.
  add column school_invoice_day smallint not null default 1 check (school_invoice_day between 1 and 28),
  -- Stop materializing new standing-order weeks for a school whose oldest
  -- unpaid invoice is more than N days overdue. Null = never suspend.
  add column school_overdue_suspend_days smallint
    check (school_overdue_suspend_days is null or school_overdue_suspend_days between 1 and 120);

alter table public.notifications_log
  add column organization_id uuid references public.organizations (id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Organizations: onboarding details and the school price list switch
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.organizations
  add column use_school_pricing boolean not null default true,
  add column onboarded_at timestamptz,
  add column dropoff_entrance text check (char_length(dropoff_entrance) <= 200),
  add column dropoff_contact text check (char_length(dropoff_contact) <= 120),
  add column dropoff_window text check (char_length(dropoff_window) <= 80);

grant update (onboarded_at, dropoff_entrance, dropoff_contact, dropoff_window, use_school_pricing)
  on public.organizations to authenticated;

-- School admins edit their own details; approval, terms, tax status and the
-- price list stay with ops/owner. The school price list is pricing
-- (CLAUDE.md §5.5): owner only, with a fresh MFA check.
create or replace function public.guard_organization_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.use_school_pricing is distinct from old.use_school_pricing
     and not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
    raise exception 'Only the owner, with a fresh MFA check, can change school pricing'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_ops_or_owner_aal2() then
    return new;
  end if;
  if new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at or new.tax_exempt is distinct from old.tax_exempt
     or new.billing_terms_days is distinct from old.billing_terms_days then
    raise exception 'Only ops or the owner can change this' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Emails: the owner hears about a new school application; the school's
-- admins hear when it's approved. (Queued; the notifications job sends them.)
create function public.notify_organization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_email text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select contact_email into v_owner_email from public.site_settings where id;
    if v_owner_email is not null then
      insert into public.notifications_log (to_address, template_key, status, organization_id, payload)
        values (v_owner_email, 'school_application', 'queued', new.id, jsonb_build_object('school_name', new.name));
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.notifications_log (to_address, template_key, status, organization_id, payload)
      select u.email, 'school_approved', 'queued', new.id, jsonb_build_object('school_name', new.name)
      from public.user_roles ur join auth.users u on u.id = ur.user_id
      where ur.organization_id = new.id and ur.role = 'school_admin' and u.email is not null;
  end if;
  return new;
end;
$$;
create trigger organizations_notify after insert or update of status on public.organizations
  for each row execute function public.notify_organization_change();

-- Null-safe: a caller with no role in the school gets false, never null (a
-- null inside `if not (…)` would silently skip the permission check).
create or replace function public.is_approved_org_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.org_role(org_id) = 'school_admin', false)
     and exists (select 1 from public.organizations o where o.id = org_id and o.status = 'approved');
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Roster linking: a parent links their child to a school classroom; the
-- school admin approves. Only then does the school see the child's first
-- name, last initial and allergies (never the household, address or payment).
-- ─────────────────────────────────────────────────────────────────────────────
create type public.school_link_status as enum ('pending', 'approved', 'rejected');

alter table public.children
  add column school_link_status public.school_link_status,
  add column school_link_reviewed_at timestamptz,
  add column school_link_reviewed_by uuid references auth.users (id) on delete set null;

-- Children linked before this phase were set up by the business: keep them.
update public.children set school_link_status = 'approved' where school_id is not null;

-- Parents can change the school/classroom, never the approval itself. A new
-- or changed link always starts as pending.
create function public.guard_child_school_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.school_id is null then
    new.classroom_id := null;
    new.school_link_status := null;
    new.school_link_reviewed_at := null;
    new.school_link_reviewed_by := null;
    return new;
  end if;
  if (coalesce(current_setting('app.school_link_review', true), '') = 'on' and public.org_role(new.school_id) = 'school_admin')
     or public.is_ops_or_owner_aal2() then
    return new;
  end if;
  if public.is_trusted_writer() then
    new.school_link_status := coalesce(new.school_link_status, 'pending');
    return new;
  end if;
  if tg_op = 'INSERT' or new.school_id is distinct from old.school_id or new.classroom_id is distinct from old.classroom_id then
    new.school_link_status := 'pending';
    new.school_link_reviewed_at := null;
    new.school_link_reviewed_by := null;
  else
    new.school_link_status := old.school_link_status;
    new.school_link_reviewed_at := old.school_link_reviewed_at;
    new.school_link_reviewed_by := old.school_link_reviewed_by;
  end if;
  return new;
end;
$$;

create trigger children_school_link_guard before insert or update on public.children
  for each row execute function public.guard_child_school_link();

-- The classroom check reads classrooms, which parents can't see under RLS:
-- run it with definer rights (it only compares ids) so parents can link.
-- New links must be to an approved school.
create or replace function public.check_child_classroom()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.classroom_id is not null and not exists (
    select 1 from public.classrooms cl where cl.id = new.classroom_id and cl.organization_id = new.school_id
  ) then
    raise exception 'Classroom must belong to the selected school' using errcode = 'check_violation';
  end if;
  if new.school_id is not null and (tg_op = 'INSERT' or new.school_id is distinct from old.school_id)
     and not public.is_trusted_writer()
     and not exists (select 1 from public.organizations o where o.id = new.school_id and o.status = 'approved') then
    raise exception 'That school isn''t available yet' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Schools no longer read the children table directly (it holds notes and
-- dietary details they don't need). They use school_roster() instead.
create or replace function public.can_view_child(p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.children c
    where c.id = p_child
      and (public.is_household_member(c.household_id) or public.is_ops_or_owner_aal2())
  );
$$;

-- The school's view of linked children. Staff see approved children; the
-- school admin also sees pending requests (without allergies until approved).
create function public.school_roster(p_org uuid)
returns table (
  child_id uuid, first_name text, last_initial text, classroom_id uuid,
  link_status public.school_link_status, allergens text[], requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.first_name, c.last_initial, c.classroom_id, c.school_link_status,
    case when c.school_link_status = 'approved' then coalesce((
      select array_agg(a.name || case when ca.severity = 'severe' then ' (severe)' else '' end order by a.sort_order)
      from public.child_allergens ca join public.allergens a on a.id = ca.allergen_id
      where ca.child_id = c.id), '{}') else '{}' end,
    c.updated_at
  from public.children c
  where c.school_id = p_org and c.archived_at is null
    and p_org in (select public.my_organization_ids())
    and (c.school_link_status = 'approved'
         or (c.school_link_status = 'pending' and public.org_role(p_org) = 'school_admin'))
  order by c.first_name, c.last_initial;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Classroom allergy counts for children who aren't linked (entered by the
-- school), combined with linked children into the classroom summary.
-- ─────────────────────────────────────────────────────────────────────────────
create function public.classroom_org(p_classroom uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.classrooms where id = p_classroom;
$$;

create table public.classroom_allergy_counts (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  allergen_id uuid not null references public.allergens (id) on delete restrict,
  count integer not null check (count between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (classroom_id, allergen_id)
);
alter table public.classroom_allergy_counts enable row level security;
revoke all on public.classroom_allergy_counts from anon;
create policy "Members read their classroom allergy counts" on public.classroom_allergy_counts
  for select to authenticated using (public.classroom_org(classroom_id) in (select public.my_organization_ids()));
create policy "School admins manage allergy counts" on public.classroom_allergy_counts
  for all to authenticated
  using (public.org_role(public.classroom_org(classroom_id)) = 'school_admin')
  with check (public.org_role(public.classroom_org(classroom_id)) = 'school_admin');
create policy "Kitchen, ops and owner read allergy counts (AAL2)" on public.classroom_allergy_counts
  for select to authenticated using (public.is_staff_aal2());
create policy "Ops and owner manage allergy counts (AAL2)" on public.classroom_allergy_counts
  for all to authenticated using (public.is_ops_or_owner_aal2()) with check (public.is_ops_or_owner_aal2());
create trigger classroom_allergy_counts_touch before update on public.classroom_allergy_counts
  for each row execute function public.touch_updated_at();

-- "Room 4: 2 peanut, 1 dairy": linked (approved) children plus manual counts.
create function public.classroom_allergy_summary(p_org uuid)
returns table (classroom_id uuid, allergen_id uuid, allergen_name text, linked_count integer, manual_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with linked as (
    select c.classroom_id, ca.allergen_id, count(*)::integer as n
    from public.children c join public.child_allergens ca on ca.child_id = c.id
    where c.school_id = p_org and c.school_link_status = 'approved' and c.archived_at is null and c.classroom_id is not null
    group by 1, 2
  ), manual as (
    select cac.classroom_id, cac.allergen_id, cac.count as n
    from public.classroom_allergy_counts cac join public.classrooms cl on cl.id = cac.classroom_id
    where cl.organization_id = p_org
  )
  select coalesce(l.classroom_id, m.classroom_id), a.id, a.name, coalesce(l.n, 0), coalesce(m.n, 0)
  from linked l
  full join manual m on m.classroom_id = l.classroom_id and m.allergen_id = l.allergen_id
  join public.allergens a on a.id = coalesce(l.allergen_id, m.allergen_id)
  where p_org in (select public.my_organization_ids()) or public.is_staff_aal2()
  order by 1, a.sort_order;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Standing orders: buffer, per-day items, category rotation
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.standing_orders
  add column buffer_percent smallint not null default 0 check (buffer_percent between 0 and 50),
  -- specific_items: ISO weekday → menu item ids, e.g. {"1": ["…", "…"]}. Each
  -- child gets one of each listed item that day.
  add column day_items jsonb not null default '{}',
  -- category_rotation: [{"category_id": "…", "count": 1}, …] per child per day.
  add column rotation jsonb not null default '[]';

create function public.check_standing_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  r jsonb;
begin
  if new.classroom_id is not null and public.classroom_org(new.classroom_id) is distinct from new.organization_id then
    raise exception 'Classroom must belong to this school' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(new.day_items) <> 'object' then
    raise exception 'Invalid day items' using errcode = 'check_violation';
  end if;
  for k, v in select * from jsonb_each(new.day_items) loop
    if k !~ '^[1-7]$' or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5 then
      raise exception 'Invalid day items' using errcode = 'check_violation';
    end if;
    perform (jsonb_array_elements_text(v))::uuid;
  end loop;
  if jsonb_typeof(new.rotation) <> 'array' or jsonb_array_length(new.rotation) > 6 then
    raise exception 'Invalid category rotation' using errcode = 'check_violation';
  end if;
  for r in select * from jsonb_array_elements(new.rotation) loop
    if (r ->> 'category_id') is null or not exists (select 1 from public.menu_categories where id = (r ->> 'category_id')::uuid)
       or coalesce((r ->> 'count')::integer, 0) not between 1 and 3 then
      raise exception 'Invalid category rotation' using errcode = 'check_violation';
    end if;
  end loop;
  if new.menu_selection_mode = 'category_rotation' and jsonb_array_length(new.rotation) = 0 then
    raise exception 'Pick at least one category for the rotation' using errcode = 'check_violation';
  end if;
  if new.menu_selection_mode = 'specific_items' and new.day_items = '{}'::jsonb then
    raise exception 'Pick items for at least one day' using errcode = 'check_violation';
  end if;
  if not (new.weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]) or cardinality(new.weekdays) = 0 then
    raise exception 'Pick at least one weekday' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger standing_orders_check before insert or update on public.standing_orders
  for each row execute function public.check_standing_order();
create trigger standing_orders_audit after insert or update or delete on public.standing_orders
  for each row execute function public.audit_row_change();

-- Day-level changes for one standing order before cutoff (field trip, swap).
create table public.standing_order_adjustments (
  id uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references public.standing_orders (id) on delete cascade,
  delivery_date date not null,
  -- per_headcount: the day's headcount (the buffer still applies); fixed: the day's meal count.
  headcount integer check (headcount is null or headcount between 0 and 1000),
  skip boolean not null default false,
  -- Replacement items for the day (each child gets one of each).
  items uuid[] check (items is null or cardinality(items) between 1 and 5),
  note text check (char_length(note) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (standing_order_id, delivery_date)
);
alter table public.standing_order_adjustments enable row level security;
revoke all on public.standing_order_adjustments from anon, authenticated;
grant select on public.standing_order_adjustments to authenticated;
create policy "Members read their adjustments" on public.standing_order_adjustments
  for select to authenticated using (exists (
    select 1 from public.standing_orders so where so.id = standing_order_id
      and (so.organization_id in (select public.my_organization_ids()) or public.is_ops_or_owner_aal2())));

-- School calendar: closure days are skipped automatically.
create table public.school_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  closure_date date not null,
  reason text check (char_length(reason) <= 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, closure_date)
);
alter table public.school_closures enable row level security;
revoke all on public.school_closures from anon, authenticated;
grant select on public.school_closures to authenticated;
create policy "Members read their closures" on public.school_closures
  for select to authenticated using (organization_id in (select public.my_organization_ids()) or public.is_staff_aal2());

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders: school links, review flags, allergy-safe lines, invoice links
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.orders
  add column standing_order_id uuid references public.standing_orders (id) on delete set null,
  add column needs_review boolean not null default false,
  add column review_notes text[] not null default '{}',
  add column school_reviewed_at timestamptz,
  add column school_reviewed_by uuid references auth.users (id) on delete set null,
  add column dropoff_location text check (char_length(dropoff_location) <= 200);
create unique index orders_standing_week_uq on public.orders (standing_order_id, menu_week_id)
  where standing_order_id is not null;

alter table public.order_items
  -- Allergens this line is meant to be safe for (allergy-safe alternates).
  add column safe_for_allergens text[] not null default '{}',
  add column invoice_id uuid references public.invoices (id) on delete set null;
create index order_items_invoice_idx on public.order_items (invoice_id);

-- Kitchen view (Phase 8 builds the screens): add the safe-for allergens and
-- the classroom drop-off location so labels and packing lists can show them.
create or replace view public.kitchen_order_lines as
  select
    oi.id as order_item_id,
    o.id as order_id,
    o.order_number,
    o.menu_week_id,
    w.week_start,
    coalesce(oi.delivery_date, o.delivery_date) as delivery_date,
    o.status as order_status,
    o.fulfillment,
    oi.item_name,
    oi.quantity,
    oi.allergens_contained,
    oi.may_contain,
    oi.badges,
    oi.allergy_override_id is not null as has_allergy_override,
    c.first_name as child_first_name,
    c.last_initial as child_last_initial,
    coalesce((
      select array_agg(a.name || case when ca.severity = 'severe' then ' (severe)' else '' end order by a.sort_order)
      from public.child_allergens ca join public.allergens a on a.id = ca.allergen_id
      where ca.child_id = c.id
    ), '{}') as child_allergens,
    c.dietary_preferences as child_dietary_preferences,
    cl.name as classroom_name,
    org.name as organization_name,
    h.name as household_name,
    oi.safe_for_allergens,
    coalesce(o.dropoff_location, cl.dropoff_location) as dropoff_location,
    o.source as order_source
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.menu_weeks w on w.id = o.menu_week_id
  left join public.children c on c.id = oi.child_id
  left join public.classrooms cl on cl.id = coalesce(oi.classroom_id, c.classroom_id)
  left join public.organizations org on org.id = coalesce(o.organization_id, c.school_id)
  left join public.households h on h.id = o.household_id
  where w.status in ('published', 'closed', 'fulfilled')
    and o.status in ('paid', 'invoiced', 'fulfilled')
    and public.has_any_role_aal2(array['kitchen', 'ops', 'owner']::public.app_role[]);

-- ─────────────────────────────────────────────────────────────────────────────
-- Invoices: Stripe details, payment and reminder tracking, line summary
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.invoices
  add column kind text not null default 'monthly' check (kind in ('monthly', 'on_demand')),
  add column number text,
  add column hosted_invoice_url text,
  add column subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  add column tax_cents integer not null default 0 check (tax_cents >= 0),
  add column amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  add column paid_at timestamptz,
  add column paid_out_of_band boolean not null default false,
  add column payment_reference text check (char_length(payment_reference) <= 120),
  add column overdue_flagged_at timestamptz,
  add column reminder_3_at timestamptz,
  add column reminder_7_at timestamptz,
  add column last_error text check (char_length(last_error) <= 500),
  add column created_by uuid references auth.users (id) on delete set null,
  add constraint invoices_total_matches check (total_cents = subtotal_cents + tax_cents);
-- One monthly invoice per school per month (voided ones don't count).
create unique index invoices_monthly_uq on public.invoices (organization_id, period_start)
  where kind = 'monthly' and status <> 'void';
create trigger invoices_audit after insert or update on public.invoices
  for each row execute function public.audit_row_change();

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  classroom_id uuid references public.classrooms (id) on delete set null,
  group_label text not null check (char_length(group_label) between 1 and 200),
  week_start date,
  description text not null check (char_length(description) between 1 and 300),
  quantity integer not null check (quantity >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  stripe_invoice_item_id text,
  sort_order integer not null default 0
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);
alter table public.invoice_lines enable row level security;
revoke all on public.invoice_lines from anon, authenticated;
grant select on public.invoice_lines to authenticated;
create policy "School admins read their invoice lines" on public.invoice_lines
  for select to authenticated using (exists (
    select 1 from public.invoices i where i.id = invoice_id and public.org_role(i.organization_id) = 'school_admin'));
create policy "Ops and owner read invoice lines (AAL2)" on public.invoice_lines
  for select to authenticated using (public.is_ops_or_owner_aal2());

-- ═════════════════════════════════════════════════════════════════════════════
-- Materializing standing orders into weekly orders
-- ═════════════════════════════════════════════════════════════════════════════

-- Allergen / badge snapshot for an order line (CLAUDE.md §4).
create function public._menu_item_snapshot(p_item uuid, out contains text[], out may text[], out badges text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
      join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = p_item and mia.presence = 'contains'), '{}'),
    coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
      join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = p_item and mia.presence = 'may_contain'), '{}'),
    coalesce((select array_agg(b.name order by b.sort_order) from public.menu_item_badges mib
      join public.dietary_badges b on b.id = mib.badge_id where mib.menu_item_id = p_item), '{}');
$$;

-- What a school pays for an item: the school price list when the school has
-- it switched on and the item has a school price; otherwise the week's price.
create function public._school_price(p_org uuid, p_week uuid, p_item uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when o.use_school_pricing and m.school_price_cents is not null then m.school_price_cents
              else coalesce(wi.price_override_cents, m.base_price_cents) end
  from public.organizations o
  cross join public.menu_items m
  left join public.menu_week_items wi on wi.menu_item_id = m.id and wi.menu_week_id = p_week
  where o.id = p_org and m.id = p_item;
$$;

-- School-available items on a week's menu for one slot. No category means
-- "a main" (the Mains category, or any non-snack if it doesn't exist).
create function public._school_candidates(p_week uuid, p_category uuid, p_mains uuid)
returns table (menu_item_id uuid, ord integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, (row_number() over (order by wi.sort_order, m.name) - 1)::integer
  from public.menu_week_items wi
  join public.menu_items m on m.id = wi.menu_item_id
  where wi.menu_week_id = p_week and wi.available_for in ('schools', 'both')
    and m.is_active and m.archived_at is null
    and case when p_category is not null then m.category_id = p_category
             when p_mains is not null then m.category_id = p_mains
             else not m.is_snack end;
$$;

create function public._add_school_line(
  p_order uuid, p_org uuid, p_week uuid, p_classroom uuid, p_child uuid, p_item uuid, p_date date, p_qty integer,
  p_safe_for text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.menu_items;
  snap record;
  v_price integer;
begin
  select * into m from public.menu_items where id = p_item;
  v_price := public._school_price(p_org, p_week, p_item);
  select * into snap from public._menu_item_snapshot(p_item);
  insert into public.order_items (order_id, child_id, classroom_id, menu_item_id, delivery_date, quantity, unit_price_cents,
                                  currency, item_name, allergens_contained, may_contain, badges, safe_for_allergens)
  values (p_order, p_child, p_classroom, p_item, p_date, p_qty, v_price, m.currency, m.name,
          snap.contains, snap.may, snap.badges, coalesce(p_safe_for, '{}'));
  return v_price * p_qty;
end;
$$;

-- A school whose oldest unpaid invoice is too far overdue (owner setting)
-- gets no NEW standing-order weeks until it's paid.
create function public.org_billing_hold(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.school_overdue_suspend_days is not null and exists (
    select 1 from public.invoices i
    where i.organization_id = p_org and i.status = 'open' and i.due_date is not null
      and i.due_date < (now() at time zone s.timezone)::date - s.school_overdue_suspend_days
  ), false)
  from public.site_settings s where s.id;
$$;

-- Turn one standing order into the order for one menu week, or rebuild it.
-- Weeks past cutoff (or unpublished) are locked and never touched. Returns
-- the order id, or null when there's nothing to deliver that week.
--
-- Allergy safety (CLAUDE.md §6): a linked child whose allergies clash with
-- the day's item gets their own line with a safe alternative (labelled with
-- their name); counts the school entered for unlinked children get safe
-- lines per allergen (avoiding "may contain" too). If no safe item exists,
-- those meals are left out and the order is flagged for review. Nobody is
-- ever given an item that clashes.
create function public._materialize_standing_order(p_so uuid, p_week uuid, p_force boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  so public.standing_orders;
  org public.organizations;
  w public.menu_weeks;
  cl public.classrooms;
  v_order public.orders;
  v_dates date[];
  v_date date;
  v_adj public.standing_order_adjustments;
  v_qty integer;
  v_items jsonb;
  v_slots jsonb;
  v_slot jsonb;
  v_cat uuid;
  v_k integer;
  v_mains uuid;
  v_n integer;
  v_start integer;
  v_primary uuid;
  v_alt uuid;
  v_child record;
  v_count record;
  v_take integer;
  v_safe integer;
  v_notes text[] := '{}';
  v_subtotal integer := 0;
  v_day text;
  v_cat_name text;
  v_lines integer;
begin
  select * into so from public.standing_orders where id = p_so for update;
  select * into w from public.menu_weeks where id = p_week;
  if so.id is null or w.id is null or w.status <> 'published' or now() >= public.menu_week_cutoff(w.id) then
    return null;
  end if;
  select * into org from public.organizations where id = so.organization_id;
  select * into cl from public.classrooms where id = so.classroom_id and archived_at is null;
  select * into v_order from public.orders where standing_order_id = so.id and menu_week_id = w.id for update;
  if v_order.id is not null and not p_force then
    return v_order.id;
  end if;

  select coalesce(array_agg(d order by d), '{}') into v_dates
  from unnest(w.delivery_dates) d
  where d >= so.start_date and (so.end_date is null or d <= so.end_date)
    and extract(isodow from d)::smallint = any (so.weekdays)
    and not exists (select 1 from public.school_closures sc where sc.organization_id = so.organization_id and sc.closure_date = d)
    and not exists (select 1 from public.standing_order_adjustments a
                    where a.standing_order_id = so.id and a.delivery_date = d and a.skip);

  if so.status <> 'active' or org.status <> 'approved' or cl.id is null or cardinality(v_dates) = 0
     or ((v_order.id is null or v_order.status = 'cancelled') and public.org_billing_hold(org.id)) then
    if v_order.id is not null and v_order.status <> 'cancelled' then
      delete from public.order_items where order_id = v_order.id;
      update public.orders
        set status = 'cancelled', subtotal_cents = 0, total_cents = 0, needs_review = false, review_notes = '{}'
        where id = v_order.id;
    end if;
    return null;
  end if;

  select id into v_mains from public.menu_categories where slug = 'mains' and is_active;

  if v_order.id is null then
    insert into public.orders (organization_id, menu_week_id, source, status, fulfillment, standing_order_id, placed_at,
                               placed_by, address_snapshot, dropoff_location, notes)
    values (org.id, w.id, 'standing_order', 'invoiced', 'school_dropoff', so.id, now(), so.created_by, org.address,
            cl.dropoff_location, left(so.notes, 1000))
    returning * into v_order;
  else
    delete from public.order_items where order_id = v_order.id;
  end if;

  foreach v_date in array v_dates loop
    v_day := to_char(v_date, 'Dy Mon FMDD');
    select * into v_adj from public.standing_order_adjustments where standing_order_id = so.id and delivery_date = v_date;
    v_qty := case when so.quantity_mode = 'fixed' then coalesce(v_adj.headcount, so.fixed_quantity)
                  else ceil(coalesce(v_adj.headcount, cl.headcount) * (100 + so.buffer_percent) / 100.0)::integer end;
    continue when coalesce(v_qty, 0) <= 0;

    -- What each child gets that day: one entry per slot.
    v_slots := null;
    v_items := case when v_adj.items is not null then to_jsonb(v_adj.items)
                    when so.menu_selection_mode = 'specific_items'
                      then so.day_items -> (extract(isodow from v_date)::integer)::text end;
    if v_items is not null and jsonb_array_length(v_items) > 0 then
      select jsonb_agg(jsonb_build_object('category', m.category_id, 'item', m.id) order by x.ord)
        into v_slots
        from jsonb_array_elements_text(v_items) with ordinality x(id, ord)
        join public.menu_items m on m.id = x.id::uuid;
    elsif so.menu_selection_mode = 'category_rotation' then
      select jsonb_agg(jsonb_build_object('category', r.value ->> 'category_id', 'item', null) order by r.ord)
        into v_slots
        from jsonb_array_elements(so.rotation) with ordinality r(value, ord),
             generate_series(1, (r.value ->> 'count')::integer);
    end if;
    if v_slots is null then
      if so.menu_selection_mode = 'specific_items' then
        v_notes := v_notes || format('%s: no items chosen for this day, so the chef picked', v_day);
      end if;
      v_slots := jsonb_build_array(jsonb_build_object('category', null, 'item', null));
    end if;

    v_k := 0;
    for v_slot in select value from jsonb_array_elements(v_slots) loop
      v_cat := nullif(v_slot ->> 'category', '')::uuid;
      select count(*) into v_n from public._school_candidates(w.id, v_cat, v_mains);
      if v_n = 0 then
        select name into v_cat_name from public.menu_categories where id = coalesce(v_cat, v_mains);
        v_notes := v_notes || format('%s: nothing from %s on this week''s school menu', v_day, coalesce(lower(v_cat_name), 'mains'));
        v_k := v_k + 1;
        continue;
      end if;
      v_start := ((v_date - w.week_start) + v_k) % v_n;

      v_primary := null;
      if (v_slot ->> 'item') is not null then
        select c.menu_item_id into v_primary from public._school_candidates(w.id, v_cat, v_mains) c
          where c.menu_item_id = (v_slot ->> 'item')::uuid;
        if v_primary is null then
          v_notes := v_notes || format('%s: %s isn''t on this week''s school menu, so the chef picked', v_day,
            (select name from public.menu_items where id = (v_slot ->> 'item')::uuid));
        end if;
      end if;
      if v_primary is null then
        select c.menu_item_id into v_primary from public._school_candidates(w.id, v_cat, v_mains) c where c.ord = v_start;
      end if;

      v_safe := 0;
      -- Linked children whose allergies clash with today's item.
      for v_child in
        select ch.id, ch.first_name, ch.last_initial,
               coalesce((select array_agg(a.name order by a.sort_order) from public.child_allergens ca
                 join public.allergens a on a.id = ca.allergen_id where ca.child_id = ch.id), '{}') as allergen_names
        from public.children ch
        where ch.classroom_id = cl.id and ch.school_link_status = 'approved' and ch.archived_at is null
          and public._blocking_allergens(ch.id, v_primary) is not null
        order by ch.first_name, ch.id
      loop
        exit when v_safe >= v_qty;
        v_safe := v_safe + 1;
        select c.menu_item_id into v_alt from public._school_candidates(w.id, v_cat, v_mains) c
          where public._blocking_allergens(v_child.id, c.menu_item_id) is null
          order by (c.ord - v_start + v_n) % v_n limit 1;
        if v_alt is null then
          v_notes := v_notes || format('%s: no safe option for %s %s. (%s); please choose', v_day, v_child.first_name,
            coalesce(v_child.last_initial, ''), array_to_string(v_child.allergen_names, ', '));
        else
          v_subtotal := v_subtotal + public._add_school_line(v_order.id, org.id, w.id, cl.id, v_child.id, v_alt, v_date, 1,
                                                             v_child.allergen_names);
        end if;
      end loop;

      -- Children the school counted but didn't link: safe lines per allergen.
      for v_count in
        select cac.allergen_id, cac.count, a.name
        from public.classroom_allergy_counts cac join public.allergens a on a.id = cac.allergen_id
        where cac.classroom_id = cl.id
          and exists (select 1 from public.menu_item_allergens mia
                      where mia.menu_item_id = v_primary and mia.allergen_id = cac.allergen_id)
        order by a.sort_order
      loop
        exit when v_safe >= v_qty;
        v_take := least(v_count.count, v_qty - v_safe);
        v_safe := v_safe + v_take;
        select c.menu_item_id into v_alt from public._school_candidates(w.id, v_cat, v_mains) c
          where not exists (select 1 from public.menu_item_allergens mia
                            where mia.menu_item_id = c.menu_item_id and mia.allergen_id = v_count.allergen_id)
          order by (c.ord - v_start + v_n) % v_n limit 1;
        if v_alt is null then
          v_notes := v_notes || format('%s: no %s-free option for %s children; please choose', v_day, lower(v_count.name), v_take);
        else
          v_subtotal := v_subtotal + public._add_school_line(v_order.id, org.id, w.id, cl.id, null, v_alt, v_date, v_take,
                                                             array[v_count.name]);
        end if;
      end loop;

      if v_qty - v_safe > 0 then
        v_subtotal := v_subtotal + public._add_school_line(v_order.id, org.id, w.id, cl.id, null, v_primary, v_date,
                                                           v_qty - v_safe, '{}');
      end if;
      v_k := v_k + 1;
    end loop;
  end loop;

  select count(*) into v_lines from public.order_items where order_id = v_order.id;
  update public.orders
    set status = case when v_lines = 0 and cardinality(v_notes) = 0 then 'cancelled'::public.order_status
                      else 'invoiced'::public.order_status end,
        subtotal_cents = v_subtotal, delivery_fee_cents = 0, discount_cents = 0, tax_cents = 0, credit_cents = 0,
        total_cents = v_subtotal,
        needs_review = cardinality(v_notes) > 0, review_notes = v_notes,
        school_reviewed_at = case when cardinality(v_notes) > 0 and review_notes is distinct from v_notes then null
                                  else school_reviewed_at end,
        address_snapshot = org.address, dropoff_location = cl.dropoff_location
    where id = v_order.id;
  return v_order.id;
end;
$$;

-- Rebuild every open (published, before cutoff) week for the matching
-- standing orders. Called by the triggers below whenever an input changes.
create function public._refresh_standing_orders(p_org uuid, p_so uuid, p_classroom uuid, p_week uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select so.id as so_id, w.id as week_id
    from public.standing_orders so
    cross join public.menu_weeks w
    where (p_org is null or so.organization_id = p_org)
      and (p_so is null or so.id = p_so)
      and (p_classroom is null or so.classroom_id = p_classroom)
      and (p_week is null or w.id = p_week)
      and w.status = 'published' and now() < public.menu_week_cutoff(w.id)
      and (so.status = 'active' or exists (select 1 from public.orders o where o.standing_order_id = so.id and o.menu_week_id = w.id))
    order by so.id, w.week_start
  loop
    perform public._materialize_standing_order(r.so_id, r.week_id, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Hourly job: create the orders for newly published weeks (before cutoff)
-- and tell each school's admins once per week: "Review by {cutoff}".
create function public.materialize_standing_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_new integer := 0;
begin
  for r in
    select so.id as so_id, w.id as week_id
    from public.standing_orders so
    join public.organizations o on o.id = so.organization_id and o.status = 'approved'
    cross join public.menu_weeks w
    where so.status = 'active' and w.status = 'published' and now() < public.menu_week_cutoff(w.id)
      and so.start_date <= w.week_start + 6 and (so.end_date is null or so.end_date >= w.week_start)
      and not exists (select 1 from public.orders x where x.standing_order_id = so.id and x.menu_week_id = w.id)
    order by w.week_start, so.id
  loop
    if public._materialize_standing_order(r.so_id, r.week_id, false) is not null then
      v_new := v_new + 1;
    end if;
  end loop;

  insert into public.notifications_log (to_address, template_key, status, organization_id, payload)
  select u.email, 'school_week_ready', 'queued', t.org,
         jsonb_build_object('menu_week_id', t.week, 'week_start', t.week_start, 'cutoff', public.menu_week_cutoff(t.week))
  from (
    select distinct o.organization_id as org, o.menu_week_id as week, w.week_start
    from public.orders o join public.menu_weeks w on w.id = o.menu_week_id
    where o.source = 'standing_order' and o.status <> 'cancelled'
      and w.status = 'published' and now() < public.menu_week_cutoff(w.id)
      and not exists (select 1 from public.notifications_log n
                      where n.template_key = 'school_week_ready' and n.organization_id = o.organization_id
                        and n.payload ->> 'menu_week_id' = o.menu_week_id::text)
  ) t
  join public.user_roles ur on ur.organization_id = t.org and ur.role = 'school_admin'
  join auth.users u on u.id = ur.user_id
  where u.email is not null;
  return v_new;
end;
$$;

-- Ops/owner "re-run" for one school (e.g. after a menu change).
create function public.refresh_school_orders(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_ops_or_owner_aal2() then
    raise exception 'Only ops or the owner can do this' using errcode = 'insufficient_privilege';
  end if;
  return public._refresh_standing_orders(p_org, null, null, null);
end;
$$;

-- ─── Triggers that keep open weeks in sync ──────────────────────────────────
create function public.trg_standing_order_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Open weeks of a deleted standing order are cancelled; delivered weeks stay.
    update public.orders o set status = 'cancelled', subtotal_cents = 0, total_cents = 0, needs_review = false
      from public.menu_weeks w
      where o.standing_order_id = old.id and w.id = o.menu_week_id and w.status = 'published'
        and now() < public.menu_week_cutoff(w.id) and o.status <> 'cancelled';
    delete from public.order_items oi using public.orders o
      where oi.order_id = o.id and o.standing_order_id = old.id and o.status = 'cancelled';
    return old;
  end if;
  perform public._refresh_standing_orders(null, new.id, null, null);
  return new;
end;
$$;
create trigger standing_orders_refresh after insert or update on public.standing_orders
  for each row execute function public.trg_standing_order_refresh();
create trigger standing_orders_cancel_open before delete on public.standing_orders
  for each row execute function public.trg_standing_order_refresh();

create function public.trg_classroom_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'classrooms' then
    if new.headcount is distinct from old.headcount or new.archived_at is distinct from old.archived_at
       or new.dropoff_location is distinct from old.dropoff_location then
      perform public._refresh_standing_orders(null, null, new.id, null);
    end if;
    return new;
  end if;
  -- classroom_allergy_counts
  perform public._refresh_standing_orders(null, null, coalesce(new.classroom_id, old.classroom_id), null);
  return coalesce(new, old);
end;
$$;
create trigger classrooms_refresh after update on public.classrooms
  for each row execute function public.trg_classroom_refresh();
create trigger classroom_allergy_counts_refresh after insert or update or delete on public.classroom_allergy_counts
  for each row execute function public.trg_classroom_refresh();

-- Linked children: approval, a classroom change, or an allergy change
-- re-plans the classroom's open weeks (so safe alternates stay right).
create function public.trg_child_school_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom uuid;
begin
  if tg_table_name = 'children' then
    if new.school_link_status is distinct from old.school_link_status or new.classroom_id is distinct from old.classroom_id
       or new.archived_at is distinct from old.archived_at then
      if old.classroom_id is not null then
        perform public._refresh_standing_orders(null, null, old.classroom_id, null);
      end if;
      if new.classroom_id is not null and new.classroom_id is distinct from old.classroom_id then
        perform public._refresh_standing_orders(null, null, new.classroom_id, null);
      end if;
    end if;
    return new;
  end if;
  select c.classroom_id into v_classroom from public.children c
    where c.id = coalesce(new.child_id, old.child_id) and c.school_link_status = 'approved';
  if v_classroom is not null then
    perform public._refresh_standing_orders(null, null, v_classroom, null);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger children_school_refresh after update on public.children
  for each row execute function public.trg_child_school_refresh();
create trigger child_allergens_school_refresh after insert or update or delete on public.child_allergens
  for each row execute function public.trg_child_school_refresh();

-- Approval, suspension or a price list change re-plans the school's open weeks.
create function public.trg_organization_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status or new.use_school_pricing is distinct from old.use_school_pricing then
    perform public._refresh_standing_orders(new.id, null, null, null);
  end if;
  return new;
end;
$$;
create trigger organizations_refresh after update on public.organizations
  for each row execute function public.trg_organization_refresh();

-- ═════════════════════════════════════════════════════════════════════════════
-- School actions (all check the caller's role and the week's cutoff)
-- ═════════════════════════════════════════════════════════════════════════════
create function public._assert_week_open_for(p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.menu_weeks;
  v_today date := (now() at time zone (select timezone from public.site_settings where id))::date;
begin
  if p_date is null or p_date < v_today then
    raise exception 'Pick a date from today onwards' using errcode = 'check_violation';
  end if;
  select * into w from public.menu_weeks where week_start = p_date - (extract(isodow from p_date)::integer - 1);
  if w.id is not null and w.status in ('published', 'closed', 'fulfilled') and now() >= public.menu_week_cutoff(w.id) then
    raise exception 'Changes for the week of % closed at the cutoff. Contact us if something has changed.',
      to_char(w.week_start, 'Mon FMDD') using errcode = 'check_violation';
  end if;
  return w.id;
end;
$$;

-- Change one day of a standing order: headcount, skip, or swap items.
create function public.set_standing_order_day(
  p_so uuid, p_date date, p_headcount integer, p_skip boolean, p_items uuid[], p_note text, p_clear boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  so public.standing_orders;
  v_week uuid;
  v_item uuid;
begin
  select * into so from public.standing_orders where id = p_so;
  if so.id is null or not (coalesce(public.org_role(so.organization_id) in ('school_admin', 'school_staff'), false)
                           or public.is_ops_or_owner_aal2()) then
    raise exception 'Standing order not found' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.organizations o where o.id = so.organization_id and o.status = 'approved') then
    raise exception 'Your school isn''t approved for ordering yet' using errcode = 'check_violation';
  end if;
  v_week := public._assert_week_open_for(p_date);
  if p_headcount is not null and (p_headcount < 0 or p_headcount > 1000) then
    raise exception 'Headcount must be between 0 and 1000' using errcode = 'check_violation';
  end if;
  if p_items is not null then
    if cardinality(p_items) not between 1 and 5 then
      raise exception 'Pick between one and five items' using errcode = 'check_violation';
    end if;
    foreach v_item in array p_items loop
      if not exists (select 1 from public.menu_items m where m.id = v_item and m.is_active and m.archived_at is null)
         or (v_week is not null and not exists (select 1 from public.menu_week_items wi where wi.menu_week_id = v_week
               and wi.menu_item_id = v_item and wi.available_for in ('schools', 'both'))) then
        raise exception 'That item isn''t on the school menu for that week' using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  if p_clear then
    delete from public.standing_order_adjustments where standing_order_id = so.id and delivery_date = p_date;
  else
    insert into public.standing_order_adjustments (standing_order_id, delivery_date, headcount, skip, items, note, updated_by)
      values (so.id, p_date, p_headcount, coalesce(p_skip, false), p_items, left(p_note, 300), (select auth.uid()))
      on conflict (standing_order_id, delivery_date) do update
        set headcount = excluded.headcount, skip = excluded.skip, items = excluded.items, note = excluded.note,
            updated_by = excluded.updated_by, updated_at = now();
  end if;
  if v_week is null then
    return null;
  end if;
  return public._materialize_standing_order(so.id, v_week, true);
end;
$$;

-- School calendar: closing a day skips it for every standing order.
create function public.set_school_closure(p_org uuid, p_date date, p_reason text, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week uuid;
begin
  if not (public.is_approved_org_admin(p_org) or public.is_ops_or_owner_aal2()) then
    raise exception 'Only your school''s admin can change the calendar' using errcode = 'insufficient_privilege';
  end if;
  v_week := public._assert_week_open_for(p_date);
  if p_closed then
    insert into public.school_closures (organization_id, closure_date, reason, created_by)
      values (p_org, p_date, nullif(left(btrim(p_reason), 120), ''), (select auth.uid()))
      on conflict (organization_id, closure_date) do update set reason = excluded.reason;
  else
    delete from public.school_closures where organization_id = p_org and closure_date = p_date;
  end if;
  if v_week is not null then
    perform public._refresh_standing_orders(p_org, null, null, v_week);
  end if;
end;
$$;

-- "We've checked next week": clears the review prompt on the dashboard.
create function public.mark_school_week_reviewed(p_org uuid, p_week uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not coalesce(public.org_role(p_org) in ('school_admin', 'school_staff'), false) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.orders set school_reviewed_at = now(), school_reviewed_by = (select auth.uid())
    where organization_id = p_org and menu_week_id = p_week and status <> 'cancelled';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- One-off bulk order (events, parties, staff lunches). Invoiced monthly.
-- Items: [{"menu_item_id", "delivery_date", "quantity", "classroom_id"?}]
create function public.create_school_bulk_order(p_org uuid, p_week uuid, p_items jsonb, p_location text, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.menu_weeks;
  org public.organizations;
  v_item jsonb;
  v_order uuid;
  v_qty integer;
  v_date date;
  v_menu uuid;
  v_classroom uuid;
  v_subtotal integer := 0;
begin
  if not (public.is_approved_org_admin(p_org) or public.is_ops_or_owner_aal2()) then
    raise exception 'Only your school''s admin can place bulk orders' using errcode = 'insufficient_privilege';
  end if;
  select * into org from public.organizations where id = p_org;
  if org.status <> 'approved' then
    raise exception 'Your school isn''t approved for ordering yet' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Add between 1 and 50 lines' using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_location), '') is null then
    raise exception 'Tell us where to deliver' using errcode = 'check_violation';
  end if;
  select * into w from public.menu_weeks where id = p_week for update;
  if w.id is null or w.status <> 'published' then
    raise exception 'This week''s menu isn''t open for orders' using errcode = 'check_violation';
  end if;
  if now() >= public.menu_week_cutoff(w.id) then
    raise exception 'Ordering for this week is closed' using errcode = 'check_violation';
  end if;

  insert into public.orders (organization_id, menu_week_id, source, status, fulfillment, placed_at, placed_by,
                             address_snapshot, dropoff_location, notes)
  values (p_org, w.id, 'school_bulk', 'invoiced', 'school_dropoff', now(), (select auth.uid()), org.address,
          left(btrim(p_location), 200), left(p_notes, 1000))
  returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    if v_qty not between 1 and 500 then
      raise exception 'Quantities must be between 1 and 500' using errcode = 'check_violation';
    end if;
    v_date := nullif(v_item ->> 'delivery_date', '')::date;
    if v_date is null or not (v_date = any (w.delivery_dates)) then
      raise exception 'Pick a delivery day from that week' using errcode = 'check_violation';
    end if;
    select wi.menu_item_id into v_menu from public.menu_week_items wi join public.menu_items m on m.id = wi.menu_item_id
      where wi.menu_week_id = w.id and wi.menu_item_id = (v_item ->> 'menu_item_id')::uuid
        and wi.available_for in ('schools', 'both') and m.is_active and m.archived_at is null;
    if v_menu is null then
      raise exception 'That item isn''t on the school menu for that week' using errcode = 'check_violation';
    end if;
    v_classroom := nullif(v_item ->> 'classroom_id', '')::uuid;
    if v_classroom is not null and public.classroom_org(v_classroom) is distinct from p_org then
      raise exception 'Unknown classroom' using errcode = 'check_violation';
    end if;
    v_subtotal := v_subtotal + public._add_school_line(v_order, p_org, w.id, v_classroom, null, v_menu, v_date, v_qty, '{}');
  end loop;

  update public.orders set subtotal_cents = v_subtotal, total_cents = v_subtotal where id = v_order;
  return v_order;
end;
$$;

create function public.cancel_school_bulk_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.source::text <> 'school_bulk'
     or not (public.is_approved_org_admin(o.organization_id) or public.is_ops_or_owner_aal2()) then
    raise exception 'Order not found' using errcode = 'insufficient_privilege';
  end if;
  if o.status <> 'invoiced' or now() >= public.menu_week_cutoff(o.menu_week_id)
     or exists (select 1 from public.order_items where order_id = o.id and invoice_id is not null) then
    raise exception 'This order can''t be cancelled any more' using errcode = 'check_violation';
  end if;
  delete from public.order_items where order_id = o.id;
  update public.orders set status = 'cancelled', subtotal_cents = 0, total_cents = 0 where id = o.id;
end;
$$;

-- School admin approves (or declines) a parent's classroom link.
create function public.review_school_link(p_child uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.children;
begin
  select * into c from public.children where id = p_child for update;
  if c.id is null or c.school_id is null or not public.is_approved_org_admin(c.school_id) then
    raise exception 'Request not found' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.school_link_review', 'on', true);
  update public.children
    set school_link_status = case when p_approve then 'approved'::public.school_link_status else 'rejected'::public.school_link_status end,
        school_link_reviewed_at = now(), school_link_reviewed_by = (select auth.uid())
    where id = c.id;
  perform set_config('app.school_link_review', '', true);
end;
$$;

-- Spend by classroom and month (school billing page).
create function public.school_spend(p_org uuid)
returns table (month date, group_label text, meals bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', oi.delivery_date)::date, coalesce(cl.name, o.dropoff_location, 'Other orders'),
         sum(oi.quantity), sum(oi.quantity * oi.unit_price_cents)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  left join public.classrooms cl on cl.id = oi.classroom_id
  where o.organization_id = p_org and o.status in ('invoiced', 'fulfilled') and oi.delivery_date is not null
    and (public.org_role(p_org) = 'school_admin' or public.is_ops_or_owner_aal2())
  group by 1, 2
  order by 1 desc, 2
  limit 240;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Invoicing (the app creates the Stripe Invoice; these keep the books)
-- ═════════════════════════════════════════════════════════════════════════════

-- Gather a school's uninvoiced lines delivered up to p_period_end into a
-- draft invoice, grouped by classroom and week. Returns the invoice id, or
-- null when there's nothing to bill. A draft that never reached Stripe is
-- returned again so the app can finish it (idempotent retries).
create function public.prepare_school_invoice(p_org uuid, p_period_start date, p_period_end date, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizations;
  s public.site_settings;
  v_inv public.invoices;
  v_sub integer;
  v_count integer;
  v_tax integer := 0;
begin
  if not (public.is_trusted_writer() or public.is_ops_or_owner_aal2()) then
    raise exception 'Only ops or the owner can create invoices' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('monthly', 'on_demand') or p_period_end < p_period_start then
    raise exception 'Invalid invoice period' using errcode = 'check_violation';
  end if;
  select * into org from public.organizations where id = p_org for update;
  if org.id is null then
    raise exception 'Unknown school' using errcode = 'check_violation';
  end if;
  select * into v_inv from public.invoices where organization_id = p_org and status = 'draft' order by created_at limit 1;
  if v_inv.id is not null then
    return v_inv.id;
  end if;
  if p_kind = 'monthly' and exists (select 1 from public.invoices where organization_id = p_org and kind = 'monthly'
                                     and period_start = p_period_start and status <> 'void') then
    return null;
  end if;

  perform 1 from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.organization_id = p_org and o.status in ('invoiced', 'fulfilled') and oi.invoice_id is null
      and oi.delivery_date <= p_period_end
    for update of oi;
  select coalesce(sum(oi.quantity * oi.unit_price_cents), 0), count(*) into v_sub, v_count
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.organization_id = p_org and o.status in ('invoiced', 'fulfilled') and oi.invoice_id is null
      and oi.delivery_date <= p_period_end;
  if v_count = 0 then
    return null;
  end if;

  -- Flat-rate tax from settings, unless the school is exempt. (With Stripe
  -- Tax on, Stripe calculates it on the invoice instead.)
  select * into s from public.site_settings where id;
  if coalesce((s.tax_settings ->> 'enabled')::boolean, false) and not coalesce((s.tax_settings ->> 'use_stripe_tax')::boolean, false)
     and not org.tax_exempt then
    v_tax := round(v_sub * coalesce((s.tax_settings ->> 'rate_bps')::integer, 0) / 10000.0)::integer;
  end if;

  insert into public.invoices (organization_id, period_start, period_end, status, kind, subtotal_cents, tax_cents, total_cents,
                               currency, created_by)
  values (p_org, p_period_start, p_period_end, 'draft', p_kind, v_sub, v_tax, v_sub + v_tax, 'usd', (select auth.uid()))
  returning * into v_inv;

  update public.order_items oi set invoice_id = v_inv.id
    from public.orders o
    where o.id = oi.order_id and o.organization_id = p_org and o.status in ('invoiced', 'fulfilled')
      and oi.invoice_id is null and oi.delivery_date <= p_period_end;

  insert into public.invoice_lines (invoice_id, classroom_id, group_label, week_start, description, quantity, amount_cents, sort_order)
  select v_inv.id, g.classroom_id, g.label, g.week_start,
         format('%s · week of %s · %s meals', g.label, to_char(g.week_start, 'Mon FMDD, YYYY'), g.qty),
         g.qty, g.amount, row_number() over (order by g.label, g.week_start)::integer
  from (
    select oi.classroom_id, coalesce(cl.name, o.dropoff_location, 'Other orders') as label, w.week_start,
           sum(oi.quantity)::integer as qty, sum(oi.quantity * oi.unit_price_cents)::integer as amount
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.menu_weeks w on w.id = o.menu_week_id
    left join public.classrooms cl on cl.id = oi.classroom_id
    where oi.invoice_id = v_inv.id
    group by 1, 2, 3
  ) g;
  if v_tax > 0 then
    insert into public.invoice_lines (invoice_id, group_label, description, quantity, amount_cents, sort_order)
      values (v_inv.id, 'Sales tax', 'Sales tax', 1, v_tax, 100000);
  end if;
  return v_inv.id;
end;
$$;

-- Schools with something to bill up to a date (the monthly job).
create function public.schools_to_invoice(p_period_end date)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct o.organization_id
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.organization_id is not null and o.status in ('invoiced', 'fulfilled') and oi.invoice_id is null
    and oi.delivery_date <= p_period_end
  union
  select organization_id from public.invoices where status = 'draft';
$$;

-- Webhook bookkeeping for school invoices. Out-of-order safe: a late
-- "finalized" never re-opens a paid invoice.
create function public.stripe_school_invoice_event(
  p_stripe_invoice text, p_invoice uuid, p_event text, p_amount_paid integer, p_hosted text, p_pdf text, p_number text,
  p_due date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices
    where (p_stripe_invoice is not null and stripe_invoice_id = p_stripe_invoice) or id = p_invoice
    order by (stripe_invoice_id = p_stripe_invoice) desc nulls last limit 1
    for update;
  if inv.id is null then
    return 'unknown';
  end if;
  update public.invoices set
    stripe_invoice_id = coalesce(stripe_invoice_id, p_stripe_invoice),
    hosted_invoice_url = coalesce(p_hosted, hosted_invoice_url),
    pdf_url = coalesce(p_pdf, pdf_url),
    number = coalesce(p_number, number),
    due_date = coalesce(p_due, due_date)
    where id = inv.id;
  case p_event
    when 'finalized' then
      update public.invoices set status = 'open' where id = inv.id and status = 'draft';
    when 'paid' then
      update public.invoices set status = 'paid', amount_paid_cents = greatest(coalesce(p_amount_paid, total_cents), amount_paid_cents),
        paid_at = coalesce(paid_at, now()) where id = inv.id and status in ('draft', 'open', 'uncollectible');
    when 'voided' then
      update public.invoices set status = 'void' where id = inv.id and status <> 'paid';
      -- Its meals go back into the next invoice.
      update public.order_items set invoice_id = null where invoice_id = inv.id;
    when 'uncollectible' then
      update public.invoices set status = 'uncollectible' where id = inv.id and status = 'open';
    when 'overdue' then
      update public.invoices set overdue_flagged_at = coalesce(overdue_flagged_at, now()) where id = inv.id and status = 'open';
    when 'payment_failed' then
      update public.invoices set last_error = 'A payment attempt failed. The school can try again from the invoice page.'
        where id = inv.id;
    else
      return 'ignored';
  end case;
  return p_event;
end;
$$;

-- Check / PO payments: the owner marks the invoice paid out of band (the app
-- does the same in Stripe). Fresh MFA required (CLAUDE.md §5.5); audited by
-- the invoices trigger and the admin action.
create function public.mark_invoice_paid_out_of_band(p_invoice uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
    raise exception 'Only the owner, with a fresh MFA check, can mark an invoice paid'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reference), '') is null then
    raise exception 'Add the check or PO number' using errcode = 'check_violation';
  end if;
  update public.invoices
    set status = 'paid', paid_out_of_band = true, payment_reference = left(btrim(p_reference), 120),
        amount_paid_cents = total_cents, paid_at = now()
    where id = p_invoice and status in ('open', 'uncollectible');
  if not found then
    raise exception 'Only open invoices can be marked paid' using errcode = 'check_violation';
  end if;
end;
$$;

-- Daily: flag overdue invoices and queue reminders at +3 and +7 days.
create function public.queue_school_invoice_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone (select timezone from public.site_settings where id))::date;
  inv record;
  v_days integer;
  v_email text;
  v_n integer := 0;
begin
  update public.invoices set overdue_flagged_at = now()
    where status = 'open' and due_date < v_today and overdue_flagged_at is null;
  for inv in
    select i.*, o.billing_email, o.name as school_name from public.invoices i join public.organizations o on o.id = i.organization_id
    where i.status = 'open' and i.due_date is not null
      and ((i.due_date + 7 <= v_today and i.reminder_7_at is null) or (i.due_date + 3 <= v_today and i.reminder_3_at is null))
  loop
    v_days := case when inv.due_date + 7 <= v_today then 7 else 3 end;
    v_email := coalesce(inv.billing_email, (
      select u.email from public.user_roles ur join auth.users u on u.id = ur.user_id
      where ur.organization_id = inv.organization_id and ur.role = 'school_admin' and u.email is not null
      order by ur.granted_at limit 1));
    if v_email is not null then
      insert into public.notifications_log (to_address, template_key, status, organization_id, payload)
        values (v_email, 'school_invoice_reminder', 'queued', inv.organization_id,
                jsonb_build_object('invoice_id', inv.id, 'days_overdue', v_today - inv.due_date));
    end if;
    update public.invoices
      set reminder_3_at = coalesce(reminder_3_at, now()),
          reminder_7_at = case when v_days = 7 then now() else reminder_7_at end
      where id = inv.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Accounts receivable aging for /admin/schools.
create function public.ar_aging()
returns table (organization_id uuid, name text, current_cents bigint, days_1_30_cents bigint, days_31_60_cents bigint,
               days_60_plus_cents bigint, total_cents bigint, oldest_due date)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (select (now() at time zone timezone)::date as today from public.site_settings where id)
  select o.id, o.name,
    coalesce(sum(i.total_cents - i.amount_paid_cents) filter (where i.due_date is null or i.due_date >= t.today), 0),
    coalesce(sum(i.total_cents - i.amount_paid_cents) filter (where t.today - i.due_date between 1 and 30), 0),
    coalesce(sum(i.total_cents - i.amount_paid_cents) filter (where t.today - i.due_date between 31 and 60), 0),
    coalesce(sum(i.total_cents - i.amount_paid_cents) filter (where t.today - i.due_date > 60), 0),
    sum(i.total_cents - i.amount_paid_cents),
    min(i.due_date)
  from public.invoices i
  join public.organizations o on o.id = i.organization_id
  cross join t
  where i.status = 'open' and public.is_ops_or_owner_aal2()
  group by o.id, o.name
  order by min(i.due_date) nulls last, o.name;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- School staff list and invites
-- ═════════════════════════════════════════════════════════════════════════════
-- The school admin sees who has access to their school (name and email of
-- their own members only).
create function public.school_members(p_org uuid)
returns table (user_id uuid, role public.app_role, email text, full_name text, granted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select ur.user_id, ur.role, u.email::text, p.full_name, ur.granted_at
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  left join public.profiles p on p.id = ur.user_id
  where ur.organization_id = p_org and coalesce(public.org_role(p_org) = 'school_admin', false)
  order by (ur.role = 'school_admin') desc, ur.granted_at;
$$;

-- Server-side invite helper (service role only): the invite action shows the
-- same message whether or not the email already has an account, so school
-- admins can't use it to probe who is registered.
create function public.find_user_id_for_invite(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Schedules, email templates, privileges
-- ═════════════════════════════════════════════════════════════════════════════
select cron.schedule('materialize-standing-orders', '7 * * * *', $$select public.materialize_standing_orders()$$);
-- 16:05 UTC ≈ 8–9am in Los Angeles.
select cron.schedule('school-invoice-reminders', '5 16 * * *', $$select public.queue_school_invoice_reminders()$$);

-- Owner-editable copy (Admin → Emails). Production gets them from here.
insert into public.email_templates (key, subject, preheader, body_rich) values
  ('school_application', 'New school application: {{school_name}}', 'Review it in the admin portal.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"{{school_name}} just applied for a school account. Approve it and set billing terms here: {{admin_url}}"}]}]}'),
  ('school_approved', 'Welcome to Smart Cookie, {{school_name}}!', 'Your school account is approved.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Great news: {{school_name}} is approved. Add your drop-off details and classrooms, then set up standing orders: {{portal_url}}"}]}]}'),
  ('school_week_ready', 'Orders for the week of {{week_of}} are ready', 'Review them by {{cutoff}}.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Next week''s orders for {{school_name}} are ready. Review headcounts, closures and swaps by {{cutoff}}: {{portal_url}}"}]}]}'),
  ('school_invoice', 'Smart Cookie invoice {{invoice_number}} for {{period}}', 'Your invoice is ready.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Your invoice for {{period}} is ready: {{amount}}, due {{due_date}}. Pay by card or bank transfer (ACH): {{invoice_url}}"}]}]}'),
  ('school_invoice_reminder', 'Reminder: invoice {{invoice_number}} is {{days_overdue}} days overdue', 'Pay by card or bank transfer.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Invoice {{invoice_number}} ({{amount}}) was due on {{due_date}}. You can pay it here by card or bank transfer: {{invoice_url}}. If you''ve already sent a check, thank you, and please ignore this email."}]}]}')
on conflict (key) do nothing;

revoke execute on function
  public.notify_organization_change(), public.guard_child_school_link(), public.check_standing_order(),
  public._menu_item_snapshot(uuid), public._school_price(uuid, uuid, uuid), public._school_candidates(uuid, uuid, uuid),
  public._add_school_line(uuid, uuid, uuid, uuid, uuid, uuid, date, integer, text[]),
  public._materialize_standing_order(uuid, uuid, boolean), public._refresh_standing_orders(uuid, uuid, uuid, uuid),
  public.materialize_standing_orders(), public.trg_standing_order_refresh(), public.trg_classroom_refresh(),
  public.trg_child_school_refresh(), public.trg_organization_refresh(), public._assert_week_open_for(date),
  public.schools_to_invoice(date), public.find_user_id_for_invite(text),
  public.stripe_school_invoice_event(text, uuid, text, integer, text, text, text, date),
  public.queue_school_invoice_reminders()
  from public, anon, authenticated;
revoke execute on function
  public.school_roster(uuid), public.classroom_org(uuid), public.classroom_allergy_summary(uuid), public.org_billing_hold(uuid),
  public.refresh_school_orders(uuid),
  public.set_standing_order_day(uuid, date, integer, boolean, uuid[], text, boolean),
  public.set_school_closure(uuid, date, text, boolean), public.mark_school_week_reviewed(uuid, uuid),
  public.create_school_bulk_order(uuid, uuid, jsonb, text, text), public.cancel_school_bulk_order(uuid),
  public.review_school_link(uuid, boolean), public.school_spend(uuid), public.school_members(uuid),
  public.prepare_school_invoice(uuid, date, date, text), public.mark_invoice_paid_out_of_band(uuid, text), public.ar_aging()
  from public, anon;
grant execute on function
  public.school_roster(uuid), public.classroom_org(uuid), public.classroom_allergy_summary(uuid), public.org_billing_hold(uuid),
  public.refresh_school_orders(uuid),
  public.set_standing_order_day(uuid, date, integer, boolean, uuid[], text, boolean),
  public.set_school_closure(uuid, date, text, boolean), public.mark_school_week_reviewed(uuid, uuid),
  public.create_school_bulk_order(uuid, uuid, jsonb, text, text), public.cancel_school_bulk_order(uuid),
  public.review_school_link(uuid, boolean), public.school_spend(uuid), public.school_members(uuid),
  public.prepare_school_invoice(uuid, date, date, text), public.mark_invoice_paid_out_of_band(uuid, text), public.ar_aging()
  to authenticated;
-- The webhook and scheduled jobs use the service role.
grant execute on function public.schools_to_invoice(date), public.find_user_id_for_invite(text),
  public.stripe_school_invoice_event(text, uuid, text, integer, text, text, text, date),
  public.queue_school_invoice_reminders(), public.materialize_standing_orders(),
  public.prepare_school_invoice(uuid, date, date, text)
  to service_role;
