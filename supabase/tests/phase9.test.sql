-- Phase 9 tests (pgTAP): the email queue (dedupe, recipient hashes, no
-- user access), event triggers (orders, plans, menu, invoices, staff roles),
-- cutoff reminder targeting and deep links, unsubscribe, new-device alerts
-- and Automatic Renewal Law consent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

create function pg_temp.mk_user(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', '{}', now(), now());
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
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
create function pg_temp.emails(p_template text, p_like text default '%') returns integer language sql as $$
  select count(*)::int from public.notifications_log where template_key = p_template and coalesce(dedupe_key, '') like p_like;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Five families: A ordered (no plan), B hasn't ordered, C subscriber with
-- meals left, D subscriber who skipped the week, E not onboarded.
select pg_temp.mk_user(('19000000-0000-4000-8000-00000000000' || n)::uuid, 'p9' || n || '@test.local') from generate_series(1, 5) n;
select pg_temp.mk_user('19000000-0000-4000-8000-000000000008', 'owner9@test.local');
create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated, anon;
insert into fx select 'hh' || n, hm.household_id from generate_series(1, 5) n
  join public.household_members hm on hm.user_id = ('19000000-0000-4000-8000-00000000000' || n)::uuid;
update public.households set onboarded_at = now() where id in (select id from fx where k in ('hh1', 'hh2', 'hh3', 'hh4'));
insert into public.menu_items (id, name, slug, base_price_cents) values ('79000000-0000-4000-8000-000000000001', 'P9 Bowl', 'p9-bowl', 1000);
insert into public.menu_weeks (id, week_start, delivery_dates, ordering_opens_at, cutoff_at, status) values
  ('89000000-0000-4000-8000-000000000001', date '2035-01-01' + (8 - extract(isodow from date '2035-01-01')::int) % 7,
   array[date '2035-01-01' + (8 - extract(isodow from date '2035-01-01')::int) % 7],
   now() - interval '2 days', now() + interval '6 hours', 'draft');
insert into public.plans (id, name, slug, description_rich, audience, billing_interval, meals_per_interval, allowance_unit, price_cents,
                          min_commitment_intervals)
  values ('99000000-0000-4000-8000-000000000001', 'P9 plan', 'p9-plan', '{"type":"doc","content":[]}', 'family', 'month', 12, 'per_child', 9900, 2);
insert into public.subscriptions (id, household_id, plan_id, status, quantity, current_period_start, current_period_end)
  select ('a9000000-0000-4000-8000-00000000000' || x.n)::uuid, f.id, '99000000-0000-4000-8000-000000000001', 'incomplete', 1,
         now(), now() + interval '2 days'
  from (values (3, 'hh3'), (4, 'hh4')) x(n, k) join fx f on f.k = x.k;

-- ═══ Queue basics ═══════════════════════════════════════════════════════════
select isnt(public.queue_email('payment_reminder', 'Someone@Test.local', '{}', 'p9:dedupe'), null, 'queue_email queues an email');
select is(public.queue_email('payment_reminder', 'Someone@Test.local', '{}', 'p9:dedupe'), null, 'the same dedupe key is ignored');
select is((select recipient_hash from public.notifications_log where dedupe_key = 'p9:dedupe'),
  encode(extensions.digest('someone@test.local', 'sha256'), 'hex'), 'the recipient is hashed (lower-cased)');
update public.notifications_log set to_address = null, status = 'sent' where dedupe_key = 'p9:dedupe';
select isnt((select recipient_hash from public.notifications_log where dedupe_key = 'p9:dedupe'), null,
  'clearing the address after sending keeps only the hash');

select pg_temp.act_as('19000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.queue_email('x', 'a@b.c') $$, '42501', null, 'users cannot queue emails');
select is((select count(*)::int from public.notifications_log), 0, 'users cannot read the email log');
select throws_ok($$ select * from public.cutoff_reminder_targets('89000000-0000-4000-8000-000000000001') $$, '42501', null,
  'users cannot list reminder targets');
select pg_temp.reset_role();

-- ═══ Menu published (only onboarded families) ═══════════════════════════════
update public.menu_weeks set status = 'published' where id = '89000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.notifications_log where template_key = 'menu_published'
           and payload ->> 'menu_week_id' = '89000000-0000-4000-8000-000000000001'
           and household_id in (select id from fx where k like 'hh%')), 4,
  'publishing a week emails every onboarded family (not the one still onboarding)');

-- ═══ Orders ═════════════════════════════════════════════════════════════════
insert into public.orders (id, household_id, menu_week_id, status, subtotal_cents, total_cents, placed_at)
  select 'b9000000-0000-4000-8000-000000000001', id, '89000000-0000-4000-8000-000000000001', 'pending_payment', 1000, 1000, now()
  from fx where k = 'hh1';
insert into public.order_items (order_id, menu_item_id, quantity, unit_price_cents, item_name)
  values ('b9000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', 1, 1000, 'P9 Bowl');
select is(pg_temp.emails('order_confirmation', '%b9000000-0000-4000-8000-000000000001'), 0, 'no confirmation while unpaid');
update public.orders set status = 'paid', amount_paid_cents = 1000 where id = 'b9000000-0000-4000-8000-000000000001';
update public.orders set status = 'pending_payment' where id = 'b9000000-0000-4000-8000-000000000001';
update public.orders set status = 'paid' where id = 'b9000000-0000-4000-8000-000000000001';
select is(pg_temp.emails('order_confirmation', '%b9000000-0000-4000-8000-000000000001'), 1,
  'paid → one confirmation, even if payment state flips again (webhook replay)');
update public.orders set payment_version = payment_version + 1 where id = 'b9000000-0000-4000-8000-000000000001';
select is(pg_temp.emails('order_modified', '%b9000000-0000-4000-8000-000000000001%'), 1, 'a change before cutoff sends "order updated"');
update public.orders set amount_refunded_cents = 400, status = 'partially_refunded' where id = 'b9000000-0000-4000-8000-000000000001';
select is((select (payload ->> 'refund_cents')::int from public.notifications_log
           where template_key = 'order_refunded' and payload ->> 'order_id' = 'b9000000-0000-4000-8000-000000000001'), 400,
  'a refund sends "we refunded" with the amount');
update public.orders set status = 'cancelled' where id = 'b9000000-0000-4000-8000-000000000001';
select is(pg_temp.emails('order_cancelled', '%b9000000-0000-4000-8000-000000000001'), 1, 'cancelling a paid order sends "cancelled"');
insert into public.orders (id, household_id, menu_week_id, status, subtotal_cents, total_cents, placed_at)
  select 'b9000000-0000-4000-8000-000000000002', id, '89000000-0000-4000-8000-000000000001', 'pending_payment', 1000, 1000, now()
  from fx where k = 'hh1';
update public.orders set status = 'cancelled' where id = 'b9000000-0000-4000-8000-000000000002';
select is(pg_temp.emails('order_cancelled', '%b9000000-0000-4000-8000-000000000002'), 0, 'an unpaid order that expires is not emailed');
-- Family A keeps a live order for the reminder tests.
insert into public.orders (id, household_id, menu_week_id, status, subtotal_cents, total_cents, placed_at)
  select 'b9000000-0000-4000-8000-000000000003', id, '89000000-0000-4000-8000-000000000001', 'paid', 1000, 1000, now()
  from fx where k = 'hh1';

-- ═══ Plans ══════════════════════════════════════════════════════════════════
update public.subscriptions set status = 'active' where id in ('a9000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000004');
select is(pg_temp.emails('subscription_started', 'subscription_started:a9000000%'), 2, 'activation sends "plan started"');
update public.subscriptions set status = 'past_due' where id = 'a9000000-0000-4000-8000-000000000003';
update public.subscriptions set status = 'active' where id = 'a9000000-0000-4000-8000-000000000003';
select is(pg_temp.emails('subscription_started', 'subscription_started:a9000000-0000-4000-8000-000000000003'), 1,
  'recovering from past due is not a second "started"');
update public.subscriptions set paused_until = now() + interval '14 days' where id = 'a9000000-0000-4000-8000-000000000003';
select is(pg_temp.emails('subscription_paused', '%a9000000-0000-4000-8000-000000000003%'), 1, 'pausing sends "paused"');
update public.subscriptions set paused_until = null where id = 'a9000000-0000-4000-8000-000000000003';
select is(pg_temp.emails('subscription_resumed', '%a9000000-0000-4000-8000-000000000003%'), 1, 'resuming sends "resumed"');
select is(public.queue_renewal_reminders(), 2, 'monthly plans renewing within 3 days get a reminder');
select is(public.queue_renewal_reminders(), 0, 'and only once per period');

-- ═══ Cutoff reminder targeting ══════════════════════════════════════════════
insert into public.subscription_allowances (subscription_id, menu_week_id, meals_allowed, skipped) values
  ('a9000000-0000-4000-8000-000000000003', '89000000-0000-4000-8000-000000000001', 3, false),
  ('a9000000-0000-4000-8000-000000000004', '89000000-0000-4000-8000-000000000001', 3, true);
select is((select array_agg(h.k || ':' || t.reason order by h.k) from public.cutoff_reminder_targets('89000000-0000-4000-8000-000000000001') t
           join fx h on h.id = t.household_id and h.k like 'hh%'),
  array['hh2:not_ordered', 'hh3:not_ordered'],
  'targets: families who haven''t ordered and subscribers with meals left; not those who ordered, skipped or are still onboarding');
insert into public.orders (id, household_id, menu_week_id, status, subtotal_cents, total_cents, placed_at)
  select 'b9000000-0000-4000-8000-000000000004', id, '89000000-0000-4000-8000-000000000001', 'paid', 0, 0, now() from fx where k = 'hh3';
insert into public.order_items (order_id, menu_item_id, quantity, unit_price_cents, item_name, covered_by_subscription)
  values ('b9000000-0000-4000-8000-000000000004', '79000000-0000-4000-8000-000000000001', 1, 0, 'P9 Bowl', true);
select is((select reason from public.cutoff_reminder_targets('89000000-0000-4000-8000-000000000001') t join fx h on h.id = t.household_id
           where h.k = 'hh3'), 'allowance_left', 'a subscriber who picked 1 of 3 meals is still reminded');

select ok(public.queue_cutoff_reminders() >= 2, 'the reminder job runs for weeks whose cutoff is within 24 hours');
select is((select count(*)::int from public.notifications_log where template_key = 'order_cutoff_reminder'
           and payload ->> 'menu_week_id' = '89000000-0000-4000-8000-000000000001'
           and household_id in (select id from fx where k like 'hh%')), 2, 'one reminder per target family');
select is(public.queue_cutoff_reminders(), 0, 'running again sends nothing new');
select ok((select bool_and(length(payload ->> 'deep_link_token') >= 30) from public.notifications_log
           where template_key = 'order_cutoff_reminder' and payload ->> 'menu_week_id' = '89000000-0000-4000-8000-000000000001'),
  'the raw link token is only in the queued payload (hashed at rest)');

-- Deep links: single use, then useless.
select is((select count(*)::int from public.redeem_deep_link((select payload ->> 'deep_link_token' from public.notifications_log
           where template_key = 'order_cutoff_reminder' and household_id = (select id from fx where k = 'hh2')))), 1,
  'a reminder link works once');
select is((select count(*)::int from public.redeem_deep_link((select payload ->> 'deep_link_token' from public.notifications_log
           where template_key = 'order_cutoff_reminder' and household_id = (select id from fx where k = 'hh2')))), 0,
  'and never again');
select is((select count(*)::int from public.redeem_deep_link('not-a-real-token')), 0, 'a made-up link does nothing');

-- ═══ Unsubscribe ════════════════════════════════════════════════════════════
select isnt(public._ensure_email_preferences('19000000-0000-4000-8000-000000000002'), null, 'a preferences row gets an unsubscribe token');
insert into fx select 'unsub', unsubscribe_token from public.email_preferences where user_id = '19000000-0000-4000-8000-000000000002';
select pg_temp.act_as_anon();
select is(public.email_unsubscribe((select id from fx where k = 'unsub'), 'cutoff_reminders'), true,
  'one-click unsubscribe works signed out');
select is(public.email_unsubscribe(gen_random_uuid(), 'all'), false, 'a wrong token changes nothing');
select pg_temp.act_as('19000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.email_preferences), 0, 'nobody can read another person''s preferences');
select pg_temp.act_as('19000000-0000-4000-8000-000000000002');
select is((select cutoff_reminders from public.email_preferences), false, 'the person sees their own (now off)');
select pg_temp.reset_role();

-- ═══ Security alerts ════════════════════════════════════════════════════════
insert into public.user_roles (user_id, role) values ('19000000-0000-4000-8000-000000000008', 'owner');
select ok(pg_temp.emails('security_role_granted', 'role_granted:%') >= 1, 'granting a staff role emails the owners');
select is(public.record_sign_in_device('19000000-0000-4000-8000-000000000008', repeat('a', 64), 'Chrome on Mac'), true,
  'the first device is recorded');
select is(pg_temp.emails('security_new_device', 'new_device:19000000-0000-4000-8000-000000000008%'), 0, 'the first device ever is not "new"');
select is(public.record_sign_in_device('19000000-0000-4000-8000-000000000008', repeat('b', 64), 'Safari on iPhone'), true,
  'a second device is new');
select is(pg_temp.emails('security_new_device', 'new_device:19000000-0000-4000-8000-000000000008%'), 1,
  'and the owner gets a new-device alert');

-- ═══ Automatic Renewal Law consent ══════════════════════════════════════════
select pg_temp.act_as('19000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.record_renewal_consent('a9000000-0000-4000-8000-000000000003', 'Renews monthly at $99') $$,
  '42501', null, 'only the plan''s own family can record consent');
select pg_temp.reset_role();

select * from finish();
rollback;
