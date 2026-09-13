/**
 * Cuts recadro's mark and wordmark out of the generated variants sheet and
 * writes them as transparent PNGs for the contact sheet's header.
 *
 * The source is one 2x2 image of four whole logo treatments, so there is no
 * transparent export to use — each asset has to be lifted off its own flat dark
 * ground. Two were chosen: the teal aperture mark from the bottom-left variant,
 * and the wordmark from the top-left one. Everything else on the sheet is
 * ignored, including each variant's own pairing.
 *
 * Hand-cropping would be a one-way operation with no record of where the pixels
 * came from. The sheet itself is a generated file that lives outside the repo;
 * pass its path, and re-run when it is regenerated:
 *
 *   npx tsx scripts/prepare-brand.ts ~/designs/recadro-variants.png
 *
 * The outputs in assets/ are what is versioned.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const SOURCE = process.argv[2] ? resolve(process.argv[2]) : null;
const OUT_DIR = join(import.meta.dirname, "..", "assets");

/** Below this, a pixel is the source's background vignette rather than ink. */
const ALPHA_FLOOR = 0.05;

/** One asset to lift out of the variants sheet. */
interface Asset {
  /** Output filename, written into `assets/`. */
  file: string;
  /** Tight bounds in the full 1536x1024 sheet, measured by row/column profile. */
  region: { left: number; top: number; width: number; height: number };
  /** Margin kept around the bounds so antialiased edges are not clipped. */
  bleed: number;
}

/**
 * What to cut, and from where.
 *
 * The sheet is a 2x2 grid of 768x512 quadrants. Both bounds below were measured
 * by scanning for pixels differing from the local background, not eyeballed:
 * the wordmark sits in a band at y 331-419 with clear gaps above (the variant's
 * own logo ends at 314) and below (its tagline starts at 447).
 */
const ASSETS: Asset[] = [
  // Bottom-left quadrant: the teal aperture mark.
  { file: "mark.png", region: { left: 75, top: 593, width: 147, height: 144 }, bleed: 3 },
  // Top-left quadrant: the wordmark alone, without that variant's logo.
  { file: "wordmark.png", region: { left: 176, top: 331, width: 409, height: 89 }, bleed: 3 },
];

/** The median of one channel across sampled pixels. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Samples the flat ground an asset sits on, from the four corners of its
 * bled crop — which are outside the measured ink bounds by construction.
 */
function sampleBackground(data: Buffer, width: number, height: number, channels: number): number[] {
  const patch = 6;
  const samples: number[][] = [[], [], []];
  for (const [cx, cy] of [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ]) {
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * width + x) * channels;
        for (let c = 0; c < 3; c++) samples[c].push(data[i + c]);
      }
    }
  }
  return samples.map(median);
}

/**
 * Lifts one asset off its background into straight (unpremultiplied) alpha.
 *
 * Coverage is read as the pixel's distance from the ground, normalised so the
 * asset's solid interior reaches full opacity — without that the teal mark,
 * whose brightest channel is well short of white, would come out translucent.
 * The colour is then recovered by undoing the composite, so an edge pixel keeps
 * the ink's hue instead of a blend with the ground it used to sit on.
 */
async function lift(asset: Asset): Promise<void> {
  const region = {
    left: asset.region.left - asset.bleed,
    top: asset.region.top - asset.bleed,
    width: asset.region.width + asset.bleed * 2,
    height: asset.region.height + asset.bleed * 2,
  };

  const { data, info } = await sharp(SOURCE!)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bg = sampleBackground(data, width, height, channels);

  const raw = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const span = 255 - bg[c];
      if (span > 0) a = Math.max(a, (data[i + c] - bg[c]) / span);
    }
    raw[p] = Math.min(1, Math.max(0, a));
  }

  // Normalise against a high percentile rather than the maximum, so one hot
  // antialiasing pixel cannot flatten the whole asset's opacity.
  const sorted = [...raw].sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.999)] || 1;

  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    let a = Math.min(1, raw[p] / peak);
    if (a < ALPHA_FLOOR) a = 0;
    out[p * 4 + 3] = Math.round(a * 255);
    for (let c = 0; c < 3; c++) {
      const value = a === 0 ? 0 : bg[c] + (data[i + c] - bg[c]) / a;
      out[p * 4 + c] = Math.round(Math.min(255, Math.max(0, value)));
    }
  }

  const path = join(OUT_DIR, asset.file);
  await sharp(out, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .png({ compressionLevel: 9 })
    .toFile(path);

  const written = await sharp(path).metadata();
  console.log(`${asset.file}: ${written.width}x${written.height} (ground rgb(${bg.join(",")}))`);
}

async function main(): Promise<void> {
  if (!SOURCE) {
    console.error("usage: npx tsx scripts/prepare-brand.ts <path to recadro-variants.png>");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const asset of ASSETS) await lift(asset);
  console.log(`\nWrote ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
