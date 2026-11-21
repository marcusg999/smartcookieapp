/** Uniform result for Server Actions, so clients can react to auth outcomes. */
export type ActionError =
  "validation" | "unauthorized" | "forbidden" | "rate_limited" | "captcha" | "locked" | "step_up_required" | "unknown";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: ActionError; message: string; fieldErrors?: Record<string, string> };

export function fail(error: ActionError, message: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, message, fieldErrors };
}

export const GENERIC = {
  signIn: "We couldn't sign you in with those details. Check them and try again, or confirm your email first.",
  link: "If an account exists for that email, we've sent a link. It expires in 10 minutes.",
  rateLimited: "Too many attempts. Please wait a minute and try again.",
  captcha: "Please complete the security check and try again.",
  locked: "Too many failed attempts. For your security, please wait 15 minutes or use an email link instead.",
  stepUp: "Please confirm it's you with your authenticator code.",
  forbidden: "You don't have permission to do that.",
} as const;
