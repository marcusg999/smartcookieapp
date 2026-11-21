-- Phase 3 (3/5): menu catalog, rotating weeks, templates and rotation.
-- The owner edits everything here from /admin (CLAUDE.md §1). The published
-- menu is deliberately public (anon). Prices: owner + fresh MFA only.

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.dietary_badges (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  icon text check (char_length(icon) <= 60),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,120}$'),
  short_description text check (char_length(short_description) <= 200),
  description_rich jsonb,
  category_id uuid references public.menu_categories (id) on delete set null,
  base_price_cents integer not null check (base_price_cents >= 0),
  school_price_cents integer check (school_price_cents is null or school_price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  portion_label text check (char_length(portion_label) <= 60),
  ingredients text check (char_length(ingredients) <= 2000),
  nutrition jsonb,
  is_snack boolean not null default false,
  is_active boolean not null default true,
  stripe_product_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index menu_items_category_idx on public.menu_items (category_id);

create table public.menu_item_images (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  -- Path in the `menu-images` Storage bucket, or `placeholder:<art-key>` for
  -- the built-in cartoon art used before real photos exist.
  storage_path text not null check (char_length(storage_path) between 1 and 300),
  alt_text text not null check (char_length(alt_text) between 1 and 200),
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index menu_item_images_one_primary on public.menu_item_images (menu_item_id) where is_primary;

create table public.menu_item_badges (
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  badge_id uuid not null references public.dietary_badges (id) on delete restrict,
  primary key (menu_item_id, badge_id)
);

create type public.allergen_presence as enum ('contains', 'may_contain');

create table public.menu_item_allergens (
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  allergen_id uuid not null references public.allergens (id) on delete restrict,
  presence public.allergen_presence not null default 'contains',
  primary key (menu_item_id, allergen_id)
);

create type public.menu_week_status as enum ('draft', 'scheduled', 'published', 'closed', 'fulfilled');
create type public.menu_audience as enum ('families', 'schools', 'both');

create table public.menu_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1), -- Monday
  delivery_dates date[] not null default '{}',
  ordering_opens_at timestamptz,
  cutoff_at timestamptz, -- null = default rule from site_settings
  status public.menu_week_status not null default 'draft',
  notes_to_families text check (char_length(notes_to_families) <= 2000),
  generated_from_template_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_weeks_cutoff_before_open check (cutoff_at is null or ordering_opens_at is null or cutoff_at > ordering_opens_at)
);

create table public.menu_week_items (
  id uuid primary key default gen_random_uuid(),
  menu_week_id uuid not null references public.menu_weeks (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete restrict,
  price_override_cents integer check (price_override_cents is null or price_override_cents >= 0),
  capacity integer check (capacity is null or capacity >= 0),
  available_for public.menu_audience not null default 'both',
  sort_order integer not null default 0,
  unique (menu_week_id, menu_item_id)
);
create index menu_week_items_week_idx on public.menu_week_items (menu_week_id);

create table public.menu_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  -- Position in the rotation cycle (Week A = 1, B = 2…). Null = not rotating.
  rotation_position smallint unique check (rotation_position is null or rotation_position between 1 and 52),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.menu_weeks
  add constraint menu_weeks_template_fk foreign key (generated_from_template_id) references public.menu_templates (id) on delete set null;

create table public.menu_template_items (
  id uuid primary key default gen_random_uuid(),
  menu_template_id uuid not null references public.menu_templates (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete restrict,
  price_override_cents integer check (price_override_cents is null or price_override_cents >= 0),
  capacity integer check (capacity is null or capacity >= 0),
  available_for public.menu_audience not null default 'both',
  sort_order integer not null default 0,
  unique (menu_template_id, menu_item_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Visibility helpers
-- ─────────────────────────────────────────────────────────────────────────────
create function public.is_public_menu_item(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.menu_items m where m.id = p_item and m.is_active and m.archived_at is null);
$$;

create function public.is_public_menu_week(p_week uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.menu_weeks w where w.id = p_week and w.status in ('published', 'closed', 'fulfilled'));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: public reads the published menu; staff (AAL2) read everything;
-- only the owner (AAL2) writes. Prices additionally need a fresh MFA check.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['menu_categories', 'dietary_badges', 'menu_items', 'menu_item_images', 'menu_item_badges',
    'menu_item_allergens', 'menu_weeks', 'menu_week_items', 'menu_templates', 'menu_template_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Staff read %1$s (AAL2)" on public.%1$I for select to authenticated using (public.is_staff_aal2())', t);
    execute format(
      'create policy "Owner manages %1$s (AAL2)" on public.%1$I for all to authenticated using (public.is_owner_aal2()) with check (public.is_owner_aal2())', t);
  end loop;
end;
$$;

create policy "Anyone reads active categories" on public.menu_categories
  for select to anon, authenticated using (is_active);
create policy "Anyone reads active badges" on public.dietary_badges
  for select to anon, authenticated using (archived_at is null);
create policy "Anyone reads active menu items" on public.menu_items
  for select to anon, authenticated using (is_active and archived_at is null);
create policy "Anyone reads images of active items" on public.menu_item_images
  for select to anon, authenticated using (public.is_public_menu_item(menu_item_id));
create policy "Anyone reads badges of active items" on public.menu_item_badges
  for select to anon, authenticated using (public.is_public_menu_item(menu_item_id));
create policy "Anyone reads allergens of active items" on public.menu_item_allergens
  for select to anon, authenticated using (public.is_public_menu_item(menu_item_id));
create policy "Anyone reads published weeks" on public.menu_weeks
  for select to anon, authenticated using (status in ('published', 'closed', 'fulfilled'));
create policy "Anyone reads items of published weeks" on public.menu_week_items
  for select to anon, authenticated using (public.is_public_menu_week(menu_week_id));
-- Templates are internal: no public policy.
revoke all on public.menu_templates, public.menu_template_items from anon;

create trigger menu_items_price_guard before insert or update on public.menu_items
  for each row execute function public.guard_price_columns('base_price_cents', 'school_price_cents');
create trigger menu_week_items_price_guard before insert or update on public.menu_week_items
  for each row execute function public.guard_price_columns('price_override_cents');
create trigger menu_template_items_price_guard before insert or update on public.menu_template_items
  for each row execute function public.guard_price_columns('price_override_cents');

create trigger menu_items_touch before update on public.menu_items for each row execute function public.touch_updated_at();
create trigger menu_weeks_touch before update on public.menu_weeks for each row execute function public.touch_updated_at();
create trigger menu_templates_touch before update on public.menu_templates for each row execute function public.touch_updated_at();

create trigger menu_items_audit after insert or update or delete on public.menu_items
  for each row execute function public.audit_row_change();
create trigger menu_item_allergens_audit after insert or update or delete on public.menu_item_allergens
  for each row execute function public.audit_row_change();
create trigger menu_weeks_audit after insert or update or delete on public.menu_weeks
  for each row execute function public.audit_row_change();
create trigger menu_week_items_audit after insert or update or delete on public.menu_week_items
  for each row execute function public.audit_row_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage: menu photos (CLAUDE.md §5.10). Public read; only the owner (AAL2)
-- uploads. Type/size are also checked server-side (magic bytes, EXIF strip).
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

create policy "Owner uploads menu images (AAL2)" on storage.objects
  for insert to authenticated with check (bucket_id = 'menu-images' and public.is_owner_aal2());
create policy "Owner updates menu images (AAL2)" on storage.objects
  for update to authenticated using (bucket_id = 'menu-images' and public.is_owner_aal2());
create policy "Owner deletes menu images (AAL2)" on storage.objects
  for delete to authenticated using (bucket_id = 'menu-images' and public.is_owner_aal2());

grant execute on function public.is_public_menu_item(uuid), public.is_public_menu_week(uuid) to anon, authenticated;
