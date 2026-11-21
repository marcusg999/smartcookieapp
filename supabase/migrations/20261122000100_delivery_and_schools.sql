-- Phase 3 (1/5): shared helpers, delivery zones, schools (organizations,
-- classrooms, standing orders, invoices). CLAUDE.md §4 (money in cents with
-- a currency column, timestamptz, soft delete) and §5 (RLS everywhere).

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared helpers
-- ─────────────────────────────────────────────────────────────────────────────
-- True for the service role (Stripe webhooks, server jobs) and for direct
-- database sessions without a JWT (migrations, seed, SQL by an operator).
create function public.is_trusted_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'role'), 'service_role') = 'service_role';
$$;

-- Price-bearing columns (CLAUDE.md §5.5, Phase 3 "price-bearing columns can
-- only be written by owner"): any change to the listed columns needs the
-- owner at AAL2 with an MFA check in the last 5 minutes. Column names are
-- passed as trigger arguments.
create function public.guard_price_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  foreach col in array tg_argv loop
    if tg_op = 'INSERT' or (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
        raise exception 'Only the owner, with a fresh MFA check, can change prices (%)', col
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
  end loop;
  return new;
end;
$$;

create function public.is_ops_or_owner_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]);
$$;

-- Organizations the caller belongs to (any school role).
create function public.my_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ur.organization_id from public.user_roles ur
  where ur.user_id = (select auth.uid()) and ur.organization_id is not null;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Delivery zones
-- ─────────────────────────────────────────────────────────────────────────────
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  zip_codes text[] not null default '{}',
  polygon_geojson jsonb,
  fee_cents integer not null default 0 check (fee_cents >= 0),
  free_over_cents integer check (free_over_cents is null or free_over_cents >= 0),
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  -- ISO weekdays, 1 = Monday … 7 = Sunday, in the business timezone.
  delivery_weekdays smallint[] not null default '{1,2,3,4,5}'
    check (delivery_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  delivery_window_label text check (char_length(delivery_window_label) <= 80),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index delivery_zones_zip_idx on public.delivery_zones using gin (zip_codes);
alter table public.delivery_zones enable row level security;

create policy "Anyone reads active delivery zones" on public.delivery_zones
  for select to anon, authenticated using (is_active and archived_at is null);
create policy "Ops and owner read all zones (AAL2)" on public.delivery_zones
  for select to authenticated using (public.is_ops_or_owner_aal2());
create policy "Ops and owner manage zones (AAL2)" on public.delivery_zones
  for all to authenticated using (public.is_ops_or_owner_aal2()) with check (public.is_ops_or_owner_aal2());

create trigger delivery_zones_price_guard before insert or update on public.delivery_zones
  for each row execute function public.guard_price_columns('fee_cents', 'free_over_cents', 'min_order_cents');
create trigger delivery_zones_touch before update on public.delivery_zones
  for each row execute function public.touch_updated_at();
create trigger delivery_zones_audit after insert or update or delete on public.delivery_zones
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Organizations (extends the Phase 2 table)
-- ─────────────────────────────────────────────────────────────────────────────
create type public.organization_type as enum ('school', 'daycare', 'other');

alter table public.organizations
  add column type public.organization_type not null default 'school',
  add column billing_email text check (billing_email is null or billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column billing_terms_days smallint not null default 30 check (billing_terms_days between 0 and 90),
  add column tax_exempt boolean not null default false,
  add column stripe_customer_id text unique,
  add column address jsonb,
  add column dropoff_instructions text check (char_length(dropoff_instructions) <= 1000),
  add column contact_phone text check (char_length(contact_phone) <= 32);

-- Ops/owner may edit operational fields; Stripe ids are set by the server.
grant update (type, billing_email, billing_terms_days, tax_exempt, address, dropoff_instructions, contact_phone)
  on public.organizations to authenticated;

-- School admins maintain their own school's contact and drop-off details.
create policy "School admins update their organization" on public.organizations
  for update to authenticated
  using (public.org_role(id) = 'school_admin')
  with check (public.org_role(id) = 'school_admin');

-- Status changes (approval) stay ops/owner only, whatever column grants allow.
create function public.guard_organization_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_writer() or public.is_ops_or_owner_aal2() then
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
create trigger organizations_status_guard before update on public.organizations
  for each row execute function public.guard_organization_status();

-- Readable membership list. Membership itself lives in user_roles (Phase 2),
-- so there is one source of truth for "who belongs to which school".
create view public.organization_members
with (security_invoker = true) as
  select ur.organization_id, ur.user_id, ur.role, ur.granted_at
  from public.user_roles ur
  where ur.organization_id is not null;
grant select on public.organization_members to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Classrooms
-- ─────────────────────────────────────────────────────────────────────────────
create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  teacher_name text check (char_length(teacher_name) <= 80),
  grade text check (char_length(grade) <= 20),
  headcount integer not null default 0 check (headcount between 0 and 1000),
  dropoff_location text check (char_length(dropoff_location) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index classrooms_org_idx on public.classrooms (organization_id);
alter table public.classrooms enable row level security;
revoke all on public.classrooms from anon;

create policy "Members read their classrooms" on public.classrooms
  for select to authenticated using (organization_id in (select public.my_organization_ids()));
create policy "School admins manage their classrooms" on public.classrooms
  for all to authenticated
  using (public.org_role(organization_id) = 'school_admin')
  with check (public.org_role(organization_id) = 'school_admin');
create policy "Ops and owner manage classrooms (AAL2)" on public.classrooms
  for all to authenticated using (public.is_ops_or_owner_aal2()) with check (public.is_ops_or_owner_aal2());
create trigger classrooms_touch before update on public.classrooms
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Standing orders (schools)
-- ─────────────────────────────────────────────────────────────────────────────
create type public.standing_order_status as enum ('draft', 'active', 'paused', 'ended');
create type public.quantity_mode as enum ('per_headcount', 'fixed');
create type public.menu_selection_mode as enum ('chefs_choice', 'specific_items', 'category_rotation');

create table public.standing_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  classroom_id uuid references public.classrooms (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  weekdays smallint[] not null default '{1,2,3,4,5}' check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  status public.standing_order_status not null default 'draft',
  quantity_mode public.quantity_mode not null default 'per_headcount',
  fixed_quantity integer check (fixed_quantity is null or fixed_quantity between 1 and 1000),
  menu_selection_mode public.menu_selection_mode not null default 'chefs_choice',
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint standing_orders_fixed_qty check (quantity_mode <> 'fixed' or fixed_quantity is not null)
);
create index standing_orders_org_idx on public.standing_orders (organization_id);
alter table public.standing_orders enable row level security;
revoke all on public.standing_orders from anon;

-- Only approved schools can create or change standing orders.
create function public.is_approved_org_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.org_role(org_id) = 'school_admin'
     and exists (select 1 from public.organizations o where o.id = org_id and o.status = 'approved');
$$;

create policy "Members read their standing orders" on public.standing_orders
  for select to authenticated using (organization_id in (select public.my_organization_ids()));
create policy "Approved school admins manage standing orders" on public.standing_orders
  for all to authenticated
  using (public.is_approved_org_admin(organization_id))
  with check (public.is_approved_org_admin(organization_id));
create policy "Ops and owner manage standing orders (AAL2)" on public.standing_orders
  for all to authenticated using (public.is_ops_or_owner_aal2()) with check (public.is_ops_or_owner_aal2());
create trigger standing_orders_touch before update on public.standing_orders
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Invoices (schools; created from Stripe Invoicing by the server)
-- ─────────────────────────────────────────────────────────────────────────────
create type public.invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  stripe_invoice_id text unique,
  status public.invoice_status not null default 'draft',
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  pdf_url text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_org_idx on public.invoices (organization_id, period_start desc);
alter table public.invoices enable row level security;
revoke all on public.invoices from anon;

create policy "School admins read their invoices" on public.invoices
  for select to authenticated using (public.org_role(organization_id) = 'school_admin');
create policy "Ops and owner read invoices (AAL2)" on public.invoices
  for select to authenticated using (public.is_ops_or_owner_aal2());
-- No write policies: invoices are written by the Stripe webhook (service role).
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

-- Function privileges for this migration.
revoke execute on function public.guard_price_columns(), public.guard_organization_status()
  from public, anon, authenticated;
-- Called inside invoker-rights triggers, so authenticated must be able to run
-- it; it only ever answers "no" for them.
revoke execute on function public.is_trusted_writer() from public, anon;
grant execute on function public.is_trusted_writer() to authenticated;
grant execute on function public.is_ops_or_owner_aal2(), public.my_organization_ids(), public.is_approved_org_admin(uuid)
  to authenticated;
