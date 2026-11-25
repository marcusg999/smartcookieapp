import { describe, expect, it } from "vitest";

import { safeHref, sanitizeRichText } from "./rich-text";

// Phase 10 security review: the CMS rich-text allow-list (XSS).
describe("rich text sanitizer", () => {
  it("drops unknown nodes, raw HTML nodes and unknown marks", () => {
    const out = sanitizeRichText({
      type: "doc",
      content: [
        { type: "html", text: "<script>alert(1)</script>" },
        { type: "iframe", attrs: { src: "https://evil.example" } },
        { type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "onclick" }, { type: "bold" }] }] },
      ],
    });
    expect(out).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "bold" }] }] }],
    });
  });

  it("keeps script-looking text as plain text (rendered escaped)", () => {
    const out = sanitizeRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] }],
    });
    expect(out.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "<img src=x onerror=alert(1)>" });
  });

  it("strips attributes it doesn't know (no style, no event handlers)", () => {
    const out = sanitizeRichText({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, style: "x", onmouseover: "alert(1)" },
          content: [{ type: "text", text: "T" }],
        },
      ],
    });
    expect(out.content?.[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "T" }] });
  });

  it.each([
    ["javascript:alert(1)", null],
    [" JavaScript:alert(1)", null],
    ["data:text/html;base64,PHNjcmlwdD4=", null],
    ["vbscript:x", null],
    ["//evil.example", null],
    ["/\\evil.example", null],
    ["/ok\u0000", null],
    ["https://smartcookie.example/menu", "https://smartcookie.example/menu"],
    ["mailto:hello@example.com", "mailto:hello@example.com"],
    ["/plans", "/plans"],
  ])("safeHref(%j) → %j", (href, expected) => {
    expect(safeHref(href)).toBe(expected);
  });

  it("drops links with unsafe hrefs but keeps the text", () => {
    const out = sanitizeRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
      ],
    });
    expect(out.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "click" });
  });

  it("limits nesting depth and total text", () => {
    let deep: Record<string, unknown> = { type: "text", text: "x" };
    for (let i = 0; i < 20; i++) deep = { type: "blockquote", content: [deep] };
    expect(JSON.stringify(sanitizeRichText({ type: "doc", content: [deep] }))).not.toContain('"x"');
    const big = sanitizeRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a".repeat(50_000) }] }],
    });
    expect(big.content?.[0]?.content?.[0]?.text?.length).toBe(20_000);
  });
});
