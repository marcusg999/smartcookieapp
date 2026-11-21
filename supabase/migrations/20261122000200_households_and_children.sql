-- Phase 3 (2/5): households, members, addresses, allergens, children.
-- Child data minimization (CLAUDE.md §5.11): first name, last initial,
-- optional grade/classroom, allergies, dietary preferences, notes. Nothing else.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  primary_user_id uuid references auth.users (id) on delete set null,
  default_zone_id uuid references public.delivery_zones (id) on delete set null,
  default_address_id uuid, -- FK added below (addresses references households)
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.household_member_role as enum ('owner', 'member');

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.household_member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  line1 text not null check (char_length(line1) between 1 and 200),
  line2 text check (char_length(line2) <= 200),
  city text not null check (char_length(city) between 1 and 100),
  state text not null default 'CA' check (char_length(state) between 2 and 40),
  zip text not null check (zip ~ '^\d{5}(-\d{4})?$'),
  delivery_notes text check (char_length(delivery_notes) <= 500),
  is_default boolean not null default false,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_household_idx on public.addresses (household_id);
create unique index addresses_one_default_idx on public.addresses (household_id) where is_default;
alter table public.households
  add constraint households_default_address_fk foreign key (default_address_id) references public.addresses (id) on delete set null;

-- Owner-editable allergen list, seeded with the US top 9 (CLAUDE.md §6).
create table public.allergens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  is_top9 boolean not null default false,
  icon text check (char_length(icon) <= 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 40),
  last_initial text check (last_initial is null or last_initial ~ '^[A-Za-z]$'),
  school_id uuid references public.organizations (id) on delete set null,
  classroom_id uuid references public.classrooms (id) on delete set null,
  grade text check (char_length(grade) <= 20),
  dietary_preferences text[] not null default '{}',
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index children_household_idx on public.children (household_id);
create index children_school_idx on public.children (school_id) where school_id is not null;

create type public.allergy_severity as enum ('intolerance', 'allergy', 'severe');

create table public.child_allergens (
  child_id uuid not null references public.children (id) on delete cascade,
  allergen_id uuid not null references public.allergens (id) on delete restrict,
  severity public.allergy_severity not null default 'allergy',
  created_at timestamptz not null default now(),
  primary key (child_id, allergen_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────
create function public.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id from public.household_members hm where hm.user_id = (select auth.uid());
$$;

create function public.is_household_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household and hm.user_id = (select auth.uid())
  );
$$;

create function public.is_household_owner(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household and hm.user_id = (select auth.uid()) and hm.role = 'owner'
  );
$$;

-- Can the caller see this child? Household members; school staff only for
-- children enrolled through their school; ops/owner at AAL2 (support).
-- Kitchen staff use the kitchen view instead of direct access.
create function public.can_view_child(p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.children c
    where c.id = p_child
      and (
        public.is_household_member(c.household_id)
        or (c.school_id is not null and c.school_id in (select public.my_organization_ids()))
        or public.is_ops_or_owner_aal2()
      )
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.addresses enable row level security;
alter table public.allergens enable row level security;
alter table public.children enable row level security;
alter table public.child_allergens enable row level security;
revoke all on public.households, public.household_members, public.addresses, public.children, public.child_allergens from anon;

-- households: members read; household owners rename / set defaults. Stripe
-- ids are written only by the server.
revoke update on public.households from authenticated;
grant update (name, default_zone_id, default_address_id) on public.households to authenticated;
create policy "Members read their household" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "Household owners update their household" on public.households
  for update to authenticated using (public.is_household_owner(id)) with check (public.is_household_owner(id));
create policy "Ops and owner read households (AAL2)" on public.households
  for select to authenticated using (public.is_ops_or_owner_aal2());

-- household_members: members see each other; owners remove members.
-- Adding a second parent happens through an invite flow (later phase).
create policy "Members read their household members" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy "Household owners remove members" on public.household_members
  for delete to authenticated using (public.is_household_owner(household_id) and user_id <> (select auth.uid()));
create policy "Ops and owner read members (AAL2)" on public.household_members
  for select to authenticated using (public.is_ops_or_owner_aal2());

-- addresses: household CRUD; ops/owner read (delivery manifests). Kitchen never.
create policy "Members manage their addresses" on public.addresses
  for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Ops and owner read addresses (AAL2)" on public.addresses
  for select to authenticated using (public.is_ops_or_owner_aal2());

-- allergens: public list; owner edits.
create policy "Anyone reads active allergens" on public.allergens
  for select to anon, authenticated using (archived_at is null);
create policy "Staff read archived allergens (AAL2)" on public.allergens
  for select to authenticated using (public.is_staff_aal2());
create policy "Owner manages allergens (AAL2)" on public.allergens
  for all to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2());

-- children
create policy "Viewers read children" on public.children
  for select to authenticated using (public.can_view_child(id));
create policy "Members add children" on public.children
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "Members update children" on public.children
  for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Members delete children" on public.children
  for delete to authenticated using (public.is_household_member(household_id));

-- child_allergens
create policy "Viewers read child allergens" on public.child_allergens
  for select to authenticated using (public.can_view_child(child_id));
create policy "Members manage child allergens" on public.child_allergens
  for all to authenticated
  using (exists (select 1 from public.children c where c.id = child_id and public.is_household_member(c.household_id)))
  with check (exists (select 1 from public.children c where c.id = child_id and public.is_household_member(c.household_id)));

-- A child can only be linked to a school classroom of that same school.
create function public.check_child_classroom()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.classroom_id is not null and not exists (
    select 1 from public.classrooms cl where cl.id = new.classroom_id and cl.organization_id = new.school_id
  ) then
    raise exception 'Classroom must belong to the selected school' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger children_classroom_check before insert or update on public.children
  for each row execute function public.check_child_classroom();

create trigger households_touch before update on public.households for each row execute function public.touch_updated_at();
create trigger addresses_touch before update on public.addresses for each row execute function public.touch_updated_at();
create trigger children_touch before update on public.children for each row execute function public.touch_updated_at();
create trigger allergens_audit after insert or update or delete on public.allergens
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Every parent gets a household at sign-up (extends handle_new_user).
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_org_id uuid;
  v_household uuid;
begin
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

-- Backfill: existing parents without a household get one.
do $$
declare
  r record;
  v_household uuid;
begin
  for r in
    select distinct ur.user_id, p.full_name
    from public.user_roles ur
    left join public.profiles p on p.id = ur.user_id
    where ur.role = 'parent'
      and not exists (select 1 from public.household_members hm where hm.user_id = ur.user_id)
  loop
    insert into public.households (name, primary_user_id)
      values (coalesce(split_part(r.full_name, ' ', 1) || '''s household', 'My household'), r.user_id)
      returning id into v_household;
    insert into public.household_members (household_id, user_id, role) values (v_household, r.user_id, 'owner');
  end loop;
end;
$$;

revoke execute on function public.check_child_classroom() from public, anon, authenticated;
grant execute on function public.my_household_ids(), public.is_household_member(uuid), public.is_household_owner(uuid),
  public.can_view_child(uuid) to authenticated;
