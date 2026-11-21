"use client";

import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, Undo2 } from "lucide-react";

import type { RichNode } from "@/lib/validation/rich-text";
import { cn } from "@/lib/utils";

/**
 * Rich text editor (Tiptap). Produces ProseMirror JSON; the server sanitizes
 * it against an allow-list before saving (lib/validation/rich-text.ts).
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: RichNode | null;
  onChange: (doc: RichNode) => void;
  label: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
    ],
    content: value ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        id,
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
        class: "prose-sc min-h-32 px-3 py-2 outline-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as RichNode),
  });

  const btn = (active: boolean) =>
    cn(
      "inline-flex size-9 items-center justify-center rounded-md border-2 border-transparent hover:border-ink",
      active && "border-ink bg-orange",
    );

  return (
    <div className="rounded-md border-2 border-ink bg-card focus-within:shadow-ink-sm">
      <div className="flex flex-wrap gap-1 border-b-2 border-ink p-1" role="toolbar" aria-label={`${label} formatting`}>
        <button
          type="button"
          className={btn(!!editor?.isActive("bold"))}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          aria-label="Bold"
          aria-pressed={!!editor?.isActive("bold")}
        >
          <Bold className="size-4" />
        </button>
        <button
          type="button"
          className={btn(!!editor?.isActive("italic"))}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          aria-pressed={!!editor?.isActive("italic")}
        >
          <Italic className="size-4" />
        </button>
        <button
          type="button"
          className={btn(!!editor?.isActive("heading", { level: 2 }))}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          aria-label="Heading"
        >
          <Heading2 className="size-4" />
        </button>
        <button
          type="button"
          className={btn(!!editor?.isActive("bulletList"))}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          aria-label="Bulleted list"
        >
          <List className="size-4" />
        </button>
        <button
          type="button"
          className={btn(!!editor?.isActive("orderedList"))}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          aria-label="Numbered list"
        >
          <ListOrdered className="size-4" />
        </button>
        <button
          type="button"
          className={btn(!!editor?.isActive("blockquote"))}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          aria-label="Quote"
        >
          <Quote className="size-4" />
        </button>
        <button
          type="button"
          className={btn(!!editor?.isActive("link"))}
          aria-label="Link"
          onClick={() => {
            const previous = editor?.getAttributes("link").href as string | undefined;
            const href = window.prompt("Link address (https://… or /page)", previous ?? "https://");
            if (href === null) return;
            if (href === "") editor?.chain().focus().unsetLink().run();
            else editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }}
        >
          <Link2 className="size-4" />
        </button>
        <button
          type="button"
          className={btn(false)}
          onClick={() => editor?.chain().focus().undo().run()}
          aria-label="Undo"
        >
          <Undo2 className="size-4" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
