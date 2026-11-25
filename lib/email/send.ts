import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { RichNode } from "@/lib/validation/rich-text";

import { EMAIL_CATALOG } from "./catalog";
import { renderEmail } from "./templates";

type Admin = ReturnType<typeof createAdminClient>;

export const resendConfigured = () => !/^re_(ci_)?dummy$/.test(env.RESEND_API_KEY);

export type SendResult = { ok: true; providerId: string } | { ok: false; error: string; retry: boolean };

/** Which transport delivers mail here: Resend (real key), Mailpit (local dev/CI), or nothing. */
export function emailTransport(): "resend" | "mailpit" | "none" {
  if (resendConfigured()) return "resend";
  if (env.MAILPIT_URL && env.NEXT_PUBLIC_APP_ENV !== "production") return "mailpit";
  return "none";
}

/**
 * Send one owner-editable template (Phase 9): load the active template,
 * fill only the variables that template allows (escaped by React), wrap it
 * in the branded layout, and deliver it with an idempotency key so a retry
 * never sends twice. Marketing emails get one-click unsubscribe headers.
 * The caller (the queue worker) records the outcome in notifications_log.
 */
export async function sendEmail(
  admin: Admin,
  opts: {
    templateKey: string;
    to: string;
    variables: Record<string, string>;
    idempotencyKey: string;
    unsubscribe?: { pageUrl: string; oneClickUrl: string; label: string } | null;
    footerReason: string;
  },
): Promise<SendResult> {
  const [{ data: tpl }, { data: settings }] = await Promise.all([
    admin
      .from("email_templates")
      .select("subject, preheader, body_rich, cta_label, is_active")
      .eq("key", opts.templateKey)
      .maybeSingle(),
    admin
      .from("site_settings")
      .select("business_name, brand_colors, contact_email, email_settings")
      .eq("id", true)
      .single(),
  ]);
  if (!tpl || !tpl.is_active)
    return { ok: false, error: `template ${opts.templateKey} missing or inactive`, retry: false };
  const c = (settings?.brand_colors ?? {}) as Record<string, string>;
  const emailSettings = (settings?.email_settings ?? {}) as { postal_address?: string; reply_to?: string };
  const businessName = (settings?.business_name as string | undefined) ?? "Smart Cookie";
  const marketing = EMAIL_CATALOG[opts.templateKey]?.category === "marketing";
  const out = await renderEmail({
    templateKey: opts.templateKey,
    subject: tpl.subject as string,
    preheader: (tpl.preheader as string | null) ?? "",
    body: tpl.body_rich as RichNode,
    ctaLabel: tpl.cta_label as string | null,
    vars: opts.variables,
    businessName,
    logoUrl: new URL("/icons/icon-192.png", env.NEXT_PUBLIC_SITE_URL).toString(),
    colors: { primary: c.primary ?? "#f4b4b6", ink: c.ink ?? "#1f3b2d", surface: c.background ?? "#fbeeea" },
    footer: {
      reason: opts.footerReason,
      address: marketing ? emailSettings.postal_address || undefined : undefined,
      unsubscribe:
        marketing && opts.unsubscribe ? { label: opts.unsubscribe.label, url: opts.unsubscribe.pageUrl } : null,
    },
  });
  return deliver({
    to: opts.to,
    subject: out.subject,
    html: out.html,
    text: out.text,
    templateKey: opts.templateKey,
    idempotencyKey: opts.idempotencyKey,
    businessName,
    contactEmail: (settings?.contact_email as string | null) ?? null,
    replyTo: emailSettings.reply_to || null,
    // RFC 8058 one-click unsubscribe for marketing email (Gmail / Yahoo require it for bulk senders).
    headers:
      marketing && opts.unsubscribe
        ? {
            "List-Unsubscribe": `<${opts.unsubscribe.oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : {},
  });
}

/** Hand a rendered email to the configured transport. */
export async function deliver(m: {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateKey: string;
  idempotencyKey: string;
  businessName: string;
  contactEmail: string | null;
  replyTo: string | null;
  headers: Record<string, string>;
}): Promise<SendResult> {
  const from = env.EMAIL_FROM ?? m.contactEmail ?? "hello@smartcookie.example";
  const replyTo = m.replyTo || m.contactEmail || undefined;
  const headers = m.headers;
  const businessName = m.businessName;
  const opts = { to: m.to, idempotencyKey: m.idempotencyKey, templateKey: m.templateKey };
  const out = { subject: m.subject, html: m.html, text: m.text };

  switch (emailTransport()) {
    case "resend": {
      const { data, error } = await new Resend(env.RESEND_API_KEY).emails.send(
        {
          from: `${businessName} <${from}>`,
          to: opts.to,
          subject: out.subject,
          html: out.html,
          text: out.text,
          replyTo,
          headers,
        },
        { idempotencyKey: opts.idempotencyKey },
      );
      if (error || !data) {
        const status = (error as { statusCode?: number } | null)?.statusCode ?? 0;
        // 4xx (bad address, validation) won't succeed on retry; 429 / 5xx might.
        return {
          ok: false,
          error: error?.message ?? "send failed",
          retry: status === 0 || status === 429 || status >= 500,
        };
      }
      return { ok: true, providerId: data.id };
    }
    case "mailpit": {
      const res = await fetch(new URL("/api/v1/send", env.MAILPIT_URL), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: { Email: from, Name: businessName },
          To: [{ Email: opts.to }],
          ReplyTo: replyTo ? [{ Email: replyTo }] : [],
          Subject: out.subject,
          HTML: out.html,
          Text: out.text,
          Headers: { ...headers, "X-Idempotency-Key": opts.idempotencyKey, "X-Template": opts.templateKey },
        }),
      });
      if (!res.ok) return { ok: false, error: `mailpit ${res.status}`, retry: true };
      const { ID } = (await res.json()) as { ID: string };
      return { ok: true, providerId: `mailpit:${ID}` };
    }
    default:
      // Placeholder key and no Mailpit: nothing leaves the server.
      return { ok: true, providerId: "not-sent:no-transport" };
  }
}
