-- RLS + identity tests (pgTAP). Run with: pnpm db:test
-- Each policy is proven three ways: the right role can, other roles can't, anon can't.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Users are inserted straight into auth.users; the handle_new_user trigger
-- creates their profile and default role.
create function pg_temp.make_user(p_id uuid, p_email text, p_meta jsonb default '{}')
returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', p_meta, now(), now());
$$;

-- Act as a user with a given AAL. `mfa_age` = seconds since the TOTP step (null = none).
create function pg_temp.act_as(p_id uuid, p_aal text default 'aal1', p_mfa_age integer default null)
returns void language plpgsql as $$
declare
  v_amr jsonb := jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600));
begin
  if p_mfa_age is not null then
    v_amr := jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_mfa_age)) || v_amr;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal, 'amr', v_amr)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Rows affected by a statement, run with the caller's privileges (so RLS applies).
create function pg_temp.rows_affected(q text) returns integer language plpgsql as $$
declare n integer;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.make_user('11111111-1111-1111-1111-111111111111', 'parent-a@example.com', '{"full_name":"Parent A"}');
select pg_temp.make_user('22222222-2222-2222-2222-222222222222', 'parent-b@example.com');
select pg_temp.make_user('33333333-3333-3333-3333-333333333333', 'kitchen@example.com');
select pg_temp.make_user('44444444-4444-4444-4444-444444444444', 'owner@example.com');
-- A user who tries to make themselves owner through user metadata:
select pg_temp.make_user('55555555-5555-5555-5555-555555555555', 'sneaky@example.com',
  '{"account_type":"owner","app_roles":["owner"],"role":"owner"}');
-- A school sign-up:
select pg_temp.make_user('66666666-6666-6666-6666-666666666666', 'school@example.com',
  '{"account_type":"school","organization_name":"Maple Elementary"}');

-- Start from a clean slate for owners (other test runs may have left some).
-- Everything is rolled back at the end.
alter table public.user_roles disable trigger user_roles_protect_last_owner;
delete from public.user_roles where role = 'owner';
alter table public.user_roles enable trigger user_roles_protect_last_owner;

-- Staff roles are granted directly here (as postgres), like the bootstrap script does.
insert into public.user_roles (user_id, role) values
  ('33333333-3333-3333-3333-333333333333', 'kitchen'),
  ('44444444-4444-4444-4444-444444444444', 'owner');

-- ── Sign-up trigger ─────────────────────────────────────────────────────────
select is(
  (select array_agg(role) from public.user_roles where user_id = '11111111-1111-1111-1111-111111111111'),
  array['parent']::public.app_role[], 'new users get the parent role');
select is((select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Parent A',
  'profile is created from sign-up metadata');
select is(
  (select array_agg(role) from public.user_roles where user_id = '55555555-5555-5555-5555-555555555555'),
  array['parent']::public.app_role[], 'user_metadata cannot grant staff roles at sign-up');
select is(
  (select o.status::text from public.organizations o join public.user_roles ur on ur.organization_id = o.id
   where ur.user_id = '66666666-6666-6666-6666-666666666666' and ur.role = 'school_admin'),
  'pending', 'school sign-up creates a pending organization with a school_admin');

-- ── Custom access token hook ───────────────────────────────────────────────
select is(
  public.custom_access_token_hook(jsonb_build_object(
    'user_id', '55555555-5555-5555-5555-555555555555',
    'claims', jsonb_build_object('sub', '55555555-5555-5555-5555-555555555555', 'aal', 'aal1',
      'app_roles', jsonb_build_array('owner'),
      'user_metadata', jsonb_build_object('app_roles', jsonb_build_array('owner'), 'full_name', 'x'))
  )) -> 'claims' -> 'app_roles',
  '["parent"]'::jsonb, 'hook overwrites spoofed app_roles with roles from user_roles');
select ok(
  not ((public.custom_access_token_hook(jsonb_build_object(
    'user_id', '55555555-5555-5555-5555-555555555555',
    'claims', jsonb_build_object('user_metadata', jsonb_build_object('app_roles', jsonb_build_array('owner'))))
  )) -> 'claims' -> 'user_metadata') ? 'app_roles',
  'hook strips role-like keys from user_metadata');
select is(
  public.custom_access_token_hook(jsonb_build_object('user_id', '66666666-6666-6666-6666-666666666666', 'claims', '{}'::jsonb))
    -> 'claims' -> 'org_ids' ->> 0,
  (select organization_id::text from public.user_roles where user_id = '66666666-6666-6666-6666-666666666666'),
  'hook adds org_ids for school users');

-- ── user_roles ─────────────────────────────────────────────────────────────
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.user_roles), 1, 'a parent sees only their own role row');
select is((select count(*)::int from public.user_roles where user_id <> '11111111-1111-1111-1111-111111111111'), 0,
  'a parent cannot read other users'' roles');
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('11111111-1111-1111-1111-111111111111', 'owner') $$,
  '42501', null, 'a parent cannot insert a role for themselves');
select throws_ok(
  $$ select public.grant_role('11111111-1111-1111-1111-111111111111', 'owner') $$,
  '42501', null, 'a parent cannot grant roles via the function');
select throws_ok(
  $$ update public.user_roles set role = 'owner' where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'a parent cannot update their role');

select pg_temp.act_as('44444444-4444-4444-4444-444444444444', 'aal1');
select is((select count(*)::int from public.user_roles where user_id <> '44444444-4444-4444-4444-444444444444'), 0,
  'owner at AAL1 sees only their own roles');
select pg_temp.act_as('44444444-4444-4444-4444-444444444444', 'aal2', 3600);
select ok((select count(*)::int from public.user_roles) >= 6, 'owner at AAL2 sees all roles');
select throws_ok(
  $$ select public.grant_role('22222222-2222-2222-2222-222222222222', 'ops') $$,
  '42501', null, 'owner without a recent MFA step-up cannot grant staff roles');
select pg_temp.act_as('44444444-4444-4444-4444-444444444444', 'aal2', 60);
select lives_ok(
  $$ select public.grant_role('22222222-2222-2222-2222-222222222222', 'ops') $$,
  'owner at AAL2 with a fresh step-up can grant a staff role');
select throws_ok(
  $$ select public.revoke_role('44444444-4444-4444-4444-444444444444', 'owner') $$,
  '23514', 'Cannot remove the last owner', 'the last owner cannot be removed');

select pg_temp.act_as('33333333-3333-3333-3333-333333333333', 'aal2', 60);
select throws_ok(
  $$ select public.grant_role('11111111-1111-1111-1111-111111111111', 'kitchen') $$,
  '42501', null, 'kitchen staff cannot grant roles');

-- ── organizations (an admin table: staff need AAL2) ────────────────────────
select pg_temp.act_as('33333333-3333-3333-3333-333333333333', 'aal1');
select is((select count(*)::int from public.organizations), 0, 'kitchen at AAL1 is denied organizations');
select pg_temp.act_as('33333333-3333-3333-3333-333333333333', 'aal2');
select is((select count(*)::int from public.organizations), 1, 'kitchen at AAL2 can read organizations');
select is(pg_temp.rows_affected($$ update public.organizations set status = 'approved' $$),
  0, 'kitchen cannot approve organizations');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111', 'aal2');
select is((select count(*)::int from public.organizations), 0, 'a parent cannot read organizations');
select pg_temp.act_as('66666666-6666-6666-6666-666666666666');
select is((select count(*)::int from public.organizations), 1, 'a school admin reads their own organization');

-- ── profiles ───────────────────────────────────────────────────────────────
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select is(
  pg_temp.rows_affected($$ update public.profiles set full_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222' $$),
  0, 'a parent cannot update another user''s profile');
select throws_ok(
  $$ update public.profiles set deleted_at = now() where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'users can only update allowed profile columns');
select is((select count(*)::int from public.profiles), 1, 'a parent reads only their own profile');

-- ── audit_log ──────────────────────────────────────────────────────────────
select pg_temp.act_as('11111111-1111-1111-1111-111111111111', 'aal2');
select is((select count(*)::int from public.audit_log), 0, 'a parent cannot read the audit log');
select pg_temp.act_as('44444444-4444-4444-4444-444444444444', 'aal2');
select ok((select count(*)::int from public.audit_log where action = 'user_roles.insert') >= 1,
  'owner at AAL2 reads the audit log, which recorded role changes');
select pg_temp.reset_role();
select throws_ok($$ delete from public.audit_log $$, '42501', 'audit_log is append-only',
  'nobody can delete audit entries, not even postgres');
select throws_ok($$ update public.audit_log set action = 'tampered' $$, '42501', 'audit_log is append-only',
  'nobody can modify audit entries');

-- ── anon ───────────────────────────────────────────────────────────────────
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.user_roles $$, '42501', null, 'anon cannot read user_roles');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');

select * from finish();
rollback;
