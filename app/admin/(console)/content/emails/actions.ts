"use server";

import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { EMAIL_CATALOG, SAMPLE_VARIABLES } from "@/lib/email/catalog";
import { deliver, emailTransport } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { richTextSchema } from "@/lib/validation/rich-text";

const schema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  subject: z.string().trim().min(1, "The subject can't be empty.").max(200),
  preheader: z.string().trim().max(200),
  cta_label: z.string().trim().max(60),
  body: richTextSchema,
  is_active: z.boolean(),
});

export async function saveEmailTemplate(input: z.input<typeof schema>) {
  return adminAction({ roles: OWNER, action: "email_template.saved", schema, input }, async (data, { supabase }) => {
    check(
      await supabase
        .from("email_templates")
        .update({
          subject: data.subject,
          preheader: data.preheader || null,
          cta_label: data.cta_label || null,
          body_rich: data.body,
          is_active: data.is_active,
        })
        .eq("key", data.key),
    );
    return { auditEntity: { type: "email_template", id: data.key }, result: { ok: true, message: "Email saved." } };
  });
}

type Supabase = Parameters<Parameters<typeof adminAction>[1]>[1]["supabase"];

async function renderSample(supabase: Supabase, data: z.output<typeof schema>) {
  const [{ data: s }, { data: copyRows }] = await Promise.all([
    supabase.from("site_settings").select("business_name, brand_colors, contact_email, email_settings").eq("id", true).single(),
    supabase.from("content_blocks").select("key, published_value").like("key", "email.footer.%"),
  ]);
  const c = (s?.brand_colors ?? {}) as Record<string, string>;
  const es = (s?.email_settings ?? {}) as { postal_address?: string; reply_to?: string };
  const copy = Object.fromEntries((copyRows ?? []).map((r) => [r.key, String(r.published_value ?? "")]));
  const entry = EMAIL_CATALOG[data.key];
  const marketing = entry?.category === "marketing";
  const businessName = (s?.business_name as string | undefined) ?? "Smart Cookie";
  const out = await renderEmail({
    templateKey: data.key,
    subject: data.subject,
    preheader: data.preheader,
    body: data.body,
    ctaLabel: data.cta_label,
    vars: SAMPLE_VARIABLES,
    businessName,
    logoUrl: new URL("/icons/icon-192.png", env.NEXT_PUBLIC_SITE_URL).toString(),
    colors: { primary: c.primary ?? "#f4b4b6", ink: c.ink ?? "#1f3b2d", surface: c.background ?? "#fbeeea" },
    footer: {
      reason:
        copy[marketing ? `email.footer.${entry?.topic}` : entry?.category === "security" ? "email.footer.security" : "email.footer.transactional"] ??
        "",
      address: marketing ? es.postal_address || undefined : undefined,
      unsubscribe: marketing ? { label: copy["email.footer.unsubscribe"] || "Unsubscribe", url: new URL("/account/notifications", env.NEXT_PUBLIC_SITE_URL).toString() } : null,
    },
  });
  return { out, businessName, contactEmail: (s?.contact_email as string | null) ?? null, replyTo: es.reply_to || null };
}

/** The same HTML with the dark palette forced on, so the owner can check both. */
function forceDark(html: string) {
  return html.replace("@media (prefers-color-scheme: dark)", "@media all");
}

export async function previewEmail(input: z.input<typeof schema>) {
  return adminAction({ roles: OWNER, action: "email_template.previewed", schema, input }, async (data, { supabase }) => {
    const { out } = await renderSample(supabase, data);
    return { result: { ok: true, data: { subject: out.subject, html: out.html, darkHtml: forceDark(out.html), text: out.text } } };
  });
}

/** Send the unsaved draft, with sample details, to the signed-in owner. */
export async function sendTestEmail(input: z.input<typeof schema>) {
  return adminAction({ roles: OWNER, action: "email_template.test_sent", schema, input }, async (data, { user, supabase }) => {
    if (!user.email) return fail("validation", "Your account has no email address.");
    if (emailTransport() === "none") {
      return { result: { ok: true, message: `Email sending isn't connected yet (Resend key not set). It would go to ${user.email}.` } };
    }
    const { out, businessName, contactEmail, replyTo } = await renderSample(supabase, data);
    const res = await deliver({
      to: user.email,
      subject: `[Test] ${out.subject}`,
      html: out.html,
      text: out.text,
      templateKey: data.key,
      idempotencyKey: `test/${data.key}/${crypto.randomUUID()}`,
      businessName,
      contactEmail,
      replyTo,
      headers: {},
    });
    if (!res.ok) return fail("unknown", "The test email couldn't be sent. Check the email settings.");
    return { result: { ok: true, message: `Test sent to ${user.email}.` } };
  });
}
