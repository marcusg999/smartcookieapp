import "server-only";

import { render } from "react-email";

import { EmailLayout, EmailRichText } from "@/emails/layout";
import type { RichNode } from "@/lib/validation/rich-text";

/** Variables the owner can drop into email copy, with sample values for previews. */
export const EMAIL_VARIABLES: Record<string, { label: string; sample: string }> = {
  parent_first_name: { label: "Parent's first name", sample: "Priya" },
  first_name: { label: "Recipient's first name", sample: "Priya" },
  order_number: { label: "Order number", sample: "SC-2026-001042" },
  delivery_dates: { label: "Delivery dates", sample: "Mon Nov 30 – Fri Dec 4" },
  cutoff: { label: "Order cutoff", sample: "Thu, Nov 26, 6:00 PM" },
  cutoff_time: { label: "Order cutoff (time only)", sample: "6:00 PM" },
  period: { label: "Invoice period", sample: "November 2026" },
  invoice_url: { label: "Invoice link", sample: "https://smartcookie.example/invoice/123" },
  business_name: { label: "Business name", sample: "Smart Cookie" },
  week_of: { label: "Menu week", sample: "Nov 30" },
  meals: { label: "Meals chosen (one per line)", sample: "Maya · Mon · Baked mac & cheese" },
  update_card_url: { label: "Update-card link", sample: "https://smartcookie.example/subscription?billing=1" },
};

/** Replace {{variables}}; unknown variables are left visible so mistakes are obvious in previews. */
export function fillVariables<T>(value: T, vars: Record<string, string>): T {
  const json = JSON.stringify(value).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) =>
    name in vars ? JSON.stringify(vars[name]).slice(1, -1) : match,
  );
  return JSON.parse(json) as T;
}

export async function renderEmail(opts: {
  subject: string;
  preheader: string;
  body: RichNode;
  vars: Record<string, string>;
  businessName: string;
  colors: { primary: string; ink: string; surface: string };
}) {
  const body = fillVariables(opts.body, opts.vars);
  const html = await render(
    <EmailLayout
      preheader={fillVariables(opts.preheader, opts.vars)}
      businessName={opts.businessName}
      colors={opts.colors}
    >
      <EmailRichText doc={body} ink={opts.colors.ink} />
    </EmailLayout>,
  );
  return { subject: fillVariables(opts.subject, opts.vars), html };
}
