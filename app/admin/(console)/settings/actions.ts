"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { requireRecentReauth } from "@/lib/auth/guards";
import { TAGS } from "@/lib/content/content";
import { brandContrastProblems } from "@/lib/contrast";
import { ImageRejected, processUpload } from "@/lib/images/process";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1f3b2d.");
const url = z.union([
  z.literal(""),
  z
    .url()
    .max(300)
    .refine((u) => u.startsWith("https://"), "Links must start with https://"),
]);

const schema = z.object({
  business_name: z.string().trim().min(1).max(80),
  contact_email: z.union([z.literal(""), z.email()]),
  contact_phone: z.string().trim().max(32),
  social_links: z.object({ instagram: url, facebook: url, tiktok: url }),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone."),
  default_cutoff_days_before: z.number().int().min(0).max(28),
  default_cutoff_time: z.string().regex(/^\d{2}:\d{2}$/),
  ordering_opens_days_before: z.number().int().min(1).max(60),
  brand_colors: z.object({ primary: hex, background: hex, surface: hex, ink: hex, accent: hex }),
  announcement: z.object({ enabled: z.boolean(), text: z.string().trim().max(200), link: z.string().trim().max(300) }),
  ordering_enabled: z.boolean(),
  ordering_paused_message: z.string().trim().min(1).max(300),
  pilot_mode: z.boolean(),
  tax_settings: z.object({
    enabled: z.boolean(),
    use_stripe_tax: z.boolean(),
    // Flat rate in basis points (725 = 7.25%) when not using Stripe Tax.
    rate_bps: z.number().int().min(0).max(2000).default(0),
  }),
  // Largest single refund ops staff may issue (owners are unlimited).
  ops_refund_limit_cents: z.number().int().min(0).max(1_000_000),
  // Phase 7: day of the month school invoices go out; overdue suspension.
  school_invoice_day: z.number().int().min(1).max(28),
  school_overdue_suspend_days: z.number().int().min(1).max(120).nullable(),
  // Phase 8: kitchen and labels.
  kitchen_settings: z.object({
    exclude_unpaid: z.boolean(),
    label_sheet: z.enum(["avery_5163", "avery_5164"]),
    use_by_days: z.number().int().min(1).max(14),
    meals_per_bag: z.number().int().min(1).max(100),
  }),
  // Phase 9: email timing and the CAN-SPAM postal address.
  email_settings: z.object({
    cutoff_reminder_hours: z.number().int().min(1).max(96),
    renewal_reminder_days: z.number().int().min(1).max(14),
    postal_address: z.string().trim().max(200),
    reply_to: z.union([z.literal(""), z.email()]),
  }),
  // Phase 10: how long a closed account's children, allergies and addresses are kept.
  data_retention_months: z.number().int().min(1).max(120),
  logo_path: z.string().max(300).nullable(),
});

export type SettingsInput = z.input<typeof schema>;

export async function saveSettings(input: SettingsInput) {
  return adminAction(
    { roles: OWNER, action: "settings.saved", schema, input, revalidate: [TAGS.settings, TAGS.content] },
    async (data, { user, supabase }) => {
      const problems = brandContrastProblems(data.brand_colors);
      if (problems.length) return fail("validation", problems[0]!, { brand_colors: problems.join(" ") });
      const current = check(
        await supabase.from("site_settings").select("tax_settings, ops_refund_limit_cents").eq("id", true).single(),
      );
      // Tax and refund-limit (payment) settings need a fresh step-up (CLAUDE.md §5.5).
      if (
        JSON.stringify(current.tax_settings) !== JSON.stringify(data.tax_settings) ||
        current.ops_refund_limit_cents !== data.ops_refund_limit_cents
      ) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }
      check(
        await supabase
          .from("site_settings")
          .update({
            ...data,
            contact_email: data.contact_email || null,
            contact_phone: data.contact_phone || null,
            announcement: { ...data.announcement, link: data.announcement.link || null },
            updated_by: user.id,
          })
          .eq("id", true),
      );
      revalidatePath("/admin/settings");
      return {
        auditEntity: { type: "site_settings", id: "singleton" },
        result: { ok: true, message: "Settings saved. The site updates in a few seconds." },
      };
    },
  );
}

/** Upload a logo into the media library and return its path (saved with the form). */
export async function uploadLogo(formData: FormData) {
  return adminAction(
    { roles: OWNER, action: "settings.logo_uploaded", schema: z.object({}), input: {} },
    async (_d, { user, supabase }) => {
      let img;
      try {
        img = await processUpload(formData.get("file") as File);
      } catch (e) {
        if (e instanceof ImageRejected) return fail("validation", e.message);
        throw e;
      }
      const up = await supabase.storage.from("media").upload(img.path, img.data, { contentType: "image/webp" });
      if (up.error) return fail("unknown", "The upload didn't go through.");
      check(
        await supabase.from("media").insert({
          storage_path: img.path,
          alt_text: "Logo",
          width: img.width,
          height: img.height,
          uploaded_by: user.id,
        }),
      );
      return { result: { ok: true, data: { path: img.path }, message: "Logo uploaded. Save settings to use it." } };
    },
  );
}
