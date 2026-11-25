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
      dropoff_instructions = 'Front office, by 11:15am. Ask for the cafeteria cart.', contact_phone = '(626) 555-0142',
      dropoff_entrance = 'Front office, Maple Grove Ave', dropoff_contact = 'Mrs. Lopez (office), ext. 12',
      dropoff_window = '10:45 to 11:15am', onboarded_at = now()
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

  update public.households set name = 'The Patel household', default_zone_id = 'd1000000-0000-4000-8000-000000000001', onboarded_at = now(), ordering_preference = 'a_la_carte' where id = v_h1;
  update public.households set name = 'The Rivera household', default_zone_id = 'd1000000-0000-4000-8000-000000000002', onboarded_at = now(), ordering_preference = 'a_la_carte' where id = v_h2;

  insert into public.addresses (id, household_id, line1, city, zip, delivery_notes, is_default) values
    ('ad000000-0000-4000-8000-000000000001', v_h1, '450 Orange Grove Blvd', 'Pasadena', '91105', 'Leave on the porch bench.', true),
    ('ad000000-0000-4000-8000-000000000002', v_h2, '2210 Sunset Blvd, Apt 3', 'Los Angeles', '90026', 'Buzz #3.', true);
  update public.households set default_address_id = 'ad000000-0000-4000-8000-000000000001' where id = v_h1;
  update public.households set default_address_id = 'ad000000-0000-4000-8000-000000000002' where id = v_h2;

  insert into public.children (id, household_id, first_name, last_initial, school_id, classroom_id, school_link_status, grade, dietary_preferences, notes) values
    ('cd000000-0000-4000-8000-000000000001', v_h1, 'Maya', 'P', v_org, 'c1000000-0000-4000-8000-000000000002', 'approved', '2', '{vegetarian}', 'Loves anything with cheese.'),
    ('cd000000-0000-4000-8000-000000000002', v_h1, 'Leo', 'P', null, null, null, 'Pre-K', '{}', null),
    ('cd000000-0000-4000-8000-000000000003', v_h2, 'Ava', 'R', v_org, 'c1000000-0000-4000-8000-000000000003', 'approved', '4', '{}', 'Small appetite.');

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
  insert into public.order_items (order_id, child_id, classroom_id, menu_item_id, delivery_date, quantity, unit_price_cents, item_name, allergens_contained, may_contain, badges)
  select v_order, 'cd000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid, m.id,
         (select delivery_dates[1] from public.menu_weeks where id = v_week), 1, m.base_price_cents, m.name,
         '{Milk,Wheat}'::text[], '{}'::text[], '{Vegetarian,"Kid Favorite"}'::text[]
  from public.menu_items m where m.slug = 'baked-mac-and-cheese'
  union all
  select v_order, 'cd000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', m.id,
         (select delivery_dates[3] from public.menu_weeks where id = v_week), 1, m.base_price_cents, m.name,
         '{Milk,Eggs}', '{Wheat}', '{Vegetarian}'
  from public.menu_items m where m.slug = 'broccoli-cheddar-bake';
end;
$$;

insert into public.testimonials (quote, attribution, is_published, sort_order) values
  ('Ordering takes me two minutes now, and my picky eater actually finishes lunch.', 'Priya, mom of two', true, 1),
  ('The allergy labels give our teachers real peace of mind.', 'Front office, partner school', true, 2);

-- Email templates are seeded by the migrations (20261128000100_email.sql), so
-- every environment has them.

update public.site_settings set contact_email = 'hello@smartcookie.test', contact_phone = '(626) 555-0100',
  social_links = '{"instagram":"https://instagram.com/smartcookie"}';

insert into public.pilot_invites (code, email) values ('PILOT-FAMILY-01', null), ('PILOT-SCHOOL-01', 'school@smartcookie.test');
