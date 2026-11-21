-- Phase 2: identity, roles, organizations and the append-only audit log.
-- CLAUDE.md §2 (roles) and §5.1, 5.3, 5.4, 5.6 (RLS, roles table, AAL2, audit).
--
-- Conventions used throughout:
--  * Every table has RLS enabled in this migration, with explicit policies.
--  * `anon` gets no access to any table here.
--  * Role checks read `public.user_roles` (never the JWT alone), so a stale
--    token can't keep privileges that were revoked.
--  * Admin access additionally requires `aal = 'aal2'` in the JWT (MFA).
--  * Privileged writes go through `security definer` functions with
--    `search_path = ''`, which do their own authorization checks.

-- ─────────────────────────────────────────────────────────────────────────────
-- Types
-- ─────────────────────────────────────────────────────────────────────────────
create type public.app_role as enum ('parent', 'school_admin', 'school_staff', 'kitchen', 'ops', 'owner');
create type public.organization_status as enum ('pending', 'approved', 'rejected', 'suspended');

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  status public.organization_status not null default 'pending',
  created_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
comment on table public.organizations is 'Schools. Created pending; an owner/ops user approves before any school ordering.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.profiles is 'One row per auth user (parents, school users, staff). Never children.';

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  -- School roles belong to exactly one organization; all other roles to none.
  constraint user_roles_org_scope check (
    (role in ('school_admin', 'school_staff')) = (organization_id is not null)
  ),
  constraint user_roles_unique unique nulls not distinct (user_id, role, organization_id)
);
create index user_roles_user_id_idx on public.user_roles (user_id);
create index user_roles_org_idx on public.user_roles (organization_id) where organization_id is not null;
comment on table public.user_roles is 'Source of truth for roles. Not user-editable; changed only via grant_role/revoke_role.';

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_roles public.app_role[] not null default '{}',
  action text not null check (char_length(action) between 3 and 80),
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  changes jsonb,
  ip inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  metadata jsonb not null default '{}'
);
create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
comment on table public.audit_log is 'Append-only. No update/delete for anyone (trigger-enforced, even for service_role).';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS on (before any policy is defined, so nothing is ever exposed)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.organizations, public.profiles, public.user_roles, public.audit_log from anon, public;
revoke all on public.organizations, public.profiles, public.user_roles, public.audit_log from authenticated;
grant select on public.organizations, public.profiles, public.user_roles, public.audit_log to authenticated;
-- Users may edit only these profile columns (RLS restricts which row).
grant update (full_name, phone) on public.profiles to authenticated;
-- Owner/ops approve schools: status + review columns only.
grant update (status, reviewed_by, reviewed_at, name) on public.organizations to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper functions (security definer, empty search_path, fully qualified)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

create function public.has_role(check_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role = check_role
  );
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role in ('kitchen', 'ops', 'owner')
  );
$$;

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('owner');
$$;

-- The caller's role in an organization (school_admin wins over school_staff), or null.
create function public.org_role(org_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select ur.role from public.user_roles ur
  where ur.user_id = (select auth.uid()) and ur.organization_id = org_id
  order by (ur.role = 'school_admin') desc
  limit 1;
$$;

-- True if the JWT shows an MFA verification within the last `max_age_seconds`
-- (step-up re-authentication, CLAUDE.md §5.5). `amr` is newest-first.
create function public.has_recent_mfa(max_age_seconds integer default 300)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) as entry
    where entry ->> 'method' in ('totp', 'mfa/totp', 'recovery_code', 'webauthn', 'mfa/webauthn')
      and (entry ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - max_age_seconds
  );
$$;

-- Admin gate used by policies: staff role (re-checked in the table) + MFA.
create function public.is_staff_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_aal2() and public.is_staff();
$$;

create function public.is_owner_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_aal2() and public.is_owner();
$$;

create function public.has_any_role_aal2(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_aal2() and exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role = any (roles)
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log: writer function + immutability
-- ─────────────────────────────────────────────────────────────────────────────
create function public.jsonb_diff(old_row jsonb, new_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, jsonb_build_object('from', old_row -> key, 'to', new_row -> key)), '{}'::jsonb)
  from (
    select key from jsonb_object_keys(coalesce(old_row, '{}'::jsonb)) as key
    union
    select key from jsonb_object_keys(coalesce(new_row, '{}'::jsonb)) as key
  ) keys
  where (old_row -> key) is distinct from (new_row -> key);
$$;

-- The only way to write audit entries from application code. The actor is
-- always the caller (auth.uid()); it can't be spoofed. Server code that runs
-- without a user session (e.g. failed sign-in) calls this with the service
-- role, which records actor_id = null and puts context in `metadata`.
create function public.log_audit_event(
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb,
  p_ip inet default null,
  p_user_agent text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id bigint;
begin
  insert into public.audit_log (actor_id, actor_roles, action, entity_type, entity_id, before, after, changes, ip, user_agent, metadata)
  values (
    v_actor,
    coalesce((select array_agg(distinct ur.role) from public.user_roles ur where ur.user_id = v_actor), '{}'),
    p_action,
    p_entity_type,
    p_entity_id,
    p_before,
    p_after,
    case when p_before is not null or p_after is not null then public.jsonb_diff(p_before, p_after) end,
    p_ip,
    left(p_user_agent, 512),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.prevent_audit_log_mutation();

-- Generic row-change auditing for sensitive tables (fires for every writer,
-- including the service role and SQL run by hand).
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  perform public.log_audit_event(
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    v_before,
    v_after,
    jsonb_build_object('source', 'trigger', 'db_role', current_user)
  );
  return coalesce(new, old);
end;
$$;

create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();
create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Invariants
-- ─────────────────────────────────────────────────────────────────────────────
-- At least one owner must always exist (CLAUDE.md §2).
create function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id) then
    if not exists (select 1 from public.user_roles where role = 'owner' and id <> old.id) then
      raise exception 'Cannot remove the last owner' using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger user_roles_protect_last_owner before update or delete on public.user_roles
  for each row execute function public.protect_last_owner();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- New user bootstrap (trigger on auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates the profile and the default role. `raw_user_meta_data` is
-- user-controlled, so it can only ever choose between `parent` and a
-- `school_admin` of a brand-new *pending* organization. It can never grant a
-- staff role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_org_name text := nullif(btrim(left(v_meta ->> 'organization_name', 120)), '');
  v_org_id uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(btrim(left(coalesce(v_meta ->> 'full_name', v_meta ->> 'name'), 120)), ''));

  if v_meta ->> 'account_type' = 'school' and v_org_name is not null and char_length(v_org_name) >= 2 then
    insert into public.organizations (name, created_by) values (v_org_name, new.id) returning id into v_org_id;
    insert into public.user_roles (user_id, role, organization_id) values (new.id, 'school_admin', v_org_id);
  else
    insert into public.user_roles (user_id, role) values (new.id, 'parent');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- Custom Access Token Hook (CLAUDE.md §5.3)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds `app_roles` and `org_ids` to every access token, read from
-- public.user_roles only. Anything a user put in user_metadata (including a
-- fake "app_roles") is overwritten, so claims can't be spoofed. RLS still
-- re-checks user_roles for anything sensitive.
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid := (event ->> 'user_id')::uuid;
  v_roles jsonb;
  v_orgs jsonb;
begin
  select coalesce(jsonb_agg(distinct ur.role::text), '[]'::jsonb) into v_roles
  from public.user_roles ur where ur.user_id = v_user;

  select coalesce(jsonb_agg(distinct ur.organization_id), '[]'::jsonb) into v_orgs
  from public.user_roles ur where ur.user_id = v_user and ur.organization_id is not null;

  v_claims := jsonb_set(v_claims, '{app_roles}', v_roles);
  v_claims := jsonb_set(v_claims, '{org_ids}', v_orgs);
  -- Defense in depth: never let user-editable metadata carry role-like keys.
  if v_claims ? 'user_metadata' then
    v_claims := jsonb_set(v_claims, '{user_metadata}', (v_claims -> 'user_metadata') - 'app_roles' - 'org_ids' - 'role' - 'roles');
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;
create policy "Auth server reads roles for the token hook" on public.user_roles
  as permissive for select to supabase_auth_admin using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Role management (the ONLY write path to user_roles for app users)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.assert_can_manage_role(p_role public.app_role, p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_role in ('owner', 'ops', 'kitchen') then
    -- Staff roles: owner only, at AAL2, with a fresh MFA step-up (§5.5).
    if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
      raise exception 'Not allowed' using errcode = 'insufficient_privilege';
    end if;
  elsif p_role = 'school_staff' then
    -- A school admin of an approved organization may manage its staff.
    if not (
      public.is_owner_aal2()
      or (
        public.org_role(p_org) = 'school_admin'
        and exists (select 1 from public.organizations o where o.id = p_org and o.status = 'approved')
      )
    ) then
      raise exception 'Not allowed' using errcode = 'insufficient_privilege';
    end if;
  else
    -- parent / school_admin: owner only.
    if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
      raise exception 'Not allowed' using errcode = 'insufficient_privilege';
    end if;
  end if;
end;
$$;

create function public.grant_role(p_user uuid, p_role public.app_role, p_org uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_can_manage_role(p_role, p_org);
  insert into public.user_roles (user_id, role, organization_id, granted_by)
  values (p_user, p_role, p_org, (select auth.uid()))
  on conflict on constraint user_roles_unique do nothing;
end;
$$;

create function public.revoke_role(p_user uuid, p_role public.app_role, p_org uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_can_manage_role(p_role, p_org);
  delete from public.user_roles
  where user_id = p_user and role = p_role and organization_id is not distinct from p_org;
end;
$$;

-- Lets a signed-in user (e.g. after Google sign-up as a school) request a
-- pending organization. One pending/active school per user.
create function public.request_school_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := nullif(btrim(left(p_name, 120)), '');
  v_org uuid;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'Organization name is required' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.user_roles where user_id = v_user and role = 'school_admin') then
    raise exception 'You already manage a school' using errcode = 'unique_violation';
  end if;
  insert into public.organizations (name, created_by) values (v_name, v_user) returning id into v_org;
  insert into public.user_roles (user_id, role, organization_id) values (v_user, 'school_admin', v_org);
  return v_org;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Session helpers
-- ─────────────────────────────────────────────────────────────────────────────
-- The caller's own active sessions (for the account security page).
create function public.my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, aal text, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at, s.updated_at, s.user_agent, host(s.ip), s.aal::text,
         s.id::text = (select auth.jwt() ->> 'session_id')
  from auth.sessions s
  where s.user_id = (select auth.uid())
  order by s.updated_at desc nulls last;
$$;

-- Owner view of staff: roles, last sign-in, MFA status. AAL2 required.
create function public.admin_list_staff()
returns table (user_id uuid, email text, roles public.app_role[], last_sign_in_at timestamptz, mfa_enrolled boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner_aal2() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.email::text, array_agg(distinct ur.role order by ur.role), u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
           u.created_at
    from auth.users u
    join public.user_roles ur on ur.user_id = u.id and ur.role in ('kitchen', 'ops', 'owner')
    group by u.id
    order by u.email;
end;
$$;

-- Force sign-out: deletes the user's sessions so refresh tokens stop working.
-- (Existing access tokens expire within jwt_expiry.) Owner + step-up only.
create function public.admin_revoke_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  perform public.log_audit_event('staff.sessions_revoked', 'user', p_user::text, null, null, jsonb_build_object('sessions', v_count));
  return v_count;
end;
$$;

-- Failed-attempt tracking for lockout/backoff (password and MFA). Keyed by a
-- hash, never the raw email. Written only by the server (service role).
create table public.auth_attempts (
  key text not null,
  kind text not null check (kind in ('password', 'mfa')),
  attempted_at timestamptz not null default now()
);
create index auth_attempts_lookup_idx on public.auth_attempts (key, kind, attempted_at desc);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated, public;
-- No policies: only the service role (which bypasses RLS) can touch it.

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies
-- ─────────────────────────────────────────────────────────────────────────────
-- profiles
create policy "Users read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Ops and owner read profiles (AAL2)" on public.profiles
  for select to authenticated using (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]));
create policy "Users update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()));

-- user_roles
create policy "Users read their own roles" on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner reads all roles (AAL2)" on public.user_roles
  for select to authenticated using (public.is_owner_aal2());
create policy "School admins read roles in their organization" on public.user_roles
  for select to authenticated using (organization_id is not null and public.org_role(organization_id) = 'school_admin');
-- No insert/update/delete policies: writes only via grant_role/revoke_role.

-- organizations
create policy "Members read their organization" on public.organizations
  for select to authenticated using (public.org_role(id) is not null);
create policy "Staff read organizations (AAL2)" on public.organizations
  for select to authenticated using (public.is_staff_aal2());
create policy "Owner and ops review organizations (AAL2)" on public.organizations
  for update to authenticated
  using (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]))
  with check (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]));

-- audit_log
create policy "Owner reads the audit log (AAL2)" on public.audit_log
  for select to authenticated using (public.is_owner_aal2());
-- No insert policy (log_audit_event is security definer), no update/delete ever.

-- ─────────────────────────────────────────────────────────────────────────────
-- Function privileges: deny by default, then grant what the app calls.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_aal2(),
  public.has_role(public.app_role),
  public.is_staff(),
  public.is_owner(),
  public.org_role(uuid),
  public.has_recent_mfa(integer),
  public.is_staff_aal2(),
  public.is_owner_aal2(),
  public.has_any_role_aal2(public.app_role[]),
  public.log_audit_event(text, text, text, jsonb, jsonb, jsonb, inet, text),
  public.grant_role(uuid, public.app_role, uuid),
  public.revoke_role(uuid, public.app_role, uuid),
  public.request_school_organization(text),
  public.my_sessions(),
  public.admin_list_staff(),
  public.admin_revoke_sessions(uuid)
to authenticated;
-- Internal helpers stay unreachable from the API.
revoke execute on function
  public.custom_access_token_hook(jsonb),
  public.handle_new_user(),
  public.audit_row_change(),
  public.protect_last_owner(),
  public.prevent_audit_log_mutation(),
  public.touch_updated_at(),
  public.assert_can_manage_role(public.app_role, uuid),
  public.jsonb_diff(jsonb, jsonb)
from authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Future functions in public are not executable by anon/authenticated unless granted.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
