import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "react-email";
import type { ReactNode } from "react";

import type { RichNode } from "@/lib/validation/rich-text";

export type EmailColors = { primary: string; ink: string; surface: string };

/**
 * Shared email layout (React Email). Copy comes from `email_templates`;
 * colours and logo from site settings. Works in light and dark mode (clients
 * that support `prefers-color-scheme` get a dark palette; the rest keep the
 * light one with good contrast) and on phones (fluid 560px column).
 */
export function EmailLayout({
  preheader,
  businessName,
  logoUrl,
  colors,
  cta,
  footer,
  children,
}: {
  preheader: string;
  businessName: string;
  logoUrl?: string;
  colors: EmailColors;
  cta?: { label: string; url: string } | null;
  footer: { reason: string; address?: string; unsubscribe?: { label: string; url: string } | null };
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          @media (prefers-color-scheme: dark) {
            .sc-body { background-color: #151311 !important; }
            .sc-card { background-color: #23201d !important; border-color: #f4f1ea !important; }
            .sc-text, .sc-text * { color: #f4f1ea !important; }
            .sc-muted { color: #c9c2b8 !important; }
            .sc-button { background-color: ${colors.primary} !important; color: #151311 !important; }
          }
          @media (max-width: 600px) {
            .sc-card { padding: 20px !important; border-radius: 12px !important; }
          }
        `}</style>
      </Head>
      <Preview>{preheader}</Preview>
      <Body
        className="sc-body"
        style={{
          backgroundColor: colors.surface,
          fontFamily: "Helvetica, Arial, sans-serif",
          color: colors.ink,
          margin: 0,
          padding: "24px 8px",
        }}
      >
        <Container
          className="sc-card sc-text"
          style={{
            maxWidth: 560,
            width: "100%",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            border: `2px solid ${colors.ink}`,
            borderRadius: 16,
            padding: 32,
          }}
        >
          <Section style={{ borderBottom: `4px solid ${colors.primary}`, paddingBottom: 12, marginBottom: 20 }}>
            {logoUrl ? (
              <Img src={logoUrl} width="48" height="48" alt="" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }} />
            ) : null}
            <Heading
              as="h1"
              style={{ display: "inline-block", verticalAlign: "middle", margin: 0, fontSize: 24, fontStyle: "italic", fontFamily: "Georgia, serif" }}
            >
              {businessName}
            </Heading>
          </Section>
          {children}
          {cta ? (
            <Section style={{ margin: "8px 0 20px" }}>
              <Button
                className="sc-button"
                href={cta.url}
                style={{
                  backgroundColor: colors.ink,
                  color: "#ffffff",
                  borderRadius: 10,
                  padding: "14px 22px",
                  fontSize: 16,
                  fontWeight: 700,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                {cta.label}
              </Button>
              <Text className="sc-muted" style={{ fontSize: 12, color: "#5a4a48", margin: "10px 0 0", wordBreak: "break-all" }}>
                {cta.url}
              </Text>
            </Section>
          ) : null}
          <Hr style={{ borderColor: colors.primary, margin: "28px 0 12px" }} />
          <Text className="sc-muted" style={{ fontSize: 12, lineHeight: "18px", color: "#5a4a48", margin: 0 }}>
            {footer.reason}
            {footer.address ? (
              <>
                <br />
                {businessName} · {footer.address}
              </>
            ) : null}
            {footer.unsubscribe ? (
              <>
                <br />
                <Link href={footer.unsubscribe.url} style={{ color: "#5a4a48", textDecoration: "underline" }}>
                  {footer.unsubscribe.label}
                </Link>
              </>
            ) : null}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Rich-text JSON → email-safe elements (no raw HTML). Newlines in text become line breaks. */
export function EmailRichText({ doc, ink }: { doc: RichNode | null; ink: string }) {
  const render = (node: RichNode, key: number): ReactNode => {
    const kids = (node.content ?? []).map(render);
    switch (node.type) {
      case "paragraph":
        return (
          <Text key={key} style={{ fontSize: 16, lineHeight: "24px", margin: "0 0 14px" }}>
            {kids}
          </Text>
        );
      case "heading":
        return (
          <Heading key={key} as="h2" style={{ fontSize: 20, margin: "18px 0 10px" }}>
            {kids}
          </Heading>
        );
      case "bulletList":
        return (
          <ul key={key} style={{ paddingLeft: 20, margin: "0 0 14px" }}>
            {kids}
          </ul>
        );
      case "orderedList":
        return (
          <ol key={key} style={{ paddingLeft: 20, margin: "0 0 14px" }}>
            {kids}
          </ol>
        );
      case "listItem":
        return <li key={key}>{kids}</li>;
      case "blockquote":
        return (
          <blockquote key={key} style={{ borderLeft: `4px solid ${ink}`, margin: "0 0 14px", paddingLeft: 12 }}>
            {kids}
          </blockquote>
        );
      case "hardBreak":
        return <br key={key} />;
      case "text": {
        const lines = (node.text ?? "").split("\n");
        let el: ReactNode = lines.flatMap((line, i) => (i === 0 ? [line] : [<br key={`b${i}`} />, line]));
        for (const m of node.marks ?? []) {
          if (m.type === "bold") el = <strong>{el}</strong>;
          if (m.type === "italic") el = <em>{el}</em>;
          if (m.type === "link" && typeof m.attrs?.href === "string" && /^(https?:|mailto:)/.test(m.attrs.href))
            el = (
              <Link href={m.attrs.href} style={{ color: ink }}>
                {el}
              </Link>
            );
        }
        return <span key={key}>{el}</span>;
      }
      default:
        return kids.length ? <span key={key}>{kids}</span> : null;
    }
  };
  return <>{(doc?.content ?? []).map(render)}</>;
}
