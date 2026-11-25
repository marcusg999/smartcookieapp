-- Phase 10 tests (pgTAP): the security review's database findings stay fixed.
-- SR-01 public views are read-only; SR-02 pilot codes are server-only;
-- every table has RLS; every foreign key has a covering index.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end; $$;
create function pg_temp.act_as_user() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000aa","role":"authenticated","aal":"aal1"}', true);
  perform set_config('role', 'authenticated', true);
end; $$;
create function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into public.content_blocks (key, type, draft_value, published_value, published_at)
  values ('p10.test', 'text', '"draft secret"', '"published"', now());

-- ── Structure ───────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'every public table has row level security enabled');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
             and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update')
                  or has_table_privilege('anon', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'insert')
                  or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'))),
  0, 'no public view is writable by anon or authenticated');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
             and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  0, 'every public view is security_invoker (no security-definer views)');
select is((
  select count(*)::int from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
  where c.contype = 'f' and n.nspname = 'public'
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                    and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey)),
  0, 'every foreign key has a covering index');
select ok(exists (select 1 from pg_index i where i.indrelid = 'public.auth_attempts'::regclass and i.indisprimary),
  'auth_attempts has a primary key');

-- ── Anon ────────────────────────────────────────────────────────────────────
select pg_temp.act_as_anon();
select is((select value from public.content_blocks_public where key = 'p10.test'), '"published"'::jsonb,
  'anon reads published copy through the public view');
select is((select count(*)::int from public.content_blocks_public where value = '"draft secret"'::jsonb), 0,
  'drafts never appear in the public view');
select throws_ok($$ update public.content_blocks_public set value = '"PWNED"' where key = 'p10.test' $$, null, null,
  'anon cannot rewrite published copy through the view (SR-01) (not updatable, and no write grant)');
select throws_ok($$ insert into public.content_blocks_public (key, value) values ('x', '"y"') $$, null, null,
  'anon cannot insert through the view (not updatable, and no write grant)');
select throws_ok($$ update public.pages_public set title = 'PWNED' where slug = 'privacy' $$, null, null,
  'anon cannot rewrite published pages through the view (not updatable, and no write grant)');
select throws_ok($$ update public.site_settings_public set business_name = 'PWNED' where true $$, null, null,
  'anon cannot rewrite site settings through the view (not updatable, and no write grant)');
select ok((select count(*) from public.site_settings_public) = 1, 'anon still reads public settings');
select throws_ok($$ select public.pilot_code_is_valid('ABCD-EFGH-1') $$, '42501', null,
  'anon cannot probe pilot codes through the API (SR-02)');
select throws_ok($$ select * from public.kitchen_order_lines $$, '42501', null, 'anon cannot read the kitchen view');

-- ── Signed-in non-staff ────────────────────────────────────────────────────
select pg_temp.act_as_user();
select throws_ok($$ update public.content_blocks_public set value = '"PWNED"' where key = 'p10.test' $$, null, null,
  'a signed-in parent cannot rewrite copy through the view (not updatable, and no write grant)');
select is((select count(*)::int from public.kitchen_order_lines), 0, 'a parent sees nothing in the kitchen view');
select pg_temp.reset_role();

-- ── SR-04: closing and purging a household after account deletion ──────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated',
          'p10-close@test.local', '', now(), '{}', '{}', now(), now());
create temp table p10 as
  select household_id from public.household_members where user_id = '10000000-0000-4000-8000-0000000000b1';
insert into public.children (household_id, first_name) select household_id, 'Closey' from p10;
insert into public.child_allergens (child_id, allergen_id)
  select c.id, (select id from public.allergens order by sort_order limit 1) from public.children c where c.first_name = 'Closey';
insert into public.addresses (household_id, line1, city, zip) select household_id, '1 Gone St', 'Pasadena', '91105' from p10;

delete from auth.users where id = '10000000-0000-4000-8000-0000000000b1';
select ok((select closed_at is not null from public.households where id = (select household_id from p10)),
  'deleting the last member closes the household');
select ok((select archived_at is not null from public.children where first_name = 'Closey'),
  'its children are archived at once');
select is(public.purge_closed_households(), 0, 'nothing is purged inside the retention period');
select is((select count(*)::int from public.children where first_name = 'Closey'), 1, 'children kept during retention');
update public.households set closed_at = now() - interval '25 months' where id = (select household_id from p10);
select ok(public.purge_closed_households() >= 1, 'after the retention period the household is purged');
select is((select count(*)::int from public.children c join p10 on p10.household_id = c.household_id)
          + (select count(*)::int from public.addresses a join p10 on p10.household_id = a.household_id), 0,
  'children (and their allergies) and addresses are deleted');
select pg_temp.act_as_user();
select throws_ok($$ select public.purge_closed_households() $$, '42501', null, 'only the service role runs the purge');
select pg_temp.reset_role();

select * from finish();
rollback;
