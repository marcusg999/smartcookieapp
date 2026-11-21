import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONTENT_GROUPS, CONTENT_KEYS } from "./registry";
import { contentValueSchema } from "./schemas";

describe("content registry", () => {
  it("has unique keys", () => {
    expect(new Set(CONTENT_KEYS).size).toBe(CONTENT_KEYS.length);
  });

  it("every default is valid for its type", () => {
    for (const def of CONTENT_GROUPS.flatMap((g) => g.items)) {
      const parsed = contentValueSchema(def.type, def.key).safeParse(def.default);
      expect(parsed.success, def.key).toBe(true);
    }
  });

  it("every key is seeded (run `pnpm content:seed` after adding one)", () => {
    const seed = readFileSync("supabase/seed.sql", "utf8");
    const missing = CONTENT_KEYS.filter((k) => !seed.includes(`('${k}', `));
    expect(missing).toEqual([]);
  });
});
