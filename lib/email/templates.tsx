import "server-only";

import { render } from "react-email";

import { EmailLayout, EmailRichText, type EmailColors } from "@/emails/layout";
import type { RichNode } from "@/lib/validation/rich-text";

import { allowedVariables, EMAIL_CATALOG, SAMPLE_VARIABLES } from "./catalog";

/** Labels and samples for the admin editor (from the catalog). */
export const EMAIL_VARIABLES: Record<string, { label: string; sample: string }> = Object.fromEntries(
  Object.entries(SAMPLE_VARIABLES).map(([k, sample]) => [k, { label: k.replace(/_/g, " "), sample }]),
);

/**
 * Replace {{variables}} in rich-text JSON. Only names on the template's
 * allow-list are filled; anything else stays exactly as typed (so mistakes
 * show up in previews and nothing unexpected is ever injected). Values go
 * into text nodes, which React escapes when rendering, so a value can never
 * become HTML or script.
 */
export function fillVariables<T>(value: T, vars: Record<string, string>, allowed?: Set<string>): T {
  const json = JSON.stringify(value).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) =>
    name in vars && (!allowed || allowed.has(name)) ? JSON.stringify(vars[name]).slice(1, -1) : match,
  );
  return JSON.parse(json) as T;
}

/** Subjects are a mail header: one line, no control characters (no header injection). */
export function cleanSubject(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export async function renderEmail(opts: {
  templateKey: string;
  subject: string;
  preheader: string;
  body: RichNode;
  ctaLabel?: string | null;
  vars: Record<string, string>;
  businessName: string;
  logoUrl?: string;
  colors: EmailColors;
  footer: { reason: string; address?: string; unsubscribe?: { label: string; url: string } | null };
}) {
  const allowed = allowedVariables(opts.templateKey);
  const vars: Record<string, string> = { business_name: opts.businessName, ...opts.vars };
  const ctaVar = EMAIL_CATALOG[opts.templateKey]?.cta;
  const ctaUrl = ctaVar ? vars[ctaVar] : undefined;
  const cta =
    opts.ctaLabel && ctaUrl && /^https?:\/\//.test(ctaUrl)
      ? { label: fillVariables(opts.ctaLabel, vars, allowed), url: ctaUrl }
      : null;
  const element = (
    <EmailLayout
      preheader={fillVariables(opts.preheader, vars, allowed)}
      businessName={opts.businessName}
      logoUrl={opts.logoUrl}
      colors={opts.colors}
      cta={cta}
      footer={opts.footer}
    >
      <EmailRichText doc={fillVariables(opts.body, vars, allowed)} ink={opts.colors.ink} />
    </EmailLayout>
  );
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: cleanSubject(fillVariables(opts.subject, vars, allowed)), html, text };
}
