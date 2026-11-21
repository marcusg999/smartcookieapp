-- Phase 4: admin portal support.

-- ── Menu item price history (Stripe Prices are immutable) ───────────────────
alter table public.menu_items
  add column stripe_price_id text,
  add column stripe_school_price_id text;

create table public.menu_item_price_history (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  base_price_cents integer not null check (base_price_cents >= 0),
  school_price_cents integer check (school_price_cents is null or school_price_cents >= 0),
  stripe_price_id text,
  stripe_school_price_id text,
  changed_by uuid references auth.users (id) on delete set null,
  active_from timestamptz not null default now(),
  active_to timestamptz check (active_to is null or active_to >= active_from)
);
create index menu_item_price_history_item_idx on public.menu_item_price_history (menu_item_id, active_from desc);
alter table public.menu_item_price_history enable row level security;
revoke all on public.menu_item_price_history from anon;
create policy "Ops and owner read menu price history (AAL2)" on public.menu_item_price_history
  for select to authenticated using (public.is_ops_or_owner_aal2());

create function public.record_menu_item_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A new amount opens a new history row; the Stripe ids that follow (set
  -- right after the matching Stripe Price is created) fill in the open row.
  if tg_op = 'INSERT' or new.base_price_cents is distinct from old.base_price_cents
     or new.school_price_cents is distinct from old.school_price_cents then
    update public.menu_item_price_history set active_to = now() where menu_item_id = new.id and active_to is null;
    insert into public.menu_item_price_history (menu_item_id, base_price_cents, school_price_cents, stripe_price_id,
                                                stripe_school_price_id, changed_by)
    values (new.id, new.base_price_cents, new.school_price_cents, new.stripe_price_id, new.stripe_school_price_id,
            (select auth.uid()));
  elsif new.stripe_price_id is distinct from old.stripe_price_id
     or new.stripe_school_price_id is distinct from old.stripe_school_price_id then
    update public.menu_item_price_history
      set stripe_price_id = new.stripe_price_id, stripe_school_price_id = new.stripe_school_price_id
      where menu_item_id = new.id and active_to is null;
  end if;
  return new;
end;
$$;
create trigger menu_items_price_history after insert or update on public.menu_items
  for each row execute function public.record_menu_item_price();
-- Stripe ids are price-bearing too: only the owner (step-up) or the server sets them.
drop trigger menu_items_price_guard on public.menu_items;
create trigger menu_items_price_guard before insert or update on public.menu_items
  for each row execute function public.guard_price_columns('base_price_cents', 'school_price_cents', 'stripe_price_id', 'stripe_school_price_id');

-- Backfill history for existing items.
insert into public.menu_item_price_history (menu_item_id, base_price_cents, school_price_cents)
select id, base_price_cents, school_price_cents from public.menu_items m
where not exists (select 1 from public.menu_item_price_history h where h.menu_item_id = m.id);

-- ── Top-9 allergens can't be deleted or renamed away ────────────────────────
create function public.protect_top9_allergens()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_top9 and (tg_op = 'DELETE' or new.is_top9 is distinct from old.is_top9 or new.slug is distinct from old.slug
                      or new.archived_at is not null) then
    raise exception 'The top 9 allergens are required and can''t be removed' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger allergens_protect_top9 before update or delete on public.allergens
  for each row execute function public.protect_top9_allergens();

-- ── Settings: customizable "ordering paused" message ────────────────────────
alter table public.site_settings
  add column ordering_paused_message text not null default 'Ordering is paused for a short break. Check back soon!'
    check (char_length(ordering_paused_message) <= 300);
create or replace view public.site_settings_public as
  select business_name, logo_path, brand_colors, contact_email, contact_phone, social_links, timezone,
         default_cutoff_days_before, default_cutoff_time, ordering_opens_days_before, pilot_mode,
         ordering_enabled, announcement, ordering_paused_message
  from public.site_settings;
grant select on public.site_settings_public to anon, authenticated;

-- ── Customer notes and account credits (ops/owner) ──────────────────────────
create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  author_id uuid not null default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_notes_one_target check ((household_id is null) <> (organization_id is null))
);
create index customer_notes_household_idx on public.customer_notes (household_id, created_at desc);
alter table public.customer_notes enable row level security;
revoke all on public.customer_notes from anon;
create policy "Ops and owner read notes (AAL2)" on public.customer_notes
  for select to authenticated using (public.is_ops_or_owner_aal2());
create policy "Ops and owner add notes (AAL2)" on public.customer_notes
  for insert to authenticated with check (public.is_ops_or_owner_aal2() and author_id = (select auth.uid()));

create table public.account_credits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  amount_cents integer not null check (amount_cents <> 0 and amount_cents between -100000 and 100000),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  reason text not null check (char_length(reason) between 3 and 300),
  order_id uuid references public.orders (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index account_credits_household_idx on public.account_credits (household_id);
alter table public.account_credits enable row level security;
revoke all on public.account_credits from anon;
create policy "Members read their credits" on public.account_credits
  for select to authenticated using (public.is_household_member(household_id) or public.is_ops_or_owner_aal2());
create policy "Ops and owner add credits (AAL2)" on public.account_credits
  for insert to authenticated with check (public.is_ops_or_owner_aal2() and created_by = (select auth.uid()));
create trigger account_credits_audit after insert on public.account_credits
  for each row execute function public.audit_row_change();

-- ── Media usage (safe delete) ───────────────────────────────────────────────
create function public.media_usage_count(p_path text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.menu_item_images where storage_path = p_path)
    + (select count(*) from public.content_blocks where draft_value::text like '%' || p_path || '%' or published_value::text like '%' || p_path || '%')
    + (select count(*) from public.pages where og_image = p_path or body_draft::text like '%' || p_path || '%' or body_published::text like '%' || p_path || '%')
    + (select count(*) from public.site_settings where logo_path = p_path)
  )::integer
  where public.is_staff_aal2();
$$;

-- Media library uploads go to their own public bucket (owner only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;
create policy "Owner uploads media (AAL2)" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_owner_aal2());
create policy "Owner deletes media (AAL2)" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_owner_aal2());

revoke execute on function public.record_menu_item_price(), public.protect_top9_allergens() from public, anon, authenticated;
revoke execute on function public.media_usage_count(text) from public, anon;
grant execute on function public.media_usage_count(text) to authenticated;
-- Notes and credits are append-only records: no edits or deletes, for anyone.
revoke update, delete on public.customer_notes, public.account_credits from authenticated;

-- ── Brand colours from the Smart Cookie logo (owner-editable in Settings) ───
alter table public.site_settings
  alter column brand_colors set default '{"primary":"#f4b4b6","background":"#fbeeea","surface":"#fff9f5","ink":"#1f3b2d","accent":"#b3344b"}';
update public.site_settings
  set brand_colors = '{"primary":"#f4b4b6","background":"#fbeeea","surface":"#fff9f5","ink":"#1f3b2d","accent":"#b3344b"}';

-- ── Price guard: an INSERT only counts as a price change when it sets one ───
-- (adding a meal with no override to a week must not need a fresh MFA).
create or replace function public.guard_price_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  foreach col in array tg_argv loop
    if (tg_op = 'INSERT' and jsonb_typeof(to_jsonb(new) -> col) is distinct from 'null')
       or (tg_op = 'UPDATE' and (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col)) then
      if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
        raise exception 'Only the owner, with a fresh MFA check, can change prices (%)', col
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.guard_price_columns() from public, anon, authenticated;

-- ── Atomic list replacement (one transaction; RLS and the price guard apply) ─
-- Rows: [{menu_item_id, price_override_cents, capacity, available_for}], in order.
-- Existing rows are UPDATED (so an unchanged override never trips the guard),
-- new rows inserted, missing rows deleted.
create function public.set_menu_week_items(p_week uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  create temp table _rows on commit drop as
    select (r ->> 'menu_item_id')::uuid as menu_item_id,
           (r ->> 'price_override_cents')::integer as price_override_cents,
           (r ->> 'capacity')::integer as capacity,
           coalesce(r ->> 'available_for', 'both')::public.menu_audience as available_for,
           (ord - 1)::integer as sort_order
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord);
  delete from public.menu_week_items w
    where w.menu_week_id = p_week and not exists (select 1 from _rows r where r.menu_item_id = w.menu_item_id);
  update public.menu_week_items w
    set price_override_cents = r.price_override_cents, capacity = r.capacity, available_for = r.available_for,
        sort_order = r.sort_order
    from _rows r where w.menu_week_id = p_week and w.menu_item_id = r.menu_item_id;
  insert into public.menu_week_items (menu_week_id, menu_item_id, price_override_cents, capacity, available_for, sort_order)
    select p_week, r.menu_item_id, r.price_override_cents, r.capacity, r.available_for, r.sort_order from _rows r
    where not exists (select 1 from public.menu_week_items w where w.menu_week_id = p_week and w.menu_item_id = r.menu_item_id);
  drop table _rows;
end;
$$;

create function public.set_menu_template_items(p_template uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  create temp table _rows on commit drop as
    select (r ->> 'menu_item_id')::uuid as menu_item_id,
           (r ->> 'price_override_cents')::integer as price_override_cents,
           (r ->> 'capacity')::integer as capacity,
           coalesce(r ->> 'available_for', 'both')::public.menu_audience as available_for,
           (ord - 1)::integer as sort_order
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord);
  delete from public.menu_template_items w
    where w.menu_template_id = p_template and not exists (select 1 from _rows r where r.menu_item_id = w.menu_item_id);
  update public.menu_template_items w
    set price_override_cents = r.price_override_cents, capacity = r.capacity, available_for = r.available_for,
        sort_order = r.sort_order
    from _rows r where w.menu_template_id = p_template and w.menu_item_id = r.menu_item_id;
  insert into public.menu_template_items (menu_template_id, menu_item_id, price_override_cents, capacity, available_for, sort_order)
    select p_template, r.menu_item_id, r.price_override_cents, r.capacity, r.available_for, r.sort_order from _rows r
    where not exists (select 1 from public.menu_template_items w where w.menu_template_id = p_template and w.menu_item_id = r.menu_item_id);
  drop table _rows;
end;
$$;

-- A meal's badges and allergens are replaced together or not at all, so a
-- failed save can never leave a meal with no allergens (CLAUDE.md §6).
create function public.set_menu_item_tags(p_item uuid, p_badges uuid[], p_allergens jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.menu_item_badges where menu_item_id = p_item;
  insert into public.menu_item_badges (menu_item_id, badge_id) select p_item, unnest(p_badges);
  delete from public.menu_item_allergens where menu_item_id = p_item;
  insert into public.menu_item_allergens (menu_item_id, allergen_id, presence)
    select p_item, (a ->> 'allergen_id')::uuid, (a ->> 'presence')::public.allergen_presence
    from jsonb_array_elements(p_allergens) a;
end;
$$;

revoke execute on function public.set_menu_week_items(uuid, jsonb), public.set_menu_template_items(uuid, jsonb),
  public.set_menu_item_tags(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.set_menu_week_items(uuid, jsonb), public.set_menu_template_items(uuid, jsonb),
  public.set_menu_item_tags(uuid, uuid[], jsonb) to authenticated;
