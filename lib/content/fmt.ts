/** CMS copy handed to client components: `copy` comes from Content.group(prefix). */
export type Copy = Record<string, string>;

/** Fill {placeholders} in a CMS string. Safe on server and client. */
export function fmt(template: string | undefined, vars: Record<string, string | number> = {}): string {
  return (template ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
