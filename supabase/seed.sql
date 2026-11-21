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
  ('peanut-noodle-bowl', 'Peanut noodle bowl', 'Wheat noodles, crunchy veg and a mild peanut sauce.', 'mains', 925, 675, false, 'pasta', '{peanuts,wheat,soy}', '{}', '{vegetarian}'),
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
  'turkey-meatballs-marinara', 'peanut-noodle-bowl', 'garden-broccoli-bites', 'rainbow-carrot-slaw', 'apple-slices-sunbutter', 'oat-apple-cookie',
  'strawberry-banana-smoothie']) with ordinality as x(slug, ord)
join public.menu_items m on m.slug = x.slug;

insert into public.menu_template_items (menu_template_id, menu_item_id, sort_order)
select 'e1000000-0000-4000-8000-000000000002', m.id, x.ord
from unnest(array['teriyaki-chicken-rice', 'peanut-noodle-bowl', 'chickpea-curry-rice', 'black-bean-quesadilla', 'salmon-sweet-potato',
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
  ('nav.tab_menu', 'text', 'Phone tab: Order', '"Order"', '"Order"', now()),
  ('nav.tab_orders', 'text', 'Phone tab: Orders', '"Orders"', '"Orders"', now()),
  ('nav.tab_cart', 'text', 'Phone tab: Cart', '"Cart"', '"Cart"', now()),
  ('nav.tab_favorites', 'text', 'Phone tab: Favorites', '"Favorites"', '"Favorites"', now()),
  ('nav.tab_account', 'text', 'Phone tab: Account', '"Account"', '"Account"', now()),
  ('banner.preview_mode', 'text', 'Preview mode banner (owner only)', '"Preview mode: you''re seeing unpublished changes."', '"Preview mode: you''re seeing unpublished changes."', now()),
  ('home.marquee', 'text', 'Scrolling ribbon (separate items with ·)', '"Chef-made · Veggie-packed · Allergy-checked · Fresh every week · Labelled for each child · Delivered or dropped at school"', '"Chef-made · Veggie-packed · Allergy-checked · Fresh every week · Labelled for each child · Delivered or dropped at school"', now()),
  ('home.plans.title', 'text', 'Plans heading', '"Pick how you order"', '"Pick how you order"', now()),
  ('home.plans.subtitle', 'text', 'Plans text', '"Order à la carte when it suits you, or subscribe and lunch is sorted every week."', '"Order à la carte when it suits you, or subscribe and lunch is sorted every week."', now()),
  ('home.plans.a_la_carte_title', 'text', 'À la carte card heading', '"À la carte"', '"À la carte"', now()),
  ('home.plans.a_la_carte_body', 'text', 'À la carte card text', '"Choose meals each week. No commitment, pay as you go."', '"Choose meals each week. No commitment, pay as you go."', now()),
  ('home.plans.per_week', 'text', '"per week" label', '"per week"', '"per week"', now()),
  ('home.plans.per_month', 'text', '"per month" label', '"per month"', '"per month"', now()),
  ('home.plans.per_two_weeks', 'text', '"every two weeks" label', '"every two weeks"', '"every two weeks"', now()),
  ('home.plans.cta', 'cta', 'Plans button', '{"label":"Compare plans","href":"/plans"}', '{"label":"Compare plans","href":"/plans"}', now()),
  ('home.testimonials.title', 'text', 'Testimonials heading', '"Parents say"', '"Parents say"', now()),
  ('home.faq.title', 'text', 'FAQ teaser heading', '"Quick answers"', '"Quick answers"', now()),
  ('home.faq.cta', 'cta', 'FAQ teaser button', '{"label":"All questions","href":"/faq"}', '{"label":"All questions","href":"/faq"}', now()),
  ('home.cta.title', 'text', 'Closing call-to-action heading', '"Lunch, handled. Every week."', '"Lunch, handled. Every week."', now()),
  ('home.cta.body', 'text', 'Closing call-to-action text', '"Set up your kids once. Reorder in seconds after that."', '"Set up your kids once. Reorder in seconds after that."', now()),
  ('home.cta.button', 'cta', 'Closing call-to-action button', '{"label":"Get started","href":"/sign-up"}', '{"label":"Get started","href":"/sign-up"}', now()),
  ('home.week.cta', 'text', 'Link under the week''s meals', '"See the full menu"', '"See the full menu"', now()),
  ('plans.title', 'text', 'Plans page heading', '"Plans & pricing"', '"Plans & pricing"', now()),
  ('plans.subtitle', 'text', 'Plans page text', '"Simple, flexible, cancel any time. Prices are per plan; extra meals are charged at menu price."', '"Simple, flexible, cancel any time. Prices are per plan; extra meals are charged at menu price."', now()),
  ('plans.meals_label', 'text', 'Meals per plan (use {count})', '"{count} meals"', '"{count} meals"', now()),
  ('plans.per_child', 'text', '"per child" label', '"per child"', '"per child"', now()),
  ('plans.per_household', 'text', '"per household" label', '"shared by the household"', '"shared by the household"', now()),
  ('plans.snacks_label', 'text', 'Snacks per plan (use {count})', '"+ {count} snacks"', '"+ {count} snacks"', now()),
  ('plans.skip_label', 'text', 'Skip rule (use {count})', '"Skip up to {count} weeks a month"', '"Skip up to {count} weeks a month"', now()),
  ('plans.pause_label', 'text', 'Pause rule', '"Pause any time"', '"Pause any time"', now()),
  ('plans.extra_label', 'text', 'Extra meal price (use {price})', '"Extra meals {price}"', '"Extra meals {price}"', now()),
  ('plans.cta', 'text', 'Plan button', '"Start with this plan"', '"Start with this plan"', now()),
  ('plans.compare_title', 'text', 'Comparison table heading', '"Side by side"', '"Side by side"', now()),
  ('plans.compare_feature', 'text', 'Comparison first column', '"What you get"', '"What you get"', now()),
  ('plans.a_la_carte_note', 'text', 'À la carte note', '"Prefer to pick week by week? Order à la carte, no plan needed."', '"Prefer to pick week by week? Order à la carte, no plan needed."', now()),
  ('schools.title', 'text', 'Schools page heading', '"Lunch for the whole class."', '"Lunch for the whole class."', now()),
  ('schools.subtitle', 'text', 'Schools page text', '"Standing orders sized to each classroom''s headcount, drop-off at school and one invoice a month."', '"Standing orders sized to each classroom''s headcount, drop-off at school and one invoice a month."', now()),
  ('schools.point1_title', 'text', 'Point 1 heading', '"Sized to headcount"', '"Sized to headcount"', now()),
  ('schools.point1_body', 'text', 'Point 1 text', '"Set each classroom once. Orders adjust when your numbers change."', '"Set each classroom once. Orders adjust when your numbers change."', now()),
  ('schools.point2_title', 'text', 'Point 2 heading', '"Dropped at the front office"', '"Dropped at the front office"', now()),
  ('schools.point2_body', 'text', 'Point 2 text', '"Labelled by classroom and child, with allergy flags in red."', '"Labelled by classroom and child, with allergy flags in red."', now()),
  ('schools.point3_title', 'text', 'Point 3 heading', '"One monthly invoice"', '"One monthly invoice"', now()),
  ('schools.point3_body', 'text', 'Point 3 text', '"Net terms for schools, with every delivery itemised."', '"Net terms for schools, with every delivery itemised."', now()),
  ('schools.cta', 'cta', 'Schools page button', '{"label":"Set up your school","href":"/sign-up?type=school"}', '{"label":"Set up your school","href":"/sign-up?type=school"}', now()),
  ('faq.title', 'text', 'FAQ page heading', '"Questions, answered"', '"Questions, answered"', now()),
  ('faq.subtitle', 'text', 'FAQ page text', '"Can''t find what you need? Email us and we''ll get back to you."', '"Can''t find what you need? Email us and we''ll get back to you."', now()),
  ('faq.empty', 'text', 'When there are no FAQs', '"No questions yet."', '"No questions yet."', now()),
  ('seo.site_description', 'text', 'Search engine description (whole site)', '"Healthy, home-cooked meals for kids, delivered or dropped at school. Order the week in minutes, with allergies checked for every child."', '"Healthy, home-cooked meals for kids, delivered or dropped at school. Order the week in minutes, with allergies checked for every child."', now()),
  ('seo.menu_description', 'text', 'Search description: menu', '"This week''s chef-made menu for kids, with every allergen listed."', '"This week''s chef-made menu for kids, with every allergen listed."', now()),
  ('seo.plans_description', 'text', 'Search description: plans', '"Weekly and monthly meal plans for kids. Skip or pause any time."', '"Weekly and monthly meal plans for kids. Skip or pause any time."', now()),
  ('seo.schools_description', 'text', 'Search description: schools', '"School lunch by classroom headcount, dropped at school, invoiced monthly."', '"School lunch by classroom headcount, dropped at school, invoiced monthly."', now()),
  ('seo.faq_description', 'text', 'Search description: FAQ', '"Answers about ordering, allergies, delivery and plans."', '"Answers about ordering, allergies, delivery and plans."', now()),
  ('onb.title', 'text', 'Heading', '"Let''s set up your family"', '"Let''s set up your family"', now()),
  ('onb.subtitle', 'text', 'Text under heading', '"Four quick steps. You''ll only do this once."', '"Four quick steps. You''ll only do this once."', now()),
  ('onb.step_of', 'text', 'Step counter (use {n} and {total})', '"Step {n} of {total}"', '"Step {n} of {total}"', now()),
  ('onb.skip', 'text', 'Skip link', '"Skip for now"', '"Skip for now"', now()),
  ('onb.back', 'text', 'Back button', '"Back"', '"Back"', now()),
  ('onb.next', 'text', 'Continue button', '"Continue"', '"Continue"', now()),
  ('onb.finish', 'text', 'Finish button', '"Start ordering"', '"Start ordering"', now()),
  ('onb.household_title', 'text', 'Step 1 heading', '"Your household"', '"Your household"', now()),
  ('onb.household_name', 'text', 'Household name label', '"Household name"', '"Household name"', now()),
  ('onb.household_phone', 'text', 'Phone label', '"Mobile number (for delivery updates)"', '"Mobile number (for delivery updates)"', now()),
  ('onb.address_title', 'text', 'Step 2 heading', '"Where should we deliver?"', '"Where should we deliver?"', now()),
  ('onb.address_line1', 'text', 'Street label', '"Street address"', '"Street address"', now()),
  ('onb.address_line2', 'text', 'Line 2 label', '"Apt, suite (optional)"', '"Apt, suite (optional)"', now()),
  ('onb.address_city', 'text', 'City label', '"City"', '"City"', now()),
  ('onb.address_zip', 'text', 'ZIP label', '"ZIP code"', '"ZIP code"', now()),
  ('onb.address_notes', 'text', 'Notes label', '"Delivery notes (optional)"', '"Delivery notes (optional)"', now()),
  ('onb.zip_check', 'text', 'Check ZIP button', '"Check my ZIP"', '"Check my ZIP"', now()),
  ('onb.zip_ok', 'text', 'ZIP covered (use {zone} and {days})', '"Great news: we deliver to {zone} on {days}."', '"Great news: we deliver to {zone} on {days}."', now()),
  ('onb.zip_no', 'text', 'ZIP not covered', '"We''re not in your area yet, but we''re growing."', '"We''re not in your area yet, but we''re growing."', now()),
  ('onb.waitlist_body', 'text', 'Waitlist text (use {zip})', '"Join the waitlist and we''ll email you the moment we deliver to {zip}."', '"Join the waitlist and we''ll email you the moment we deliver to {zip}."', now()),
  ('onb.waitlist_cta', 'text', 'Waitlist button', '"Join the waitlist"', '"Join the waitlist"', now()),
  ('onb.waitlist_done', 'text', 'Waitlist confirmation', '"You''re on the list. We''ll be in touch."', '"You''re on the list. We''ll be in touch."', now()),
  ('onb.school_offer', 'text', 'School drop-off offer', '"Does your child go to a partner school? We can deliver to school instead."', '"Does your child go to a partner school? We can deliver to school instead."', now()),
  ('onb.school_cta', 'text', 'School drop-off button', '"Deliver to school instead"', '"Deliver to school instead"', now()),
  ('onb.kids_title', 'text', 'Step 3 heading', '"Add your kids"', '"Add your kids"', now()),
  ('onb.kids_body', 'text', 'Step 3 text', '"First name and allergies are all we need. Allergies block unsafe meals automatically."', '"First name and allergies are all we need. Allergies block unsafe meals automatically."', now()),
  ('onb.plan_title', 'text', 'Step 4 heading', '"How would you like to order?"', '"How would you like to order?"', now()),
  ('onb.plan_a_la_carte', 'text', 'À la carte option', '"Pick à la carte each week"', '"Pick à la carte each week"', now()),
  ('onb.plan_a_la_carte_body', 'text', 'À la carte option text', '"Choose meals when you want them. No commitment."', '"Choose meals when you want them. No commitment."', now()),
  ('onb.plan_subscribe', 'text', 'Subscribe option', '"Subscribe to a plan"', '"Subscribe to a plan"', now()),
  ('onb.plan_subscribe_body', 'text', 'Subscribe option text', '"Meals included every week, extras at menu price. Skip or pause any time."', '"Meals included every week, extras at menu price. Skip or pause any time."', now()),
  ('onb.saved', 'text', 'Saved confirmation', '"Saved"', '"Saved"', now()),
  ('kids.title', 'text', 'Page heading', '"Your kids"', '"Your kids"', now()),
  ('kids.subtitle', 'text', 'Page text', '"Allergies here block unsafe meals for that child. Keep them up to date."', '"Allergies here block unsafe meals for that child. Keep them up to date."', now()),
  ('kids.add', 'text', 'Add child button', '"Add a child"', '"Add a child"', now()),
  ('kids.add_another', 'text', 'Add another button', '"Add another child"', '"Add another child"', now()),
  ('kids.edit', 'text', 'Edit button', '"Edit"', '"Edit"', now()),
  ('kids.save', 'text', 'Save button', '"Save child"', '"Save child"', now()),
  ('kids.cancel', 'text', 'Cancel button', '"Cancel"', '"Cancel"', now()),
  ('kids.remove', 'text', 'Remove button', '"Remove"', '"Remove"', now()),
  ('kids.remove_confirm', 'text', 'Remove confirmation (use {name})', '"Remove {name}? Past orders are kept."', '"Remove {name}? Past orders are kept."', now()),
  ('kids.first_name', 'text', 'First name label', '"First name"', '"First name"', now()),
  ('kids.last_initial', 'text', 'Last initial label', '"Last initial"', '"Last initial"', now()),
  ('kids.grade', 'text', 'Grade label', '"Grade (optional)"', '"Grade (optional)"', now()),
  ('kids.school', 'text', 'School label', '"School (optional)"', '"School (optional)"', now()),
  ('kids.no_school', 'text', 'No school option', '"No school / home delivery"', '"No school / home delivery"', now()),
  ('kids.classroom', 'text', 'Classroom label', '"Classroom"', '"Classroom"', now()),
  ('kids.allergies', 'text', 'Allergies label', '"Allergies"', '"Allergies"', now()),
  ('kids.allergies_help', 'text', 'Allergies help', '"Tap each one that applies, then set how serious it is."', '"Tap each one that applies, then set how serious it is."', now()),
  ('kids.custom_allergy', 'text', 'Custom allergy label', '"Something else?"', '"Something else?"', now()),
  ('kids.custom_allergy_help', 'text', 'Custom allergy help', '"Tell us in the notes and we''ll add it to the list."', '"Tell us in the notes and we''ll add it to the list."', now()),
  ('kids.severity', 'text', 'Severity label', '"How serious?"', '"How serious?"', now()),
  ('kids.severity_intolerance', 'text', 'Severity: intolerance', '"Intolerance"', '"Intolerance"', now()),
  ('kids.severity_allergy', 'text', 'Severity: allergy', '"Allergy"', '"Allergy"', now()),
  ('kids.severity_severe', 'text', 'Severity: severe', '"Severe (blocks ''may contain'' too)"', '"Severe (blocks ''may contain'' too)"', now()),
  ('kids.dietary', 'text', 'Dietary preferences label', '"Eats"', '"Eats"', now()),
  ('kids.notes', 'text', 'Notes label', '"Notes for the chef (optional)"', '"Notes for the chef (optional)"', now()),
  ('kids.no_allergies', 'text', 'No allergies text', '"No allergies listed"', '"No allergies listed"', now()),
  ('kids.empty', 'text', 'Empty state', '"No kids yet. Add your first to start ordering."', '"No kids yet. Add your first to start ordering."', now()),
  ('kids.conflicts_title', 'text', 'Conflict warning (use {name})', '"Heads up: upcoming meals now clash with {name}''s allergies"', '"Heads up: upcoming meals now clash with {name}''s allergies"', now()),
  ('kids.conflicts_body', 'text', 'Conflict warning text', '"Edit these orders before the cutoff:"', '"Edit these orders before the cutoff:"', now()),
  ('kids.saved', 'text', 'Saved toast', '"Saved"', '"Saved"', now()),
  ('order.title', 'text', 'Heading (use {date})', '"Order for the week of {date}"', '"Order for the week of {date}"', now()),
  ('order.delivery_days', 'text', 'Delivery days (use {days})', '"Delivered {days}"', '"Delivered {days}"', now()),
  ('order.cutoff', 'text', 'Cutoff (use {date})', '"Order by {date}"', '"Order by {date}"', now()),
  ('order.countdown', 'text', 'Countdown (use {time})', '"{time} left"', '"{time} left"', now()),
  ('order.closed', 'text', 'After cutoff', '"Ordering is closed for this week. Here''s next week."', '"Ordering is closed for this week. Here''s next week."', now()),
  ('order.no_week', 'text', 'No open week', '"The next menu isn''t open yet. We''ll email you when it is."', '"The next menu isn''t open yet. We''ll email you when it is."', now()),
  ('order.paused', 'text', 'Ordering paused fallback', '"Ordering is paused right now."', '"Ordering is paused right now."', now()),
  ('order.no_kids', 'text', 'No children', '"Add your kids first so we can check allergies."', '"Add your kids first so we can check allergies."', now()),
  ('order.add_kids_cta', 'text', 'Add child button', '"Add a child"', '"Add a child"', now()),
  ('order.all_categories', 'text', '"All" category filter', '"All"', '"All"', now()),
  ('order.kids_label', 'text', 'Child tabs label (screen readers)', '"Choose a child"', '"Choose a child"', now()),
  ('order.snacks_title', 'text', 'Snacks section heading', '"Add snacks"', '"Add snacks"', now()),
  ('order.snacks_body', 'text', 'Snacks section text', '"Little extras for lunchboxes and after school."', '"Little extras for lunchboxes and after school."', now()),
  ('order.add', 'text', 'Add button', '"Add"', '"Add"', now()),
  ('order.add_for', 'text', 'Add-for button (use {name})', '"Add for {name}"', '"Add for {name}"', now()),
  ('order.remove', 'text', 'Remove button', '"Remove"', '"Remove"', now()),
  ('order.included', 'text', 'Included in plan badge', '"Included"', '"Included"', now()),
  ('order.unavailable', 'text', 'Blocked badge (use {name})', '"Unavailable for {name}"', '"Unavailable for {name}"', now()),
  ('order.unavailable_reason', 'text', 'Blocked reason (use {allergens} and {name})', '"Contains {allergens}, which is on {name}''s allergy list."', '"Contains {allergens}, which is on {name}''s allergy list."', now()),
  ('order.override', 'text', 'Owner override note (use {name})', '"Approved by the chef for {name}"', '"Approved by the chef for {name}"', now()),
  ('order.warning', 'text', 'May-contain warning (use {allergens})', '"May contain {allergens}"', '"May contain {allergens}"', now()),
  ('order.favorite', 'text', 'Favourite button label (screen readers)', '"Save as favourite"', '"Save as favourite"', now()),
  ('order.unfavorite', 'text', 'Unfavourite button label (screen readers)', '"Remove favourite"', '"Remove favourite"', now()),
  ('order.day_label', 'text', 'Delivery day picker label', '"Day"', '"Day"', now()),
  ('order.allowance', 'text', 'Allowance meter (use {used} and {total})', '"{used} of {total} meals picked this week"', '"{used} of {total} meals picked this week"', now()),
  ('order.allowance_household', 'text', 'Household allowance (use {used} and {total})', '"{used} of {total} household meals picked"', '"{used} of {total} household meals picked"', now()),
  ('order.extra_note', 'text', 'Extras note', '"Extras are charged at menu price."', '"Extras are charged at menu price."', now()),
  ('order.skip_week', 'text', 'Skip button', '"Skip this week"', '"Skip this week"', now()),
  ('order.unskip_week', 'text', 'Unskip button', '"Unskip this week"', '"Unskip this week"', now()),
  ('order.skipped', 'text', 'Skipped banner', '"You''re skipping this week. Nothing is included, but you can still order à la carte."', '"You''re skipping this week. Nothing is included, but you can still order à la carte."', now()),
  ('order.repeat', 'text', 'Repeat button', '"Repeat last week"', '"Repeat last week"', now()),
  ('order.repeat_done', 'text', 'After repeat', '"Last week''s picks are in. Check the highlighted swaps."', '"Last week''s picks are in. Check the highlighted swaps."', now()),
  ('order.repeat_none', 'text', 'Nothing to repeat', '"No previous order to repeat yet."', '"No previous order to repeat yet."', now()),
  ('order.swapped', 'text', 'Swap badge (use {from})', '"Swapped from {from}"', '"Swapped from {from}"', now()),
  ('order.dropped', 'text', 'Dropped line (use {name} and {item})', '"{name} couldn''t be repeated safely: {item}"', '"{name} couldn''t be repeated safely: {item}"', now()),
  ('order.fill_favorites', 'text', 'Fill with favourites button', '"Fill week with favourites"', '"Fill week with favourites"', now()),
  ('order.fill_done', 'text', 'After fill', '"Filled with favourites."', '"Filled with favourites."', now()),
  ('order.fill_none', 'text', 'No favourites', '"Save some favourites first (tap the heart)."', '"Save some favourites first (tap the heart)."', now()),
  ('order.saved_orders', 'text', 'Saved orders heading', '"Saved orders"', '"Saved orders"', now()),
  ('order.save_as', 'text', 'Save combination button', '"Save this week as…"', '"Save this week as…"', now()),
  ('order.save_name', 'text', 'Saved order name label', '"Name (e.g. Mon–Wed usual)"', '"Name (e.g. Mon–Wed usual)"', now()),
  ('order.save', 'text', 'Save button', '"Save"', '"Save"', now()),
  ('order.apply', 'text', 'Apply saved order button', '"Use"', '"Use"', now()),
  ('order.delete', 'text', 'Delete saved order button', '"Delete"', '"Delete"', now()),
  ('order.editing', 'text', 'Editing banner (use {number})', '"Editing order {number}. Changes are re-priced at checkout."', '"Editing order {number}. Changes are re-priced at checkout."', now()),
  ('order.already_ordered', 'text', 'Already ordered (use {number})', '"You''ve ordered for this week ({number})."', '"You''ve ordered for this week ({number})."', now()),
  ('order.edit_order', 'text', 'Change order button', '"Change order"', '"Change order"', now()),
  ('order.cart_items', 'text', 'Cart bar count (use {count})', '"{count} meals"', '"{count} meals"', now()),
  ('order.cart_empty', 'text', 'Empty cart bar', '"Your cart is empty"', '"Your cart is empty"', now()),
  ('order.checkout', 'text', 'Checkout button', '"Review & check out"', '"Review & check out"', now()),
  ('order.subtotal', 'text', 'Subtotal label', '"Subtotal"', '"Subtotal"', now()),
  ('order.view_cart', 'text', 'View cart button', '"View cart"', '"View cart"', now()),
  ('order.clear', 'text', 'Clear cart button', '"Clear cart"', '"Clear cart"', now()),
  ('order.blocked_toast', 'text', 'Blocked toast (use {reason})', '"Not added: {reason}"', '"Not added: {reason}"', now()),
  ('checkout.title', 'text', 'Heading', '"Checkout"', '"Checkout"', now()),
  ('checkout.step_review', 'text', 'Step 1', '"Review"', '"Review"', now()),
  ('checkout.step_delivery', 'text', 'Step 2', '"Delivery"', '"Delivery"', now()),
  ('checkout.step_allergies', 'text', 'Step 3', '"Allergies"', '"Allergies"', now()),
  ('checkout.step_payment', 'text', 'Step 4', '"Payment"', '"Payment"', now()),
  ('checkout.empty', 'text', 'Empty cart', '"Your cart is empty."', '"Your cart is empty."', now()),
  ('checkout.back_to_menu', 'text', 'Back button', '"Back to the menu"', '"Back to the menu"', now()),
  ('checkout.edit', 'text', 'Edit picks link', '"Edit"', '"Edit"', now()),
  ('checkout.continue', 'text', 'Continue button', '"Continue"', '"Continue"', now()),
  ('checkout.back', 'text', 'Back button', '"Back"', '"Back"', now()),
  ('checkout.subtotal', 'text', 'Subtotal label', '"Meals"', '"Meals"', now()),
  ('checkout.included', 'text', 'Included label', '"Included in your plan"', '"Included in your plan"', now()),
  ('checkout.delivery_fee', 'text', 'Delivery fee label', '"Delivery"', '"Delivery"', now()),
  ('checkout.free', 'text', 'Free label', '"Free"', '"Free"', now()),
  ('checkout.free_over', 'text', 'Free over threshold (use {amount})', '"Free delivery over {amount}"', '"Free delivery over {amount}"', now()),
  ('checkout.discount', 'text', 'Discount label', '"Discount"', '"Discount"', now()),
  ('checkout.discount_code', 'text', 'Discount code label', '"Discount code"', '"Discount code"', now()),
  ('checkout.apply', 'text', 'Apply code button', '"Apply"', '"Apply"', now()),
  ('checkout.code_invalid', 'text', 'Invalid code', '"That code isn''t valid."', '"That code isn''t valid."', now()),
  ('checkout.tax', 'text', 'Tax label', '"Tax"', '"Tax"', now()),
  ('checkout.total', 'text', 'Total label', '"Total"', '"Total"', now()),
  ('checkout.estimate_note', 'text', 'Estimate note', '"Totals are confirmed when you place the order."', '"Totals are confirmed when you place the order."', now()),
  ('checkout.minimum', 'text', 'Minimum (use {amount})', '"Minimum order for delivery is {amount}."', '"Minimum order for delivery is {amount}."', now()),
  ('checkout.deliver_home', 'text', 'Home delivery option', '"Deliver to my address"', '"Deliver to my address"', now()),
  ('checkout.deliver_school', 'text', 'School drop-off option', '"Drop off at school"', '"Drop off at school"', now()),
  ('checkout.school_note', 'text', 'School drop-off note', '"Every child in this order needs a school on their profile."', '"Every child in this order needs a school on their profile."', now()),
  ('checkout.add_address', 'text', 'Add address link', '"Add an address"', '"Add an address"', now()),
  ('checkout.notes', 'text', 'Order notes label', '"Notes for this order (optional)"', '"Notes for this order (optional)"', now()),
  ('checkout.allergy_title', 'text', 'Allergy step heading', '"Are these still correct for each child?"', '"Are these still correct for each child?"', now()),
  ('checkout.allergy_correct', 'text', 'Still correct button', '"Still correct"', '"Still correct"', now()),
  ('checkout.allergy_edit', 'text', 'Edit allergies link', '"Edit"', '"Edit"', now()),
  ('checkout.allergy_confirmed', 'text', 'Confirmed label', '"Confirmed"', '"Confirmed"', now()),
  ('checkout.allergy_none', 'text', 'No allergies label', '"No allergies"', '"No allergies"', now()),
  ('checkout.allergy_all', 'text', 'Confirm all & place button', '"All correct, place order"', '"All correct, place order"', now()),
  ('checkout.allergy_needed', 'text', 'Confirmation needed', '"Please confirm each child''s allergies."', '"Please confirm each child''s allergies."', now()),
  ('checkout.place', 'text', 'Place order button', '"Place order"', '"Place order"', now()),
  ('checkout.placing', 'text', 'Placing state', '"Placing…"', '"Placing…"', now()),
  ('checkout.pay_title', 'text', 'Payment heading', '"Payment"', '"Payment"', now()),
  ('checkout.pay_body', 'text', 'Payment text (use {number})', '"Order {number} is saved. Pay now to confirm it."', '"Order {number} is saved. Pay now to confirm it."', now()),
  ('checkout.pay_button', 'text', 'Pay button (use {amount})', '"Pay {amount}"', '"Pay {amount}"', now()),
  ('checkout.pay_test_note', 'text', 'Test mode note', '"Test mode: no card is charged."', '"Test mode: no card is charged."', now()),
  ('checkout.nothing_to_pay', 'text', 'Zero total', '"Nothing to pay: everything is included in your plan."', '"Nothing to pay: everything is included in your plan."', now()),
  ('checkout.done_title', 'text', 'Success heading', '"You''re all set!"', '"You''re all set!"', now()),
  ('checkout.done_body', 'text', 'Success text', '"We''ve got it. You''ll get an email confirmation, and you can change things until the cutoff."', '"We''ve got it. You''ll get an email confirmation, and you can change things until the cutoff."', now()),
  ('checkout.view_order', 'text', 'View order button', '"View order"', '"View order"', now()),
  ('checkout.save_combo', 'text', 'Save combination prompt', '"Save these picks for next time"', '"Save these picks for next time"', now()),
  ('acct.this_week', 'text', 'This-week card heading', '"This week"', '"This week"', now()),
  ('acct.ordered', 'text', 'Ordered status', '"Ordered"', '"Ordered"', now()),
  ('acct.not_ordered', 'text', 'Not ordered status', '"Not ordered yet"', '"Not ordered yet"', now()),
  ('acct.skipped', 'text', 'Skipped status', '"Skipped"', '"Skipped"', now()),
  ('acct.order_now', 'text', 'Order now button', '"Order now"', '"Order now"', now()),
  ('acct.quick_actions', 'text', 'Quick actions heading', '"Quick actions"', '"Quick actions"', now()),
  ('acct.finish_setup', 'text', 'Onboarding nudge', '"Finish setting up your family"', '"Finish setting up your family"', now()),
  ('acct.finish_setup_cta', 'text', 'Onboarding nudge button', '"Continue setup"', '"Continue setup"', now()),
  ('acct.kids', 'text', 'Kids link', '"Kids"', '"Kids"', now()),
  ('acct.kids_body', 'text', 'Kids link text', '"Profiles and allergies"', '"Profiles and allergies"', now()),
  ('acct.subscription', 'text', 'Subscription link', '"Plan"', '"Plan"', now()),
  ('acct.subscription_body', 'text', 'Subscription link text', '"Skip, pause or change"', '"Skip, pause or change"', now()),
  ('acct.addresses', 'text', 'Addresses link', '"Addresses"', '"Addresses"', now()),
  ('acct.addresses_body', 'text', 'Addresses link text', '"Where we deliver"', '"Where we deliver"', now()),
  ('acct.saved_orders', 'text', 'Saved orders link', '"Saved orders"', '"Saved orders"', now()),
  ('acct.saved_orders_body', 'text', 'Saved orders link text', '"Your usual picks"', '"Your usual picks"', now()),
  ('orders.title', 'text', 'Orders heading', '"Your orders"', '"Your orders"', now()),
  ('orders.upcoming', 'text', 'Upcoming heading', '"Upcoming"', '"Upcoming"', now()),
  ('orders.past', 'text', 'Past heading', '"Past"', '"Past"', now()),
  ('orders.empty', 'text', 'No orders', '"No orders yet."', '"No orders yet."', now()),
  ('orders.week_of', 'text', 'Week label (use {date})', '"Week of {date}"', '"Week of {date}"', now()),
  ('orders.items', 'text', 'Item count (use {count})', '"{count} meals"', '"{count} meals"', now()),
  ('orders.status_pending_payment', 'text', 'Status: pending payment', '"Awaiting payment"', '"Awaiting payment"', now()),
  ('orders.status_paid', 'text', 'Status: paid', '"Confirmed"', '"Confirmed"', now()),
  ('orders.status_invoiced', 'text', 'Status: invoiced', '"Invoiced"', '"Invoiced"', now()),
  ('orders.status_fulfilled', 'text', 'Status: fulfilled', '"Delivered"', '"Delivered"', now()),
  ('orders.status_cancelled', 'text', 'Status: cancelled', '"Cancelled"', '"Cancelled"', now()),
  ('orders.status_refunded', 'text', 'Status: refunded', '"Refunded"', '"Refunded"', now()),
  ('orders.status_partially_refunded', 'text', 'Status: partly refunded', '"Partly refunded"', '"Partly refunded"', now()),
  ('orders.modify', 'text', 'Change button', '"Change order"', '"Change order"', now()),
  ('orders.cancel', 'text', 'Cancel button', '"Cancel order"', '"Cancel order"', now()),
  ('orders.cancel_confirm', 'text', 'Cancel confirmation', '"Cancel this order? Refunds follow our refund policy."', '"Cancel this order? Refunds follow our refund policy."', now()),
  ('orders.cancelled', 'text', 'Cancelled toast', '"Order cancelled."', '"Order cancelled."', now()),
  ('orders.pay', 'text', 'Pay button', '"Pay now"', '"Pay now"', now()),
  ('orders.locked', 'text', 'Locked note', '"Changes closed at the cutoff."', '"Changes closed at the cutoff."', now()),
  ('orders.change_until', 'text', 'Changeable note (use {date})', '"You can change or cancel until {date}."', '"You can change or cancel until {date}."', now()),
  ('orders.delivery_to', 'text', 'Address label', '"Delivering to"', '"Delivering to"', now()),
  ('orders.school_dropoff', 'text', 'School drop-off label', '"School drop-off"', '"School drop-off"', now()),
  ('orders.allergies_confirmed', 'text', 'Allergy confirmation (use {date})', '"Allergies confirmed {date}"', '"Allergies confirmed {date}"', now()),
  ('orders.refund_policy', 'text', 'Refund policy link', '"Refund policy"', '"Refund policy"', now()),
  ('orders.reorder', 'text', 'Reorder button', '"Order these again"', '"Order these again"', now()),
  ('sub.title', 'text', 'Subscription heading', '"Your plan"', '"Your plan"', now()),
  ('sub.none', 'text', 'No plan', '"You''re ordering à la carte. Subscribe and meals are included every week."', '"You''re ordering à la carte. Subscribe and meals are included every week."', now()),
  ('sub.choose', 'text', 'Choose plan heading', '"Choose a plan"', '"Choose a plan"', now()),
  ('sub.start', 'text', 'Start button', '"Start this plan"', '"Start this plan"', now()),
  ('sub.started', 'text', 'Started toast', '"Your plan is active."', '"Your plan is active."', now()),
  ('sub.status_active', 'text', 'Status: active', '"Active"', '"Active"', now()),
  ('sub.status_trialing', 'text', 'Status: trialing', '"Trial"', '"Trial"', now()),
  ('sub.status_past_due', 'text', 'Status: past due', '"Payment due"', '"Payment due"', now()),
  ('sub.status_paused', 'text', 'Status: paused', '"Paused"', '"Paused"', now()),
  ('sub.next_bill', 'text', 'Next bill (use {date})', '"Next bill {date}"', '"Next bill {date}"', now()),
  ('sub.allowance', 'text', 'Weekly allowance (use {count})', '"{count} meals a week included"', '"{count} meals a week included"', now()),
  ('sub.paused_until', 'text', 'Paused (use {date})', '"Paused until {date}"', '"Paused until {date}"', now()),
  ('sub.pause', 'text', 'Pause button', '"Pause"', '"Pause"', now()),
  ('sub.pause_until', 'text', 'Resume date label', '"Resume on"', '"Resume on"', now()),
  ('sub.resume', 'text', 'Resume button', '"Resume now"', '"Resume now"', now()),
  ('sub.cancel', 'text', 'Cancel button', '"Cancel plan"', '"Cancel plan"', now()),
  ('sub.cancel_confirm', 'text', 'Cancel confirmation', '"Cancel at the end of this billing period?"', '"Cancel at the end of this billing period?"', now()),
  ('sub.canceling', 'text', 'Canceling note', '"Ends at the end of this period."', '"Ends at the end of this period."', now()),
  ('sub.reactivate', 'text', 'Reactivate button', '"Keep my plan"', '"Keep my plan"', now()),
  ('sub.change', 'text', 'Change plan button', '"Switch to this plan"', '"Switch to this plan"', now()),
  ('sub.change_pending', 'text', 'Pending change (use {plan})', '"Switching to {plan} from your next billing period."', '"Switching to {plan} from your next billing period."', now()),
  ('sub.current', 'text', 'Current plan badge', '"Current plan"', '"Current plan"', now()),
  ('sub.skip_title', 'text', 'Skip list heading', '"Upcoming weeks"', '"Upcoming weeks"', now()),
  ('sub.billing_note', 'text', 'Billing note', '"Card details and receipts arrive with online payments."', '"Card details and receipts arrive with online payments."', now()),
  ('fav.title', 'text', 'Favourites heading', '"Favourites"', '"Favourites"', now()),
  ('fav.subtitle', 'text', 'Favourites text', '"Tap the heart on any meal. Use them to fill a week in one tap."', '"Tap the heart on any meal. Use them to fill a week in one tap."', now()),
  ('fav.empty', 'text', 'Empty state', '"No favourites yet."', '"No favourites yet."', now()),
  ('fav.household', 'text', 'Household favourites label', '"Whole household"', '"Whole household"', now()),
  ('fav.not_this_week', 'text', 'Not this week note', '"Not on this week''s menu"', '"Not on this week''s menu"', now()),
  ('addr.title', 'text', 'Addresses heading', '"Addresses"', '"Addresses"', now()),
  ('addr.add', 'text', 'Add button', '"Add address"', '"Add address"', now()),
  ('addr.default', 'text', 'Default badge', '"Default"', '"Default"', now()),
  ('addr.make_default', 'text', 'Make default button', '"Make default"', '"Make default"', now()),
  ('addr.delete', 'text', 'Delete button', '"Delete"', '"Delete"', now()),
  ('addr.save', 'text', 'Save button', '"Save address"', '"Save address"', now()),
  ('addr.not_covered', 'text', 'Not covered (use {zip})', '"Heads up: we don''t deliver to {zip} yet."', '"Heads up: we don''t deliver to {zip} yet."', now()),
  ('addr.empty', 'text', 'Empty state', '"No addresses yet."', '"No addresses yet."', now()),
  ('orders.refund_policy_body', 'rich_text', 'Refund policy (shown when cancelling)', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Cancel before the cutoff for a full refund. After the cutoff we''ve already shopped and cooked, so orders can''t be refunded, but tell us if something went wrong."}]}]}', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Cancel before the cutoff for a full refund. After the cutoff we''ve already shopped and cooked, so orders can''t be refunded, but tell us if something went wrong."}]}]}', now()),
  ('security.title', 'text', 'Security page heading', '"Security"', '"Security"', now()),
  ('security.methods_title', 'text', 'Sign-in methods heading', '"Sign-in methods"', '"Sign-in methods"', now()),
  ('security.methods_body', 'text', 'Sign-in methods text', '"At least one method always stays connected."', '"At least one method always stays connected."', now()),
  ('security.passkeys_title', 'text', 'Passkeys heading', '"Passkeys"', '"Passkeys"', now()),
  ('security.passkeys_body', 'text', 'Passkeys text', '"The fastest and most secure way to sign in."', '"The fastest and most secure way to sign in."', now()),
  ('security.password_title', 'text', 'Password heading', '"Password"', '"Password"', now()),
  ('security.password_body', 'text', 'Password text', '"Changing it signs out your other devices."', '"Changing it signs out your other devices."', now()),
  ('security.password_button', 'text', 'Change password button', '"Change password"', '"Change password"', now()),
  ('security.mfa_title', 'text', 'Two-factor heading', '"Two-factor authentication"', '"Two-factor authentication"', now()),
  ('security.sessions_title', 'text', 'Sessions heading', '"Where you''re signed in"', '"Where you''re signed in"', now()),
  ('security.this_device', 'text', '"this device" label', '"this device"', '"this device"', now()),
  ('security.active', 'text', 'Last active (use {date})', '"Active {date}"', '"Active {date}"', now()),
  ('security.unknown_device', 'text', 'Unknown device label', '"Unknown device"', '"Unknown device"', now()),
  ('security.sign_out_everywhere', 'text', 'Sign out everywhere button', '"Sign out everywhere"', '"Sign out everywhere"', now()),
  ('privacy.title', 'text', 'Privacy page heading', '"Privacy"', '"Privacy"', now()),
  ('privacy.export_title', 'text', 'Export heading', '"Download your data"', '"Download your data"', now()),
  ('privacy.export_body', 'text', 'Export text', '"A JSON file with everything we store about your household."', '"A JSON file with everything we store about your household."', now()),
  ('privacy.export_button', 'text', 'Export button', '"Download my data"', '"Download my data"', now()),
  ('privacy.delete_title', 'text', 'Delete heading', '"Delete your account"', '"Delete your account"', now()),
  ('privacy.delete_body', 'text', 'Delete text', '"This permanently deletes your account and your children''s profiles. Order records required for accounting are kept without your personal details. This can''t be undone."', '"This permanently deletes your account and your children''s profiles. Order records required for accounting are kept without your personal details. This can''t be undone."', now()),
  ('nav.tab_kids', 'text', 'Phone tab: Kids', '"Kids"', '"Kids"', now()),
  ('nav.plans', 'text', '"Plans" link', '"Plans"', '"Plans"', now()),
  ('nav.faq', 'text', '"FAQ" link', '"FAQ"', '"FAQ"', now()),
  ('nav.my_account', 'text', '"My account" button (signed in)', '"My account"', '"My account"', now());
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
