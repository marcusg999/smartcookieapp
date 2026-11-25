import { describe, expect, it } from "vitest";

import { deviceLabel } from "@/lib/auth/device";
import type { RichNode } from "@/lib/validation/rich-text";

import { allowedVariables, EMAIL_CATALOG, SAMPLE_VARIABLES } from "./catalog";
import { cleanSubject, fillVariables, renderEmail } from "./templates";

const doc = (...texts: string[]): RichNode => ({
  type: "doc",
  content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const base = {
  preheader: "Hi {{first_name}}",
  businessName: "Smart Cookie",
  logoUrl: "https://smartcookie.example/icons/icon-192.png",
  colors: { primary: "#f4b4b6", ink: "#1f3b2d", surface: "#fbeeea" },
  footer: { reason: "You have an account with us." },
};

describe("email rendering", () => {
  it("renders the branded layout with the CTA, both colour schemes and a plain-text part", async () => {
    const out = await renderEmail({
      ...base,
      templateKey: "order_confirmation",
      subject: "Order {{order_number}} confirmed",
      body: doc("Hi {{first_name}},", "{{meals}}", "Total {{total}}"),
      ctaLabel: "View order",
      vars: SAMPLE_VARIABLES,
    });
    expect(out.subject).toBe("Order SC-2026-001042 confirmed");
    expect(out.html).toContain('lang="en"');
    expect(out.html).toContain("prefers-color-scheme: dark");
    expect(out.html).toContain('href="https://smartcookie.example/orders/123"');
    expect(out.html).toContain("View order");
    // Newlines in a value become line breaks, not one long line.
    expect(out.html).toMatch(/Baked mac &amp; cheese<br\/?>/);
    expect(out.text).toContain("Maya · Mon · Baked mac & cheese");
    expect(out.text).toContain("Total $27.45");
  });

  it("escapes injected values: a variable can never become HTML or script", async () => {
    const evil = '<script>alert(1)</script><a href="https://evil.example">x</a>"}]}';
    const out = await renderEmail({
      ...base,
      templateKey: "order_confirmation",
      subject: "Order {{order_number}}",
      body: doc("Hi {{first_name}}"),
      vars: { first_name: evil, order_number: "A\r\nBcc: victim@example.com" },
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain('href="https://evil.example"');
    expect(out.html).toContain("&lt;script&gt;");
    // Subjects are one header line: no header injection.
    expect(out.subject).toBe("Order A Bcc: victim@example.com");
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("only fills variables the template allows", () => {
    const allowed = allowedVariables("menu_published");
    expect(allowed.has("menu_url")).toBe(true);
    expect(allowed.has("order_number")).toBe(false);
    expect(fillVariables("{{week_of}} {{order_number}}", { week_of: "Nov 30", order_number: "X" }, allowed)).toBe(
      "Nov 30 {{order_number}}",
    );
  });

  it("drops a button whose link isn't http(s)", async () => {
    const out = await renderEmail({
      ...base,
      templateKey: "order_confirmation",
      subject: "s",
      body: doc("b"),
      ctaLabel: "Open",
      vars: { order_url: "javascript:alert(1)" },
    });
    expect(out.html).not.toContain("javascript:");
    expect(out.html).not.toContain(">Open<");
  });

  it("marketing footers carry the address and unsubscribe link", async () => {
    const out = await renderEmail({
      ...base,
      templateKey: "menu_published",
      subject: "Menu",
      body: doc("New menu"),
      vars: SAMPLE_VARIABLES,
      footer: {
        reason: "You asked to hear about new menus.",
        address: "PO Box 1, Los Angeles, CA",
        unsubscribe: { label: "Unsubscribe", url: "https://smartcookie.example/unsubscribe?token=t" },
      },
    });
    expect(out.html).toContain("PO Box 1, Los Angeles, CA");
    expect(out.html).toContain('href="https://smartcookie.example/unsubscribe?token=t"');
  });

  it("every catalog entry has sample values for its variables and button", () => {
    for (const [key, entry] of Object.entries(EMAIL_CATALOG)) {
      for (const v of [...entry.variables, ...(entry.cta ? [entry.cta] : [])]) {
        expect(SAMPLE_VARIABLES, `${key}: ${v}`).toHaveProperty(v);
      }
      if (entry.category === "marketing") expect(entry.topic, key).toBeDefined();
    }
  });

  it("cleanSubject trims and caps length", () => {
    expect(cleanSubject("  a\tb  ")).toBe("a b");
    expect(cleanSubject("x".repeat(300))).toHaveLength(200);
  });
});

describe("deviceLabel", () => {
  it("names common browsers and devices", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0",
      ),
    ).toBe("Edge on Windows");
    expect(deviceLabel(null)).toBe("a browser on an unknown device");
  });
});
