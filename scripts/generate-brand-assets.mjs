// Builds every brand asset from the owner's logo (assets/brand/logo-source.webp):
// the web logo, PWA/iOS icons and the favicon. Re-run after replacing the source:
//   node scripts/generate-brand-assets.mjs
import sharp from "sharp";

const SRC = "assets/brand/logo-source.webp";
const PAPER = "#fff9f5"; // cream surface from the logo palette
const BLUSH = "#fbeeea";

// Trim transparent edges so the cookie fills its box.
const trimmed = await sharp(SRC).trim().toBuffer();

// Web logo: transparent WebP at 1× and 2× of the 96px display size.
for (const size of [96, 192, 512]) {
  await sharp(trimmed)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90 })
    .toFile(`public/brand/logo-${size}.webp`);
}

async function icon(file, size, padding, background) {
  const inner = Math.round(size * (1 - padding * 2));
  const art = await sharp(trimmed)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const base = sharp({
    create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  await base
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toFile(file);
  console.log("wrote", file);
}

await icon("public/icons/icon-192.png", 192, 0.02);
await icon("public/icons/icon-512.png", 512, 0.02);
// Maskable: artwork inside the central 80% safe zone, on a solid background.
await icon("public/icons/icon-maskable-512.png", 512, 0.12, BLUSH);
// iOS doesn't do transparency: cream background.
await icon("public/icons/apple-touch-icon.png", 180, 0.06, PAPER);
// Favicon (Next serves app/icon.png and links it automatically).
await icon("app/icon.png", 64, 0);
