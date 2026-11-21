-- Phase 5 tests (pgTAP): carts, waitlist, onboarding columns, placing,
-- modifying and cancelling orders, subscription allowance, skip, auto-fill
-- and pilot-mode sign-up. Right role can; other roles can't; anon can't.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- ── Helpers (same as phase3) ────────────────────────────────────────────────
create function pg_temp.mk_user(p_id uuid, p_email text, p_meta jsonb default '{}') returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', p_meta, now(), now());
$$;
create function pg_temp.act_as(p_id uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal,
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
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
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────
select pg_temp.mk_user('15000000-0000-4000-8000-000000000001', 'p5a@test.local', '{"full_name":"Ann A"}');
select pg_temp.mk_user('15000000-0000-4000-8000-000000000002', 'p5b@test.local', '{"full_name":"Ben B"}');
select pg_temp.mk_user('15000000-0000-4000-8000-000000000003', 'ops5@test.local');
insert into public.user_roles (user_id, role) values ('15000000-0000-4000-8000-000000000003', 'ops');

create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated, anon;
insert into fx select 'hhA', household_id from public.household_members where user_id = '15000000-0000-4000-8000-000000000001';
insert into fx select 'hhB', household_id from public.household_members where user_id = '15000000-0000-4000-8000-000000000002';

insert into public.delivery_zones (id, name, zip_codes, fee_cents, free_over_cents, min_order_cents) values
  ('d5000000-0000-4000-8000-000000000001', 'Test zone 5', '{99901}', 500, 5000, 1000);
insert into public.addresses (id, household_id, line1, city, zip, is_default)
  select 'ad500000-0000-4000-8000-000000000001', id, '1 Test St', 'Testville', '99901', true from fx where k = 'hhA';
update public.households set default_address_id = 'ad500000-0000-4000-8000-000000000001' where id = (select id from fx where k = 'hhA');

insert into public.children (id, household_id, first_name) select '65000000-0000-4000-8000-000000000001', id, 'Pea' from fx where k = 'hhA';
insert into public.children (id, household_id, first_name) select '65000000-0000-4000-8000-000000000002', id, 'Kit' from fx where k = 'hhA';
insert into public.children (id, household_id, first_name) select '65000000-0000-4000-8000-000000000003', id, 'Bee' from fx where k = 'hhB';
insert into public.child_allergens (child_id, allergen_id)
  select '65000000-0000-4000-8000-000000000001', id from public.allergens where slug = 'peanuts';

insert into public.menu_items (id, name, slug, base_price_cents) values
  ('75000000-0000-4000-8000-000000000001', 'P5 Peanut noodles', 'p5-peanut-noodles', 1000),
  ('75000000-0000-4000-8000-000000000002', 'P5 Rice bowl', 'p5-rice-bowl', 800),
  ('75000000-0000-4000-8000-000000000003', 'P5 Pasta', 'p5-pasta', 900);
insert into public.menu_item_allergens (menu_item_id, allergen_id, presence)
  select '75000000-0000-4000-8000-000000000001', id, 'contains' from public.allergens where slug = 'peanuts';

-- Open week (Monday 2031-01-06) and a week whose cutoff has passed.
insert into public.menu_weeks (id, week_start, delivery_dates, ordering_opens_at, cutoff_at, status) values
  ('85000000-0000-4000-8000-000000000001', date '2031-01-06', '{2031-01-06,2031-01-07}', now() - interval '1 day', now() + interval '3 days', 'published'),
  ('85000000-0000-4000-8000-000000000002', date '2031-01-13', '{2031-01-13}', now() - interval '9 days', now() + interval '10 days', 'published');
insert into public.menu_week_items (menu_week_id, menu_item_id, capacity) values
  ('85000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', null),
  ('85000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000002', 3),
  ('85000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000003', null),
  ('85000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000003', null);

insert into public.discount_codes (code, type, value) values ('P5TEN', 'percent', 10);

-- ═══ Anon ═══════════════════════════════════════════════════════════════════
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.carts $$, '42501', null, 'anon cannot read carts');
select throws_ok($$ insert into public.zone_waitlist (email, zip) values ('x@y.zz', '12345') $$, '42501', null,
  'anon cannot join the waitlist directly');
select throws_ok($$ select public.place_family_order('00000000-0000-4000-8000-000000000000', '85000000-0000-4000-8000-000000000001', '[]') $$,
  '42501', null, 'anon cannot place orders');
select throws_ok($$ select public.cancel_family_order('00000000-0000-4000-8000-000000000000') $$, '42501', null,
  'anon cannot cancel orders');
select throws_ok($$ select * from public.partner_schools() $$, '42501', null, 'anon cannot list partner schools');
select is(public.pilot_code_is_valid('NOPE-NOPE-1'), false, 'anon can check a pilot code (invalid → false)');
select throws_ok($$ select public.auto_fill_week('85000000-0000-4000-8000-000000000001') $$, '42501', null,
  'anon cannot run auto-fill');

-- ═══ Parent A ═══════════════════════════════════════════════════════════════
select pg_temp.act_as('15000000-0000-4000-8000-000000000001');
select lives_ok($$ insert into public.carts (household_id, menu_week_id, lines)
  select id, '85000000-0000-4000-8000-000000000001', '[{"child_id":"65000000-0000-4000-8000-000000000002"}]' from fx where k = 'hhA' $$,
  'parent saves a cart for their household');
select throws_ok($$ insert into public.carts (household_id, menu_week_id) select id, '85000000-0000-4000-8000-000000000001' from fx where k = 'hhB' $$,
  '42501', null, 'parent cannot save a cart for another household');
select lives_ok($$ insert into public.zone_waitlist (household_id, email, zip) select id, 'p5a@test.local', '90210' from fx where k = 'hhA' $$,
  'parent joins the waitlist for their household');
select throws_ok($$ insert into public.zone_waitlist (household_id, email, zip) select id, 'x@test.local', '90210' from fx where k = 'hhB' $$,
  '42501', null, 'parent cannot add another household to the waitlist');
select lives_ok($$ update public.households set onboarded_at = now(), ordering_preference = 'a_la_carte' where id = (select id from fx where k = 'hhA') $$,
  'parent records onboarding on their household');
select is((select count(*)::int from public.zone_for_zip('99901')), 1, 'zone lookup finds a covered ZIP');
select is((select count(*)::int from public.zone_for_zip('90210')), 0, 'zone lookup misses an uncovered ZIP');

-- Placing orders
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-06"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001') $$,
  '23514', null, 'an order without the allergy confirmation is rejected');
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000001","menu_item_id":"75000000-0000-4000-8000-000000000001","delivery_date":"2031-01-06"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true) $$,
  'P0001', null, 'a peanut-allergic child cannot be given a peanut meal');
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-09"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true) $$,
  '23514', null, 'a delivery day outside the week is rejected');
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-06"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', 'NOT-A-CODE', true) $$,
  '23514', null, 'an invalid discount code is rejected');
select lives_ok($$ insert into fx select 'o1', public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-06","quantity":2},
      {"child_id":"65000000-0000-4000-8000-000000000001","menu_item_id":"75000000-0000-4000-8000-000000000002","delivery_date":"2031-01-07"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', 'p5ten', true) $$,
  'parent places an order for two children');
select is((select array[subtotal_cents, delivery_fee_cents, discount_cents, total_cents] from public.orders where id = (select id from fx where k = 'o1')),
  array[2600, 500, 260, 2840], 'subtotal, fee, 10% discount and total are computed server-side');
select is((select status::text from public.orders where id = (select id from fx where k = 'o1')), 'pending_payment', 'new order waits for payment');
select isnt((select allergy_confirmed_at from public.orders where id = (select id from fx where k = 'o1')), null,
  'the allergy confirmation is recorded on the order');
select is((select allergy_confirmed_by from public.orders where id = (select id from fx where k = 'o1')),
  '15000000-0000-4000-8000-000000000001'::uuid, 'and who confirmed it');
select is((select item_name from public.order_items where order_id = (select id from fx where k = 'o1') and child_id = '65000000-0000-4000-8000-000000000001'),
  'P5 Rice bowl', 'order lines snapshot the meal name');

-- Capacity (3 rice bowls; 1 taken)
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000002","delivery_date":"2031-01-06","quantity":3}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true) $$,
  '23514', null, 'capacity is enforced across live orders');

-- Modify: reprices on the same order (free delivery over $50)
select lives_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-06","quantity":6}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true, null, (select id from fx where k = 'o1')) $$,
  'parent modifies the order before cutoff');
select is((select array[subtotal_cents, delivery_fee_cents, total_cents] from public.orders where id = (select id from fx where k = 'o1')),
  array[5400, 0, 5400], 'modified order is re-priced (free delivery over the threshold)');
select is((select count(*)::int from public.order_items where order_id = (select id from fx where k = 'o1')), 1, 'old lines are replaced');

-- Cancel
select lives_ok($$ select public.cancel_family_order((select id from fx where k = 'o1')) $$, 'parent cancels before cutoff');
select is((select status::text from public.orders where id = (select id from fx where k = 'o1')), 'cancelled', 'order is cancelled');
select throws_ok($$ select public.cancel_family_order((select id from fx where k = 'o1')) $$, '23514', null,
  'a cancelled order cannot be cancelled again');

-- ═══ Parent B can't touch A's things ═══════════════════════════════════════
select pg_temp.act_as('15000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.carts), 0, 'another parent cannot see household A carts');
select is((select count(*)::int from public.zone_waitlist), 0, 'another parent cannot see household A waitlist rows');
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-06"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true) $$,
  '42501', null, 'another parent cannot order for household A');
select throws_ok($$ select public.cancel_family_order((select id from fx where k = 'o1')) $$, 'P0002', null,
  'another parent cannot cancel household A orders');
select throws_ok($$ select public.auto_fill_week('85000000-0000-4000-8000-000000000001') $$, '42501', null,
  'a parent cannot run auto-fill');

-- ═══ Ops reads the waitlist; kitchen-style roles don't get carts ═══════════
select pg_temp.act_as('15000000-0000-4000-8000-000000000003', 'aal2');
select is((select count(*)::int from public.zone_waitlist where zip = '90210'), 1, 'ops reads the waitlist (AAL2)');
select is((select count(*)::int from public.carts), 0, 'ops cannot read carts');

-- ═══ Cutoff (server time, bypassing any UI) ════════════════════════════════
select pg_temp.reset_role();
update public.menu_weeks set ordering_opens_at = now() - interval '9 days', cutoff_at = now() - interval '1 minute'
  where id = '85000000-0000-4000-8000-000000000002';
select pg_temp.act_as('15000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000002',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-13"}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true) $$,
  '23514', 'Ordering for this week is closed', 'ordering after the cutoff is rejected by the database');

-- ═══ Subscription allowance: 2 meals per child per week ════════════════════
select pg_temp.reset_role();
insert into public.plans (id, name, slug, meals_per_interval, allowance_unit, price_cents, allow_skip, max_skips_per_month, auto_fill_strategy)
  values ('95000000-0000-4000-8000-000000000001', 'P5 Two', 'p5-two', 2, 'per_child', 2000, true, 1, 'favorites');
with s as (insert into public.subscriptions (household_id, plan_id, status)
  select id, '95000000-0000-4000-8000-000000000001', 'active' from fx where k = 'hhA' returning id)
insert into fx select 'sub', id from s;
select pg_temp.act_as('15000000-0000-4000-8000-000000000001');
select lives_ok($$ insert into fx select 'o2', public.place_family_order((select id from fx where k = 'hhA'), '85000000-0000-4000-8000-000000000001',
    '[{"child_id":"65000000-0000-4000-8000-000000000002","menu_item_id":"75000000-0000-4000-8000-000000000003","delivery_date":"2031-01-06","quantity":3}]',
    'delivery', 'ad500000-0000-4000-8000-000000000001', null, true) $$,
  'subscriber places an order');
select is((select array[subtotal_cents, total_cents] from public.orders where id = (select id from fx where k = 'o2')), array[900, 1400],
  'two meals are included; the third is charged at its menu price, plus delivery');
select is((select source::text from public.orders where id = (select id from fx where k = 'o2')), 'subscription', 'order source is subscription');
select is((select meals_used from public.subscription_allowances where subscription_id = (select id from fx where k = 'sub')), 2,
  'allowance usage is counted');
select throws_ok($$ select public.set_subscription_week_skip((select id from fx where k = 'sub'), '85000000-0000-4000-8000-000000000001', true) $$,
  '23514', null, 'a week with an included order cannot be skipped');
select lives_ok($$ select public.cancel_family_order((select id from fx where k = 'o2')) $$, 'subscriber cancels');
select is((select meals_used from public.subscription_allowances where subscription_id = (select id from fx where k = 'sub')), 0,
  'cancelling releases the allowance');
select lives_ok($$ select public.set_subscription_week_skip((select id from fx where k = 'sub'), '85000000-0000-4000-8000-000000000001', true) $$,
  'subscriber skips the week');
select pg_temp.act_as('15000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.set_subscription_week_skip((select id from fx where k = 'sub'), '85000000-0000-4000-8000-000000000001', false) $$,
  'P0002', null, 'another parent cannot change household A''s subscription');

-- ═══ Auto-fill (system) respects allergies ═════════════════════════════════
select pg_temp.reset_role();
update public.subscription_allowances set skipped = false where subscription_id = (select id from fx where k = 'sub');
insert into public.favorites (household_id, child_id, menu_item_id)
  select id, '65000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001' from fx where k = 'hhA';
select is(public.auto_fill_week('85000000-0000-4000-8000-000000000001'), 1, 'auto-fill creates one order for the household');
select is((select count(*)::int from public.order_items oi join public.orders o on o.id = oi.order_id
           where o.household_id = (select id from fx where k = 'hhA') and o.status <> 'cancelled'
             and oi.child_id = '65000000-0000-4000-8000-000000000001' and oi.menu_item_id = '75000000-0000-4000-8000-000000000001'), 0,
  'auto-fill never picks the peanut favourite for the peanut-allergic child');
select is((select count(*)::int from public.notifications_log where template_key = 'subscription_autofill'
           and household_id = (select id from fx where k = 'hhA')), 1, 'the family is told what was chosen');

-- ═══ Pilot mode sign-up ════════════════════════════════════════════════════
update public.site_settings set pilot_mode = true;
insert into public.pilot_invites (code) values ('P5-PILOT-OK');
select throws_ok($$ select pg_temp.mk_user('15000000-0000-4000-8000-000000000009', 'nocode@test.local') $$,
  '23514', 'PILOT_CODE_INVALID', 'pilot mode: sign-up without a code is refused');
select lives_ok($$ select pg_temp.mk_user('15000000-0000-4000-8000-00000000000a', 'code@test.local', '{"pilot_code":"p5-pilot-ok"}') $$,
  'pilot mode: sign-up with a valid code works');

select * from finish();
rollback;
