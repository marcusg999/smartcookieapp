-- Phase 10 QA (pgTAP): time edge cases, enforced in the database.
--  * the default cutoff across DST changes (America/Los_Angeles)
--  * ordering at the exact cutoff second is refused; one second before is fine
--  * a delivery week that spans a month boundary is split across invoices
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
grant execute on all functions in schema pg_temp to authenticated;
create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated;

update public.site_settings set timezone = 'America/Los_Angeles', default_cutoff_days_before = 4, default_cutoff_time = '18:00';

-- ── DST ─────────────────────────────────────────────────────────────────────
insert into public.menu_weeks (week_start, status) values ('2031-11-03', 'draft'), ('2032-03-15', 'draft'), ('2032-03-08', 'draft');
-- Week of Mon 2031-11-03: cutoff Thu Oct 30 18:00 PDT (before the Nov 2 fall-back) = 01:00 UTC.
select is(public.menu_week_cutoff((select id from public.menu_weeks where week_start = '2031-11-03')),
          '2031-10-31T01:00:00Z'::timestamptz, 'cutoff before fall-back keeps PDT (UTC-7)');
-- Week of Mon 2032-03-15: cutoff Thu Mar 11 18:00, before the Mar 14 spring-forward, so PST = 02:00 UTC.
select is(public.menu_week_cutoff((select id from public.menu_weeks where week_start = '2032-03-15')),
          '2032-03-12T02:00:00Z'::timestamptz, 'cutoff before spring-forward is still PST (UTC-8)');
update public.site_settings set default_cutoff_days_before = 1;
-- 2032-03-14 is spring-forward Sunday: 18:00 that evening is PDT.
select is(public.menu_week_cutoff((select id from public.menu_weeks where week_start = '2032-03-15')),
          '2032-03-15T01:00:00Z'::timestamptz, 'a cutoff on spring-forward Sunday evening is PDT');
update public.site_settings set default_cutoff_days_before = 4;

-- ── Exact cutoff second ─────────────────────────────────────────────────────
-- now() is fixed for the whole transaction, so "the cutoff is exactly now"
-- is deterministic here.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', '1b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cutoff@test.local', '', now(), '{}', '{}', now(), now());
insert into fx select 'hh', household_id from public.household_members where user_id = '1b000000-0000-4000-8000-000000000001';
insert into public.addresses (household_id, line1, city, zip, is_default)
  select id, '1 Cutoff Ln', 'Pasadena', '91105', true from fx where k = 'hh';
insert into fx select 'addr', id from public.addresses where household_id = (select id from fx where k = 'hh');
update public.households set onboarded_at = now(), default_address_id = (select id from fx where k = 'addr')
  where id = (select id from fx where k = 'hh');
insert into public.children (household_id, first_name) select id, 'Tick' from fx where k = 'hh';
insert into fx select 'kid', id from public.children where first_name = 'Tick' and household_id = (select id from fx where k = 'hh');
-- A published, open week from the seed, with one of its meals.
insert into fx select 'week', id from public.menu_weeks
  where status = 'published' and (ordering_opens_at is null or ordering_opens_at <= now()) and public.menu_week_cutoff(id) > now()
  order by week_start limit 1;
insert into fx select 'item', menu_item_id from public.menu_week_items where menu_week_id = (select id from fx where k = 'week')
  and capacity is null order by sort_order limit 1;
create temp table args as select jsonb_build_array(jsonb_build_object(
  'child_id', (select id from fx where k = 'kid'), 'menu_item_id', (select id from fx where k = 'item'), 'quantity', 10,
  'delivery_date', (select delivery_dates[1] from public.menu_weeks where id = (select id from fx where k = 'week')))) as items;
grant select on args to authenticated;

update public.menu_weeks set cutoff_at = now() where id = (select id from fx where k = 'week');
select pg_temp.act_as('1b000000-0000-4000-8000-000000000001');
select throws_like($$ select public.place_family_order((select id from fx where k = 'hh'), (select id from fx where k = 'week'),
                        (select items from args), 'delivery', (select id from fx where k = 'addr'), null, true) $$,
  '%clos%', 'an order at the exact cutoff second is refused');
select pg_temp.reset_role();
update public.menu_weeks set cutoff_at = now() + interval '1 second' where id = (select id from fx where k = 'week');
select pg_temp.act_as('1b000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.place_family_order((select id from fx where k = 'hh'), (select id from fx where k = 'week'),
                     (select items from args), 'delivery', (select id from fx where k = 'addr'), null, true) $$,
  'one second before the cutoff, the order goes through');
select pg_temp.reset_role();

-- ── A week spanning a month boundary, invoiced monthly ─────────────────────
insert into public.organizations (name, status) values ('Boundary School', 'approved');
insert into fx select 'org', id from public.organizations where name = 'Boundary School';
insert into public.menu_weeks (week_start, status) values ('2031-11-24', 'fulfilled');
insert into public.orders (organization_id, menu_week_id, status, subtotal_cents, total_cents, fulfillment)
  select (select id from fx where k = 'org'), id, 'invoiced', 1700, 1700, 'school_dropoff' from public.menu_weeks where week_start = '2031-11-24';
insert into fx select 'order', id from public.orders where organization_id = (select id from fx where k = 'org');
insert into public.order_items (order_id, item_name, unit_price_cents, quantity, delivery_date) values
  ((select id from fx where k = 'order'), 'Sun 30 Nov lunch', 500, 2, '2031-11-30'),
  ((select id from fx where k = 'order'), 'Mon 1 Dec lunch', 700, 1, '2031-12-01');

insert into fx select 'nov', public.prepare_school_invoice((select id from fx where k = 'org'), '2031-11-01', '2031-11-30', 'monthly');
select is((select subtotal_cents from public.invoices where id = (select id from fx where k = 'nov')), 1000,
  'November''s invoice has only the November delivery days');
select is((select count(*)::int from public.order_items where invoice_id = (select id from fx where k = 'nov')), 1,
  'the December line is left for December');
update public.invoices set status = 'open' where id = (select id from fx where k = 'nov');
insert into fx select 'dec', public.prepare_school_invoice((select id from fx where k = 'org'), '2031-12-01', '2031-12-31', 'monthly');
select is((select subtotal_cents from public.invoices where id = (select id from fx where k = 'dec')), 700,
  'December''s invoice picks up the rest of the week');
select is((select count(*)::int from public.order_items where order_id = (select id from fx where k = 'order') and invoice_id is null), 0,
  'every line is invoiced exactly once');

select * from finish();
rollback;
