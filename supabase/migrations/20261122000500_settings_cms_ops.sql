-- Phase 3 (5/5): site settings, CMS, ops tables, and the business functions
-- that depend on them: effective cutoff, rotation generator, allergy
-- conflicts, server-priced order creation, and the kitchen view.

-- ─────────────────────────────────────────────────────────────────────────────
-- Site settings (singleton) + public view of the safe columns
-- ─────────────────────────────────────────────────────────────────────────────
create table public.site_settings (
  id boolean primary key default true check (id), -- exactly one row
  business_name text not null default 'Smart Cookie' check (char_length(business_name) between 1 and 80),
  logo_path text,
  brand_colors jsonb not null default '{"primary":"#ff5b14","background":"#d9d5cd","surface":"#f4f1ea","ink":"#151311"}',
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (char_length(contact_phone) <= 32),
  social_links jsonb not null default '{}',
  timezone text not null default 'America/Los_Angeles',
  -- Default cutoff rule: N days before the week starts (Monday), at a local time.
  -- 4 days + 18:00 = "Thursday 6pm before the delivery week".
  default_cutoff_days_before smallint not null default 4 check (default_cutoff_days_before between 0 and 28),
  default_cutoff_time time not null default '18:00',
  ordering_opens_days_before smallint not null default 14 check (ordering_opens_days_before between 1 and 60),
  tax_settings jsonb not null default '{"enabled":false,"use_stripe_tax":false}',
  pilot_mode boolean not null default false,
  ordering_enabled boolean not null default true,
  announcement jsonb not null default '{"enabled":false,"text":"","link":null}',
  -- Rotation: Week A starts on this Monday; drafts are generated this far ahead.
  rotation_anchor_week date check (rotation_anchor_week is null or extract(isodow from rotation_anchor_week) = 1),
  rotation_weeks_ahead smallint not null default 3 check (rotation_weeks_ahead between 0 and 12),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.site_settings (id) values (true);

alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon;
revoke insert, delete on public.site_settings from authenticated;
create policy "Staff read settings (AAL2)" on public.site_settings
  for select to authenticated using (public.is_staff_aal2());
create policy "Owner updates settings (AAL2)" on public.site_settings
  for update to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2());
-- Tax settings need a fresh MFA step-up (CLAUDE.md §5.5).
create trigger site_settings_tax_guard before update on public.site_settings
  for each row execute function public.guard_price_columns('tax_settings');
create trigger site_settings_touch before update on public.site_settings
  for each row execute function public.touch_updated_at();
create trigger site_settings_audit after update on public.site_settings
  for each row execute function public.audit_row_change();

-- Public, read-only projection. A view owned by postgres (security definer by
-- default) is deliberate here: it exposes only these columns to anon.
create view public.site_settings_public as
  select business_name, logo_path, brand_colors, contact_email, contact_phone, social_links, timezone,
         default_cutoff_days_before, default_cutoff_time, ordering_opens_days_before, pilot_mode,
         ordering_enabled, announcement
  from public.site_settings;
grant select on public.site_settings_public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- CMS: content blocks (+ versions), pages, FAQs, testimonials, email templates, media
-- ─────────────────────────────────────────────────────────────────────────────
create type public.content_block_type as enum ('text', 'rich_text', 'image', 'json', 'cta');

create table public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  type public.content_block_type not null default 'text',
  description text check (char_length(description) <= 300),
  draft_value jsonb,
  published_value jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null
);

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.content_blocks (id) on delete cascade,
  value jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index content_versions_block_idx on public.content_versions (block_id, created_at desc);

-- Every publish keeps the previous published value for history and rollback.
create function public.version_content_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.published_value is distinct from old.published_value and new.published_value is not null then
    insert into public.content_versions (block_id, value, created_by)
      values (new.id, new.published_value, (select auth.uid()));
    new.published_at := now();
    new.published_by := (select auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;
create trigger content_blocks_version before update on public.content_blocks
  for each row execute function public.version_content_block();

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  title text not null check (char_length(title) between 1 and 120),
  seo_title text check (char_length(seo_title) <= 70),
  seo_description text check (char_length(seo_description) <= 200),
  og_image text,
  body_draft jsonb,
  body_published jsonb,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 3 and 300),
  answer_rich jsonb not null,
  category text check (char_length(category) <= 60),
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  quote text not null check (char_length(quote) between 3 and 600),
  attribution text not null check (char_length(attribution) between 1 and 120),
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,60}$'),
  subject text not null check (char_length(subject) between 1 and 200),
  preheader text check (char_length(preheader) <= 200),
  body_rich jsonb not null, -- may contain {{variables}}
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  alt_text text not null check (char_length(alt_text) between 1 and 200),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['content_blocks', 'content_versions', 'pages', 'faqs', 'testimonials', 'email_templates', 'media'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Staff read %1$s (AAL2)" on public.%1$I for select to authenticated using (public.is_staff_aal2())', t);
    execute format(
      'create policy "Owner manages %1$s (AAL2)" on public.%1$I for all to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2())', t);
  end loop;
end;
$$;
revoke all on public.content_blocks, public.content_versions, public.pages, public.email_templates, public.media from anon;
create policy "Anyone reads published FAQs" on public.faqs
  for select to anon, authenticated using (is_published);
create policy "Anyone reads published testimonials" on public.testimonials
  for select to anon, authenticated using (is_published);

-- Public projections: drafts never leave the database.
create view public.content_blocks_public as
  select key, type, published_value as value, published_at
  from public.content_blocks
  where published_value is not null;
create view public.pages_public as
  select slug, title, seo_title, seo_description, og_image, body_published as body, published_at
  from public.pages
  where is_published and archived_at is null and body_published is not null;
grant select on public.content_blocks_public, public.pages_public to anon, authenticated;

create trigger pages_touch before update on public.pages for each row execute function public.touch_updated_at();
create trigger faqs_touch before update on public.faqs for each row execute function public.touch_updated_at();
create trigger email_templates_touch before update on public.email_templates for each row execute function public.touch_updated_at();
create trigger content_blocks_audit after insert or update or delete on public.content_blocks
  for each row execute function public.audit_row_change();
create trigger pages_audit after insert or update or delete on public.pages
  for each row execute function public.audit_row_change();
create trigger email_templates_audit after insert or update or delete on public.email_templates
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Discount codes
-- ─────────────────────────────────────────────────────────────────────────────
create type public.discount_type as enum ('percent', 'fixed');

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,40}$'),
  type public.discount_type not null,
  value integer not null check (value > 0), -- percent (1–100) or cents
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  times_redeemed integer not null default 0 check (times_redeemed >= 0),
  expires_at timestamptz,
  applies_to jsonb not null default '{"scope":"all"}',
  stripe_coupon_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint discount_percent_range check (type <> 'percent' or value between 1 and 100)
);
alter table public.discount_codes enable row level security;
revoke all on public.discount_codes from anon;
create policy "Ops and owner read discount codes (AAL2)" on public.discount_codes
  for select to authenticated using (public.is_ops_or_owner_aal2());
create policy "Owner manages discount codes (AAL2)" on public.discount_codes
  for all to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2());
create trigger discount_codes_guard before insert or update on public.discount_codes
  for each row execute function public.guard_price_columns('type', 'value', 'max_redemptions', 'expires_at');
create trigger discount_codes_audit after insert or update or delete on public.discount_codes
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Ops: Stripe idempotency, notifications log, pilot invites
-- ─────────────────────────────────────────────────────────────────────────────
create table public.stripe_events (
  event_id text primary key,
  type text not null,
  livemode boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
grant select on public.stripe_events to authenticated;
create policy "Owner reads Stripe events (AAL2)" on public.stripe_events
  for select to authenticated using (public.is_owner_aal2());
-- Nobody deletes processed events (idempotency record), not even the service role.
create function public.prevent_stripe_event_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stripe_events rows are never deleted' using errcode = 'insufficient_privilege';
end;
$$;
create trigger stripe_events_no_delete before delete on public.stripe_events
  for each row execute function public.prevent_stripe_event_delete();

create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  template_key text not null,
  status text not null check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  provider_id text,
  error text,
  sent_at timestamptz not null default now()
);
create index notifications_log_sent_idx on public.notifications_log (sent_at desc);
alter table public.notifications_log enable row level security;
revoke all on public.notifications_log from anon;
create policy "Ops and owner read notifications (AAL2)" on public.notifications_log
  for select to authenticated using (public.is_ops_or_owner_aal2());

create table public.pilot_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{6,40}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pilot_invites enable row level security;
revoke all on public.pilot_invites from anon;
create policy "Owner manages pilot invites (AAL2)" on public.pilot_invites
  for all to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2());

-- ─────────────────────────────────────────────────────────────────────────────
-- Business functions
-- ─────────────────────────────────────────────────────────────────────────────
-- Effective ordering cutoff for a week: the week's own cutoff, else the
-- default rule, computed in the business timezone (CLAUDE.md §4).
create function public.menu_week_cutoff(p_week uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    w.cutoff_at,
    ((w.week_start - s.default_cutoff_days_before) + s.default_cutoff_time) at time zone s.timezone
  )
  from public.menu_weeks w cross join public.site_settings s
  where w.id = p_week;
$$;

-- Generate draft weeks ahead from the template rotation (Week A, B, C…).
-- Existing weeks are never touched. Runs weekly via pg_cron and can be
-- triggered by the owner.
create function public.generate_rotation_weeks(p_weeks_ahead integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.site_settings;
  v_templates uuid[];
  v_n integer;
  v_today date;
  v_anchor date;
  v_week date;
  v_template uuid;
  v_week_id uuid;
  v_created integer := 0;
  i integer;
begin
  if not (public.is_trusted_writer() or public.is_owner_aal2()) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.site_settings where id;
  select array_agg(t.id order by t.rotation_position) into v_templates
    from public.menu_templates t where t.rotation_position is not null and t.archived_at is null;
  v_n := coalesce(array_length(v_templates, 1), 0);
  if v_n = 0 then
    return 0;
  end if;

  v_today := (now() at time zone s.timezone)::date;
  v_anchor := coalesce(s.rotation_anchor_week, date_trunc('week', v_today)::date);

  for i in 0 .. coalesce(p_weeks_ahead, s.rotation_weeks_ahead) loop
    v_week := date_trunc('week', v_today)::date + (7 * i);
    continue when exists (select 1 from public.menu_weeks w where w.week_start = v_week);
    v_template := v_templates[1 + ((((v_week - v_anchor) / 7) % v_n) + v_n) % v_n];

    insert into public.menu_weeks (week_start, delivery_dates, ordering_opens_at, status, generated_from_template_id)
    values (
      v_week,
      array[v_week, v_week + 1, v_week + 2, v_week + 3, v_week + 4],
      ((v_week - s.ordering_opens_days_before) + time '09:00') at time zone s.timezone,
      'draft',
      v_template
    )
    returning id into v_week_id;

    insert into public.menu_week_items (menu_week_id, menu_item_id, price_override_cents, capacity, available_for, sort_order)
    select v_week_id, ti.menu_item_id, ti.price_override_cents, ti.capacity, ti.available_for, ti.sort_order
    from public.menu_template_items ti
    join public.menu_items m on m.id = ti.menu_item_id and m.is_active and m.archived_at is null
    where ti.menu_template_id = v_template;

    v_created := v_created + 1;
  end loop;
  return v_created;
end;
$$;

-- Allergy conflicts between a child and a menu item (CLAUDE.md §6).
-- `contains` always blocks; `may_contain` blocks for severe allergies and
-- warns otherwise. An active owner override clears the block.
create function public.meal_allergy_conflicts(p_child uuid, p_item uuid)
returns table (allergen text, presence public.allergen_presence, severity public.allergy_severity, blocking boolean, overridden boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.name,
         mia.presence,
         ca.severity,
         (mia.presence = 'contains' or ca.severity = 'severe') and o.id is null,
         o.id is not null
  from public.child_allergens ca
  join public.menu_item_allergens mia on mia.allergen_id = ca.allergen_id and mia.menu_item_id = p_item
  join public.allergens a on a.id = ca.allergen_id
  left join public.allergy_overrides o on o.child_id = p_child and o.menu_item_id = p_item and o.revoked_at is null
  where ca.child_id = p_child
    and public.can_view_child(p_child)
  order by a.sort_order;
$$;

-- Create a family order. Every price is recomputed here from the menu (the
-- client only sends what, who and when). Blocks allergy conflicts, enforces
-- the cutoff, capacity, delivery zone and minimum order. Returns the order id.
-- p_items: [{ "child_id": uuid, "menu_item_id": uuid, "quantity": int, "delivery_date": "YYYY-MM-DD" }]
create function public.create_family_order(
  p_household uuid,
  p_menu_week uuid,
  p_items jsonb,
  p_fulfillment public.fulfillment_method default 'delivery',
  p_address uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s public.site_settings;
  w public.menu_weeks;
  v_item jsonb;
  v_child public.children;
  v_menu public.menu_items;
  v_week_item public.menu_week_items;
  v_qty integer;
  v_date date;
  v_price integer;
  v_subtotal integer := 0;
  v_fee integer := 0;
  v_zone public.delivery_zones;
  v_addr public.addresses;
  v_order uuid;
  v_blocking text;
  v_override uuid;
  v_reserved integer;
begin
  if v_user is null or not public.is_household_member(p_household) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Add at least one meal' using errcode = 'check_violation';
  end if;

  select * into s from public.site_settings where id;
  if not s.ordering_enabled then
    raise exception 'Ordering is paused right now' using errcode = 'check_violation';
  end if;

  select * into w from public.menu_weeks where id = p_menu_week;
  if w.id is null or w.status <> 'published' then
    raise exception 'This week''s menu isn''t open for orders' using errcode = 'check_violation';
  end if;
  if (w.ordering_opens_at is not null and now() < w.ordering_opens_at) or now() >= public.menu_week_cutoff(w.id) then
    raise exception 'Ordering for this week is closed' using errcode = 'check_violation';
  end if;

  -- Fulfillment: delivery needs a household address inside an active zone.
  if p_fulfillment = 'delivery' then
    select * into v_addr from public.addresses where id = p_address and household_id = p_household;
    if v_addr.id is null then
      raise exception 'Choose a delivery address' using errcode = 'check_violation';
    end if;
    select * into v_zone from public.delivery_zones z
      where z.is_active and z.archived_at is null and v_addr.zip = any (z.zip_codes)
      order by z.sort_order limit 1;
    if v_zone.id is null then
      raise exception 'We don''t deliver to % yet', v_addr.zip using errcode = 'check_violation';
    end if;
  end if;

  insert into public.orders (household_id, menu_week_id, source, status, fulfillment, address_snapshot, delivery_zone_id,
                             placed_at, placed_by, notes)
  values (
    p_household, w.id, 'a_la_carte', 'pending_payment', p_fulfillment,
    case when v_addr.id is not null then jsonb_build_object(
      'line1', v_addr.line1, 'line2', v_addr.line2, 'city', v_addr.city, 'state', v_addr.state,
      'zip', v_addr.zip, 'delivery_notes', v_addr.delivery_notes) end,
    v_zone.id, now(), v_user, left(p_notes, 1000)
  )
  returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty < 1 or v_qty > 20 then
      raise exception 'Quantity must be between 1 and 20' using errcode = 'check_violation';
    end if;

    select * into v_child from public.children
      where id = (v_item ->> 'child_id')::uuid and household_id = p_household and archived_at is null;
    if v_child.id is null then
      raise exception 'Unknown child' using errcode = 'check_violation';
    end if;
    if p_fulfillment = 'school_dropoff' and v_child.school_id is null then
      raise exception 'School drop-off needs a school on %''s profile', v_child.first_name using errcode = 'check_violation';
    end if;

    select * into v_week_item from public.menu_week_items
      where menu_week_id = w.id and menu_item_id = (v_item ->> 'menu_item_id')::uuid and available_for in ('families', 'both');
    select * into v_menu from public.menu_items where id = v_week_item.menu_item_id and is_active and archived_at is null;
    if v_week_item.id is null or v_menu.id is null then
      raise exception 'That meal isn''t on this week''s menu' using errcode = 'check_violation';
    end if;

    v_date := nullif(v_item ->> 'delivery_date', '')::date;
    if v_date is not null and not (v_date = any (w.delivery_dates)) then
      raise exception 'Pick a delivery day from this week''s menu' using errcode = 'check_violation';
    end if;
    if v_date is not null and p_fulfillment = 'delivery'
       and not (extract(isodow from v_date)::smallint = any (v_zone.delivery_weekdays)) then
      raise exception 'We don''t deliver to your area on that day' using errcode = 'check_violation';
    end if;

    -- Allergy block (CLAUDE.md §6).
    select string_agg(c.allergen, ', ') into v_blocking
      from public.meal_allergy_conflicts(v_child.id, v_menu.id) c where c.blocking;
    if v_blocking is not null then
      raise exception 'ALLERGY_BLOCK: % can''t have %: it contains %', v_child.first_name, v_menu.name, v_blocking
        using errcode = 'P0001', hint = 'allergy_block';
    end if;
    select o.id into v_override from public.allergy_overrides o
      where o.child_id = v_child.id and o.menu_item_id = v_menu.id and o.revoked_at is null;

    -- Capacity across all live orders for this week.
    if v_week_item.capacity is not null then
      select coalesce(sum(oi.quantity), 0) into v_reserved
        from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.menu_week_id = w.id and oi.menu_item_id = v_menu.id
          and o.status in ('pending_payment', 'paid', 'invoiced', 'fulfilled');
      if v_reserved + v_qty > v_week_item.capacity then
        raise exception '% is sold out this week', v_menu.name using errcode = 'check_violation';
      end if;
    end if;

    v_price := coalesce(v_week_item.price_override_cents, v_menu.base_price_cents);
    v_subtotal := v_subtotal + v_price * v_qty;

    insert into public.order_items (order_id, child_id, classroom_id, menu_item_id, delivery_date, quantity, unit_price_cents,
                                    currency, item_name, allergens_contained, may_contain, badges, allergy_override_id)
    values (
      v_order, v_child.id, v_child.classroom_id, v_menu.id, v_date, v_qty, v_price, v_menu.currency, v_menu.name,
      coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
        join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = v_menu.id and mia.presence = 'contains'), '{}'),
      coalesce((select array_agg(a.name order by a.sort_order) from public.menu_item_allergens mia
        join public.allergens a on a.id = mia.allergen_id where mia.menu_item_id = v_menu.id and mia.presence = 'may_contain'), '{}'),
      coalesce((select array_agg(b.name order by b.sort_order) from public.menu_item_badges mib
        join public.dietary_badges b on b.id = mib.badge_id where mib.menu_item_id = v_menu.id), '{}'),
      v_override
    );
  end loop;

  if p_fulfillment = 'delivery' then
    if v_subtotal < v_zone.min_order_cents then
      raise exception 'The minimum order for delivery to your area is $%', to_char(v_zone.min_order_cents / 100.0, 'FM999990.00')
        using errcode = 'check_violation';
    end if;
    v_fee := case when v_zone.free_over_cents is not null and v_subtotal >= v_zone.free_over_cents then 0 else v_zone.fee_cents end;
  end if;

  update public.orders
    set subtotal_cents = v_subtotal, delivery_fee_cents = v_fee, total_cents = v_subtotal + v_fee
    where id = v_order;
  return v_order;
end;
$$;

-- Checkout's final step (CLAUDE.md §6): "Are these still correct for each child?"
create function public.confirm_order_allergies(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders
    set allergy_confirmed_at = now(), allergy_confirmed_by = (select auth.uid())
    where id = p_order and household_id is not null and public.is_household_member(household_id)
      and status in ('draft', 'pending_payment');
  if not found then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Kitchen view (CLAUDE.md §2, Phase 3 RLS outline): what to cook and for
-- whom, with allergy flags. No street addresses, phones, emails, prices or
-- payment amounts. Kitchen staff have no direct access to orders/children;
-- this definer view re-checks the role (AAL2) on every query.
create view public.kitchen_order_lines as
  select
    oi.id as order_item_id,
    o.id as order_id,
    o.order_number,
    o.menu_week_id,
    w.week_start,
    coalesce(oi.delivery_date, o.delivery_date) as delivery_date,
    o.status as order_status,
    o.fulfillment,
    oi.item_name,
    oi.quantity,
    oi.allergens_contained,
    oi.may_contain,
    oi.badges,
    oi.allergy_override_id is not null as has_allergy_override,
    c.first_name as child_first_name,
    c.last_initial as child_last_initial,
    coalesce((
      select array_agg(a.name || case when ca.severity = 'severe' then ' (severe)' else '' end order by a.sort_order)
      from public.child_allergens ca join public.allergens a on a.id = ca.allergen_id
      where ca.child_id = c.id
    ), '{}') as child_allergens,
    c.dietary_preferences as child_dietary_preferences,
    cl.name as classroom_name,
    org.name as organization_name,
    h.name as household_name
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.menu_weeks w on w.id = o.menu_week_id
  left join public.children c on c.id = oi.child_id
  left join public.classrooms cl on cl.id = coalesce(oi.classroom_id, c.classroom_id)
  left join public.organizations org on org.id = coalesce(o.organization_id, c.school_id)
  left join public.households h on h.id = o.household_id
  where w.status in ('published', 'closed', 'fulfilled')
    and o.status in ('paid', 'invoiced', 'fulfilled')
    and public.has_any_role_aal2(array['kitchen', 'ops', 'owner']::public.app_role[]);
revoke all on public.kitchen_order_lines from anon;
grant select on public.kitchen_order_lines to authenticated;

-- Weekly rotation job (Sunday 03:00 UTC ≈ Saturday evening in Los Angeles).
create extension if not exists pg_cron;
select cron.schedule('generate-rotation-weeks', '0 3 * * 0', $$select public.generate_rotation_weeks()$$);

revoke execute on function public.version_content_block(), public.prevent_stripe_event_delete() from public, anon, authenticated;
grant execute on function public.menu_week_cutoff(uuid) to anon, authenticated;
grant execute on function public.generate_rotation_weeks(integer), public.meal_allergy_conflicts(uuid, uuid),
  public.create_family_order(uuid, uuid, jsonb, public.fulfillment_method, uuid, text),
  public.confirm_order_allergies(uuid) to authenticated;
