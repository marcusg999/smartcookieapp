-- Phase 6 tests (pgTAP): payment state, refunds (step-up + ops limit), Stripe
-- bookkeeping functions (service role only), credits at checkout, net-paid
-- status, 30-minute expiry, and the quantity-capped allowance.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function pg_temp.mk_user(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', '{}', now(), now());
$$;
-- p_mfa_age: seconds since the last TOTP check (null = none).
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
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────
select pg_temp.mk_user('16000000-0000-4000-8000-000000000001', 'p6a@test.local');
select pg_temp.mk_user('16000000-0000-4000-8000-000000000002', 'p6b@test.local');
select pg_temp.mk_user('16000000-0000-4000-8000-000000000003', 'ops6@test.local');
select pg_temp.mk_user('16000000-0000-4000-8000-000000000004', 'owner6@test.local');
select pg_temp.mk_user('16000000-0000-4000-8000-000000000005', 'kitchen6@test.local');
insert into public.user_roles (user_id, role) values
  ('16000000-0000-4000-8000-000000000003', 'ops'),
  ('16000000-0000-4000-8000-000000000004', 'owner'),
  ('16000000-0000-4000-8000-000000000005', 'kitchen');
create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated, anon;
insert into fx select 'hhA', household_id from public.household_members where user_id = '16000000-0000-4000-8000-000000000001';

insert into public.delivery_zones (id, name, zip_codes, fee_cents, free_over_cents, min_order_cents) values
  ('d6000000-0000-4000-8000-000000000001', 'Test zone 6', '{99961}', 0, null, 0);
insert into public.addresses (id, household_id, line1, city, zip, is_default)
  select 'ad600000-0000-4000-8000-000000000001', id, '6 Test St', 'Testville', '99961', true from fx where k = 'hhA';
insert into public.children (id, household_id, first_name) select '66000000-0000-4000-8000-000000000001', id, 'Uno' from fx where k = 'hhA';
insert into public.children (id, household_id, first_name) select '66000000-0000-4000-8000-000000000002', id, 'Dos' from fx where k = 'hhA';
insert into public.menu_items (id, name, slug, base_price_cents) values ('76000000-0000-4000-8000-000000000001', 'P6 Bowl', 'p6-bowl', 1000);
insert into public.menu_weeks (id, week_start, delivery_dates, ordering_opens_at, cutoff_at, status) values
  ('86000000-0000-4000-8000-000000000001', date '2032-01-05', '{2032-01-05}', now() - interval '1 day', now() + interval '3 days', 'published');
insert into public.menu_week_items (menu_week_id, menu_item_id) values ('86000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001');

-- A paid $20 order for refunds.
with o as (insert into public.orders (household_id, menu_week_id, status, subtotal_cents, total_cents)
  select id, '86000000-0000-4000-8000-000000000001', 'pending_payment', 2000, 2000 from fx where k = 'hhA' returning id)
insert into fx select 'paid', id from o;
select public.stripe_record_payment_intent((select id from fx where k = 'paid'), 'pi_p6_paid', 'charge', 2000, 'usd');

-- ═══ Webhook bookkeeping ═══════════════════════════════════════════════════
select is(public.stripe_claim_event('evt_p6_1', 'payment_intent.succeeded', false, '{}'), true, 'a new event is claimed');
select is(public.stripe_claim_event('evt_p6_1', 'payment_intent.succeeded', false, '{}'), false, 'the same event is not claimed twice while in flight');
select public.stripe_finish_event('evt_p6_1', null);
select is(public.stripe_claim_event('evt_p6_1', 'payment_intent.succeeded', false, '{}'), false, 'a processed event is never re-run');
select public.stripe_claim_event('evt_p6_2', 'x', false, '{}');
select public.stripe_finish_event('evt_p6_2', 'boom');
update public.stripe_events set locked_at = null where event_id = 'evt_p6_2';
select is(public.stripe_claim_event('evt_p6_2', 'x', false, '{}'), true, 'a failed event can be retried');

select is(public.stripe_payment_succeeded('pi_p6_paid', 2000), 'paid', 'payment succeeded marks the order paid');
select is(public.stripe_payment_succeeded('pi_p6_paid', 2000), 'paid', 'replaying it is harmless');
select is((select amount_paid_cents from public.orders where id = (select id from fx where k = 'paid')), 2000, 'and the amount is counted once');
select is(public.stripe_payment_succeeded('pi_unknown', 100), 'ignored', 'an unknown intent is ignored');

-- ═══ Payments and refunds: who can see and do what ═════════════════════════
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.order_payments $$, '42501', null, 'anon cannot read payments');
select throws_ok($$ select * from public.order_refunds $$, '42501', null, 'anon cannot read refunds');

select pg_temp.act_as('16000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.order_payments), 1, 'the family reads its own payments');
select throws_ok($$ update public.order_payments set status = 'succeeded' $$, '42501', null, 'the family cannot change payment state');
select throws_ok($$ select public.stripe_payment_succeeded('pi_p6_paid', 1) $$, '42501', null, 'the family cannot call webhook functions');
select throws_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 100, 'please', '16000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'the family cannot refund itself');

select pg_temp.act_as('16000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.order_payments), 0, 'another family sees no payments');

select pg_temp.act_as('16000000-0000-4000-8000-000000000005', 'aal2', 30);
select throws_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 100, 'kitchen', '16000000-0000-4000-8000-000000000005') $$,
  '42501', null, 'kitchen staff cannot refund');

select pg_temp.act_as('16000000-0000-4000-8000-000000000003', 'aal2', 3600);
select throws_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 100, 'stale mfa', '16000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'ops need a fresh MFA check to refund');
select pg_temp.act_as('16000000-0000-4000-8000-000000000003', 'aal2', 30);
select lives_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 1500, 'cold meal', '16000000-0000-4000-8000-000000000003') $$,
  'ops refund within their limit ($50 default)');
select throws_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 1000, 'too much', '16000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'nobody can refund more than is left (pending refunds count)');
select is((select count(*)::int from public.order_payments where order_id = (select id from fx where k = 'paid')), 1, 'ops read payments (AAL2)');

select pg_temp.reset_role();
update public.site_settings set ops_refund_limit_cents = 200;
select pg_temp.act_as('16000000-0000-4000-8000-000000000003', 'aal2', 30);
select throws_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 300, 'over limit', '16000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'ops cannot exceed the owner''s refund limit');
select pg_temp.act_as('16000000-0000-4000-8000-000000000004', 'aal2', 30);
select lives_ok($$ insert into public.order_refunds (order_id, amount_cents, reason, requested_by)
  values ((select id from fx where k = 'paid'), 300, 'owner', '16000000-0000-4000-8000-000000000004') $$,
  'the owner is not bound by the ops limit');
select pg_temp.act_as('16000000-0000-4000-8000-000000000004', 'aal2', 3600);
select throws_ok($$ update public.site_settings set ops_refund_limit_cents = 9999 $$, '42501', null,
  'changing the refund limit needs a fresh step-up');

-- Refund webhook → order status
select pg_temp.reset_role();
select public.stripe_payment_refunded('pi_p6_paid', 2000);
select is((select status::text from public.orders where id = (select id from fx where k = 'paid')), 'refunded', 'a full refund marks the order refunded');

-- ═══ Credits at checkout, net-paid status, expiry ══════════════════════════
insert into public.account_credits (household_id, amount_cents, reason, created_by)
  select id, 700, 'Sorry credit', '16000000-0000-4000-8000-000000000004' from fx where k = 'hhA';
select pg_temp.act_as('16000000-0000-4000-8000-000000000001');
insert into fx select 'o2', public.place_family_order((select id from fx where k = 'hhA'), '86000000-0000-4000-8000-000000000001',
  '[{"child_id":"66000000-0000-4000-8000-000000000001","menu_item_id":"76000000-0000-4000-8000-000000000001","delivery_date":"2032-01-05"}]',
  'delivery', 'ad600000-0000-4000-8000-000000000001', null, true);
select is((select array[credit_cents, total_cents] from public.orders where id = (select id from fx where k = 'o2')), array[700, 300],
  'account credit pays first');
select is((select coalesce(sum(amount_cents), 0)::int from public.account_credits where household_id = (select id from fx where k = 'hhA')), 0,
  'the credit is used up');
select isnt((select expires_at from public.orders where id = (select id from fx where k = 'o2')), null, 'an unpaid order expires (30 minutes)');

select pg_temp.reset_role();
update public.orders set expires_at = now() - interval '1 minute' where id = (select id from fx where k = 'o2');
select ok(public.expire_pending_orders() >= 1, 'the expiry job cancels unpaid orders');
select is((select status::text from public.orders where id = (select id from fx where k = 'o2')), 'cancelled', 'the order is cancelled');
select is((select coalesce(sum(amount_cents), 0)::int from public.account_credits where household_id = (select id from fx where k = 'hhA')), 700,
  'and its credit goes back');

-- ═══ Plan allowance is capped by the subscription quantity ═════════════════
insert into public.plans (id, name, slug, meals_per_interval, allowance_unit, price_cents)
  values ('96000000-0000-4000-8000-000000000001', 'P6 One', 'p6-one', 1, 'per_child', 1000);
insert into public.subscriptions (household_id, plan_id, status, quantity)
  select id, '96000000-0000-4000-8000-000000000001', 'active', 1 from fx where k = 'hhA';
select pg_temp.act_as('16000000-0000-4000-8000-000000000001');
insert into fx select 'o3', public.place_family_order((select id from fx where k = 'hhA'), '86000000-0000-4000-8000-000000000001',
  '[{"child_id":"66000000-0000-4000-8000-000000000001","menu_item_id":"76000000-0000-4000-8000-000000000001","delivery_date":"2032-01-05"},
    {"child_id":"66000000-0000-4000-8000-000000000002","menu_item_id":"76000000-0000-4000-8000-000000000001","delivery_date":"2032-01-05"}]',
  'delivery', 'ad600000-0000-4000-8000-000000000001', null, true);
select is((select count(*)::int from public.order_items where order_id = (select id from fx where k = 'o3') and covered_by_subscription), 1,
  'a plan for 1 child covers one child''s meal, even with two children');

select * from finish();
rollback;
