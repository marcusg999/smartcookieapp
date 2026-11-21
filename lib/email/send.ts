import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { RichNode } from "@/lib/validation/rich-text";

import { renderEmail } from "./templates";

type Admin = ReturnType<typeof createAdminClient>;

export const resendConfigured = () => !/^re_(ci_)?dummy$/.test(env.RESEND_API_KEY);

/**
 * Render an owner-editable template (email_templates) and send it. With the
 * placeholder Resend key nothing leaves the server; the caller records it.
 */
export async function sendTemplate(
  admin: Admin,
  key: string,
  to: string,
  vars: Record<string, string>,
): Promise<{ ok: true; providerId: string } | { ok: false; error: string }> {
  const [{ data: tpl }, { data: settings }] = await Promise.all([
    admin.from("email_templates").select("subject, preheader, body_rich, is_active").eq("key", key).maybeSingle(),
    admin.from("site_settings").select("business_name, brand_colors, contact_email").eq("id", true).single(),
  ]);
  if (!tpl || !tpl.is_active) return { ok: false, error: `template ${key} missing or inactive` };
  const c = (settings?.brand_colors ?? {}) as Record<string, string>;
  const businessName = (settings?.business_name as string | undefined) ?? "Smart Cookie";
  const out = await renderEmail({
    subject: tpl.subject as string,
    preheader: (tpl.preheader as string | null) ?? "",
    body: tpl.body_rich as RichNode,
    vars: { business_name: businessName, ...vars },
    businessName,
    colors: { primary: c.primary ?? "#f4b4b6", ink: c.ink ?? "#1f3b2d", surface: c.background ?? "#fbeeea" },
  });
  if (!resendConfigured()) return { ok: true, providerId: "not-sent:placeholder-key" };
  const { data, error } = await new Resend(env.RESEND_API_KEY).emails.send({
    from: `${businessName} <${(settings?.contact_email as string | null) ?? "hello@smartcookie.example"}>`,
    to,
    subject: out.subject,
    html: out.html,
  });
  return error || !data ? { ok: false, error: error?.message ?? "send failed" } : { ok: true, providerId: data.id };
}
