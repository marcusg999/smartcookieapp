import { z } from "zod";

/**
 * Rich text is stored as Tiptap/ProseMirror JSON and sanitized SERVER-SIDE
 * against an allow-list (Phase 4 §1). We never store or render raw HTML:
 * unknown nodes, marks and attributes are dropped, and links are limited to
 * http(s), mailto and same-site paths.
 */
export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

const BLOCK_NODES = new Set(["doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote"]);
const LEAF_NODES = new Set(["text", "hardBreak", "horizontalRule"]);
const MARKS = new Set(["bold", "italic", "link"]);
const MAX_DEPTH = 8;
const MAX_TEXT = 20_000;

export function safeHref(href: unknown): string | null {
  if (typeof href !== "string" || href.length > 500) return null;
  const value = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return null;
}

function sanitizeNode(node: unknown, depth: number, budget: { chars: number }): RichNode | null {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  const n = node as RichNode;
  if (n.type === "text") {
    if (typeof n.text !== "string" || n.text.length === 0) return null;
    const text = n.text.slice(0, Math.max(0, budget.chars));
    budget.chars -= text.length;
    if (!text) return null;
    const marks = (Array.isArray(n.marks) ? n.marks : [])
      .filter((m) => m && MARKS.has(m.type))
      .map((m) => {
        if (m.type !== "link") return { type: m.type };
        const href = safeHref(m.attrs?.href);
        return href ? { type: "link", attrs: { href } } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    return marks.length ? { type: "text", text, marks } : { type: "text", text };
  }
  if (LEAF_NODES.has(n.type)) return { type: n.type };
  if (!BLOCK_NODES.has(n.type)) return null;

  const out: RichNode = { type: n.type };
  if (n.type === "heading") {
    const level = Number(n.attrs?.level);
    out.attrs = { level: level === 3 ? 3 : 2 };
  }
  if (n.type === "orderedList") {
    const start = Number(n.attrs?.start);
    if (Number.isInteger(start) && start > 1 && start < 1000) out.attrs = { start };
  }
  const children = (Array.isArray(n.content) ? n.content : [])
    .map((c) => sanitizeNode(c, depth + 1, budget))
    .filter((c): c is RichNode => c !== null);
  if (children.length) out.content = children;
  return out;
}

/** Returns a clean doc (always `{ type: "doc" }` at the root). */
export function sanitizeRichText(input: unknown): RichNode {
  const doc = sanitizeNode(input, 0, { chars: MAX_TEXT });
  if (!doc || doc.type !== "doc") return { type: "doc", content: [] };
  return doc;
}

export function richTextFromPlain(text: string): RichNode {
  return {
    type: "doc",
    content: text
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}

export function richTextToPlain(doc: RichNode | null | undefined): string {
  if (!doc) return "";
  if (doc.type === "text") return doc.text ?? "";
  return (doc.content ?? []).map(richTextToPlain).join(doc.type === "doc" ? "\n\n" : "");
}

/** Zod schema for Server Actions: parses JSON and sanitizes. */
export const richTextSchema = z.union([z.string(), z.record(z.string(), z.unknown())]).transform((value, ctx) => {
  try {
    return sanitizeRichText(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid rich text" });
    return z.NEVER;
  }
});
