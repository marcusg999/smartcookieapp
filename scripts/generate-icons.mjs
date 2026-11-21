// Renders the placeholder app icon (app/icon.svg) to the PNG sizes the PWA
// manifest and iOS need. Re-run when the brand icon replaces the placeholder:
//   node scripts/generate-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
const targets = [
  { file: "public/icons/icon-192.png", size: 192, padding: 0 },
  { file: "public/icons/icon-512.png", size: 512, padding: 0 },
  // Maskable icons need the artwork inside the central 80% "safe zone".
  { file: "public/icons/icon-maskable-512.png", size: 512, padding: 0.12, background: "#c2410c" },
  { file: "public/icons/apple-touch-icon.png", size: 180, padding: 0 },
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
);
const page = await browser.newPage();
for (const { file, size, padding, background } of targets) {
  const inner = Math.round(size * (1 - padding * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${background ?? "transparent"}">` +
      svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `) +
      "</body></html>",
  );
  await page.screenshot({ path: file, omitBackground: !background });
  console.log("wrote", file);
}
await browser.close();
