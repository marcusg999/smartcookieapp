/**
 * A coarse, human-readable device label from a User-Agent ("Safari on
 * iPhone"). Used for the owner's new-device alert; only a hash of
 * user + label is stored, so browser updates don't count as a new device.
 */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Mac OS X|Macintosh/.test(s)
          ? "Mac"
          : /Windows/.test(s)
            ? "Windows"
            : /CrOS/.test(s)
              ? "Chromebook"
              : /Linux/.test(s)
                ? "Linux"
                : "an unknown device";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(s)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : "a browser";
  return `${browser} on ${os}`;
}
