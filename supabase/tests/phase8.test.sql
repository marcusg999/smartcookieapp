-- Phase 8 tests (pgTAP): kitchen line data without prices or contact
-- details, ops order view, prep checks, deliveries (+ email, fulfilled),
-- "needs attention" allergy conflicts (+ emails, once), payment reminders,
-- the week lifecycle and owner late-order exceptions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create function pg_temp.mk_user(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', '{}', now(), now());
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
create function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────
select pg_temp.mk_user('18000000-0000-4000-8000-000000000001', 'p8@test.local');
select pg_temp.mk_user('18000000-0000-4000-8000-000000000002', 'kitchen8@test.local');
select pg_temp.mk_user('18000000-0000-4000-8000-000000000003', 'ops8@test.local');
select pg_temp.mk_user('18000000-0000-4000-8000-000000000004', 'owner8@test.local');
insert into public.user_roles (user_id, role) values
  ('18000000-0000-4000-8000-000000000002', 'kitchen'),
  ('18000000-0000-4000-8000-000000000003', 'ops'),
  ('18000000-0000-4000-8000-000000000004', 'owner');
update public.site_settings set contact_email = 'owner8@test.local';
create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated, anon;
insert into fx select 'hh', household_id from public.household_members where user_id = '18000000-0000-4000-8000-000000000001';
update public.profiles set phone = '(555) 010-8888' where id = '18000000-0000-4000-8000-000000000001';

insert into public.allergens (name, slug, sort_order) values ('Wheat', 'wheat', 7) on conflict do nothing;
insert into public.delivery_zones (id, name, zip_codes, fee_cents, free_over_cents, min_order_cents) values
  ('d8000000-0000-4000-8000-000000000001', 'Zone 8', '{99981}', 0, null, 0);
insert into public.addresses (id, household_id, line1, city, zip, is_default)
  select 'ad800000-0000-4000-8000-000000000001', id, '8 Test St', 'Testville', '99981', true from fx where k = 'hh';
insert into public.children (id, household_id, first_name, last_initial)
  select '68000000-0000-4000-8000-000000000001', id, 'Otto', 'K' from fx where k = 'hh';
insert into public.menu_items (id, name, slug, base_price_cents, reheat_instructions) values
  ('78000000-0000-4000-8000-000000000001', 'P8 Wheat Wrap', 'p8-wheat-wrap', 900, 'Serve cold.');
insert into public.menu_item_allergens (menu_item_id, allergen_id, presence)
  select '78000000-0000-4000-8000-000000000001'::uuid, id, 'contains'::public.allergen_presence from public.allergens where slug = 'wheat';
-- Week A: open (cutoff in 3 days). Week B: cutoff passed an hour ago, auto-fill done.
insert into public.menu_weeks (id, week_start, delivery_dates, ordering_opens_at, cutoff_at, status, auto_filled_at) values
  ('88000000-0000-4000-8000-000000000001', date '2034-01-02', '{2034-01-02}', now() - interval '2 days', now() + interval '3 days', 'published', null),
  ('88000000-0000-4000-8000-000000000002', date '2034-01-09', '{2034-01-09}', now() - interval '3 days', now() - interval '1 hour', 'published', now());
insert into public.menu_week_items (menu_week_id, menu_item_id) values
  ('88000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001'),
  ('88000000-0000-4000-8000-000000000002', '78000000-0000-4000-8000-000000000001');
-- A paid order in week A and an unpaid one in week B.
insert into public.orders (id, household_id, menu_week_id, status, fulfillment, delivery_zone_id, subtotal_cents, total_cents,
                           amount_paid_cents, address_snapshot, placed_at)
  select '98000000-0000-4000-8000-000000000001', id, '88000000-0000-4000-8000-000000000001', 'paid', 'delivery',
         'd8000000-0000-4000-8000-000000000001', 900, 900, 900, '{"line1":"8 Test St","city":"Testville","zip":"99981"}', now()
  from fx where k = 'hh';
insert into public.orders (id, household_id, menu_week_id, status, fulfillment, subtotal_cents, total_cents, placed_at)
  select '98000000-0000-4000-8000-000000000002', id, '88000000-0000-4000-8000-000000000002', 'pending_payment', 'delivery', 900, 900, now()
  from fx where k = 'hh';
insert into public.order_items (id, order_id, child_id, menu_item_id, delivery_date, quantity, unit_price_cents, item_name, allergens_contained) values
  ('a8000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001',
   '78000000-0000-4000-8000-000000000001', '2034-01-02', 1, 900, 'P8 Wheat Wrap', '{Wheat}'),
  ('a8000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000001',
   '78000000-0000-4000-8000-000000000001', '2034-01-09', 1, 900, 'P8 Wheat Wrap', '{Wheat}');

-- ═══ Kitchen read model ═════════════════════════════════════════════════════
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select is((select count(*)::int from public.fulfillment_lines('88000000-0000-4000-8000-000000000001')), 1, 'kitchen (AAL2) sees the week''s lines');
select is((select reheat_instructions from public.fulfillment_lines('88000000-0000-4000-8000-000000000001')), 'Serve cold.',
  'lines carry the item''s reheating note for labels');
select is((select count(*)::int from public.fulfillment_orders('88000000-0000-4000-8000-000000000001')), 0,
  'kitchen gets no order-level payment / address data');
select is((select count(*)::int from public.orders), 0, 'kitchen cannot read orders (prices) directly');
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal1');
select is((select count(*)::int from public.fulfillment_lines('88000000-0000-4000-8000-000000000001')), 0, 'kitchen at AAL1 sees nothing');
select pg_temp.act_as('18000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.fulfillment_lines('88000000-0000-4000-8000-000000000001')), 0, 'a parent sees nothing');
select pg_temp.reset_role();
select ok(pg_get_function_result('public.fulfillment_lines(uuid)'::regprocedure) !~ '(cents|phone|address|email|zip)',
  'the kitchen line data has no price, phone, address, email or ZIP columns');

select pg_temp.act_as('18000000-0000-4000-8000-000000000003', 'aal2');
select is((select phone from public.fulfillment_orders('88000000-0000-4000-8000-000000000001')), '(555) 010-8888',
  'ops see the family''s phone for the manifest');
select is((select total_cents from public.fulfillment_orders('88000000-0000-4000-8000-000000000001')), 900, 'ops see payment totals');
select pg_temp.reset_role();

-- ═══ Prep checks ════════════════════════════════════════════════════════════
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select lives_ok($$ insert into public.prep_checks (order_item_id) values ('a8000000-0000-4000-8000-000000000001') $$,
  'kitchen records a prep check');
select is((select prep_checked_by is not null from public.fulfillment_lines('88000000-0000-4000-8000-000000000001')), true,
  'the line shows who checked it');
select throws_ok($$ insert into public.prep_checks (order_item_id, checked_by)
  values ('a8000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a prep check can''t be recorded in someone else''s name');
select pg_temp.act_as('18000000-0000-4000-8000-000000000001');
select throws_ok($$ insert into public.prep_checks (order_item_id) values ('a8000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a parent cannot record prep checks');
select pg_temp.reset_role();
select ok(exists (select 1 from public.audit_log where entity_type = 'prep_checks' and action like '%insert%'),
  'prep checks are written to the audit log');

-- ═══ Deliveries ═════════════════════════════════════════════════════════════
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select throws_ok($$ select public.mark_delivered(array['98000000-0000-4000-8000-000000000001'::uuid], '2034-01-02', true) $$,
  '42501', null, 'kitchen cannot mark deliveries');
select pg_temp.act_as('18000000-0000-4000-8000-000000000003', 'aal2');
select is(public.mark_delivered(array['98000000-0000-4000-8000-000000000001'::uuid], '2034-01-02', true), 1, 'ops marks the stop delivered');
select is(public.mark_delivered(array['98000000-0000-4000-8000-000000000001'::uuid], '2034-01-02', true), 0, 'marking twice does nothing');
select pg_temp.reset_role();
select is((select status::text from public.orders where id = '98000000-0000-4000-8000-000000000001'), 'fulfilled',
  'every delivery day done → the order is fulfilled');
select is((select count(*)::int from public.notifications_log where template_key = 'order_delivered'
           and payload ->> 'order_id' = '98000000-0000-4000-8000-000000000001'), 1, 'one "delivered" email is queued');

-- ═══ Needs attention: an allergy added after ordering ═══════════════════════
insert into public.child_allergens (child_id, allergen_id, severity)
  select '68000000-0000-4000-8000-000000000001', id, 'allergy' from public.allergens where slug = 'wheat';
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select is((select conflict from public.fulfillment_lines('88000000-0000-4000-8000-000000000002')), 'Wheat',
  'the line now shows the conflict (live, before any job runs)');
select pg_temp.reset_role();
select is(public.detect_allergy_conflicts(), 1, 'the check finds the new conflict');
select is((select array_agg(payload ->> 'audience' order by payload ->> 'audience') from public.notifications_log
           where template_key = 'allergy_conflict' and payload ->> 'order_item_id' = 'a8000000-0000-4000-8000-000000000002'),
  array['owner', 'parent'], 'the owner and the parent are emailed');
select is(public.detect_allergy_conflicts(), 0, 'running again sends nothing new');
insert into public.allergy_overrides (child_id, menu_item_id, approved_by, reason)
  values ('68000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004',
          'Owner approved a wheat-free wrap for Otto');
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select is((select conflict from public.fulfillment_lines('88000000-0000-4000-8000-000000000002')), null,
  'an owner-approved override clears the conflict');
select pg_temp.reset_role();
select public.detect_allergy_conflicts();
select is((select count(*)::int from public.allergy_conflict_alerts
           where order_item_id = 'a8000000-0000-4000-8000-000000000002' and resolved_at is null), 0,
  'and the alert is resolved');

-- ═══ Payment reminders ══════════════════════════════════════════════════════
select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select throws_ok($$ select public.send_payment_reminder('98000000-0000-4000-8000-000000000002') $$, '42501', null,
  'kitchen cannot send payment reminders');
select pg_temp.act_as('18000000-0000-4000-8000-000000000003', 'aal2');
select lives_ok($$ select public.send_payment_reminder('98000000-0000-4000-8000-000000000002') $$, 'ops reminds an unpaid family');
select throws_like($$ select public.send_payment_reminder('98000000-0000-4000-8000-000000000002') $$, '%12 hours%',
  'not twice within 12 hours');
select pg_temp.reset_role();

-- ═══ Week lifecycle ═════════════════════════════════════════════════════════
select is(public.close_due_weeks() >= 1, true, 'weeks past cutoff (auto-fill done) close automatically');
select is((select array_agg(status::text order by week_start) from public.menu_weeks
           where id in ('88000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002')),
  array['published', 'closed'], 'the open week stays published');

select pg_temp.act_as('18000000-0000-4000-8000-000000000003', 'aal2', 30);
select throws_ok($$ select public.close_week_now('88000000-0000-4000-8000-000000000001') $$, '42501', null,
  'ops cannot close a week early');
select pg_temp.act_as('18000000-0000-4000-8000-000000000004', 'aal2');
select throws_ok($$ select public.close_week_now('88000000-0000-4000-8000-000000000001') $$, '42501', null,
  'the owner needs a fresh MFA check to close early');

-- Late order: the family can't order for the closed week… until the owner allows it.
select pg_temp.act_as('18000000-0000-4000-8000-000000000001');
select throws_like($$ select public.place_family_order((select id from fx where k = 'hh'), '88000000-0000-4000-8000-000000000002',
  '[{"child_id":"68000000-0000-4000-8000-000000000001","menu_item_id":"78000000-0000-4000-8000-000000000001","delivery_date":"2034-01-09"}]',
  'delivery', 'ad800000-0000-4000-8000-000000000001', null, true) $$, '%isn''t open%', 'after cutoff, ordering is refused');
select pg_temp.act_as('18000000-0000-4000-8000-000000000004', 'aal2');
select lives_ok($$ select public.grant_late_order('88000000-0000-4000-8000-000000000002', (select id from fx where k = 'hh'),
  'Forgot to order, owner approved', 12) $$, 'the owner allows a late order for this family');
select pg_temp.act_as('18000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.place_family_order((select id from fx where k = 'hh'), '88000000-0000-4000-8000-000000000002',
  '[{"child_id":"68000000-0000-4000-8000-000000000001","menu_item_id":"78000000-0000-4000-8000-000000000001","delivery_date":"2034-01-09"}]',
  'delivery', 'ad800000-0000-4000-8000-000000000001', null, true) $$, 'the family can now order for that week');

select pg_temp.act_as('18000000-0000-4000-8000-000000000002', 'aal2');
select throws_ok($$ select public.mark_week_fulfilled('88000000-0000-4000-8000-000000000002') $$, '42501', null,
  'kitchen cannot mark a week fulfilled');
select pg_temp.reset_role();

select * from finish();
rollback;
