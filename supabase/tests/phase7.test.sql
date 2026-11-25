-- Phase 7 tests (pgTAP): standing orders materialize into weekly orders
-- (holiday skipped, headcount changes re-price before cutoff and are locked
-- after), allergy-safe alternates, roster linking with school approval,
-- bulk orders, invoicing totals, and cross-organization isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

create function pg_temp.mk_user(p_id uuid, p_email text, p_meta jsonb default '{}') returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', p_meta, now(), now());
$$;
create function pg_temp.act_as(p_id uuid, p_aal text default 'aal1', p_mfa_age integer default null) returns void language plpgsql as $$
declare v_amr jsonb := '[]'::jsonb;
begin
  if p_mfa_age is not null then
    v_amr := jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_mfa_age));
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal, 'amr', v_amr)::text, true);
  perform set_config('role', 'authenticated', true);
end; $$;
create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end; $$;
create function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;
-- Meals for one standing order on one day (read as postgres).
create function pg_temp.day_qty(p_so uuid, p_date date) returns integer language sql security definer as $$
  select coalesce(sum(oi.quantity), 0)::integer from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.standing_order_id = p_so and oi.delivery_date = p_date;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Users: school A admin + staff, school B admin, a parent, ops, owner, kitchen.
select pg_temp.mk_user('17000000-0000-4000-8000-000000000001', 'sa7@test.local', '{"account_type":"school","organization_name":"School Seven A"}');
select pg_temp.mk_user('17000000-0000-4000-8000-000000000002', 'st7@test.local');
select pg_temp.mk_user('17000000-0000-4000-8000-000000000003', 'sb7@test.local', '{"account_type":"school","organization_name":"School Seven B"}');
select pg_temp.mk_user('17000000-0000-4000-8000-000000000004', 'p7@test.local');
select pg_temp.mk_user('17000000-0000-4000-8000-000000000005', 'ops7@test.local');
select pg_temp.mk_user('17000000-0000-4000-8000-000000000006', 'owner7@test.local');
select pg_temp.mk_user('17000000-0000-4000-8000-000000000007', 'kitchen7@test.local');
insert into public.user_roles (user_id, role) values
  ('17000000-0000-4000-8000-000000000005', 'ops'),
  ('17000000-0000-4000-8000-000000000006', 'owner'),
  ('17000000-0000-4000-8000-000000000007', 'kitchen');

create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated, anon;
insert into fx select 'orgA', id from public.organizations where name = 'School Seven A';
insert into fx select 'orgB', id from public.organizations where name = 'School Seven B';
insert into fx select 'hh', household_id from public.household_members where user_id = '17000000-0000-4000-8000-000000000004';
update public.organizations set status = 'approved', billing_email = 'billing@seven.test' where id in (select id from fx where k in ('orgA', 'orgB'));
insert into public.user_roles (user_id, role, organization_id)
  select '17000000-0000-4000-8000-000000000002', 'school_staff', id from fx where k = 'orgA';
insert into public.classrooms (id, organization_id, name, headcount)
  select '27000000-0000-4000-8000-000000000001', id, 'Room A1', 10 from fx where k = 'orgA';
insert into public.classrooms (id, organization_id, name, headcount)
  select '27000000-0000-4000-8000-000000000002', id, 'Room B1', 12 from fx where k = 'orgB';

-- Menu: two mains (the first contains peanuts), school prices, one open week
-- and one week already past its cutoff.
insert into public.allergens (name, slug, sort_order)
  select v.name, v.slug, 100 + v.ord from (values ('Peanuts', 'peanuts', 1), ('Wheat', 'wheat', 2)) v(name, slug, ord)
  on conflict do nothing;
insert into public.menu_items (id, name, slug, base_price_cents, school_price_cents, category_id) values
  ('37000000-0000-4000-8000-000000000001', 'AAA Peanut Pasta', 'p7-peanut-pasta', 900, 600, (select id from public.menu_categories where slug = 'mains')),
  ('37000000-0000-4000-8000-000000000002', 'BBB Plain Rice', 'p7-plain-rice', 800, 500, (select id from public.menu_categories where slug = 'mains'));
insert into public.menu_item_allergens (menu_item_id, allergen_id, presence)
  select '37000000-0000-4000-8000-000000000001'::uuid, id, 'contains'::public.allergen_presence from public.allergens where slug in ('peanuts', 'wheat')
  union all select '37000000-0000-4000-8000-000000000002', id, 'contains' from public.allergens where slug = 'wheat';
insert into public.menu_weeks (id, week_start, delivery_dates, ordering_opens_at, cutoff_at, status) values
  ('47000000-0000-4000-8000-000000000001', date '2033-01-03', '{2033-01-03,2033-01-04,2033-01-05,2033-01-06,2033-01-07}',
   now() - interval '1 day', now() + interval '3 days', 'published'),
  ('47000000-0000-4000-8000-000000000002', date '2033-01-10', '{2033-01-10,2033-01-11,2033-01-12}',
   now() - interval '2 days', now() - interval '1 hour', 'published');
insert into public.menu_week_items (menu_week_id, menu_item_id, sort_order, available_for)
  select w, i, s, 'both' from (values
    ('47000000-0000-4000-8000-000000000001'::uuid, '37000000-0000-4000-8000-000000000001'::uuid, 0),
    ('47000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000002', 1),
    ('47000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000001', 0)) v(w, i, s);

-- ═══ Standing orders → weekly orders ════════════════════════════════════════
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
insert into public.standing_orders (id, organization_id, classroom_id, name, weekdays, start_date, quantity_mode, buffer_percent,
                                    menu_selection_mode, status)
  select '57000000-0000-4000-8000-000000000001', id, '27000000-0000-4000-8000-000000000001', 'A1 lunch', '{1,2,3}',
         date '2033-01-01', 'per_headcount', 10, 'chefs_choice', 'active' from fx where k = 'orgA';
select pg_temp.reset_role();

select is((select status::text from public.orders where standing_order_id = '57000000-0000-4000-8000-000000000001'
           and menu_week_id = '47000000-0000-4000-8000-000000000001'), 'invoiced',
  'an active standing order materializes an invoiced order for the open week');
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-03'), 11, 'per headcount: 10 children + 10% buffer = 11');
select is((select count(*)::int from public.orders where standing_order_id = '57000000-0000-4000-8000-000000000001'
           and menu_week_id = '47000000-0000-4000-8000-000000000002'), 0, 'a week past its cutoff is never materialized');
select is((select subtotal_cents from public.orders where standing_order_id = '57000000-0000-4000-8000-000000000001'
           and menu_week_id = '47000000-0000-4000-8000-000000000001'),
          11 * 600 + 11 * 500 + 11 * 600, 'priced from the school price list (Mon pasta, Tue rice, Wed pasta)');
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-06'), 0, 'only the chosen weekdays are delivered');

-- Holiday on Tuesday: skipped automatically.
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.set_school_closure((select id from fx where k = 'orgA'), '2033-01-04', 'Staff training', true) $$,
  'school admin marks a closure day');
select pg_temp.reset_role();
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-04'), 0, 'the closure day is skipped');
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-03'), 11, 'other days are unchanged');

-- Headcount change for a day: re-prices before cutoff…
select pg_temp.act_as('17000000-0000-4000-8000-000000000002');
select lives_ok($$ select public.set_standing_order_day('57000000-0000-4000-8000-000000000001', '2033-01-05', 5, false, null, 'Field trip', false) $$,
  'school staff change one day''s headcount');
select pg_temp.reset_role();
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-05'), 6, 'the day''s headcount (5 + 10%) is used');
select is((select total_cents from public.orders where standing_order_id = '57000000-0000-4000-8000-000000000001'
           and menu_week_id = '47000000-0000-4000-8000-000000000001'), 11 * 600 + 6 * 600, 'the order is re-priced');
-- …and is locked after.
select pg_temp.act_as('17000000-0000-4000-8000-000000000002');
select throws_like($$ select public.set_standing_order_day('57000000-0000-4000-8000-000000000001', '2033-01-10', 3, false, null, null, false) $$,
  '%closed at the cutoff%', 'changes after the cutoff are refused');
select throws_like($$ select public.set_school_closure((select id from fx where k = 'orgA'), '2033-01-05', null, true) $$,
  '%calendar%', 'school staff cannot change the calendar');
select throws_ok($$ insert into public.standing_orders (organization_id, classroom_id, name, start_date)
  select id, '27000000-0000-4000-8000-000000000001', 'Nope', date '2033-01-01' from fx where k = 'orgA' $$,
  '42501', null, 'school staff cannot create standing orders');
update public.organizations set billing_email = 'x@x.test' where id = (select id from fx where k = 'orgA');
select is((select billing_email from public.organizations where id = (select id from fx where k = 'orgA')), 'billing@seven.test',
  'school staff cannot change billing settings');
select throws_ok($$ select public.grant_role('17000000-0000-4000-8000-000000000004', 'school_staff', (select id from fx where k = 'orgA')) $$,
  null, null, 'school staff cannot invite users');
select pg_temp.reset_role();

-- Classroom headcount change re-plans open weeks.
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
update public.classrooms set headcount = 20 where id = '27000000-0000-4000-8000-000000000001';
select pg_temp.reset_role();
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-03'), 22, 'a classroom headcount change re-plans the week (20 + 10%)');

-- ═══ Roster linking ═════════════════════════════════════════════════════════
select pg_temp.act_as('17000000-0000-4000-8000-000000000004');
insert into public.children (id, household_id, first_name, last_initial, notes)
  select '67000000-0000-4000-8000-000000000001', id, 'Pia', 'Q', 'Private family note' from fx where k = 'hh';
insert into public.child_allergens (child_id, allergen_id, severity)
  select '67000000-0000-4000-8000-000000000001', id, 'allergy' from public.allergens where slug = 'peanuts' and archived_at is null limit 1;
update public.children set school_id = (select id from fx where k = 'orgA'), classroom_id = '27000000-0000-4000-8000-000000000001',
  school_link_status = 'approved' where id = '67000000-0000-4000-8000-000000000001';
select is((select school_link_status::text from public.children where id = '67000000-0000-4000-8000-000000000001'), 'pending',
  'a parent''s classroom link starts as pending (they cannot approve it themselves)');

select pg_temp.act_as('17000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.school_roster((select id from fx where k = 'orgA'))), 0, 'school staff don''t see pending requests');
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
select is((select allergens from public.school_roster((select id from fx where k = 'orgA'))
           where child_id = '67000000-0000-4000-8000-000000000001'), '{}'::text[],
  'the school admin sees the pending request without allergies');
select pg_temp.act_as('17000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.school_roster((select id from fx where k = 'orgA'))), 0, 'another school sees nothing');
select throws_ok($$ select public.review_school_link('67000000-0000-4000-8000-000000000001', true) $$,
  '42501', null, 'another school cannot approve the link');
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.review_school_link('67000000-0000-4000-8000-000000000001', true) $$, 'the school admin approves the link');
select is((select array_length(allergens, 1) from public.school_roster((select id from fx where k = 'orgA'))
           where child_id = '67000000-0000-4000-8000-000000000001'), 1, 'once approved, the school sees the child''s allergies');
select is((select count(*)::int from public.children where id = '67000000-0000-4000-8000-000000000001'), 0,
  'the school never reads the children table (notes, household) directly');
select pg_temp.reset_role();

-- ═══ Allergy-safe alternates ════════════════════════════════════════════════
select ok(exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                  where o.standing_order_id = '57000000-0000-4000-8000-000000000001' and oi.delivery_date = '2033-01-03'
                    and oi.child_id = '67000000-0000-4000-8000-000000000001' and oi.item_name = 'BBB Plain Rice'
                    and 'Peanuts' = any (oi.safe_for_allergens)),
  'the linked child with a peanut allergy gets a safe alternate, labelled with their name');
select is((select count(*)::int from public.order_items oi join public.orders o on o.id = oi.order_id
           where o.standing_order_id = '57000000-0000-4000-8000-000000000001' and oi.child_id = '67000000-0000-4000-8000-000000000001'
             and 'Peanuts' = any (oi.allergens_contained)), 0, 'the child is never given an item with their allergen');
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-03'), 22, 'alternates replace meals, the total stays the same');

select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
insert into public.classroom_allergy_counts (classroom_id, allergen_id, count)
  select '27000000-0000-4000-8000-000000000001', id, 2 from public.allergens where slug = 'peanuts' and archived_at is null limit 1;
select pg_temp.reset_role();
select is((select sum(oi.quantity)::int from public.order_items oi join public.orders o on o.id = oi.order_id
           where o.standing_order_id = '57000000-0000-4000-8000-000000000001' and oi.delivery_date = '2033-01-03'
             and oi.child_id is null and 'Peanuts' = any (oi.safe_for_allergens)), 2,
  'counts the school entered for unlinked children get peanut-free meals');
select is((select bool_and(not ('Peanuts' = any (oi.allergens_contained))) from public.order_items oi join public.orders o on o.id = oi.order_id
           where o.standing_order_id = '57000000-0000-4000-8000-000000000001' and 'Peanuts' = any (oi.safe_for_allergens)), true,
  'every safe line really is free of the allergen');

-- No safe option at all (both mains contain wheat): meals are left out and the order flagged.
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
insert into public.classroom_allergy_counts (classroom_id, allergen_id, count)
  select '27000000-0000-4000-8000-000000000001', id, 1 from public.allergens where slug = 'wheat' and archived_at is null limit 1;
select pg_temp.reset_role();
select is((select needs_review from public.orders where standing_order_id = '57000000-0000-4000-8000-000000000001'
           and menu_week_id = '47000000-0000-4000-8000-000000000001'), true, 'no safe option flags the order for review');
select is(pg_temp.day_qty('57000000-0000-4000-8000-000000000001', '2033-01-03'), 21, 'and that child''s meal is left out rather than served unsafely');
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
delete from public.classroom_allergy_counts where classroom_id = '27000000-0000-4000-8000-000000000001'
  and allergen_id in (select id from public.allergens where slug = 'wheat');
select pg_temp.reset_role();

-- ═══ One-off bulk orders ════════════════════════════════════════════════════
select pg_temp.act_as('17000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.create_school_bulk_order((select id from fx where k = 'orgA'), '47000000-0000-4000-8000-000000000001',
  '[{"menu_item_id":"37000000-0000-4000-8000-000000000002","delivery_date":"2033-01-06","quantity":15}]', 'Library', null) $$,
  '42501', null, 'school staff cannot place bulk orders');
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
select lives_ok($$ insert into fx select 'bulk', public.create_school_bulk_order((select id from fx where k = 'orgA'),
  '47000000-0000-4000-8000-000000000001',
  '[{"menu_item_id":"37000000-0000-4000-8000-000000000002","delivery_date":"2033-01-06","quantity":15}]', 'Library', 'Staff lunch') $$,
  'the school admin places a bulk order');
select is((select total_cents from public.orders where id = (select id from fx where k = 'bulk')), 15 * 500, 'bulk orders use school pricing');
select pg_temp.reset_role();

-- ═══ Cross-organization isolation ═══════════════════════════════════════════
select pg_temp.act_as('17000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.classrooms where organization_id = (select id from fx where k = 'orgA')), 0,
  'school B cannot read school A''s classrooms');
select is((select count(*)::int from public.orders where organization_id = (select id from fx where k = 'orgA')), 0,
  'school B cannot read school A''s orders');
select is((select count(*)::int from public.standing_orders where organization_id = (select id from fx where k = 'orgA')), 0,
  'school B cannot read school A''s standing orders');
select is((select count(*)::int from public.school_closures where organization_id = (select id from fx where k = 'orgA')), 0,
  'school B cannot read school A''s calendar');
select throws_ok($$ select public.set_standing_order_day('57000000-0000-4000-8000-000000000001', '2033-01-05', 1, false, null, null, false) $$,
  '42501', null, 'school B cannot change school A''s standing order');
select is((select count(*)::int from public.classroom_allergy_summary((select id from fx where k = 'orgA'))), 0,
  'school B cannot read school A''s allergy summary');
select pg_temp.reset_role();

-- ═══ Invoicing ══════════════════════════════════════════════════════════════
select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.prepare_school_invoice((select id from fx where k = 'orgA'), '2033-01-01', '2033-01-31', 'monthly') $$,
  '42501', null, 'a school cannot create its own invoices');
select pg_temp.act_as('17000000-0000-4000-8000-000000000005', 'aal2');
select lives_ok($$ insert into fx select 'inv', public.prepare_school_invoice((select id from fx where k = 'orgA'), '2033-01-01', '2033-01-31', 'monthly') $$,
  'ops prepares the monthly invoice');
select pg_temp.reset_role();
select is((select total_cents from public.invoices where id = (select id from fx where k = 'inv')),
          (select sum(total_cents)::int from public.orders where organization_id = (select id from fx where k = 'orgA') and status = 'invoiced'),
  'invoice total = the sum of the month''s orders');
select is((select sum(amount_cents)::int from public.invoice_lines where invoice_id = (select id from fx where k = 'inv')),
          (select total_cents from public.invoices where id = (select id from fx where k = 'inv')),
  'the classroom × week lines add up to the invoice');
select is(public.prepare_school_invoice((select id from fx where k = 'orgA'), '2033-01-01', '2033-01-31', 'monthly'),
          (select id from fx where k = 'inv'), 'preparing again resumes the same draft (idempotent)');

select pg_temp.act_as('17000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.invoice_lines where invoice_id = (select id from fx where k = 'inv')) > 0, true,
  'the school admin reads their invoice lines');
select pg_temp.act_as('17000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.invoices), 0, 'school staff cannot see invoices');
select pg_temp.act_as('17000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.invoices where organization_id = (select id from fx where k = 'orgA')), 0,
  'school B cannot read school A''s invoices');
select throws_ok($$ select public.stripe_school_invoice_event('in_x', null, 'paid', 1, null, null, null, null) $$,
  '42501', null, 'webhook bookkeeping is service-role only');
select pg_temp.reset_role();

-- Out-of-band (check / PO) payment: owner with a fresh MFA check only.
update public.invoices set status = 'open', due_date = '2033-02-15' where id = (select id from fx where k = 'inv');
select pg_temp.act_as('17000000-0000-4000-8000-000000000005', 'aal2', 30);
select throws_ok($$ select public.mark_invoice_paid_out_of_band((select id from fx where k = 'inv'), 'CHK-1001') $$,
  '42501', null, 'ops cannot mark an invoice paid out of band');
select pg_temp.act_as('17000000-0000-4000-8000-000000000006', 'aal2');
select throws_ok($$ select public.mark_invoice_paid_out_of_band((select id from fx where k = 'inv'), 'CHK-1001') $$,
  '42501', null, 'the owner needs a fresh MFA check');
select pg_temp.act_as('17000000-0000-4000-8000-000000000006', 'aal2', 30);
select lives_ok($$ select public.mark_invoice_paid_out_of_band((select id from fx where k = 'inv'), 'CHK-1001') $$,
  'the owner marks a check payment');
select pg_temp.reset_role();
select is((select status::text || ':' || payment_reference from public.invoices where id = (select id from fx where k = 'inv')),
  'paid:CHK-1001', 'the invoice is paid with its reference');

-- ═══ Pricing switch, billing hold, kitchen and anon ═════════════════════════
select pg_temp.act_as('17000000-0000-4000-8000-000000000005', 'aal2', 30);
select throws_ok($$ update public.organizations set use_school_pricing = false where id = (select id from fx where k = 'orgA') $$,
  '42501', null, 'ops cannot switch off the school price list');
select pg_temp.reset_role();

update public.site_settings set school_overdue_suspend_days = 5;
insert into public.invoices (organization_id, period_start, period_end, status, due_date)
  select id, '2032-11-01', '2032-11-30', 'open', '2000-01-01' from fx where k = 'orgB';
select pg_temp.act_as('17000000-0000-4000-8000-000000000003');
insert into public.standing_orders (id, organization_id, classroom_id, name, start_date, status)
  select '57000000-0000-4000-8000-000000000002', id, '27000000-0000-4000-8000-000000000002', 'B1 lunch', date '2033-01-01', 'active'
  from fx where k = 'orgB';
select pg_temp.reset_role();
select is((select count(*)::int from public.orders where standing_order_id = '57000000-0000-4000-8000-000000000002'), 0,
  'a school past the overdue limit gets no new standing-order weeks');

select pg_temp.act_as('17000000-0000-4000-8000-000000000007', 'aal2');
select ok((select count(*)::int from public.kitchen_order_lines where organization_name = 'School Seven A'
           and 'Peanuts' = any (safe_for_allergens)) > 0, 'the kitchen sees school lines with their allergy-safe labels');

select pg_temp.act_as_anon();
select throws_ok($$ select count(*) from public.classrooms $$, '42501', null, 'anon cannot read classrooms');
select throws_ok($$ select * from public.school_roster((select id from fx where k = 'orgA')) $$, '42501', null,
  'anon cannot read a school roster');
select pg_temp.reset_role();

select * from finish();
rollback;
