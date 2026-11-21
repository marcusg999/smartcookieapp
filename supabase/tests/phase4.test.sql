-- Phase 4 RLS tests (pgTAP): customer notes, credits, price history, top-9 lock, media usage.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

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


-- ── Fixtures ────────────────────────────────────────────────────────────────
select pg_temp.mk_user('40000000-0000-4000-8000-000000000001', 'p4a@test.local', '{"full_name":"Pa Four"}');
select pg_temp.mk_user('40000000-0000-4000-8000-000000000002', 'p4b@test.local', '{"full_name":"Pb Four"}');
select pg_temp.mk_user('40000000-0000-4000-8000-000000000005', 'k4@test.local');
select pg_temp.mk_user('40000000-0000-4000-8000-000000000006', 'ops4@test.local');
select pg_temp.mk_user('40000000-0000-4000-8000-000000000007', 'own4@test.local');
insert into public.user_roles (user_id, role) values
  ('40000000-0000-4000-8000-000000000005', 'kitchen'),
  ('40000000-0000-4000-8000-000000000006', 'ops'),
  ('40000000-0000-4000-8000-000000000007', 'owner');
create temp table fx (k text primary key, id uuid) on commit drop;
grant all on fx to authenticated, anon;
insert into fx select 'hhA', household_id from public.household_members where user_id = '40000000-0000-4000-8000-000000000001';
insert into fx select 'hhB', household_id from public.household_members where user_id = '40000000-0000-4000-8000-000000000002';
insert into public.menu_items (name, slug, base_price_cents) values ('P4 Test Meal', 'p4-test-meal', 900);
insert into fx select 'item', id from public.menu_items where slug = 'p4-test-meal';
insert into public.allergens (name, slug, is_top9) values ('P4 Top Allergen', 'p4-top', true)
  on conflict do nothing;
insert into fx select 'top9', id from public.allergens where slug = 'p4-top';

-- ── customer_notes ──────────────────────────────────────────────────────────
select pg_temp.act_as('40000000-0000-4000-8000-000000000006', 'aal2');
select lives_ok($$ insert into public.customer_notes (household_id, body, author_id)
  values ((select id from fx where k = 'hhA'), 'Prefers porch drop-off', '40000000-0000-4000-8000-000000000006') $$,
  'ops (AAL2) can add a customer note');
select is((select count(*)::int from public.customer_notes where household_id = (select id from fx where k = 'hhA')), 1, 'ops reads notes');
select pg_temp.act_as('40000000-0000-4000-8000-000000000006', 'aal1');
select is((select count(*)::int from public.customer_notes), 0, 'ops at AAL1 reads no notes');
select pg_temp.act_as('40000000-0000-4000-8000-000000000005', 'aal2');
select is((select count(*)::int from public.customer_notes), 0, 'kitchen reads no notes');
select throws_ok($$ insert into public.customer_notes (household_id, body, author_id)
  values ((select id from fx where k = 'hhA'), 'x', '40000000-0000-4000-8000-000000000005') $$, '42501', null, 'kitchen cannot add notes');
select pg_temp.act_as('40000000-0000-4000-8000-000000000001', 'aal1');
select is((select count(*)::int from public.customer_notes), 0, 'parents never see staff notes, even about themselves');
select pg_temp.act_as('40000000-0000-4000-8000-000000000007', 'aal2');
select throws_ok($$ insert into public.customer_notes (household_id, body, author_id)
  values ((select id from fx where k = 'hhA'), 'spoof', '40000000-0000-4000-8000-000000000006') $$, '42501', null, 'author cannot be spoofed');
select throws_ok($$ update public.customer_notes set body = 'edited' $$, '42501', null, 'notes are append-only (no update grant)');
select throws_ok($$ delete from public.account_credits $$, '42501', null, 'credits cannot be deleted');
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.customer_notes $$, '42501', null, 'anon cannot read notes');

-- ── account_credits ─────────────────────────────────────────────────────────
select pg_temp.act_as('40000000-0000-4000-8000-000000000006', 'aal2');
select lives_ok($$ insert into public.account_credits (household_id, amount_cents, reason, created_by)
  values ((select id from fx where k = 'hhA'), 500, 'Late delivery', '40000000-0000-4000-8000-000000000006') $$,
  'ops can add a credit');
select pg_temp.act_as('40000000-0000-4000-8000-000000000001', 'aal1');
select is((select sum(amount_cents)::int from public.account_credits), 500, 'the household reads its own credit');
select throws_ok($$ insert into public.account_credits (household_id, amount_cents, reason, created_by)
  values ((select id from fx where k = 'hhA'), 9999, 'free money', '40000000-0000-4000-8000-000000000001') $$, '42501', null, 'parents cannot credit themselves');
select pg_temp.act_as('40000000-0000-4000-8000-000000000002', 'aal1');
select is((select count(*)::int from public.account_credits), 0, 'another household sees no credits');
select pg_temp.act_as('40000000-0000-4000-8000-000000000005', 'aal2');
select throws_ok($$ insert into public.account_credits (household_id, amount_cents, reason, created_by)
  values ((select id from fx where k = 'hhA'), 100, 'kitchen credit', '40000000-0000-4000-8000-000000000005') $$, '42501', null, 'kitchen cannot add credits');
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.account_credits $$, '42501', null, 'anon cannot read credits');
select pg_temp.reset_role();
select ok(exists (select 1 from public.audit_log where action = 'account_credits.insert'), 'credits are audited');

-- ── menu_item_price_history + price guard ──────────────────────────────────
select is((select count(*)::int from public.menu_item_price_history where menu_item_id = (select id from fx where k = 'item')), 1,
  'creating an item records its first price');
select pg_temp.act_as('40000000-0000-4000-8000-000000000007', 'aal2');
select throws_ok($$ update public.menu_items set base_price_cents = 1000 where slug = 'p4-test-meal' $$, '42501', null,
  'owner without a fresh MFA cannot change a price');
select throws_ok($$ update public.menu_items set stripe_price_id = 'price_spoof' where slug = 'p4-test-meal' $$, '42501', null,
  'Stripe price ids are guarded like prices');
select pg_temp.act_as('40000000-0000-4000-8000-000000000007', 'aal2', 60);
select lives_ok($$ update public.menu_items set base_price_cents = 1000, stripe_price_id = 'price_new' where slug = 'p4-test-meal' $$,
  'owner with a fresh MFA changes the price');
select is((select count(*)::int from public.menu_item_price_history where menu_item_id = (select id from fx where k = 'item')), 2,
  'a price change adds a history row');
select lives_ok($$ update public.menu_items set stripe_price_id = 'price_newer' where slug = 'p4-test-meal' $$, 'owner sets a new Stripe id');
select is((select stripe_price_id from public.menu_item_price_history where menu_item_id = (select id from fx where k = 'item') and active_to is null),
  'price_newer', 'a Stripe-id-only change fills in the open history row instead of adding one');
select is((select count(*)::int from public.menu_item_price_history where menu_item_id = (select id from fx where k = 'item') and active_to is null), 1,
  'only the newest price is open-ended');
select pg_temp.act_as('40000000-0000-4000-8000-000000000006', 'aal2', 60);
select is(pg_temp.rows_affected($$ update public.menu_items set base_price_cents = 1 where slug = 'p4-test-meal' $$), 0, 'ops cannot change prices');
select is((select count(*)::int from public.menu_item_price_history where menu_item_id = (select id from fx where k = 'item')), 2, 'ops reads price history');
select pg_temp.act_as('40000000-0000-4000-8000-000000000005', 'aal2');
select is((select count(*)::int from public.menu_item_price_history), 0, 'kitchen reads no price history');
select pg_temp.act_as('40000000-0000-4000-8000-000000000001', 'aal1');
select is((select count(*)::int from public.menu_item_price_history), 0, 'parents read no price history');
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.menu_item_price_history $$, '42501', null, 'anon cannot read price history');

-- ── top-9 allergens are locked ─────────────────────────────────────────────
select pg_temp.act_as('40000000-0000-4000-8000-000000000007', 'aal2');
select throws_ok($$ update public.allergens set slug = 'renamed' where slug = 'p4-top' $$, '23514', null, 'a top-9 allergen slug cannot change');
select throws_ok($$ update public.allergens set archived_at = now() where slug = 'p4-top' $$, '23514', null, 'a top-9 allergen cannot be archived');
select throws_ok($$ delete from public.allergens where slug = 'p4-top' $$, '23514', null, 'a top-9 allergen cannot be deleted');
select lives_ok($$ update public.allergens set icon = 'star' where slug = 'p4-top' $$, 'cosmetic edits to a top-9 allergen are fine');

-- ── public settings + media usage ──────────────────────────────────────────
select pg_temp.act_as_anon();
select ok((select ordering_paused_message from public.site_settings_public) is not null, 'anon reads the paused message');
select throws_ok($$ select public.media_usage_count('x') $$, '42501', null, 'anon cannot run media_usage_count');
select pg_temp.act_as('40000000-0000-4000-8000-000000000001', 'aal1');
select is(public.media_usage_count('x'), null, 'non-staff get no media usage answer');
select pg_temp.act_as('40000000-0000-4000-8000-000000000007', 'aal2');
select is(public.media_usage_count('nothing/uses-this.webp'), 0, 'owner gets a usage count');

select * from finish();
rollback;
