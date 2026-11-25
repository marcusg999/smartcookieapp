import { z } from "zod";

import { richTextSchema } from "@/lib/validation/rich-text";

import type { ContentType } from "./registry";
import { safeHref } from "@/lib/validation/rich-text";

const href = z
  .string()
  .trim()
  .max(300)
  .refine((v) => safeHref(v) === v.trim(), "Links must start with /, https:// or mailto:");

export const ctaSchema = z.object({ label: z.string().trim().min(1, "Button text can't be empty.").max(60), href });
export const stepsSchema = z
  .array(
    z.object({
      title: z.string().trim().min(1).max(80),
      body: z.string().trim().max(300),
      bubble: z.string().trim().max(60).optional().default(""),
    }),
  )
  .min(1)
  .max(6);

/** Validates a content value for its registered type (server side). */
export function contentValueSchema(type: ContentType, key: string) {
  switch (type) {
    case "text":
      return z.string().trim().max(1000);
    case "rich_text":
      return richTextSchema;
    case "cta":
      return ctaSchema;
    case "image":
      return z.object({ path: z.string().trim().max(300), alt: z.string().trim().max(200) });
    case "json":
      return key === "how_it_works.steps" ? stepsSchema : z.unknown();
  }
}
