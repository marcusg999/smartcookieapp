-- Phase 10: security hardening from the pre-launch review (docs/security-review.md).

-- ═════════════════════════════════════════════════════════════════════════════
-- SR-01 (critical): the public projection views were owned by postgres and
-- ran with its rights (security definer), and Supabase's default privileges
-- gave anon/authenticated INSERT/UPDATE/DELETE on them. Simple views are
-- auto-updatable, so anyone with the public API key could rewrite published
-- site copy and pages through them. Fix: each view now reads from a
-- security-definer *function* (a function-backed view is never updatable)
-- and is itself security_invoker; writes on every public view are revoked.
-- ═════════════════════════════════════════════════════════════════════════════
drop view public.content_blocks_public;
drop view public.pages_public;
drop view public.site_settings_public;
drop view public.kitchen_order_lines;

create function public._content_blocks_public()
returns table (key text, type public.content_block_type, value jsonb, published_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select key, type, published_value, published_at from public.content_blocks where published_value is not null;
$$;

create function public._pages_public()
returns table (slug text, title text, seo_title text, seo_description text, og_image text, body jsonb, published_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select slug, title, seo_title, seo_description, og_image, body_published, published_at
  from public.pages
  where is_published and archived_at is null and body_published is not null;
$$;

create function public._site_settings_public()
returns table (
  business_name text, logo_path text, brand_colors jsonb, contact_email text, contact_phone text, social_links jsonb,
  timezone text, default_cutoff_days_before smallint, default_cutoff_time time, ordering_opens_days_before smallint,
  pilot_mode boolean, ordering_enabled boolean, announcement jsonb, ordering_paused_message text
)
language sql stable security definer set search_path = ''
as $$
  select business_name, logo_path, brand_colors, contact_email, contact_phone, social_links, timezone,
         default_cutoff_days_before, default_cutoff_time, ordering_opens_days_before, pilot_mode,
         ordering_enabled, announcement, ordering_paused_message
  from public.site_settings;
$$;

-- Kitchen view: no prices, no contact details; staff at AAL2 only (checked inside).
create function public._kitchen_order_lines()
returns table (
  order_item_id uuid, order_id uuid, order_number text, menu_week_id uuid, week_start date, delivery_date date,
  order_status public.order_status, fulfillment public.fulfillment_method, item_name text, quantity integer,
  allergens_contained text[], may_contain text[], badges text[], has_allergy_override boolean,
  child_first_name text, child_last_initial text, child_allergens text[], child_dietary_preferences text[],
  classroom_name text, organization_name text, household_name text, safe_for_allergens text[],
  dropoff_location text, order_source public.order_source
)
language sql stable security definer set search_path = ''
as $$
  select
    oi.id, o.id, o.order_number, o.menu_week_id, w.week_start,
    coalesce(oi.delivery_date, o.delivery_date), o.status, o.fulfillment, oi.item_name, oi.quantity,
    oi.allergens_contained, oi.may_contain, oi.badges, oi.allergy_override_id is not null,
    c.first_name, c.last_initial,
    coalesce((
      select array_agg(a.name || case when ca.severity = 'severe' then ' (severe)' else '' end order by a.sort_order)
      from public.child_allergens ca join public.allergens a on a.id = ca.allergen_id
      where ca.child_id = c.id
    ), '{}'),
    c.dietary_preferences, cl.name, org.name, h.name, oi.safe_for_allergens,
    coalesce(o.dropoff_location, cl.dropoff_location), o.source
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
$$;

create view public.content_blocks_public with (security_invoker = true) as select * from public._content_blocks_public();
create view public.pages_public with (security_invoker = true) as select * from public._pages_public();
create view public.site_settings_public with (security_invoker = true) as select * from public._site_settings_public();
create view public.kitchen_order_lines with (security_invoker = true) as select * from public._kitchen_order_lines();

revoke all on function public._content_blocks_public(), public._pages_public(), public._site_settings_public(),
  public._kitchen_order_lines() from public, anon, authenticated;
grant execute on function public._content_blocks_public(), public._pages_public(), public._site_settings_public()
  to anon, authenticated, service_role;
grant execute on function public._kitchen_order_lines() to authenticated, service_role;

-- Views are read-only for API roles, all of them, now and later.
do $$
declare v record;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('v', 'm') loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v.relname);
  end loop;
end $$;
revoke all on public.content_blocks_public, public.pages_public, public.site_settings_public, public.kitchen_order_lines
  from anon, authenticated;
grant select on public.content_blocks_public, public.pages_public, public.site_settings_public to anon, authenticated;
grant select on public.kitchen_order_lines to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- SR-02 (medium): pilot codes could be guessed through the API directly
-- (the RPC was executable by anon, skipping the app's rate limit). Only the
-- server (service role, after Turnstile + rate limit) checks codes now.
-- ═════════════════════════════════════════════════════════════════════════════
revoke execute on function public.pilot_code_is_valid(text, text) from public, anon, authenticated;
grant execute on function public.pilot_code_is_valid(text, text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Advisor fixes: a primary key for auth_attempts; covering indexes for every
-- foreign key (faster joins, and deletes/cascades don't scan whole tables).
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.auth_attempts add column id bigint generated always as identity primary key;

create index if not exists account_credits_created_by_fk_idx on public.account_credits (created_by);
create index if not exists account_credits_order_id_fk_idx on public.account_credits (order_id);
create index if not exists allergy_conflict_alerts_child_id_fk_idx on public.allergy_conflict_alerts (child_id);
create index if not exists allergy_conflict_alerts_order_id_fk_idx on public.allergy_conflict_alerts (order_id);
create index if not exists allergy_overrides_approved_by_fk_idx on public.allergy_overrides (approved_by);
create index if not exists allergy_overrides_menu_item_id_fk_idx on public.allergy_overrides (menu_item_id);
create index if not exists carts_menu_week_id_fk_idx on public.carts (menu_week_id);
create index if not exists carts_replaces_order_id_fk_idx on public.carts (replaces_order_id);
create index if not exists child_allergens_allergen_id_fk_idx on public.child_allergens (allergen_id);
create index if not exists children_classroom_id_fk_idx on public.children (classroom_id);
create index if not exists children_school_link_reviewed_by_fk_idx on public.children (school_link_reviewed_by);
create index if not exists classroom_allergy_counts_allergen_id_fk_idx on public.classroom_allergy_counts (allergen_id);
create index if not exists content_blocks_published_by_fk_idx on public.content_blocks (published_by);
create index if not exists content_blocks_updated_by_fk_idx on public.content_blocks (updated_by);
create index if not exists content_versions_created_by_fk_idx on public.content_versions (created_by);
create index if not exists customer_notes_author_id_fk_idx on public.customer_notes (author_id);
create index if not exists customer_notes_organization_id_fk_idx on public.customer_notes (organization_id);
create index if not exists deep_link_tokens_menu_week_id_fk_idx on public.deep_link_tokens (menu_week_id);
create index if not exists deep_link_tokens_user_id_fk_idx on public.deep_link_tokens (user_id);
create index if not exists deliveries_delivered_by_fk_idx on public.deliveries (delivered_by);
create index if not exists favorites_child_id_fk_idx on public.favorites (child_id);
create index if not exists favorites_menu_item_id_fk_idx on public.favorites (menu_item_id);
create index if not exists households_default_address_id_fk_idx on public.households (default_address_id);
create index if not exists households_default_zone_id_fk_idx on public.households (default_zone_id);
create index if not exists households_preferred_plan_id_fk_idx on public.households (preferred_plan_id);
create index if not exists households_primary_user_id_fk_idx on public.households (primary_user_id);
create index if not exists invoice_lines_classroom_id_fk_idx on public.invoice_lines (classroom_id);
create index if not exists invoices_created_by_fk_idx on public.invoices (created_by);
create index if not exists late_order_exceptions_created_by_fk_idx on public.late_order_exceptions (created_by);
create index if not exists late_order_exceptions_menu_week_id_fk_idx on public.late_order_exceptions (menu_week_id);
create index if not exists media_uploaded_by_fk_idx on public.media (uploaded_by);
create index if not exists menu_item_allergens_allergen_id_fk_idx on public.menu_item_allergens (allergen_id);
create index if not exists menu_item_badges_badge_id_fk_idx on public.menu_item_badges (badge_id);
create index if not exists menu_item_price_history_changed_by_fk_idx on public.menu_item_price_history (changed_by);
create index if not exists menu_template_items_menu_item_id_fk_idx on public.menu_template_items (menu_item_id);
create index if not exists menu_week_items_menu_item_id_fk_idx on public.menu_week_items (menu_item_id);
create index if not exists menu_weeks_generated_from_template_id_fk_idx on public.menu_weeks (generated_from_template_id);
create index if not exists notifications_log_household_id_fk_idx on public.notifications_log (household_id);
create index if not exists notifications_log_organization_id_fk_idx on public.notifications_log (organization_id);
create index if not exists notifications_log_user_id_fk_idx on public.notifications_log (user_id);
create index if not exists order_items_allergy_override_id_fk_idx on public.order_items (allergy_override_id);
create index if not exists order_items_classroom_id_fk_idx on public.order_items (classroom_id);
create index if not exists order_items_menu_item_id_fk_idx on public.order_items (menu_item_id);
create index if not exists order_refunds_requested_by_fk_idx on public.order_refunds (requested_by);
create index if not exists orders_allergy_confirmed_by_fk_idx on public.orders (allergy_confirmed_by);
create index if not exists orders_delivery_zone_id_fk_idx on public.orders (delivery_zone_id);
create index if not exists orders_placed_by_fk_idx on public.orders (placed_by);
create index if not exists orders_school_reviewed_by_fk_idx on public.orders (school_reviewed_by);
create index if not exists organizations_created_by_fk_idx on public.organizations (created_by);
create index if not exists organizations_reviewed_by_fk_idx on public.organizations (reviewed_by);
create index if not exists pilot_invites_used_by_fk_idx on public.pilot_invites (used_by);
create index if not exists prep_checks_checked_by_fk_idx on public.prep_checks (checked_by);
create index if not exists saved_orders_household_id_fk_idx on public.saved_orders (household_id);
create index if not exists school_closures_created_by_fk_idx on public.school_closures (created_by);
create index if not exists site_settings_updated_by_fk_idx on public.site_settings (updated_by);
create index if not exists standing_order_adjustments_updated_by_fk_idx on public.standing_order_adjustments (updated_by);
create index if not exists standing_orders_classroom_id_fk_idx on public.standing_orders (classroom_id);
create index if not exists standing_orders_created_by_fk_idx on public.standing_orders (created_by);
create index if not exists subscription_allowances_menu_week_id_fk_idx on public.subscription_allowances (menu_week_id);
create index if not exists subscriptions_pending_plan_id_fk_idx on public.subscriptions (pending_plan_id);
create index if not exists subscriptions_plan_id_fk_idx on public.subscriptions (plan_id);
create index if not exists user_roles_granted_by_fk_idx on public.user_roles (granted_by);
create index if not exists zone_waitlist_household_id_fk_idx on public.zone_waitlist (household_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- Monitoring: the daily payment health check emails the owner when it finds
-- stuck payments, Stripe/app mismatches or failed Stripe events.
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.email_templates (key, subject, preheader, body_rich, cta_label) values
  ('owner_payment_health', 'Payment check: something needs a look', 'From today''s automatic payment check.',
   '{"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Today''s payment check found:"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Orders stuck waiting for payment: {{stuck_orders}}\nPaid in Stripe but not marked paid here: {{stripe_mismatches}}\nStripe events that failed to process: {{failed_webhooks}}"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Open Payments to check them. If an order was paid in Stripe but isn''t marked paid, contact your developer before refunding."}]}]}',
   'Open payments')
on conflict (key) do nothing;
