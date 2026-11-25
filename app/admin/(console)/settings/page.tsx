import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { kitchenSettings } from "@/lib/kitchen/logic";
import { createClient } from "@/lib/supabase/server";

import type { SettingsInput } from "./actions";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireStaffAAL2(["owner"]);
  const { data: s } = await (await createClient()).from("site_settings").select("*").eq("id", true).single();
  const colors = (s?.brand_colors ?? {}) as Record<string, string>;
  const social = (s?.social_links ?? {}) as Record<string, string>;
  const ann = (s?.announcement ?? {}) as { enabled?: boolean; text?: string; link?: string | null };
  const tax = (s?.tax_settings ?? {}) as { enabled?: boolean; use_stripe_tax?: boolean; rate_bps?: number };
  const settings: SettingsInput = {
    business_name: s?.business_name ?? "Smart Cookie",
    contact_email: s?.contact_email ?? "",
    contact_phone: s?.contact_phone ?? "",
    social_links: { instagram: social.instagram ?? "", facebook: social.facebook ?? "", tiktok: social.tiktok ?? "" },
    timezone: s?.timezone ?? "America/Los_Angeles",
    default_cutoff_days_before: s?.default_cutoff_days_before ?? 4,
    default_cutoff_time: (s?.default_cutoff_time ?? "18:00").slice(0, 5),
    ordering_opens_days_before: s?.ordering_opens_days_before ?? 14,
    brand_colors: {
      primary: colors.primary ?? "#f4b4b6",
      background: colors.background ?? "#fbeeea",
      surface: colors.surface ?? "#fff9f5",
      ink: colors.ink ?? "#1f3b2d",
      accent: colors.accent ?? "#b3344b",
    },
    announcement: { enabled: !!ann.enabled, text: ann.text ?? "", link: ann.link ?? "" },
    ordering_enabled: s?.ordering_enabled ?? true,
    ordering_paused_message: s?.ordering_paused_message ?? "",
    pilot_mode: s?.pilot_mode ?? false,
    tax_settings: { enabled: !!tax.enabled, use_stripe_tax: !!tax.use_stripe_tax, rate_bps: tax.rate_bps ?? 0 },
    ops_refund_limit_cents: s?.ops_refund_limit_cents ?? 5000,
    school_invoice_day: s?.school_invoice_day ?? 1,
    school_overdue_suspend_days: s?.school_overdue_suspend_days ?? null,
    kitchen_settings: kitchenSettings(s?.kitchen_settings),
    logo_path: s?.logo_path ?? null,
  };
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Settings"
        description="Your business details, brand, ordering rules and switches. Tax changes ask for your authenticator code."
      />
      <SettingsForm settings={settings} />
    </div>
  );
}
