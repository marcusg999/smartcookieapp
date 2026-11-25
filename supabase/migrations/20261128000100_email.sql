-- Phase 9: transactional email. notifications_log becomes a proper queue
-- (dedupe keys, retries, recipient hashes instead of addresses once sent);
-- marketing preferences with one-click unsubscribe; short-lived "repeat
-- last week" sign-in links; new-device alerts; database triggers that queue
-- an email for every important moment, and the scheduled jobs (cutoff
-- reminder, renewal reminder, owner digests). Copy lives in email_templates
-- (owner-editable); this migration seeds every template so production has them.

-- ─────────────────────────────────────────────────────────────────────────────
-- Queue
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notifications_log
  alter column to_address drop not null,
  add column dedupe_key text,
  add column recipient_hash text,
  add column attempts smallint not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column user_id uuid references auth.users (id) on delete set null,
  add column created_at timestamptz not null default now();
create unique index notifications_log_dedupe_uq on public.notifications_log (dedupe_key) where dedupe_key is not null;
create index notifications_log_due_idx on public.notifications_log (next_attempt_at) where status = 'queued';
alter table public.notifications_log drop constraint notifications_log_status_check;
alter table public.notifications_log
  add constraint notifications_log_status_check check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'skipped'));

-- Logs keep a hash of the recipient, never a readable address once the email
-- is handled (the worker clears to_address after sending or giving up).
create function public.notifications_log_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.to_address is not null then
    new.recipient_hash := encode(extensions.digest(lower(btrim(new.to_address)), 'sha256'), 'hex');
  end if;
  return new;
end;
$$;
create trigger notifications_log_hash before insert or update of to_address on public.notifications_log
  for each row execute function public.notifications_log_hash();
update public.notifications_log set recipient_hash = encode(extensions.digest(lower(btrim(to_address)), 'sha256'), 'hex')
  where to_address is not null;

-- One way to queue an email from SQL. A repeated dedupe key is ignored, so a
-- replayed webhook or a re-run job never sends twice.
create function public.queue_email(
  p_template text, p_to text, p_payload jsonb default '{}', p_dedupe text default null,
  p_household uuid default null, p_org uuid default null, p_user uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_to is null or btrim(p_to) = '' then
    return null;
  end if;
  insert into public.notifications_log (to_address, template_key, status, payload, dedupe_key, household_id, organization_id, user_id)
    values (p_to, p_template, 'queued', coalesce(p_payload, '{}'), p_dedupe, p_household, p_org, p_user)
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_id;
  return v_id;
end;
$$;

-- The household's main parent: id, email and first name.
create function public._household_contact(p_household uuid, out user_id uuid, out email text, out first_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, split_part(coalesce(p.full_name, ''), ' ', 1)
  from public.households h
  join auth.users u on u.id = h.primary_user_id
  left join public.profiles p on p.id = u.id
  where h.id = p_household;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Settings and templates
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.site_settings
  -- cutoff_reminder_hours: "menu closes soon" lead time. renewal_reminder_days:
  -- notice before a monthly plan renews. postal_address: shown in marketing
  -- email footers (CAN-SPAM). reply_to: where replies go (the owner's inbox).
  add column email_settings jsonb not null
    default '{"cutoff_reminder_hours": 24, "renewal_reminder_days": 3, "postal_address": "", "reply_to": ""}';

alter table public.email_templates
  add column cta_label text check (char_length(cta_label) <= 60);

-- ─────────────────────────────────────────────────────────────────────────────
-- Marketing preferences + one-click unsubscribe (transactional and security
-- emails can't be turned off).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.email_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  menu_published boolean not null default true,
  cutoff_reminders boolean not null default true,
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
alter table public.email_preferences enable row level security;
revoke all on public.email_preferences from anon, authenticated;
grant select, insert, update (menu_published, cutoff_reminders) on public.email_preferences to authenticated;
create policy "Users read their email preferences" on public.email_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create their email preferences" on public.email_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their email preferences" on public.email_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger email_preferences_touch before update on public.email_preferences
  for each row execute function public.touch_updated_at();

create function public._ensure_email_preferences(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  insert into public.email_preferences (user_id) values (p_user) on conflict (user_id) do nothing;
  select unsubscribe_token into v_token from public.email_preferences where user_id = p_user;
  return v_token;
end;
$$;

-- Unsubscribe links work without signing in (RFC 8058 one-click). The token
-- identifies only a preferences row; it reveals nothing about the person.
create function public.email_unsubscribe(p_token uuid, p_category text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_category not in ('menu_published', 'cutoff_reminders', 'all') then
    return false;
  end if;
  update public.email_preferences
    set menu_published = case when p_category in ('menu_published', 'all') then false else menu_published end,
        cutoff_reminders = case when p_category in ('cutoff_reminders', 'all') then false else cutoff_reminders end
    where unsubscribe_token = p_token;
  return found;
end;
$$;

create function public.email_preferences_by_token(p_token uuid)
returns table (menu_published boolean, cutoff_reminders boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select menu_published, cutoff_reminders from public.email_preferences where unsubscribe_token = p_token;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- "Repeat last week" links in the cutoff reminder: single use, hashed at rest,
-- valid until the week's cutoff. Redeemed server-side only.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.deep_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('repeat_last_week')),
  menu_week_id uuid references public.menu_weeks (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.deep_link_tokens enable row level security;
revoke all on public.deep_link_tokens from anon, authenticated;
-- No policies: only the service role (the redeem route) touches this table.

create function public.redeem_deep_link(p_token text)
returns table (user_id uuid, purpose text, menu_week_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.deep_link_tokens;
begin
  update public.deep_link_tokens d set used_at = now()
    where d.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and d.used_at is null and d.expires_at > now()
    returning * into t;
  if t.id is null then
    return;
  end if;
  return query select t.user_id, t.purpose, t.menu_week_id;
end;
$$;

create function public._new_deep_link(p_user uuid, p_week uuid, p_expires timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');
begin
  insert into public.deep_link_tokens (token_hash, user_id, purpose, menu_week_id, expires_at)
    values (encode(extensions.digest(v_raw, 'sha256'), 'hex'), p_user, 'repeat_last_week', p_week, p_expires);
  return v_raw;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Known devices: the owner is alerted when their account signs in from a
-- device it hasn't used before. Only a hash of the device is stored.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.known_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_hash text not null check (char_length(device_hash) = 64),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_hash)
);
alter table public.known_devices enable row level security;
revoke all on public.known_devices from anon, authenticated;

create function public.record_sign_in_device(p_user uuid, p_device_hash text, p_device_label text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_had_devices boolean;
  v_new boolean;
  v_email text;
begin
  select exists (select 1 from public.known_devices where user_id = p_user) into v_had_devices;
  insert into public.known_devices (user_id, device_hash) values (p_user, p_device_hash)
    on conflict (user_id, device_hash) do update set last_seen = now()
    returning (xmax = 0) into v_new;
  -- Alert owners (the first device ever isn't "new").
  if v_new and v_had_devices and exists (select 1 from public.user_roles where user_id = p_user and role = 'owner') then
    select email into v_email from auth.users where id = p_user;
    perform public.queue_email('security_new_device', v_email,
      jsonb_build_object('device', left(coalesce(p_device_label, 'a new device'), 120), 'signed_in_at', now()),
      'new_device:' || p_user || ':' || p_device_hash, null, null, p_user);
  end if;
  return v_new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Automatic Renewal Law: what the parent agreed to, and when.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.subscriptions
  add column renewal_consent_at timestamptz,
  add column renewal_terms text check (char_length(renewal_terms) <= 2000);

create function public.record_renewal_consent(p_subscription uuid, p_terms text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.subscriptions
    set renewal_consent_at = now(), renewal_terms = left(btrim(p_terms), 2000)
    where id = p_subscription and household_id is not null and public.is_household_member(household_id);
  if not found then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Event triggers: every important moment queues one email (deduplicated)
-- ═════════════════════════════════════════════════════════════════════════════

-- Family orders: confirmed, changed, cancelled, refunded.
create function public.trg_order_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if new.household_id is null then
    return new;
  end if;
  select * into c from public._household_contact(new.household_id);
  if c.email is null then
    return new;
  end if;
  -- Confirmed: first time it's paid (plan auto-fill orders have their own email).
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status not in ('paid', 'fulfilled', 'partially_refunded'))
     and new.source::text <> 'subscription' then
    perform public.queue_email('order_confirmation', c.email, jsonb_build_object('order_id', new.id),
      'order_confirmation:' || new.id, new.household_id, null, c.user_id);
  end if;
  if tg_op = 'UPDATE' then
    -- Changed before cutoff (re-priced: the payment version moves on).
    if new.payment_version > old.payment_version and new.status <> 'cancelled' and old.placed_at is not null
       and old.status in ('paid', 'partially_refunded', 'pending_payment') then
      perform public.queue_email('order_modified', c.email, jsonb_build_object('order_id', new.id),
        'order_modified:' || new.id || ':' || new.payment_version, new.household_id, null, c.user_id);
    end if;
    -- Cancelled after it was paid (an unpaid order that expires isn't emailed).
    if new.status = 'cancelled' and old.status in ('paid', 'partially_refunded') then
      perform public.queue_email('order_cancelled', c.email, jsonb_build_object('order_id', new.id),
        'order_cancelled:' || new.id, new.household_id, null, c.user_id);
    end if;
    -- Money back.
    if new.amount_refunded_cents > old.amount_refunded_cents then
      perform public.queue_email('order_refunded', c.email,
        jsonb_build_object('order_id', new.id, 'refund_cents', new.amount_refunded_cents - old.amount_refunded_cents),
        'order_refunded:' || new.id || ':' || new.amount_refunded_cents, new.household_id, null, c.user_id);
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_emails after insert or update on public.orders
  for each row execute function public.trg_order_emails();

-- Plans: started (with the renewal terms), paused, resumed, cancelled.
create function public.trg_subscription_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  p public.plans;
  v_payload jsonb;
begin
  if new.household_id is null then
    return new;
  end if;
  select * into c from public._household_contact(new.household_id);
  if c.email is null then
    return new;
  end if;
  select * into p from public.plans where id = new.plan_id;
  v_payload := jsonb_build_object('subscription_id', new.id, 'plan_name', p.name, 'price_cents', p.price_cents,
    'interval', p.billing_interval, 'quantity', new.quantity, 'min_term', p.min_commitment_intervals,
    'period_end', new.current_period_end, 'paused_until', new.paused_until, 'renewal_terms', new.renewal_terms);
  if new.status in ('active', 'trialing') and old.status not in ('active', 'trialing', 'past_due', 'paused') then
    perform public.queue_email('subscription_started', c.email, v_payload, 'subscription_started:' || new.id,
      new.household_id, null, c.user_id);
  end if;
  if new.paused_until is not null and new.paused_until > now() and new.paused_until is distinct from old.paused_until then
    perform public.queue_email('subscription_paused', c.email, v_payload,
      'subscription_paused:' || new.id || ':' || new.paused_until, new.household_id, null, c.user_id);
  end if;
  if old.paused_until is not null and new.paused_until is null and new.status in ('active', 'trialing') then
    perform public.queue_email('subscription_resumed', c.email, v_payload,
      'subscription_resumed:' || new.id || ':' || old.paused_until, new.household_id, null, c.user_id);
  end if;
  if (new.cancel_at_period_end and not old.cancel_at_period_end)
     or (new.status = 'canceled' and old.status <> 'canceled' and not old.cancel_at_period_end) then
    perform public.queue_email('subscription_cancelled', c.email, v_payload,
      'subscription_cancelled:' || new.id || ':' || coalesce(new.current_period_end::text, ''), new.household_id, null, c.user_id);
  end if;
  return new;
end;
$$;
create trigger subscriptions_emails after update on public.subscriptions
  for each row execute function public.trg_subscription_emails();

-- New weekly menu published (marketing: respects preferences at send time).
create function public.trg_menu_published_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' and old.status <> 'closed'
     and new.week_start >= (now() at time zone (select timezone from public.site_settings where id))::date - 6 then
    perform public.queue_email('menu_published', u.email,
      jsonb_build_object('menu_week_id', new.id, 'week_start', new.week_start), 'menu_published:' || new.id || ':' || h.id,
      h.id, null, u.id)
    from public.households h join auth.users u on u.id = h.primary_user_id
    where h.onboarded_at is not null and u.email is not null;
  end if;
  return new;
end;
$$;
create trigger menu_weeks_published_emails after update of status on public.menu_weeks
  for each row execute function public.trg_menu_published_emails();

-- School invoice paid (card, ACH or check).
create function public.trg_invoice_paid_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select billing_email into v_email from public.organizations where id = new.organization_id;
    perform public.queue_email('school_invoice_paid', v_email, jsonb_build_object('invoice_id', new.id),
      'school_invoice_paid:' || new.id, null, new.organization_id, null);
  end if;
  return new;
end;
$$;
create trigger invoices_paid_email after update of status on public.invoices
  for each row execute function public.trg_invoice_paid_email();

-- Security alert: a staff role was granted. Every owner hears about it.
create function public.trg_staff_role_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('kitchen', 'ops', 'owner') then
    perform public.queue_email('security_role_granted', u.email,
      jsonb_build_object('role', new.role, 'staff_email', (select email from auth.users where id = new.user_id),
                         'granted_by', coalesce((select full_name from public.profiles where id = new.granted_by), 'the system')),
      'role_granted:' || new.id || ':' || o.user_id, null, null, o.user_id)
    from public.user_roles o join auth.users u on u.id = o.user_id
    where o.role = 'owner' and u.email is not null;
  end if;
  return new;
end;
$$;
create trigger user_roles_security_email after insert on public.user_roles
  for each row execute function public.trg_staff_role_email();

-- ═════════════════════════════════════════════════════════════════════════════
-- Scheduled jobs
-- ═════════════════════════════════════════════════════════════════════════════

-- Who gets the "menu closes soon" reminder for a week: onboarded households
-- that haven't ordered, plus subscribers who still have meals to pick. Not
-- households whose plan skipped the week.
create function public.cutoff_reminder_targets(p_week uuid)
returns table (household_id uuid, user_id uuid, email text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select o.household_id, sum(oi.quantity) filter (where oi.covered_by_subscription) as covered
    from public.orders o left join public.order_items oi on oi.order_id = o.id
    where o.menu_week_id = p_week and o.household_id is not null
      and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled', 'partially_refunded')
    group by o.household_id
  ), subs as (
    select s.household_id, s.id, a.meals_allowed, coalesce(a.skipped, false) as skipped
    from public.subscriptions s
    left join public.subscription_allowances a on a.subscription_id = s.id and a.menu_week_id = p_week
    where s.household_id is not null and s.status in ('active', 'trialing')
      and (s.paused_until is null or s.paused_until <= now())
  )
  select h.id, u.id, u.email::text,
         case when l.household_id is null then 'not_ordered' else 'allowance_left' end
  from public.households h
  join auth.users u on u.id = h.primary_user_id
  left join live l on l.household_id = h.id
  left join subs s on s.household_id = h.id
  where h.onboarded_at is not null and u.email is not null
    and coalesce(s.skipped, false) = false
    and (l.household_id is null
         or (s.id is not null and coalesce(l.covered, 0) < coalesce(s.meals_allowed, 0)));
$$;

create function public.queue_cutoff_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  t record;
  v_hours integer := coalesce(((select email_settings from public.site_settings where id) ->> 'cutoff_reminder_hours')::integer, 24);
  v_token text;
  v_n integer := 0;
begin
  for w in
    select mw.id, mw.week_start, public.menu_week_cutoff(mw.id) as cutoff
    from public.menu_weeks mw
    where mw.status = 'published' and (mw.ordering_opens_at is null or mw.ordering_opens_at <= now())
      and public.menu_week_cutoff(mw.id) > now()
      and public.menu_week_cutoff(mw.id) <= now() + make_interval(hours => v_hours)
  loop
    for t in select * from public.cutoff_reminder_targets(w.id) loop
      continue when exists (select 1 from public.notifications_log
                            where dedupe_key = 'cutoff_reminder:' || w.id || ':' || t.household_id);
      v_token := public._new_deep_link(t.user_id, w.id, w.cutoff);
      perform public.queue_email('order_cutoff_reminder', t.email,
        jsonb_build_object('menu_week_id', w.id, 'week_start', w.week_start, 'cutoff', w.cutoff,
                           'reason', t.reason, 'deep_link_token', v_token),
        'cutoff_reminder:' || w.id || ':' || t.household_id, t.household_id, null, t.user_id);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Upcoming renewal (monthly plans): a few days' notice before each charge.
create function public.queue_renewal_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := coalesce(((select email_settings from public.site_settings where id) ->> 'renewal_reminder_days')::integer, 3);
  r record;
  v_n integer := 0;
begin
  for r in
    select s.*, p.name as plan_name, p.price_cents, p.billing_interval
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.household_id is not null and s.status = 'active' and not s.cancel_at_period_end
      and (s.paused_until is null or s.paused_until <= now())
      and p.billing_interval = 'month'
      and s.current_period_end > now() and s.current_period_end <= now() + make_interval(days => v_days)
  loop
    if public.queue_email('subscription_renewal_reminder', (select email from public._household_contact(r.household_id)),
         jsonb_build_object('subscription_id', r.id, 'plan_name', r.plan_name, 'price_cents', r.price_cents,
                            'quantity', r.quantity, 'period_end', r.current_period_end, 'interval', r.billing_interval),
         'renewal:' || r.id || ':' || r.current_period_end, r.household_id, null,
         (select user_id from public._household_contact(r.household_id))) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Weeks close at cutoff (Phase 8) and the owner gets the cutoff digest.
create or replace function public.close_due_weeks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_owner text := (select contact_email from public.site_settings where id);
  v_n integer := 0;
begin
  for w in
    update public.menu_weeks mw set status = 'closed'
      where mw.status = 'published' and public.menu_week_cutoff(mw.id) <= now()
        and (mw.auto_filled_at is not null or public.menu_week_cutoff(mw.id) < now() - interval '1 day')
      returning mw.id, mw.week_start
  loop
    v_n := v_n + 1;
    perform public.queue_email('owner_cutoff_digest', v_owner, jsonb_build_object(
      'menu_week_id', w.id, 'week_start', w.week_start,
      'orders', (select count(*) from public.orders o where o.menu_week_id = w.id
                 and o.status in ('paid', 'invoiced', 'fulfilled', 'partially_refunded', 'pending_payment')),
      'meals', (select coalesce(sum(oi.quantity), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                where o.menu_week_id = w.id and o.status in ('paid', 'invoiced', 'fulfilled', 'partially_refunded')),
      'unpaid', (select count(*) from public.orders o where o.menu_week_id = w.id and o.status = 'pending_payment'),
      'attention', (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id
                    where o.menu_week_id = w.id and oi.child_id is not null
                      and o.status in ('pending_payment', 'paid', 'partially_refunded')
                      and public._line_conflict(oi.child_id, oi.menu_item_id, oi.allergens_contained, oi.may_contain) is not null)),
      'cutoff_digest:' || w.id);
  end loop;
  return v_n;
end;
$$;

-- Daily owner summary: failed payments, past-due plans, overdue invoices.
create function public.queue_owner_payments_summary()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone (select timezone from public.site_settings where id))::date;
  v_failed integer;
  v_past_due integer;
  v_overdue integer;
  v_overdue_cents bigint;
begin
  select count(*) into v_failed from public.orders o join public.menu_weeks w on w.id = o.menu_week_id
    where o.status = 'pending_payment' and o.payment_failed_at is not null and w.week_start >= v_today - 7;
  select count(*) into v_past_due from public.subscriptions where status in ('past_due', 'unpaid');
  select count(*), coalesce(sum(total_cents - amount_paid_cents), 0) into v_overdue, v_overdue_cents
    from public.invoices where status = 'open' and due_date < v_today;
  if v_failed + v_past_due + v_overdue = 0 then
    return 0;
  end if;
  perform public.queue_email('owner_payments_summary', (select contact_email from public.site_settings where id),
    jsonb_build_object('failed_orders', v_failed, 'past_due_plans', v_past_due, 'overdue_invoices', v_overdue,
                       'overdue_cents', v_overdue_cents),
    'payments_summary:' || v_today);
  return 1;
end;
$$;

-- School invoices: "due soon" 3 days before the due date (Phase 7 already
-- sends the overdue reminders at +3 and +7 days).
alter table public.invoices add column reminder_due_soon_at timestamptz;
create function public.queue_school_invoice_due_soon()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone (select timezone from public.site_settings where id))::date;
  r record;
  v_n integer := 0;
begin
  for r in
    select i.id, i.organization_id, o.billing_email from public.invoices i join public.organizations o on o.id = i.organization_id
    where i.status = 'open' and i.reminder_due_soon_at is null and i.due_date between v_today and v_today + 3
      and i.created_at < now() - interval '1 day'
  loop
    perform public.queue_email('school_invoice_due_soon', r.billing_email, jsonb_build_object('invoice_id', r.id),
      'school_invoice_due_soon:' || r.id, null, r.organization_id, null);
    update public.invoices set reminder_due_soon_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

select cron.schedule('cutoff-reminders', '*/15 * * * *', $$select public.queue_cutoff_reminders()$$);
select cron.schedule('renewal-reminders', '35 16 * * *', $$select public.queue_renewal_reminders()$$);
select cron.schedule('owner-payments-summary', '25 16 * * *', $$select public.queue_owner_payments_summary()$$);
select cron.schedule('school-invoice-due-soon', '15 16 * * *', $$select public.queue_school_invoice_due_soon()$$);

-- ═════════════════════════════════════════════════════════════════════════════
-- Email templates (owner-editable in Admin → Emails). Seeded here so every
-- environment, production included, has them; existing copy is never replaced.
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.email_templates (key, subject, preheader, body_rich, cta_label) values
  ('order_confirmation', 'Your Smart Cookie order {{order_number}} is confirmed', 'Here''s what''s coming.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, thanks for your order! Here''s what we''ll cook:"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "{{meals}}"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Delivery: {{delivery_dates}}. Total: {{total}}."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Allergies you confirmed at checkout: {{allergy_recap}}"}]}]}', 'View your order'),
  ('order_modified', 'Your order {{order_number}} was updated', 'Here''s the new version.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, your changes to order {{order_number}} are saved. Here''s what we''ll cook now:"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "{{meals}}"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "New total: {{total}}. If the total went up we charged the difference to your card; if it went down we refunded it."}]}]}', 'View your order'),
  ('order_cancelled', 'Order {{order_number}} is cancelled', 'We won''t cook this one.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, order {{order_number}} is cancelled. Anything you paid is refunded to your card (it usually shows within 5 to 10 days)."}]}]}', 'See your orders'),
  ('order_refunded', 'We''ve refunded {{refund_amount}} for order {{order_number}}', 'It''s on its way back to your card.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, we''ve refunded {{refund_amount}} for order {{order_number}}. It usually shows on your statement within 5 to 10 days."}]}]}', 'View your order'),
  ('order_cutoff_reminder', 'The menu for the week of {{week_of}} closes {{cutoff}}', 'Order in a tap: repeat last week.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, ordering for the week of {{week_of}} closes {{cutoff}}."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "{{reason_line}}"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Tap the button to put last week''s meals in your cart (we''ll swap anything that''s not on the menu or clashes with allergies), then check out."}]}]}', 'Repeat last week'),
  ('menu_published', 'The menu for the week of {{week_of}} is here', 'Fresh meals, chosen by our chef.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, next week''s menu is ready. Order by {{cutoff}} so we can cook for you."}]}]}', 'See the menu'),
  ('subscription_started', 'Your {{plan_name}} plan has started', 'Here are your plan terms.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, welcome! Your {{plan_name}} plan is active."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Your plan terms: {{renewal_terms}}"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "You can skip a week, pause or cancel any time from your plan page: {{plan_url}}"}]}]}', 'Manage your plan'),
  ('subscription_renewal_reminder', 'Your plan renews on {{renews_on}}', 'No action needed to keep it.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, your {{plan_name}} plan renews on {{renews_on}} for {{amount}}."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "To skip, pause or cancel, visit your plan page before then."}]}]}', 'Manage your plan'),
  ('subscription_paused', 'Your plan is paused until {{paused_until}}', 'No charges while it''s paused.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, your {{plan_name}} plan is paused until {{paused_until}}. You won''t be charged while it''s paused."}]}]}', 'Manage your plan'),
  ('subscription_resumed', 'Your plan is back on', 'Meals are included again.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, your {{plan_name}} plan is active again. Your included meals are ready to pick."}]}]}', 'Order this week'),
  ('subscription_cancelled', 'Your plan ends on {{ends_on}}', 'You won''t be charged again.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, your {{plan_name}} plan ends on {{ends_on}} and you won''t be charged again."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Changed your mind? You can keep your plan from the plan page before then."}]}]}', 'Manage your plan'),
  ('subscription_autofill', 'We picked your meals for the week of {{week_of}}', 'Your plan''s meals are chosen. Allergies checked.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "The cutoff passed, so we chose your included meals from your favourites (then chef''s choice), skipping anything that clashes with your kids'' allergies. Order {{order_number}}:"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "{{meals}}"}]}]}', 'View your order'),
  ('subscription_autofill_failed', 'We couldn''t pick meals for the week of {{week_of}}', 'Please get in touch.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "The cutoff passed, but we couldn''t safely choose meals for your plan this week (no delivery address, or no meal that fits everyone''s allergies). Reply to this email and we''ll sort it out."}]}]}', null),
  ('payment_failed', 'Your Smart Cookie plan payment didn''t go through', 'Update your card to keep meals included.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi {{first_name}}, we couldn''t take your latest plan payment. We''ll try again automatically, but the quickest fix is to update your card."}]}]}', 'Update your card'),
  ('school_invoice_due_soon', 'Invoice {{invoice_number}} is due {{due_date}}', 'Pay by card or bank transfer.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A friendly reminder: invoice {{invoice_number}} ({{amount}}) for {{school_name}} is due on {{due_date}}."}]}]}', 'View and pay'),
  ('school_invoice_paid', 'Thank you: invoice {{invoice_number}} is paid', 'We''ve received your payment.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Thank you! We''ve received payment for invoice {{invoice_number}} ({{period}})."}]}]}', 'View invoices'),
  ('school_staff_added', 'You''ve been added to {{school_name}} on Smart Cookie', 'See your school''s orders.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "You now have access to {{school_name}}''s orders and classrooms on Smart Cookie. Sign in with this email address to get started."}]}]}', 'Open the school portal'),
  ('owner_cutoff_digest', 'Cutoff passed: {{orders}} orders for the week of {{week_of}}', 'Your kitchen summary.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "The cutoff for the week of {{week_of}} has passed. {{orders}} orders, {{meals}} paid or invoiced meals."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Unpaid orders: {{unpaid}}. Meals that need allergy attention: {{attention}}."}]}]}', 'Open This week'),
  ('owner_payments_summary', 'Payments needing attention', 'Failed payments and overdue invoices.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Failed family payments: {{failed_orders}}. Plans past due: {{past_due_plans}}. Overdue school invoices: {{overdue_invoices}} ({{overdue_amount}})."}]}]}', 'Who has paid'),
  ('security_role_granted', 'Security alert: {{staff_email}} now has the {{role}} role', 'A staff role was granted.', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "{{staff_email}} was given the {{role}} role by {{granted_by}}. If you didn''t expect this, review your staff list and remove the role."}]}]}', 'Review staff'),
  ('security_new_device', 'Security alert: new sign-in to your owner account', 'Was this you?', '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Your owner account was just used to sign in from {{device}}. If this was you, there''s nothing to do. If not, change your password and sign out of all devices right away."}]}]}', 'Review your account')
on conflict (key) do nothing;

-- Buttons for templates created in earlier phases.
update public.email_templates set cta_label = v.label
  from (values ('school_application', 'Review the school'), ('school_approved', 'Open the school portal'),
               ('school_week_ready', 'Review next week'), ('school_invoice', 'View and pay'),
               ('school_invoice_reminder', 'View and pay'), ('allergy_conflict', 'View the order'),
               ('order_delivered', 'View your order'), ('payment_reminder', 'Pay now')) v(key, label)
  where email_templates.key = v.key and email_templates.cta_label is null;

-- ═════════════════════════════════════════════════════════════════════════════
-- Privileges
-- ═════════════════════════════════════════════════════════════════════════════
revoke execute on function public.notifications_log_hash(), public.queue_email(text, text, jsonb, text, uuid, uuid, uuid),
  public._household_contact(uuid), public._ensure_email_preferences(uuid), public.redeem_deep_link(text),
  public._new_deep_link(uuid, uuid, timestamptz), public.record_sign_in_device(uuid, text, text),
  public.trg_order_emails(), public.trg_subscription_emails(), public.trg_menu_published_emails(),
  public.trg_invoice_paid_email(), public.trg_staff_role_email(), public.cutoff_reminder_targets(uuid),
  public.queue_cutoff_reminders(), public.queue_renewal_reminders(), public.queue_owner_payments_summary(),
  public.queue_school_invoice_due_soon()
  from public, anon, authenticated;
grant execute on function public.queue_email(text, text, jsonb, text, uuid, uuid, uuid), public._ensure_email_preferences(uuid),
  public.redeem_deep_link(text), public.record_sign_in_device(uuid, text, text), public.cutoff_reminder_targets(uuid),
  public.queue_cutoff_reminders(), public.queue_renewal_reminders(), public.queue_owner_payments_summary(),
  public.queue_school_invoice_due_soon()
  to service_role;
-- One-click unsubscribe works signed out; the token is the only key.
revoke execute on function public.email_unsubscribe(uuid, text), public.email_preferences_by_token(uuid) from public;
grant execute on function public.email_unsubscribe(uuid, text), public.email_preferences_by_token(uuid) to anon, authenticated;
revoke execute on function public.record_renewal_consent(uuid, text) from public, anon;
grant execute on function public.record_renewal_consent(uuid, text) to authenticated;
