/**
 * Password rules (CLAUDE.md §5.7): at least 12 characters; leaked passwords
 * rejected (server-side HIBP check in `pwned.ts`, plus Supabase's own check
 * when enabled on the hosted project). The strength score drives the meter.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON = [
  "password",
  "123456",
  "qwerty",
  "letmein",
  "welcome",
  "iloveyou",
  "admin",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "smartcookie",
  "cookie",
];

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; hints: string[] };

export function passwordStrength(password: string): PasswordStrength {
  const hints: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) hints.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);

  const lower = password.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const uniqueRatio = password.length ? new Set(password).size / password.length : 0;
  const hasCommon = COMMON.some((word) => lower.includes(word));
  const hasSequence = /(012|123|234|345|456|567|678|789|abc|bcd|cde|qwe|wer|asd)/i.test(password);
  const hasRepeat = /(.)\1{2,}/.test(password);

  let points = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) points++;
  if (password.length >= 16) points++;
  if (password.length >= 20) points++;
  if (classes >= 3) points++;
  if (uniqueRatio < 0.5) points--;
  if (hasCommon) {
    points -= 2;
    hints.push("Avoid common words like “password”.");
  }
  if (hasSequence || hasRepeat) {
    points--;
    hints.push("Avoid sequences and repeated characters.");
  }
  if (classes < 3 && password.length < 16) hints.push("Mix letters, numbers and symbols, or use a longer passphrase.");

  if (password.length < MIN_PASSWORD_LENGTH) points = Math.min(points, 1);
  const score = Math.max(0, Math.min(4, points)) as PasswordStrength["score"];
  const label = ["Too weak", "Weak", "Fair", "Strong", "Very strong"][score]!;
  return { score, label, hints };
}
