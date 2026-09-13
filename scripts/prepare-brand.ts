/**
 * Cuts recadro's mark and wordmark out of the generated brand images and
 * writes them as transparent PNGs, each at the largest size any source has it.
 *
 * The sources are flat renders with no transparent export, so each asset has to
 * be lifted off its own dark ground. Two were chosen: the teal aperture mark,
 * which exists only in the bottom-left variant of the 2x2 variants sheet, and the
 * wordmark of the top-left variant — which `recadro.png` renders on its own at
 * about 1.9x the sheet's size, so that is where it is taken from.
 *
 * Hand-cropping would be a one-way operation with no record of where the pixels
 * came from. Both images are generated files that live outside the repo; pass
 * the directory holding them and where to write, and re-run when they are
 * regenerated:
 *
 *   npx tsx scripts/prepare-brand.ts ~/myprojects/repliq/designs ../../site/assets
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const SOURCE_DIR = process.argv[2] ? resolve(process.argv[2]) : null;
const OUT_DIR = process.argv[3] ? resolve(process.argv[3]) : null;

/** Below this, a pixel is the source's background vignette rather than ink. */
const ALPHA_FLOOR = 0.05;

/** One asset to lift out of a source image. */
interface Asset {
  /** Output filename, written into the output directory. */
  file: string;
  /** Source filename, inside the source directory. */
  source: string;
  /** Tight bounds in the full source image, measured by row/column profile. */
  region: { left: number; top: number; width: number; height: number };
  /** Margin kept around the bounds so antialiased edges are not clipped. */
  bleed: number;
}

/**
 * What to cut, and from where.
 *
 * All bounds were measured by scanning for pixels differing from the local
 * background by more than 40 in any channel, not eyeballed. The variants sheet
 * is 1536x1024, a 2x2 grid of 768x512 quadrants; its top-left wordmark (176,
 * 331, 409x89) is superseded by the larger render below. `recadro.png` is
 * 1254x1254: the wordmark sits in a band at y 712-874, with clear gaps above
 * (the logo ends at 663) and below (the tagline starts at 930).
 */
const ASSETS: Asset[] = [
  // Variants sheet, bottom-left quadrant: the teal aperture mark. The only render of it.
  { file: "mark.png", source: "recadro-variants.png", region: { left: 75, top: 593, width: 147, height: 144 }, bleed: 3 },
  // The top-left variant rendered alone: the wordmark, without its logo or tagline.
  { file: "wordmark.png", source: "recadro.png", region: { left: 241, top: 712, width: 776, height: 163 }, bleed: 6 },
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

  const { data, info } = await sharp(join(SOURCE_DIR!, asset.source))
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

  const path = join(OUT_DIR!, asset.file);
  await sharp(out, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .png({ compressionLevel: 9 })
    .toFile(path);

  const written = await sharp(path).metadata();
  console.log(`${asset.file}: ${written.width}x${written.height} (ground rgb(${bg.join(",")}))`);
}

async function main(): Promise<void> {
  if (!SOURCE_DIR || !OUT_DIR) {
    console.error("usage: npx tsx scripts/prepare-brand.ts <dir holding recadro.png and recadro-variants.png> <out dir>");
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
