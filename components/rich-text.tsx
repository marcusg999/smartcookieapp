import type { ReactNode } from "react";

import { safeHref, type RichNode } from "@/lib/validation/rich-text";

/** Renders sanitized rich-text JSON as React elements (never raw HTML). */
export function RichText({ doc, className }: { doc: RichNode | null | undefined; className?: string }) {
  if (!doc) return null;
  return <div className={className ? `prose-sc ${className}` : "prose-sc"}>{renderChildren(doc)}</div>;
}

function renderChildren(node: RichNode): ReactNode {
  return (node.content ?? []).map((child, i) => renderNode(child, i));
}

function renderNode(node: RichNode, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderChildren(node)}</p>;
    case "heading":
      return node.attrs?.level === 3 ? (
        <h4 key={key}>{renderChildren(node)}</h4>
      ) : (
        <h3 key={key}>{renderChildren(node)}</h3>
      );
    case "bulletList":
      return <ul key={key}>{renderChildren(node)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node)}</li>;
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node)}</blockquote>;
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    case "text": {
      let el: ReactNode = node.text ?? "";
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") el = <strong>{el}</strong>;
        if (mark.type === "italic") el = <em>{el}</em>;
        if (mark.type === "link") {
          const href = safeHref(mark.attrs?.href);
          if (href)
            el = (
              <a href={href} rel={href.startsWith("/") ? undefined : "noopener noreferrer"}>
                {el}
              </a>
            );
        }
      }
      return <span key={key}>{el}</span>;
    }
    default:
      return null;
  }
}
