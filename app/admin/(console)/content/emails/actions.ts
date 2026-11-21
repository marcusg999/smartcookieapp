"use server";

import { Resend } from "resend";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { EMAIL_VARIABLES, renderEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { richTextSchema } from "@/lib/validation/rich-text";

const schema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  subject: z.string().trim().min(1, "The subject can't be empty.").max(200),
  preheader: z.string().trim().max(200),
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
          body_rich: data.body,
          is_active: data.is_active,
        })
        .eq("key", data.key),
    );
    return { auditEntity: { type: "email_template", id: data.key }, result: { ok: true, message: "Email saved." } };
  });
}

async function brand(supabase: Parameters<Parameters<typeof adminAction>[1]>[1]["supabase"]) {
  const { data } = await supabase.from("site_settings").select("business_name, brand_colors").eq("id", true).single();
  const c = (data?.brand_colors ?? {}) as Record<string, string>;
  return {
    businessName: data?.business_name ?? "Smart Cookie",
    colors: { primary: c.primary ?? "#f4b4b6", ink: c.ink ?? "#1f3b2d", surface: c.background ?? "#fbeeea" },
  };
}

const sampleVars = Object.fromEntries(Object.entries(EMAIL_VARIABLES).map(([k, v]) => [k, v.sample]));

export async function previewEmail(input: z.input<typeof schema>) {
  return adminAction(
    { roles: OWNER, action: "email_template.previewed", schema, input },
    async (data, { supabase }) => {
      const out = await renderEmail({
        subject: data.subject,
        preheader: data.preheader,
        body: data.body,
        vars: sampleVars,
        ...(await brand(supabase)),
      });
      return { result: { ok: true, data: out } };
    },
  );
}

/** Send the email to the signed-in owner. With placeholder keys, nothing is sent. */
export async function sendTestEmail(input: z.input<typeof schema>) {
  return adminAction(
    { roles: OWNER, action: "email_template.test_sent", schema, input },
    async (data, { user, supabase }) => {
      if (!user.email) return fail("validation", "Your account has no email address.");
      const out = await renderEmail({
        subject: data.subject,
        preheader: data.preheader,
        body: data.body,
        vars: sampleVars,
        ...(await brand(supabase)),
      });
      if (/^re_(ci_)?dummy$/.test(env.RESEND_API_KEY)) {
        return {
          result: {
            ok: true,
            message: `Email sending isn't connected yet (Resend key not set). It would go to ${user.email}.`,
          },
        };
      }
      const resend = new Resend(env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: "Smart Cookie <hello@smartcookie.example>",
        to: user.email,
        subject: `[Test] ${out.subject}`,
        html: out.html,
      });
      if (error) return fail("unknown", "The test email couldn't be sent. Check the Resend settings.");
      return { result: { ok: true, message: `Test sent to ${user.email}.` } };
    },
  );
}
