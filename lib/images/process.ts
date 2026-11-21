import "server-only";

import sharp from "sharp";

/**
 * Upload pipeline (CLAUDE.md §5.10): images only, sniffed by MAGIC BYTES (the
 * file name and browser-supplied type are ignored), 8 MB cap, decoded and
 * re-encoded by sharp, which strips EXIF/GPS metadata, then converted to WebP
 * under a random path.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type ImageKind = "jpeg" | "png" | "webp" | "avif";

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "avif";
  return null;
}

export class ImageRejected extends Error {}

export async function processUpload(
  file: File,
): Promise<{ data: Buffer; width: number; height: number; path: string }> {
  if (!(file instanceof File) || file.size === 0) throw new ImageRejected("Choose an image to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageRejected("That image is larger than 8 MB.");
  const input = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(input)) throw new ImageRejected("Only JPEG, PNG, WebP or AVIF images can be uploaded.");

  try {
    const pipeline = sharp(input, { limitInputPixels: 40_000_000 })
      .rotate() // apply EXIF orientation, then metadata is dropped on output
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    const now = new Date();
    const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.webp`;
    return { data, width: info.width, height: info.height, path };
  } catch {
    throw new ImageRejected("That file couldn't be read as an image.");
  }
}
