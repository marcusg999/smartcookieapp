import { createHmac } from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret, for tests. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", bytes).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Wait until the next 30 s window so a fresh (never-used) code is generated. */
export async function freshTotp(secret: string): Promise<string> {
  const msIntoWindow = Date.now() % 30_000;
  await new Promise((r) => setTimeout(r, 30_000 - msIntoWindow + 500));
  return totp(secret);
}
