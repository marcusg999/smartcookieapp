-- Phase 10 pilot tooling (pgTAP): invites, pilot households, feedback RLS,
-- server-side funnel events and the owner's pilot metrics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.mk_user(p_id uuid, p_email text, p_code text default null) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}',
          case when p_code is null then '{}'::jsonb else jsonb_build_object('pilot_code', p_code) end, now(), now());
$$;
create function pg_temp.act_as(p_id uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end; $$;
create function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table fx (k text primary key, v text);
grant select, insert on fx to authenticated;

-- Owner (AAL2) creates invites.
select pg_temp.mk_user('1a000000-0000-4000-8000-000000000001', 'owner-p10@test.local');
insert into public.user_roles (user_id, role) values ('1a000000-0000-4000-8000-000000000001', 'owner');
select pg_temp.act_as('1a000000-0000-4000-8000-000000000001', 'aal2');
insert into fx values ('code', public.create_pilot_invite('founding@test.local', 'Priya'));
select matches((select v from fx where k = 'code'), '^SC-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$', 'invite codes are readable and unambiguous');
select pg_temp.reset_role();
select is((select count(*)::int from public.notifications_log where template_key = 'pilot_invite' and to_address = 'founding@test.local'), 1,
  'an emailed invite queues the invitation');

select pg_temp.act_as('1a000000-0000-4000-8000-000000000001', 'aal1');
select throws_ok($$ select public.create_pilot_invite(null, null) $$, '42501', null, 'creating invites needs the owner at AAL2');
select throws_ok($$ select public.pilot_metrics() $$, '42501', null, 'pilot metrics need AAL2');
select pg_temp.reset_role();

-- A family signs up with the code during pilot mode → pilot household.
update public.site_settings set pilot_mode = true;
select pg_temp.mk_user('1a000000-0000-4000-8000-000000000002', 'founding@test.local', (select v from fx where k = 'code'));
update public.site_settings set pilot_mode = false;
insert into fx select 'hh', household_id::text from public.household_members where user_id = '1a000000-0000-4000-8000-000000000002';
select ok((select is_pilot from public.households where id = (select v::uuid from fx where k = 'hh')), 'signing up with an invite makes a pilot household');
select pg_temp.mk_user('1a000000-0000-4000-8000-000000000003', 'regular-p10@test.local');
insert into fx select 'hh2', household_id::text from public.household_members where user_id = '1a000000-0000-4000-8000-000000000003';
select ok(not (select is_pilot from public.households where id = (select v::uuid from fx where k = 'hh2')), 'other families are not in the pilot');

-- Feedback: pilot families only, own rows only.
select pg_temp.act_as('1a000000-0000-4000-8000-000000000002');
select ok(public.is_pilot_user(), 'the pilot parent is a pilot user');
select lives_ok($$ insert into public.feedback (household_id, kind, rating, comment, page_path)
                   values ((select v::uuid from fx where k = 'hh'), 'weekly', 4, 'Easy!', '/order') $$,
  'a pilot family can rate the week');
select lives_ok($$ insert into public.feedback (household_id, kind, comment, page_path)
                   values ((select v::uuid from fx where k = 'hh'), 'confusing', 'Where is checkout?', '/order') $$,
  'a pilot family can report something confusing');
select throws_ok($$ insert into public.feedback (household_id, kind, comment, page_path)
                    values ((select v::uuid from fx where k = 'hh2'), 'confusing', 'x', '/order') $$, '42501', null,
  'feedback can''t be filed against another household');
update public.feedback set resolved_at = now();
select is((select count(*)::int from public.feedback where resolved_at is not null), 0, 'families can''t resolve feedback (RLS matches nothing)');
select pg_temp.act_as('1a000000-0000-4000-8000-000000000003');
select throws_ok($$ insert into public.feedback (household_id, kind, rating, page_path)
                    values ((select v::uuid from fx where k = 'hh2'), 'weekly', 5, '/order') $$, '42501', null,
  'non-pilot families can''t send pilot feedback');
select is((select count(*)::int from public.feedback), 0, 'families only see their own feedback');
select is((select count(*)::int from public.funnel_events), 0, 'families can''t read funnel events');
select pg_temp.reset_role();

-- Funnel: starting a cart, then placing an order, records time-to-order.
insert into public.carts (household_id, menu_week_id) values ((select v::uuid from fx where k = 'hh'), (select id from public.menu_weeks limit 1));
update public.funnel_events set occurred_at = now() - interval '45 seconds' where household_id = (select v::uuid from fx where k = 'hh');
select is((select count(*)::int from public.funnel_events where household_id = (select v::uuid from fx where k = 'hh') and event = 'order_started'), 1,
  'starting a cart records order_started');
insert into public.orders (household_id, menu_week_id, status, subtotal_cents, total_cents)
  values ((select v::uuid from fx where k = 'hh'), (select id from public.menu_weeks limit 1), 'pending_payment', 1000, 1000);
select ok((select duration_seconds between 40 and 120 and not is_repeat from public.funnel_events
           where household_id = (select v::uuid from fx where k = 'hh') and event = 'order_placed'),
  'placing the order records the time it took (first order)');

-- Owner metrics.
select pg_temp.act_as('1a000000-0000-4000-8000-000000000001', 'aal2');
select ok((public.pilot_metrics() ->> 'families')::int >= 1, 'metrics count pilot families');
select is((public.pilot_metrics() -> 'funnel' ->> 'placed')::int >= 1, true, 'metrics include the checkout funnel');
select pg_temp.reset_role();

select * from finish();
rollback;
