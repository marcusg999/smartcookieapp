import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "react-email";
import type { ReactNode } from "react";

import type { RichNode } from "@/lib/validation/rich-text";

/**
 * Shared transactional email layout (React Email). Copy comes from the
 * `email_templates` table; brand colours from site settings.
 */
export function EmailLayout({
  preheader,
  businessName,
  colors,
  children,
}: {
  preheader: string;
  businessName: string;
  colors: { primary: string; ink: string; surface: string };
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={{ backgroundColor: colors.surface, fontFamily: "Helvetica, Arial, sans-serif", color: colors.ink, margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", backgroundColor: "#ffffff", border: `2px solid ${colors.ink}`, borderRadius: 16, padding: 32 }}>
          <Section style={{ borderBottom: `4px solid ${colors.primary}`, paddingBottom: 12, marginBottom: 20 }}>
            <Heading as="h1" style={{ margin: 0, fontSize: 24, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
              {businessName}
            </Heading>
          </Section>
          {children}
          <Hr style={{ borderColor: colors.primary, margin: "28px 0 12px" }} />
          <Text style={{ fontSize: 12, color: "#5a4a48", margin: 0 }}>You're receiving this because you have an account with {businessName}.</Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Rich-text JSON → email-safe elements (no raw HTML). */
export function EmailRichText({ doc, ink }: { doc: RichNode | null; ink: string }) {
  const render = (node: RichNode, key: number): ReactNode => {
    const kids = (node.content ?? []).map(render);
    switch (node.type) {
      case "paragraph":
        return <Text key={key} style={{ fontSize: 16, lineHeight: "24px", margin: "0 0 14px" }}>{kids}</Text>;
      case "heading":
        return <Heading key={key} as="h2" style={{ fontSize: 20, margin: "18px 0 10px" }}>{kids}</Heading>;
      case "bulletList":
        return <ul key={key} style={{ paddingLeft: 20, margin: "0 0 14px" }}>{kids}</ul>;
      case "orderedList":
        return <ol key={key} style={{ paddingLeft: 20, margin: "0 0 14px" }}>{kids}</ol>;
      case "listItem":
        return <li key={key}>{kids}</li>;
      case "blockquote":
        return <blockquote key={key} style={{ borderLeft: `4px solid ${ink}`, margin: "0 0 14px", paddingLeft: 12 }}>{kids}</blockquote>;
      case "hardBreak":
        return <br key={key} />;
      case "text": {
        let el: ReactNode = node.text;
        for (const m of node.marks ?? []) {
          if (m.type === "bold") el = <strong>{el}</strong>;
          if (m.type === "italic") el = <em>{el}</em>;
          if (m.type === "link" && typeof m.attrs?.href === "string") el = <Link href={m.attrs.href} style={{ color: ink }}>{el}</Link>;
        }
        return <span key={key}>{el}</span>;
      }
      default:
        return kids.length ? <span key={key}>{kids}</span> : null;
    }
  };
  return <>{(doc?.content ?? []).map(render)}</>;
}
