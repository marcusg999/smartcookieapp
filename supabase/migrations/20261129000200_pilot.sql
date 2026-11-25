-- Phase 10 Part C: pilot program tooling. Pilot households, invites by
-- email, an in-app feedback widget, server-side funnel events (no trackers)
-- and the metrics behind the owner's pilot success criteria.

-- ═════════════════════════════════════════════════════════════════════════════
-- Pilot households: anyone who signed up with a pilot invite, or a family the
-- owner adds to the pilot by hand.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.households add column is_pilot boolean not null default false;
update public.households h set is_pilot = true
  where exists (select 1 from public.household_members m join public.pilot_invites pi on pi.used_by = m.user_id
                where m.household_id = h.id);

create function public.trg_mark_pilot_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pilot_invites where used_by = new.user_id) then
    update public.households set is_pilot = true where id = new.household_id;
  end if;
  return new;
end;
$$;
create trigger household_members_mark_pilot after insert on public.household_members
  for each row execute function public.trg_mark_pilot_household();

-- Owner-editable success criteria (shown on /admin/pilot).
alter table public.site_settings add column pilot_targets jsonb not null
  default '{"reorder_week2_pct": 80, "median_repeat_seconds": 60, "max_allergy_incidents": 0, "allergy_incidents_recorded": 0}'
  check (jsonb_typeof(pilot_targets) = 'object');

alter table public.pilot_invites
  add column invited_at timestamptz,
  add column note text check (char_length(note) <= 200);

/** A fresh, unambiguous invite code (no 0/O/1/I), e.g. SC-7KQ4-M2XD. */
create function public._new_pilot_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := 'SC-';
  i integer;
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    if i = 3 then
      v_code := v_code || '-';
    end if;
  end loop;
  return v_code;
end;
$$;

/** Owner creates an invite; with an email address, the invitation is emailed. */
create function public.create_pilot_invite(p_email text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_id uuid;
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if not public.is_owner_aal2() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  loop
    v_code := public._new_pilot_code();
    exit when not exists (select 1 from public.pilot_invites where code = v_code);
  end loop;
  insert into public.pilot_invites (code, email, note, invited_at)
    values (v_code, v_email, nullif(btrim(p_note), ''), case when v_email is not null then now() end)
    returning id into v_id;
  if v_email is not null then
    perform public.queue_email('pilot_invite', v_email, jsonb_build_object('code', v_code), 'pilot_invite:' || v_id);
  end if;
  return v_code;
end;
$$;

create function public.set_household_pilot(p_household uuid, p_pilot boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner_aal2() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.households set is_pilot = p_pilot where id = p_household;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Funnel events, recorded server-side by triggers (no browser tracking):
-- a family starts a week's cart, then places the order. The time between
-- them is "time to place an order"; is_repeat marks returning families.
-- ═════════════════════════════════════════════════════════════════════════════
create table public.funnel_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  menu_week_id uuid references public.menu_weeks (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  event text not null check (event in ('order_started', 'order_placed')),
  is_repeat boolean,
  duration_seconds integer check (duration_seconds >= 0),
  occurred_at timestamptz not null default now()
);
create index funnel_events_household_idx on public.funnel_events (household_id, menu_week_id, occurred_at desc);
create index funnel_events_week_idx on public.funnel_events (menu_week_id);
create index funnel_events_order_idx on public.funnel_events (order_id);
alter table public.funnel_events enable row level security;
revoke all on public.funnel_events from anon, authenticated;
grant select on public.funnel_events to authenticated;
create policy "Ops and owner read funnel events (AAL2)" on public.funnel_events
  for select to authenticated using (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]));

create function public.trg_funnel_cart_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.replaces_order_id is null then
    insert into public.funnel_events (household_id, menu_week_id, event) values (new.household_id, new.menu_week_id, 'order_started');
  end if;
  return new;
end;
$$;
create trigger carts_funnel_started after insert on public.carts
  for each row execute function public.trg_funnel_cart_started();

create function public.trg_funnel_order_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
begin
  if new.household_id is null or new.source = 'subscription' then
    return new;
  end if;
  select max(occurred_at) into v_started from public.funnel_events
    where household_id = new.household_id and menu_week_id = new.menu_week_id and event = 'order_started';
  insert into public.funnel_events (household_id, menu_week_id, order_id, event, is_repeat, duration_seconds)
  values (new.household_id, new.menu_week_id, new.id, 'order_placed',
          exists (select 1 from public.orders o where o.household_id = new.household_id and o.id <> new.id
                  and o.status not in ('draft', 'cancelled')),
          case when v_started is not null then greatest(0, extract(epoch from now() - v_started))::integer end);
  return new;
end;
$$;
create trigger orders_funnel_placed after insert on public.orders
  for each row execute function public.trg_funnel_order_placed();

-- ═════════════════════════════════════════════════════════════════════════════
-- Feedback from pilot families: a weekly 1–5 rating and "Something confusing?"
-- notes with the page they were on.
-- ═════════════════════════════════════════════════════════════════════════════
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  kind text not null check (kind in ('weekly', 'confusing')),
  rating smallint check (rating between 1 and 5),
  comment text check (char_length(comment) <= 2000),
  page_path text check (char_length(page_path) <= 300 and page_path ~ '^/'),
  menu_week_id uuid references public.menu_weeks (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  constraint feedback_weekly_has_rating check (kind <> 'weekly' or rating is not null),
  constraint feedback_confusing_has_comment check (kind <> 'confusing' or char_length(btrim(comment)) > 0)
);
create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_user_idx on public.feedback (user_id);
create index feedback_household_idx on public.feedback (household_id);
create index feedback_week_idx on public.feedback (menu_week_id);
create index feedback_resolved_by_idx on public.feedback (resolved_by);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select, insert (household_id, kind, rating, comment, page_path, menu_week_id) on public.feedback to authenticated;
grant update (resolved_at, resolved_by) on public.feedback to authenticated;

create function public.is_pilot_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.household_members m join public.households h on h.id = m.household_id
                 where m.user_id = (select auth.uid()) and h.is_pilot and h.closed_at is null);
$$;

create policy "Pilot families send feedback for their household" on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_pilot_user()
              and (household_id is null or public.is_household_member(household_id)));
create policy "People read their own feedback" on public.feedback
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Ops and owner read feedback (AAL2)" on public.feedback
  for select to authenticated using (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]));
create policy "Ops and owner resolve feedback (AAL2)" on public.feedback
  for update to authenticated
  using (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]))
  with check (public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]));

-- ═════════════════════════════════════════════════════════════════════════════
-- Pilot metrics for the owner (/admin/pilot). Pilot households only.
-- ═════════════════════════════════════════════════════════════════════════════
create function public.pilot_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone (select timezone from public.site_settings where id))::date;
  v jsonb;
begin
  if not public.has_any_role_aal2(array['ops', 'owner']::public.app_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  with pilot as (
    select id, onboarded_at, created_at from public.households where is_pilot
  ), counted as (
    select o.household_id, o.menu_week_id, w.week_start
    from public.orders o join public.menu_weeks w on w.id = o.menu_week_id join pilot p on p.id = o.household_id
    where o.status in ('paid', 'invoiced', 'fulfilled', 'partially_refunded')
    group by 1, 2, 3
  ), firsts as (
    select household_id, min(week_start) as first_week from counted group by 1
  ), week2 as (
    -- Families whose second week has passed its cutoff, and whether they ordered again.
    select f.household_id,
           exists (select 1 from counted c where c.household_id = f.household_id and c.week_start = f.first_week + 7) as reordered
    from firsts f
    join public.menu_weeks nw on nw.week_start = f.first_week + 7
    where public.menu_week_cutoff(nw.id) < now()
  ), placed as (
    select fe.* from public.funnel_events fe join pilot p on p.id = fe.household_id where fe.event = 'order_placed'
  ), started as (
    select distinct fe.household_id, fe.menu_week_id from public.funnel_events fe join pilot p on p.id = fe.household_id
    where fe.event = 'order_started'
  ), pilot_orders as (
    select o.* from public.orders o join pilot p on p.id = o.household_id where o.source <> 'subscription'
  )
  select jsonb_build_object(
    'families', (select count(*) from pilot),
    'onboarded', (select count(*) from pilot where onboarded_at is not null),
    'first_order', (select count(*) from firsts),
    'repeat_order', (select count(*) from (select household_id from counted group by 1 having count(*) >= 2) r),
    'week2_eligible', (select count(*) from week2),
    'week2_reordered', (select count(*) from week2 where reordered),
    'median_first_seconds', (select percentile_cont(0.5) within group (order by duration_seconds) from placed
                             where not is_repeat and duration_seconds is not null),
    'median_repeat_seconds', (select percentile_cont(0.5) within group (order by duration_seconds) from placed
                              where is_repeat and duration_seconds is not null),
    'funnel', jsonb_build_object(
      'started', (select count(*) from started),
      'placed', (select count(*) from pilot_orders where status <> 'draft'),
      'allergy_confirmed', (select count(*) from pilot_orders where allergy_confirmed_at is not null),
      'paid', (select count(*) from pilot_orders where status in ('paid', 'invoiced', 'fulfilled', 'partially_refunded', 'refunded'))
    ),
    'allergy_conflicts_caught', (select count(*) from public.allergy_conflict_alerts a join public.orders o on o.id = a.order_id
                                 join pilot p on p.id = o.household_id),
    'feedback_avg_rating', (select round(avg(f.rating)::numeric, 1) from public.feedback f join pilot p on p.id = f.household_id
                            where f.kind = 'weekly'),
    'feedback_open', (select count(*) from public.feedback where resolved_at is null),
    'as_of', v_today
  ) into v;
  return v;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Invitation email (owner-editable like every other email).
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.email_templates (key, subject, preheader, body_rich, cta_label) values
  ('pilot_invite', 'You''re invited to try Smart Cookie', 'Your founding-family invite code is inside.',
   '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi! You''re one of a few founding families we''re inviting to try ordering online before everyone else."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Your invite code: {{code}}"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Tap the button to create your account (the code is filled in for you). Tell us what''s confusing; that''s the whole point of the pilot."}]}]}',
   'Create my account')
on conflict (key) do nothing;

-- Grants
revoke execute on function public.trg_mark_pilot_household(), public._new_pilot_code(), public.create_pilot_invite(text, text),
  public.set_household_pilot(uuid, boolean), public.trg_funnel_cart_started(), public.trg_funnel_order_placed(),
  public.is_pilot_user(), public.pilot_metrics()
  from public, anon, authenticated;
grant execute on function public.create_pilot_invite(text, text), public.set_household_pilot(uuid, boolean),
  public.is_pilot_user(), public.pilot_metrics() to authenticated;
