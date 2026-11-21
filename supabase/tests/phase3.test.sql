-- Phase 3 RLS tests (pgTAP). Self-contained fixtures; everything rolls back.
-- For each area: the right role can, other roles can't, anon can't.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.mk_user(p_id uuid, p_email text, p_meta jsonb default '{}') returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', p_meta, now(), now());
$$;
create function pg_temp.act_as(p_id uuid, p_aal text default 'aal1', p_mfa_age integer default null) returns void language plpgsql as $$
declare v_amr jsonb := jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600));
begin
  if p_mfa_age is not null then
    v_amr := jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_mfa_age)) || v_amr;
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
create function pg_temp.rows_affected(q text) returns integer language plpgsql as $$
declare n integer; begin execute q; get diagnostics n = row_count; return n; end; $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- Users. Parents get a household from the sign-up trigger.
select pg_temp.mk_user('10000000-0000-4000-8000-000000000001', 'pa@test.local', '{"full_name":"Pat A"}');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000002', 'pb@test.local', '{"full_name":"Bo B"}');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000003', 'sa@test.local', '{"account_type":"school","organization_name":"Test School"}');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000004', 'ss@test.local');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000005', 'k@test.local');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000006', 'ops@test.local');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000007', 'own@test.local');
select pg_temp.mk_user('10000000-0000-4000-8000-000000000008', 'sa2@test.local', '{"account_type":"school","organization_name":"Other School"}');
insert into public.user_roles (user_id, role) values
  ('10000000-0000-4000-8000-000000000005', 'kitchen'),
  ('10000000-0000-4000-8000-000000000006', 'ops'),
  ('10000000-0000-4000-8000-000000000007', 'owner');
update public.organizations set status = 'approved' where name in ('Test School', 'Other School');
insert into public.user_roles (user_id, role, organization_id)
  select '10000000-0000-4000-8000-000000000004', 'school_staff', id from public.organizations where name = 'Test School';

create temp table fx (k text primary key, id uuid) on commit drop;
grant all on fx to authenticated, anon;
insert into fx select 'org', id from public.organizations where name = 'Test School';
insert into fx select 'org2', id from public.organizations where name = 'Other School';
insert into fx select 'hhA', household_id from public.household_members where user_id = '10000000-0000-4000-8000-000000000001';
insert into fx select 'hhB', household_id from public.household_members where user_id = '10000000-0000-4000-8000-000000000002';

insert into public.classrooms (id, organization_id, name, headcount)
  select '20000000-0000-4000-8000-000000000001', id, 'Room T', 20 from fx where k = 'org';
insert into public.classrooms (id, organization_id, name, headcount)
  select '20000000-0000-4000-8000-000000000002', id, 'Room O', 20 from fx where k = 'org2';

insert into public.allergens (id, name, slug, is_top9) values ('30000000-0000-4000-8000-000000000001', 'Testnut', 'testnut', false);
insert into public.delivery_zones (id, name, zip_codes, fee_cents, min_order_cents) values
  ('40000000-0000-4000-8000-000000000001', 'Test zone', '{99999}', 500, 0);
insert into public.addresses (id, household_id, line1, city, zip, is_default)
  select '50000000-0000-4000-8000-000000000001', id, '1 Test St', 'Testville', '99999', true from fx where k = 'hhA';
insert into public.addresses (id, household_id, line1, city, zip, is_default)
  select '50000000-0000-4000-8000-000000000002', id, '2 Other St', 'Testville', '99999', true from fx where k = 'hhB';

insert into public.children (id, household_id, first_name, last_initial, school_id, classroom_id)
  select '60000000-0000-4000-8000-000000000001', (select id from fx where k = 'hhA'), 'Ann', 'A',
         (select id from fx where k = 'org'), '20000000-0000-4000-8000-000000000001';
insert into public.children (id, household_id, first_name) select '60000000-0000-4000-8000-000000000002', id, 'Abe' from fx where k = 'hhA';
insert into public.children (id, household_id, first_name) select '60000000-0000-4000-8000-000000000003', id, 'Bea' from fx where k = 'hhB';
insert into public.child_allergens (child_id, allergen_id, severity) values
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'allergy');

insert into public.menu_items (id, name, slug, base_price_cents) values
  ('70000000-0000-4000-8000-000000000001', 'Nutty bowl', 'test-nutty-bowl', 900),
  ('70000000-0000-4000-8000-000000000002', 'Safe bowl', 'test-safe-bowl', 800);
insert into public.menu_items (id, name, slug, base_price_cents, is_active) values
  ('70000000-0000-4000-8000-000000000003', 'Hidden bowl', 'test-hidden-bowl', 800, false);
insert into public.menu_item_allergens (menu_item_id, allergen_id, presence) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'contains');

-- Published week far in the future with an explicit open window; and a draft week.
insert into public.menu_weeks (id, week_start, delivery_dates, ordering_opens_at, cutoff_at, status) values
  ('80000000-0000-4000-8000-000000000001', date '2030-01-07', '{2030-01-07,2030-01-08}', now() - interval '1 day', now() + interval '7 days', 'published'),
  ('80000000-0000-4000-8000-000000000002', date '2030-01-14', '{}', null, null, 'draft');
insert into public.menu_week_items (menu_week_id, menu_item_id) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002');
insert into public.menu_templates (id, name) values ('90000000-0000-4000-8000-000000000001', 'Internal template');

insert into public.plans (id, name, slug, meals_per_interval, price_cents) values
  ('a1000000-0000-4000-8000-000000000001', 'Test plan', 'test-plan', 3, 2500);
insert into public.plans (id, name, slug, meals_per_interval, price_cents, is_active) values
  ('a1000000-0000-4000-8000-000000000002', 'Retired plan', 'test-retired', 3, 2500, false);

insert into public.content_blocks (key, type, draft_value, published_value) values
  ('test.block', 'text', '"SECRET DRAFT"', '"Published copy"');
insert into public.stripe_events (event_id, type, payload) values ('evt_test_1', 'test', '{}');

-- A paid order for household A (as the webhook would leave it).
insert into public.orders (id, household_id, menu_week_id, status, subtotal_cents, total_cents, address_snapshot)
  select 'b1000000-0000-4000-8000-000000000001', id, '80000000-0000-4000-8000-000000000001', 'paid', 800, 800,
         '{"line1":"1 Test St","zip":"99999"}' from fx where k = 'hhA';
insert into public.order_items (order_id, child_id, menu_item_id, quantity, unit_price_cents, item_name, allergens_contained)
  values ('b1000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
          '70000000-0000-4000-8000-000000000002', 1, 800, 'Safe bowl', '{}');

-- ═══ Anon ═══════════════════════════════════════════════════════════════════
select pg_temp.act_as_anon();
select is((select count(*)::int from public.menu_weeks where week_start >= '2030-01-01'), 1, 'anon sees the published week, not the draft');
select ok(not exists (select 1 from public.menu_items where slug = 'test-hidden-bowl'), 'anon cannot see inactive menu items');
select is((select count(*)::int from public.menu_week_items where menu_week_id = '80000000-0000-4000-8000-000000000001'), 2,
  'anon reads items of a published week');
select ok(exists (select 1 from public.plans where slug = 'test-plan') and not exists (select 1 from public.plans where slug = 'test-retired'),
  'anon sees active plans only');
select throws_ok($$ select * from public.children $$, '42501', null, 'anon cannot read children');
select throws_ok($$ select * from public.orders $$, '42501', null, 'anon cannot read orders');
select throws_ok($$ select * from public.addresses $$, '42501', null, 'anon cannot read addresses');
select throws_ok($$ select * from public.site_settings $$, '42501', null, 'anon cannot read raw site settings');
select is((select business_name from public.site_settings_public), 'Smart Cookie', 'anon reads the public settings view');
select is((select value from public.content_blocks_public where key = 'test.block'), '"Published copy"'::jsonb,
  'anon reads only the published content value');
select throws_ok($$ select * from public.content_blocks $$, '42501', null, 'anon cannot read drafts');
select throws_ok($$ select * from public.menu_templates $$, '42501', null, 'anon cannot read menu templates');
select throws_ok($$ select * from public.kitchen_order_lines $$, '42501', null, 'anon cannot read the kitchen view');

-- ═══ Parent A ═══════════════════════════════════════════════════════════════
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.children), 2, 'parent reads only their own children');
select lives_ok($$ insert into public.children (household_id, first_name) select id, 'Ace' from fx where k = 'hhA' $$,
  'parent adds a child to their household');
select throws_ok($$ insert into public.children (household_id, first_name) select id, 'Evil' from fx where k = 'hhB' $$,
  '42501', null, 'parent cannot add a child to another household');
select is((select count(*)::int from public.addresses), 1, 'parent reads only their own address');
select throws_ok($$ insert into public.orders (household_id, menu_week_id) select id, '80000000-0000-4000-8000-000000000001' from fx where k = 'hhA' $$,
  '42501', null, 'parent cannot insert orders directly');
select throws_ok(
  $$ select public.create_family_order((select id from fx where k = 'hhA'), '80000000-0000-4000-8000-000000000001',
       '[{"child_id":"60000000-0000-4000-8000-000000000001","menu_item_id":"70000000-0000-4000-8000-000000000001"}]',
       'delivery', '50000000-0000-4000-8000-000000000001') $$,
  'P0001', null, 'ordering a meal with a matching allergen is blocked');
select lives_ok(
  $$ insert into fx select 'orderA', public.create_family_order((select id from fx where k = 'hhA'), '80000000-0000-4000-8000-000000000001',
       '[{"child_id":"60000000-0000-4000-8000-000000000002","menu_item_id":"70000000-0000-4000-8000-000000000001","quantity":2}]',
       'delivery', '50000000-0000-4000-8000-000000000001') $$,
  'parent places an order through the server function');
select is((select total_cents from public.orders where id = (select id from fx where k = 'orderA')), 2300,
  'order total is computed server-side (2 × 900 + 500 delivery)');
select throws_ok($$ update public.orders set total_cents = 1 $$, '42501', null, 'parent cannot change order totals');
select throws_ok(
  $$ select public.create_family_order((select id from fx where k = 'hhA'), '80000000-0000-4000-8000-000000000001',
       '[{"child_id":"60000000-0000-4000-8000-000000000003","menu_item_id":"70000000-0000-4000-8000-000000000002"}]',
       'delivery', '50000000-0000-4000-8000-000000000001') $$,
  '23514', 'Unknown child', 'parent cannot order for a child in another household');
select is((select count(*)::int from public.kitchen_order_lines), 0, 'parent sees nothing in the kitchen view');
select throws_ok($$ insert into public.menu_items (name, slug, base_price_cents) values ('X', 'test-x', 1) $$,
  '42501', null, 'parent cannot write menu items');
select is((select count(*)::int from public.site_settings), 0, 'parent cannot read raw site settings');
select lives_ok($$ insert into public.favorites (household_id, menu_item_id) select id, '70000000-0000-4000-8000-000000000002' from fx where k = 'hhA' $$,
  'parent saves a favorite');
select throws_ok($$ select public.generate_rotation_weeks() $$, '42501', null, 'parent cannot run the rotation generator');

-- ═══ Parent B ═══════════════════════════════════════════════════════════════
select pg_temp.act_as('10000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.orders), 0, 'another parent cannot see household A orders');
select is((select count(*)::int from public.children where household_id = (select id from fx where k = 'hhA')), 0,
  'another parent cannot see household A children');

-- ═══ School admin / staff ═══════════════════════════════════════════════════
select pg_temp.act_as('10000000-0000-4000-8000-000000000003');
select is((select array_agg(first_name order by first_name) from public.children), array['Ann'],
  'school admin sees only the child enrolled through their school');
select is((select count(*)::int from public.child_allergens), 1, 'school admin sees the enrolled child''s allergens');
select is((select count(*)::int from public.classrooms), 1, 'school admin sees only their classrooms');
select lives_ok($$ insert into public.classrooms (organization_id, name) select id, 'New room' from fx where k = 'org' $$,
  'school admin adds a classroom');
select throws_ok($$ update public.organizations set status = 'suspended' where id = (select id from fx where k = 'org') $$,
  '42501', null, 'school admin cannot change their organization''s status');

select pg_temp.act_as('10000000-0000-4000-8000-000000000004');
select ok((select count(*)::int from public.classrooms) >= 1, 'school staff read their classrooms');
select throws_ok($$ insert into public.classrooms (organization_id, name) select id, 'Nope' from fx where k = 'org' $$,
  '42501', null, 'school staff cannot add classrooms');

-- ═══ Kitchen ════════════════════════════════════════════════════════════════
select pg_temp.act_as('10000000-0000-4000-8000-000000000005', 'aal1');
select is((select count(*)::int from public.kitchen_order_lines where order_id = 'b1000000-0000-4000-8000-000000000001'), 0,
  'kitchen at AAL1 sees nothing');
select pg_temp.act_as('10000000-0000-4000-8000-000000000005', 'aal2');
select is((select child_first_name from public.kitchen_order_lines where order_id = 'b1000000-0000-4000-8000-000000000001'), 'Ann',
  'kitchen at AAL2 sees paid order lines with the child''s first name');
select is((select child_allergens from public.kitchen_order_lines where order_id = 'b1000000-0000-4000-8000-000000000001'),
  array['Testnut'], 'kitchen sees the child''s allergies');
select is((select count(*)::int from public.orders), 0, 'kitchen cannot read orders directly');
select is((select count(*)::int from public.addresses), 0, 'kitchen cannot read addresses');
select pg_temp.reset_role();
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'kitchen_order_lines'
     and (column_name ~ '(price|cents|address|email|phone|stripe|total)')),
  0, 'the kitchen view has no price, payment, address, email or phone columns');

-- ═══ Ops ════════════════════════════════════════════════════════════════════
select pg_temp.act_as('10000000-0000-4000-8000-000000000006', 'aal1');
select is((select count(*)::int from public.orders), 0, 'ops at AAL1 cannot read orders');
select pg_temp.act_as('10000000-0000-4000-8000-000000000006', 'aal2');
select ok((select count(*)::int from public.orders) >= 2, 'ops at AAL2 reads orders');
select is(pg_temp.rows_affected($$ update public.orders set status = 'fulfilled' where id = 'b1000000-0000-4000-8000-000000000001' $$), 1,
  'ops updates order status');
select is(pg_temp.rows_affected($$ update public.menu_items set base_price_cents = 1 where id = '70000000-0000-4000-8000-000000000002' $$), 0,
  'ops cannot change menu prices');
select is(pg_temp.rows_affected($$ update public.plans set name = 'Hacked' where id = 'a1000000-0000-4000-8000-000000000001' $$), 0,
  'ops cannot edit plans');
select is(pg_temp.rows_affected($$ update public.site_settings set business_name = 'Hacked' $$), 0, 'ops cannot edit site settings');

-- ═══ Owner ══════════════════════════════════════════════════════════════════
select pg_temp.act_as('10000000-0000-4000-8000-000000000007', 'aal2', 3600);
select throws_ok($$ update public.menu_items set base_price_cents = 999 where id = '70000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'owner needs a fresh MFA step-up to change a price');
select throws_ok($$ update public.site_settings set tax_settings = '{"enabled":true}' $$,
  '42501', null, 'owner needs a fresh MFA step-up to change tax settings');
select is(pg_temp.rows_affected($$ update public.site_settings set business_name = 'Smart Cookie Kitchen' $$), 1,
  'owner edits ordinary site settings without step-up');
select pg_temp.act_as('10000000-0000-4000-8000-000000000007', 'aal2', 30);
select lives_ok($$ update public.plans set price_cents = 2700 where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'owner with a fresh step-up changes a plan price');
select throws_ok($$ delete from public.stripe_events where event_id = 'evt_test_1' $$, '42501', null,
  'nobody deletes Stripe events');
select lives_ok(
  $$ insert into public.allergy_overrides (child_id, menu_item_id, reason)
     values ('60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Doctor cleared, see note') $$,
  'owner with a fresh step-up approves an allergy override');
select pg_temp.reset_role();
select is((select count(*)::int from public.plan_price_history where plan_id = 'a1000000-0000-4000-8000-000000000001'), 2,
  'plan price changes are recorded in price history');

select * from finish();
rollback;
