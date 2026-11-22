import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Phase 4: customer-facing pages must not hard-code copy. Every sentence in
 * JSX under the marketing and family areas (and their components) must come from content_blocks
 * (lib/content). Anything with two or more words counts as a sentence.
 */
const ROOTS = ["app/(marketing)", "app/(family)", "components/family", "components/marketing"];

const ALLOW_FILES = new Set<string>();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

// Landmark names (aria-label on nav etc.) are structural, not copy.
const COPY_PROPS = new Set(["title", "description", "placeholder", "alt", "body", "heading"]);

const isSentence = (text: string) => /[A-Za-z]{2,}[^A-Za-z]+[A-Za-z]{2,}/.test(text.replace(/\s+/g, " ").trim());

export function findLiteralCopy(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && isSentence(node.text)) hits.push(node.text.trim());
    // {"Some sentence"} directly inside JSX
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression) &&
      ts.isJsxElement(node.parent) &&
      isSentence(node.expression.text)
    ) {
      hits.push(node.expression.text);
    }
    // title="…", description="…", aria-label="…" and similar props carry copy too.
    if (
      ts.isJsxAttribute(node) &&
      COPY_PROPS.has(node.name.getText()) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      isSentence(node.initializer.text)
    ) {
      hits.push(`${node.name.getText()}="${node.initializer.text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("no hard-coded customer copy", () => {
  it("flags literal sentences", () => {
    expect(findLiteralCopy("x.tsx", "const A = () => <p>Hello there friend</p>;")).toEqual(["Hello there friend"]);
    expect(findLiteralCopy("x.tsx", "const A = () => <p>{c.text('k')} · 3</p>;")).toEqual([]);
    expect(findLiteralCopy("x.tsx", 'const A = () => <Page title="Your orders" />;')).toEqual(['title="Your orders"']);
    expect(findLiteralCopy("x.tsx", 'const A = () => <div className="flex gap-2" />;')).toEqual([]);
  });

  for (const file of ROOTS.flatMap(walk).filter((f) => !ALLOW_FILES.has(f))) {
    it(`${file} has no literal sentences`, () => {
      expect(findLiteralCopy(file, readFileSync(file, "utf8"))).toEqual([]);
    });
  }
});
