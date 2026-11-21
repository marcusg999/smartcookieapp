/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Problems that would make text unreadable with these brand colours (AA = 4.5:1). */
export function brandContrastProblems(c: {
  primary: string;
  background: string;
  surface: string;
  ink: string;
  accent: string;
}): string[] {
  const checks: [string, string, string][] = [
    ["Text on the page background", c.ink, c.background],
    ["Text on cards", c.ink, c.surface],
    ["Text on buttons", c.ink, c.primary],
    ["Accent text on cards", c.accent, c.surface],
  ];
  return checks
    .filter(([, fg, bg]) => contrastRatio(fg, bg) < 4.5)
    .map(([label, fg, bg]) => `${label} is hard to read (${contrastRatio(fg, bg).toFixed(1)}:1, needs 4.5:1).`);
}
