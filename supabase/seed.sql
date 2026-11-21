-- ═════════════════════════════════════════════════════════════════════════════
-- Smart Cookie: LOCAL / STAGING SEED DATA. Never run against production.
-- Runs after migrations on `supabase db reset`.
--
-- Test accounts (local only), password for all: SmartCookie-local-2026!
--   owner@smartcookie.test      owner        (TOTP pre-enrolled, see below)
--   ops@smartcookie.test        ops          (TOTP pre-enrolled)
--   kitchen@smartcookie.test    kitchen      (TOTP pre-enrolled)
--   parent@smartcookie.test     parent       (household with Maya + Leo)
--   parent2@smartcookie.test    parent       (household with Ava)
--   school@smartcookie.test     school_admin (Maple Grove Elementary)
--   teacher@smartcookie.test    school_staff (Maple Grove Elementary)
--
-- Staff TOTP secret (local only): JBSWY3DPEHPK3PXP
-- Add it to an authenticator app (or `oathtool --totp -b JBSWY3DPEHPK3PXP`).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Users ────────────────────────────────────────────────────────────────────
create function pg_temp.seed_user(p_id uuid, p_email text, p_name text, p_meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('SmartCookie-local-2026!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name) || p_meta, now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), p_id::text, p_id,
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now());
end;
$$;

create function pg_temp.seed_totp(p_user uuid) returns void language sql as $$
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), p_user, 'Local dev authenticator', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
$$;

select pg_temp.seed_user('a0000000-0000-4000-8000-000000000001', 'owner@smartcookie.test', 'Hannah Owner');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000002', 'ops@smartcookie.test', 'Omar Ops');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000003', 'kitchen@smartcookie.test', 'Kim Kitchen');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000004', 'parent@smartcookie.test', 'Priya Patel');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000005', 'parent2@smartcookie.test', 'Dan Rivera');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000006', 'school@smartcookie.test', 'Sam Principal',
  '{"account_type":"school","organization_name":"Maple Grove Elementary"}');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000007', 'teacher@smartcookie.test', 'Tess Teacher');

-- Staff: replace the default parent role/household with their staff role.
delete from public.households h using public.household_members hm
  where hm.household_id = h.id and hm.user_id in (
    'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000007');
delete from public.user_roles where role = 'parent' and user_id in (
  'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000007');
insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'owner'),
  ('a0000000-0000-4000-8000-000000000002', 'ops'),
  ('a0000000-0000-4000-8000-000000000003', 'kitchen');
select pg_temp.seed_totp('a0000000-0000-4000-8000-000000000001');
select pg_temp.seed_totp('a0000000-0000-4000-8000-000000000002');
select pg_temp.seed_totp('a0000000-0000-4000-8000-000000000003');

-- ── School: approve it, add classrooms and a teacher ─────────────────────────
update public.organizations
  set status = 'approved', reviewed_at = now(), reviewed_by = 'a0000000-0000-4000-8000-000000000001',
      billing_email = 'accounts@maplegrove.test', billing_terms_days = 30, tax_exempt = true,
      address = '{"line1":"1200 Maple Grove Ave","city":"Pasadena","state":"CA","zip":"91101"}',
      dropoff_instructions = 'Front office, by 11:15am. Ask for the cafeteria cart.', contact_phone = '(626) 555-0142'
  where name = 'Maple Grove Elementary';

insert into public.classrooms (id, organization_id, name, teacher_name, grade, headcount, dropoff_location)
select v.id, o.id, v.name, v.teacher, v.grade, v.headcount, v.dropoff
from public.organizations o,
  (values
    ('c1000000-0000-4000-8000-000000000001'::uuid, 'Room 4 · Sunflowers', 'Ms. Alvarez', 'K', 22, 'Kindergarten wing'),
    ('c1000000-0000-4000-8000-000000000002'::uuid, 'Room 9 · Explorers', 'Mr. Chen', '2', 25, 'Main hall, door B'),
    ('c1000000-0000-4000-8000-000000000003'::uuid, 'Room 12 · Owls', 'Mrs. Okafor', '4', 27, 'Upstairs, room 12')
  ) as v(id, name, teacher, grade, headcount, dropoff)
where o.name = 'Maple Grove Elementary';

insert into public.user_roles (user_id, role, organization_id)
select 'a0000000-0000-4000-8000-000000000007', 'school_staff', o.id from public.organizations o where o.name = 'Maple Grove Elementary';

-- ── Delivery zones (LA area) ─────────────────────────────────────────────────
insert into public.delivery_zones (id, name, zip_codes, fee_cents, free_over_cents, min_order_cents, delivery_weekdays, delivery_window_label, sort_order) values
  ('d1000000-0000-4000-8000-000000000001', 'Pasadena & Altadena', '{91101,91103,91104,91105,91106,91107,91001}', 499, 6000, 2500, '{1,2,3,4,5}', '7:00–8:30am', 1),
  ('d1000000-0000-4000-8000-000000000002', 'Silver Lake, Echo Park & Los Feliz', '{90026,90027,90039,90029}', 699, 8000, 3000, '{1,3,5}', '7:30–9:00am', 2);

-- ── Allergens (US top 9), badges, categories ─────────────────────────────────
insert into public.allergens (name, slug, is_top9, icon, sort_order) values
  ('Milk', 'milk', true, 'milk', 1), ('Eggs', 'eggs', true, 'egg', 2), ('Fish', 'fish', true, 'fish', 3),
  ('Shellfish', 'shellfish', true, 'shell', 4), ('Tree nuts', 'tree-nuts', true, 'nut', 5),
  ('Peanuts', 'peanuts', true, 'peanut', 6), ('Wheat', 'wheat', true, 'wheat', 7), ('Soy', 'soy', true, 'bean', 8),
  ('Sesame', 'sesame', true, 'seed', 9);

insert into public.dietary_badges (name, slug, icon, color, sort_order) values
  ('Vegetarian', 'vegetarian', 'leaf', '#2f6f4f', 1), ('Vegan', 'vegan', 'sprout', '#2f6f4f', 2),
  ('Gluten-Free', 'gluten-free', 'wheat-off', '#8c3b1a', 3), ('Dairy-Free', 'dairy-free', 'milk-off', '#4a4640', 4),
  ('Nut-Free', 'nut-free', 'shield', '#4a4640', 5), ('Kid Favorite', 'kid-favorite', 'star', '#ff5b14', 6);

insert into public.menu_categories (name, slug, sort_order) values
  ('Mains', 'mains', 1), ('Sides', 'sides', 2), ('Snacks', 'snacks', 3), ('Drinks', 'drinks', 4);

-- ── Menu items (~20) ─────────────────────────────────────────────────────────
-- (slug, name, short, category, price, school price, snack, art, contains, may contain, badges)
create temp table seed_items (slug text, name text, short text, category text, price int, school_price int, snack bool,
  art text, contains text[], may text[], badges text[]) on commit drop;
insert into seed_items values
  ('baked-mac-and-cheese', 'Baked mac & cheese', 'Elbow pasta, sharp cheddar and hidden butternut squash.', 'mains', 895, 650, false, 'pasta', '{milk,wheat}', '{}', '{vegetarian,kid-favorite}'),
  ('turkey-avocado-wrap', 'Turkey & avocado wrap', 'Whole-wheat tortilla, roast turkey, avocado and crunchy lettuce.', 'mains', 925, 675, false, 'wrap', '{wheat}', '{sesame}', '{dairy-free,nut-free}'),
  ('chicken-veggie-wrap', 'Chicken veggie wrap', 'Grilled chicken, peppers and a mild yogurt sauce.', 'mains', 925, 675, false, 'wrap', '{wheat,milk}', '{}', '{nut-free}'),
  ('broccoli-cheddar-bake', 'Broccoli cheddar bake', 'Golden top, soft middle, lots of green.', 'mains', 875, 625, false, 'broccoli', '{milk,eggs}', '{wheat}', '{vegetarian}'),
  ('veggie-pasta-salad', 'Veggie pasta salad', 'Spiral pasta, peas and cherry tomatoes with olive oil.', 'mains', 825, 600, false, 'pasta', '{wheat}', '{}', '{vegan,dairy-free,nut-free}'),
  ('teriyaki-chicken-rice', 'Teriyaki chicken & rice', 'Brown rice, glazed chicken thigh, steamed edamame.', 'mains', 975, 700, false, 'broccoli', '{soy,wheat,sesame}', '{}', '{dairy-free,kid-favorite}'),
  ('salmon-sweet-potato', 'Salmon bites & sweet potato', 'Oven-baked salmon bites with roasted sweet potato wedges.', 'mains', 1095, 795, false, 'carrots', '{fish}', '{}', '{gluten-free,dairy-free}'),
  ('turkey-meatballs-marinara', 'Turkey meatballs marinara', 'Tender turkey meatballs, slow tomato sauce, quinoa.', 'mains', 950, 690, false, 'pasta', '{eggs}', '{wheat}', '{gluten-free,dairy-free,kid-favorite}'),
  ('black-bean-quesadilla', 'Black bean quesadilla', 'Black beans, corn and mild cheese in a crisp tortilla.', 'mains', 850, 615, false, 'wrap', '{wheat,milk}', '{}', '{vegetarian,kid-favorite}'),
  ('chickpea-curry-rice', 'Mild chickpea curry & rice', 'Coconut chickpea curry with basmati rice. Gently spiced.', 'mains', 875, 625, false, 'broccoli', '{}', '{tree-nuts}', '{vegan,gluten-free,dairy-free}'),
  ('garden-broccoli-bites', 'Garden broccoli bites', 'Roasted florets with lemon and olive oil.', 'sides', 395, 275, false, 'broccoli', '{}', '{}', '{vegan,gluten-free,dairy-free,nut-free}'),
  ('carrot-sticks-hummus', 'Carrot sticks & hummus', 'Sweet carrots with house-made hummus.', 'sides', 425, 300, false, 'carrots', '{sesame}', '{}', '{vegan,gluten-free,dairy-free}'),
  ('rainbow-carrot-slaw', 'Rainbow carrot slaw', 'Shredded carrots and apple with honey-lime dressing.', 'sides', 395, 275, false, 'carrots', '{}', '{}', '{vegetarian,gluten-free,dairy-free,nut-free}'),
  ('cucumber-edamame-salad', 'Cucumber edamame salad', 'Crunchy cucumber, edamame, rice vinegar.', 'sides', 425, 300, false, 'broccoli', '{soy}', '{sesame}', '{vegan,gluten-free,dairy-free}'),
  ('apple-slices-sunbutter', 'Apple slices & sunflower butter', 'Crisp apple with nut-free sunflower seed butter.', 'snacks', 350, 250, true, 'apple', '{}', '{}', '{vegan,gluten-free,dairy-free,nut-free}'),
  ('oat-apple-cookie', 'Oat & apple cookie', 'Our namesake. Sweetened with fruit.', 'snacks', 295, 200, true, 'cookie', '{wheat,eggs}', '{milk}', '{vegetarian,kid-favorite}'),
  ('yogurt-berry-parfait', 'Yogurt berry parfait', 'Greek yogurt, berries and crunchy oat granola.', 'snacks', 450, 325, true, 'apple', '{milk}', '{tree-nuts,wheat}', '{vegetarian}'),
  ('veggie-mini-muffins', 'Veggie mini muffins', 'Zucchini and carrot muffins, lightly sweet.', 'snacks', 375, 265, true, 'cookie', '{wheat,eggs,milk}', '{}', '{vegetarian,nut-free}'),
  ('strawberry-banana-smoothie', 'Strawberry banana smoothie', 'Fruit and oat milk. Nothing else.', 'drinks', 450, 325, false, 'apple', '{}', '{}', '{vegan,gluten-free,dairy-free,nut-free}'),
  ('vanilla-oat-milk', 'Vanilla oat milk', 'Lightly sweetened oat milk carton.', 'drinks', 250, 175, false, 'cookie', '{}', '{wheat}', '{vegan,dairy-free,nut-free}');

insert into public.menu_items (name, slug, short_description, category_id, base_price_cents, school_price_cents, is_snack,
                               portion_label, ingredients, nutrition)
select si.name, si.slug, si.short, c.id, si.price, si.school_price, si.snack,
       case when si.category = 'drinks' then '8 oz' when si.snack then 'Snack size' else 'Kid size' end,
       'See label for full ingredients.',
       jsonb_build_object('calories', 200 + (si.price % 7) * 40, 'protein_g', 5 + (si.price % 5) * 3)
from seed_items si join public.menu_categories c on c.slug = si.category;

insert into public.menu_item_images (menu_item_id, storage_path, alt_text, is_primary)
select m.id, 'placeholder:' || si.art, si.name || ' (illustration)', true
from seed_items si join public.menu_items m on m.slug = si.slug;

insert into public.menu_item_allergens (menu_item_id, allergen_id, presence)
select m.id, a.id, 'contains'::public.allergen_presence from seed_items si join public.menu_items m on m.slug = si.slug
  cross join lateral unnest(si.contains) as x(slug) join public.allergens a on a.slug = x.slug
union all
select m.id, a.id, 'may_contain'::public.allergen_presence from seed_items si join public.menu_items m on m.slug = si.slug
  cross join lateral unnest(si.may) as x(slug) join public.allergens a on a.slug = x.slug;

insert into public.menu_item_badges (menu_item_id, badge_id)
select m.id, b.id from seed_items si join public.menu_items m on m.slug = si.slug
  cross join lateral unnest(si.badges) as x(slug) join public.dietary_badges b on b.slug = x.slug;

-- ── Templates (Week A / Week B rotation) ─────────────────────────────────────
insert into public.menu_templates (id, name, description, rotation_position) values
  ('e1000000-0000-4000-8000-000000000001', 'Week A · Comfort classics', 'Mac & cheese, wraps and bakes.', 1),
  ('e1000000-0000-4000-8000-000000000002', 'Week B · World tour', 'Teriyaki, curry, quesadillas and salmon.', 2);

insert into public.menu_template_items (menu_template_id, menu_item_id, sort_order, capacity)
select 'e1000000-0000-4000-8000-000000000001', m.id, x.ord, case when m.slug = 'baked-mac-and-cheese' then 120 end
from unnest(array['baked-mac-and-cheese', 'turkey-avocado-wrap', 'broccoli-cheddar-bake', 'veggie-pasta-salad',
  'turkey-meatballs-marinara', 'garden-broccoli-bites', 'rainbow-carrot-slaw', 'apple-slices-sunbutter', 'oat-apple-cookie',
  'strawberry-banana-smoothie']) with ordinality as x(slug, ord)
join public.menu_items m on m.slug = x.slug;

insert into public.menu_template_items (menu_template_id, menu_item_id, sort_order)
select 'e1000000-0000-4000-8000-000000000002', m.id, x.ord
from unnest(array['teriyaki-chicken-rice', 'chickpea-curry-rice', 'black-bean-quesadilla', 'salmon-sweet-potato',
  'chicken-veggie-wrap', 'carrot-sticks-hummus', 'cucumber-edamame-salad', 'yogurt-berry-parfait', 'veggie-mini-muffins',
  'vanilla-oat-milk']) with ordinality as x(slug, ord)
join public.menu_items m on m.slug = x.slug;

-- ── Three published weeks, starting next Monday (alternating A/B) ────────────
update public.site_settings set rotation_anchor_week = (date_trunc('week', now() at time zone 'America/Los_Angeles')::date + 7);
select public.generate_rotation_weeks(3);
update public.menu_weeks
  set status = 'published',
      notes_to_families = 'Fresh this week! Tap a meal to see allergens.'
  where week_start between date_trunc('week', now() at time zone 'America/Los_Angeles')::date + 7
                       and date_trunc('week', now() at time zone 'America/Los_Angeles')::date + 21;
-- The current week stays a draft (generated, not published), useful for testing the admin flow.

-- ── Plans ────────────────────────────────────────────────────────────────────
insert into public.plans (name, slug, description_rich, audience, billing_interval, meals_per_interval, allowance_unit,
                          price_cents, price_per_extra_meal_cents, includes_snacks, snacks_per_interval, max_skips_per_month,
                          rollover_unused, max_rollover, auto_fill_strategy, sort_order) values
  ('3 Lunches / week / child', '3-lunches-week', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Three chef-made lunches each week for each child."}]}]}',
   'family', 'week', 3, 'per_child', 2550, 875, false, 0, 2, false, 0, 'favorites', 1),
  ('5 Lunches / week / child', '5-lunches-week', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A lunch every school day, plus two snacks."}]}]}',
   'family', 'week', 5, 'per_child', 3995, 825, true, 2, 2, true, 2, 'favorites', 2),
  ('Monthly Family Bundle', 'monthly-family-bundle', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Twenty meals a month to share across your household."}]}]}',
   'family', 'month', 20, 'per_household', 15900, 825, true, 8, 4, true, 5, 'chefs_choice', 3);

-- ── Households, children, addresses ──────────────────────────────────────────
do $$
declare
  v_h1 uuid;
  v_h2 uuid;
  v_org uuid;
begin
  select household_id into v_h1 from public.household_members where user_id = 'a0000000-0000-4000-8000-000000000004';
  select household_id into v_h2 from public.household_members where user_id = 'a0000000-0000-4000-8000-000000000005';
  select id into v_org from public.organizations where name = 'Maple Grove Elementary';

  update public.households set name = 'The Patel household', default_zone_id = 'd1000000-0000-4000-8000-000000000001' where id = v_h1;
  update public.households set name = 'The Rivera household', default_zone_id = 'd1000000-0000-4000-8000-000000000002' where id = v_h2;

  insert into public.addresses (id, household_id, line1, city, zip, delivery_notes, is_default) values
    ('ad000000-0000-4000-8000-000000000001', v_h1, '450 Orange Grove Blvd', 'Pasadena', '91105', 'Leave on the porch bench.', true),
    ('ad000000-0000-4000-8000-000000000002', v_h2, '2210 Sunset Blvd, Apt 3', 'Los Angeles', '90026', 'Buzz #3.', true);
  update public.households set default_address_id = 'ad000000-0000-4000-8000-000000000001' where id = v_h1;
  update public.households set default_address_id = 'ad000000-0000-4000-8000-000000000002' where id = v_h2;

  insert into public.children (id, household_id, first_name, last_initial, school_id, classroom_id, grade, dietary_preferences, notes) values
    ('cd000000-0000-4000-8000-000000000001', v_h1, 'Maya', 'P', v_org, 'c1000000-0000-4000-8000-000000000002', '2', '{vegetarian}', 'Loves anything with cheese.'),
    ('cd000000-0000-4000-8000-000000000002', v_h1, 'Leo', 'P', null, null, 'Pre-K', '{}', null),
    ('cd000000-0000-4000-8000-000000000003', v_h2, 'Ava', 'R', v_org, 'c1000000-0000-4000-8000-000000000003', '4', '{}', 'Small appetite.');

  insert into public.child_allergens (child_id, allergen_id, severity)
  select 'cd000000-0000-4000-8000-000000000001'::uuid, id, 'severe'::public.allergy_severity from public.allergens where slug = 'sesame'
  union all select 'cd000000-0000-4000-8000-000000000002', id, 'allergy' from public.allergens where slug = 'milk'
  union all select 'cd000000-0000-4000-8000-000000000003', id, 'intolerance' from public.allergens where slug = 'wheat';

  insert into public.favorites (household_id, child_id, menu_item_id)
  select v_h1, 'cd000000-0000-4000-8000-000000000001', id from public.menu_items where slug = 'baked-mac-and-cheese';

  insert into public.standing_orders (organization_id, classroom_id, name, weekdays, start_date, quantity_mode, menu_selection_mode, status, notes)
  values (v_org, 'c1000000-0000-4000-8000-000000000001', 'Sunflowers daily lunch', '{1,2,3,4,5}',
          date_trunc('week', now())::date + 7, 'per_headcount', 'chefs_choice', 'active', 'Two nut-free tables.');
end;
$$;

-- ── A paid sample order for next week (so the kitchen view has data) ─────────
do $$
declare
  v_week uuid;
  v_h1 uuid;
  v_order uuid;
begin
  select id into v_week from public.menu_weeks where week_start = date_trunc('week', now() at time zone 'America/Los_Angeles')::date + 7;
  select household_id into v_h1 from public.household_members where user_id = 'a0000000-0000-4000-8000-000000000004';
  insert into public.orders (household_id, menu_week_id, status, fulfillment, address_snapshot, delivery_zone_id, subtotal_cents,
                             delivery_fee_cents, total_cents, allergy_confirmed_at, placed_at)
  values (v_h1, v_week, 'paid', 'delivery',
          '{"line1":"450 Orange Grove Blvd","city":"Pasadena","state":"CA","zip":"91105"}',
          'd1000000-0000-4000-8000-000000000001', 1790, 499, 2289, now(), now())
  returning id into v_order;
  insert into public.order_items (order_id, child_id, classroom_id, menu_item_id, quantity, unit_price_cents, item_name, allergens_contained, badges)
  select v_order, 'cd000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid, m.id, 1, m.base_price_cents, m.name,
         '{Milk,Wheat}'::text[], '{Vegetarian,"Kid Favorite"}'::text[]
  from public.menu_items m where m.slug = 'baked-mac-and-cheese'
  union all
  select v_order, 'cd000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', m.id, 1, m.base_price_cents, m.name,
         '{Milk,Eggs}', '{Vegetarian}'
  from public.menu_items m where m.slug = 'broccoli-cheddar-bake';
end;
$$;

-- ── CMS starter copy ─────────────────────────────────────────────────────────
-- BEGIN content_blocks (generated by scripts/gen-content-seed.mts)
insert into public.content_blocks (key, type, description, draft_value, published_value, published_at) values
  ('home.hero.eyebrow', 'text', 'Small label above the headline', '"Private kids'' chef · families & schools"', '"Private kids'' chef · families & schools"', now()),
  ('home.hero.title', 'text', 'Headline (first line)', '"Lunch,"', '"Lunch,"', now()),
  ('home.hero.title_highlight', 'text', 'Headline (highlighted words)', '"handled."', '"handled."', now()),
  ('home.hero.subtitle', 'text', 'Text under the headline', '"Healthy, home-cooked meals your kids will actually eat. Order the whole week in minutes. No more PDF forms."', '"Healthy, home-cooked meals your kids will actually eat. Order the whole week in minutes. No more PDF forms."', now()),
  ('home.hero.cta', 'cta', 'Main button', '{"label":"See this week''s menu","href":"/menu"}', '{"label":"See this week''s menu","href":"/menu"}', now()),
  ('home.hero.cta_secondary', 'cta', 'Second button', '{"label":"Create a family account","href":"/sign-up"}', '{"label":"Create a family account","href":"/sign-up"}', now()),
  ('home.hero.caption', 'text', 'Caption under the lunch tray', '"Mac & cheese, broccoli, apple, carrots"', '"Mac & cheese, broccoli, apple, carrots"', now()),
  ('home.hero.caption_done', 'text', 'Caption once the tray is packed', '"Lunch packed. Allergies checked for every child."', '"Lunch packed. Allergies checked for every child."', now()),
  ('home.hero.stamp', 'text', 'Stamp on the packed tray ("PACKED!")', '"PACKED!"', '"PACKED!"', now()),
  ('home.hero.scroll_hint', 'text', '"Scroll" hint', '"Scroll to pack lunch"', '"Scroll to pack lunch"', now()),
  ('home.week.title', 'text', '"This week" heading', '"This week, at a glance"', '"This week, at a glance"', now()),
  ('home.week.subtitle', 'text', '"This week" text', '"A fresh menu every week. Tap a meal to see what''s cooking."', '"A fresh menu every week. Tap a meal to see what''s cooking."', now()),
  ('home.allergy.title', 'text', 'Allergy box heading', '"Allergies are blocked, not just noted."', '"Allergies are blocked, not just noted."', now()),
  ('home.allergy.body', 'text', 'Allergy box text', '"If a meal contains something on your child''s allergy list, you can''t add it by mistake. At checkout we ask one quick question: “Are these still correct for each child?”"', '"If a meal contains something on your child''s allergy list, you can''t add it by mistake. At checkout we ask one quick question: “Are these still correct for each child?”"', now()),
  ('home.schools.title', 'text', 'Schools heading', '"Feeding a"', '"Feeding a"', now()),
  ('home.schools.title_highlight', 'text', 'Schools heading (highlighted words)', '"whole class?"', '"whole class?"', now()),
  ('home.schools.body', 'text', 'Schools text', '"Standing orders sized to each classroom''s headcount, drop-off at school, and one simple invoice each month."', '"Standing orders sized to each classroom''s headcount, drop-off at school, and one simple invoice each month."', now()),
  ('home.schools.cta', 'cta', 'Schools button', '{"label":"Set up your school","href":"/sign-up"}', '{"label":"Set up your school","href":"/sign-up"}', now()),
  ('how_it_works.title', 'text', 'Heading', '"How it works"', '"How it works"', now()),
  ('how_it_works.steps', 'json', 'The three steps', '[{"title":"Tell us about your kids","body":"First names, classroom and allergies. Once. We remember them every week.","bubble":"Sam can''t have sesame!"},{"title":"Pick meals in a few taps","body":"Choose from this week''s menu for each child, or reorder last week''s favourites with one tap.","bubble":"Same as last week, please."},{"title":"We cook. You relax.","body":"Fresh, home-cooked and labelled for each child. Delivered to your door or straight to school.","bubble":"Lunch is here!"}]', '[{"title":"Tell us about your kids","body":"First names, classroom and allergies. Once. We remember them every week.","bubble":"Sam can''t have sesame!"},{"title":"Pick meals in a few taps","body":"Choose from this week''s menu for each child, or reorder last week''s favourites with one tap.","bubble":"Same as last week, please."},{"title":"We cook. You relax.","body":"Fresh, home-cooked and labelled for each child. Delivered to your door or straight to school.","bubble":"Lunch is here!"}]', now()),
  ('menu.title', 'text', 'Page heading', '"This week''s menu"', '"This week''s menu"', now()),
  ('menu.subtitle', 'text', 'Text under the heading', '"Fresh, home-cooked meals for the week ahead."', '"Fresh, home-cooked meals for the week ahead."', now()),
  ('menu.empty', 'text', 'When no menu is published', '"The next menu is being cooked up. Check back soon!"', '"The next menu is being cooked up. Check back soon!"', now()),
  ('menu.allergen_disclaimer', 'rich_text', 'Allergen note', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Every meal lists the allergens it contains. Our kitchen handles common allergens, so we can''t promise any meal is allergen-free. When you order, meals that clash with your child''s allergies are blocked."}]}]}', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Every meal lists the allergens it contains. Our kitchen handles common allergens, so we can''t promise any meal is allergen-free. When you order, meals that clash with your child''s allergies are blocked."}]}]}', now()),
  ('menu.contains_label', 'text', '"Contains" label', '"Contains"', '"Contains"', now()),
  ('menu.may_contain_label', 'text', '"May contain" label', '"May contain"', '"May contain"', now()),
  ('menu.no_allergens_label', 'text', '"No top-9 allergens" label', '"No top-9 allergens"', '"No top-9 allergens"', now()),
  ('menu.cutoff_label', 'text', '"Order by" label', '"Order by {date}"', '"Order by {date}"', now()),
  ('checkout.allergy_disclaimer', 'rich_text', 'Allergy disclaimer at checkout', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Please check each child''s allergies below. Meals that clash with a listed allergy can''t be ordered. Our kitchen handles common allergens and shared equipment."}]}]}', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Please check each child''s allergies below. Meals that clash with a listed allergy can''t be ordered. Our kitchen handles common allergens and shared equipment."}]}]}', now()),
  ('account.title', 'text', 'Account page heading', '"Your account"', '"Your account"', now()),
  ('account.greeting', 'text', 'Greeting (use {name})', '"Hi, {name}"', '"Hi, {name}"', now()),
  ('account.passkey_offer.title', 'text', 'Passkey suggestion heading', '"Sign in faster with a passkey"', '"Sign in faster with a passkey"', now()),
  ('account.passkey_offer.body', 'text', 'Passkey suggestion text', '"Use Face ID, Touch ID or your device PIN instead of a password."', '"Use Face ID, Touch ID or your device PIN instead of a password."', now()),
  ('account.passkey_offer.cta', 'text', 'Passkey suggestion link', '"Add a passkey"', '"Add a passkey"', now()),
  ('account.security.title', 'text', 'Security card heading', '"Security"', '"Security"', now()),
  ('account.security.body', 'text', 'Security card text', '"Sign-in methods, passkeys, password, two-factor, devices."', '"Sign-in methods, passkeys, password, two-factor, devices."', now()),
  ('account.privacy.title', 'text', 'Privacy card heading', '"Privacy"', '"Privacy"', now()),
  ('account.privacy.body', 'text', 'Privacy card text', '"Download your data or delete your account."', '"Download your data or delete your account."', now()),
  ('account.coming_soon', 'text', '"Coming soon" text for pages not built yet', '"Coming soon"', '"Coming soon"', now()),
  ('family.cart.title', 'text', 'Cart page heading', '"Cart"', '"Cart"', now()),
  ('family.cart.body', 'text', 'Cart page text', '"Review meals for each child before checkout."', '"Review meals for each child before checkout."', now()),
  ('family.checkout.title', 'text', 'Checkout page heading', '"Checkout"', '"Checkout"', now()),
  ('family.checkout.body', 'text', 'Checkout page text', '"Confirm allergies for each child, then pay securely."', '"Confirm allergies for each child, then pay securely."', now()),
  ('family.children.title', 'text', 'Children page heading', '"Children"', '"Children"', now()),
  ('family.children.body', 'text', 'Children page text', '"Each child''s first name, classroom, allergies and dietary needs."', '"Each child''s first name, classroom, allergies and dietary needs."', now()),
  ('family.favorites.title', 'text', 'Favorites page heading', '"Favorites"', '"Favorites"', now()),
  ('family.favorites.body', 'text', 'Favorites page text', '"Meals you''ve saved for quick ordering."', '"Meals you''ve saved for quick ordering."', now()),
  ('family.orders.title', 'text', 'Orders page heading', '"Orders"', '"Orders"', now()),
  ('family.orders.body', 'text', 'Orders page text', '"Upcoming and past orders, with one-tap reorder."', '"Upcoming and past orders, with one-tap reorder."', now()),
  ('family.subscription.title', 'text', 'Subscription page heading', '"Subscription"', '"Subscription"', now()),
  ('family.subscription.body', 'text', 'Subscription page text', '"Your meal plan, billing and pause/skip options."', '"Your meal plan, billing and pause/skip options."', now()),
  ('school.pending_banner', 'text', 'Banner while a school awaits approval', '"Thanks for applying! We''re reviewing your school and will email you once it''s approved."', '"Thanks for applying! We''re reviewing your school and will email you once it''s approved."', now()),
  ('footer.tagline', 'text', 'Tagline', '"Healthy, home-cooked meals for kids. Made fresh every week."', '"Healthy, home-cooked meals for kids. Made fresh every week."', now()),
  ('footer.allergen_note', 'text', 'Allergen note', '"Allergen information is listed on every meal. We take allergies seriously, but our kitchen handles common allergens, so we never promise “allergen-free”."', '"Allergen information is listed on every meal. We take allergies seriously, but our kitchen handles common allergens, so we never promise “allergen-free”."', now()),
  ('nav.menu', 'text', '"Menu" link', '"This week''s menu"', '"This week''s menu"', now()),
  ('nav.how_it_works', 'text', '"How it works" link', '"How it works"', '"How it works"', now()),
  ('nav.schools', 'text', '"For schools" link', '"For schools"', '"For schools"', now()),
  ('nav.sign_in', 'text', '"Sign in" button', '"Sign in"', '"Sign in"', now()),
  ('nav.get_started', 'text', '"Get started" button', '"Get started"', '"Get started"', now()),
  ('nav.sign_out', 'text', '"Sign out" button', '"Sign out"', '"Sign out"', now()),
  ('nav.tab_menu', 'text', 'Phone tab: Menu', '"Menu"', '"Menu"', now()),
  ('nav.tab_orders', 'text', 'Phone tab: Orders', '"Orders"', '"Orders"', now()),
  ('nav.tab_cart', 'text', 'Phone tab: Cart', '"Cart"', '"Cart"', now()),
  ('nav.tab_favorites', 'text', 'Phone tab: Favorites', '"Favorites"', '"Favorites"', now()),
  ('nav.tab_account', 'text', 'Phone tab: Account', '"Account"', '"Account"', now()),
  ('banner.preview_mode', 'text', 'Preview mode banner (owner only)', '"Preview mode: you''re seeing unpublished changes."', '"Preview mode: you''re seeing unpublished changes."', now());
-- END content_blocks

insert into public.pages (slug, title, seo_title, seo_description, body_draft, body_published, is_published, published_at) values
  ('about', 'About Smart Cookie', 'About Smart Cookie', 'A private kids'' chef making healthy, home-cooked meals for families and schools.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Smart Cookie is a private kids'' chef service. Hannah cooks healthy, home-made meals every week for families and schools."}]}]}',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Smart Cookie is a private kids'' chef service. Hannah cooks healthy, home-made meals every week for families and schools."}]}]}', true, now()),
  ('allergy-policy', 'Allergy policy', 'Allergy policy', 'How Smart Cookie handles allergens.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"We label the top 9 allergens on every meal and block meals that clash with your child''s profile. Our kitchen is not allergen-free."}]}]}',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"We label the top 9 allergens on every meal and block meals that clash with your child''s profile. Our kitchen is not allergen-free."}]}]}', true, now()),
  ('refunds', 'Refund & cancellation policy', 'Refund & cancellation policy', 'How cancellations, skips and refunds work.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"You can change or cancel an order until the weekly cutoff. After the cutoff we have already shopped and cooked, so orders can''t be refunded, but we will always make it right if something went wrong."}]}]}',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"You can change or cancel an order until the weekly cutoff. After the cutoff we have already shopped and cooked, so orders can''t be refunded, but we will always make it right if something went wrong."}]}]}', true, now()),
  ('privacy', 'Privacy policy', 'Privacy policy', 'What we collect and why.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Placeholder: the owner will publish the final privacy policy here."}]}]}', null, false, null),
  ('terms', 'Terms of service', 'Terms of service', 'The terms for using Smart Cookie.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Placeholder: the owner will publish the final terms here."}]}]}', null, false, null);

insert into public.faqs (question, answer_rich, category, sort_order, is_published) values
  ('When is the ordering cutoff?', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Thursday at 6pm before the delivery week, unless a week says otherwise."}]}]}', 'Ordering', 1, true),
  ('How do you handle allergies?', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Add allergies to each child''s profile. Meals that contain them are blocked when you order."}]}]}', 'Allergies', 2, true),
  ('Can I skip a week on my plan?', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Yes. Most plans allow up to two skips a month from your account."}]}]}', 'Plans', 3, true),
  ('Do you deliver to schools?', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Yes. Partner schools get drop-off and monthly invoicing."}]}]}', 'Schools', 4, true);

insert into public.testimonials (quote, attribution, is_published, sort_order) values
  ('Ordering takes me two minutes now, and my picky eater actually finishes lunch.', 'Priya, mom of two', true, 1),
  ('The allergy labels give our teachers real peace of mind.', 'Front office, partner school', true, 2);

insert into public.email_templates (key, subject, preheader, body_rich) values
  ('order_confirmation', 'Your Smart Cookie order {{order_number}} is confirmed', 'Here''s what''s coming this week.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi {{first_name}}, thanks for your order! We''ll deliver on {{delivery_dates}}."}]}]}'),
  ('order_cutoff_reminder', 'Order by {{cutoff}} for next week', 'Next week''s menu is ready.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Next week''s menu is live. Order by {{cutoff}} so we can cook for you."}]}]}'),
  ('school_invoice', 'Smart Cookie invoice for {{period}}', 'Your monthly invoice is ready.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Your invoice for {{period}} is ready: {{invoice_url}}"}]}]}');

update public.site_settings set contact_email = 'hello@smartcookie.test', contact_phone = '(626) 555-0100',
  social_links = '{"instagram":"https://instagram.com/smartcookie"}';

insert into public.pilot_invites (code, email) values ('PILOT-FAMILY-01', null), ('PILOT-SCHOOL-01', 'school@smartcookie.test');
