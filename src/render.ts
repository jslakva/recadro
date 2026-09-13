/**
 * The render pass: Playwright drives the same server and the same URLs the
 * browser shows, at the slot's scale factor, and writes exact App Store pixels.
 *
 * There is no validation here beyond the completeness check — the contact sheet
 * is the check. What looks like the two survivors is unconditional processing:
 * every write is flattened and stamped sRGB, because an alpha channel is never
 * wanted (ASC rejects transparency) and so there is nothing to test for.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import type { Panel } from "./panels.ts";
import { viewportFor, type Slot } from "./slots.ts";

/** Everything one render pass needs. */
export interface RenderOptions {
  /** Origin of the running server, from `startServer`. */
  origin: string;
  /** Panels to attempt, in filename order. */
  panels: Panel[];
  /** Slots to render each panel into. */
  slots: Slot[];
  /** Locale codes, matching the listing Markdown filenames. */
  locales: string[];
  /** Absolute path of the output directory; `<out>/<locale>/<device>/`. */
  outDir: string;
}

/** What a pass produced, for the caller's summary line. */
export interface RenderResult {
  /** Files written, as paths relative to `outDir`. */
  written: string[];
  /** Panels skipped for want of a capture, as `locale/device/slug` with the src. */
  skipped: { where: string; missing: string[] }[];
}

/**
 * Waits for the page to be finished and reports whether it is complete.
 *
 * "Complete" is deliberately not a contract the page implements: a panel that
 * carries no `<img>` at all — a text-only story panel — has nothing to fail and
 * is complete, while a panel whose capture is absent has an `<img>` that
 * resolved to nothing. That is the readiness signal the filesystem was always
 * providing; this is where the tool reads it without learning which capture any
 * panel wanted.
 *
 * Fonts are awaited here too, or the first panel ships in a fallback face.
 */
async function settle(page: import("playwright").Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.all(
      images.map(
        (img) =>
          img.complete ||
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    );
    return images.filter((img) => img.naturalWidth === 0).map((img) => img.currentSrc || img.src);
  });
}

/**
 * Renders every locale x slot x panel whose capture exists.
 *
 * Each `<out>/<locale>/<device>/` directory is cleared first, so a panel
 * deleted from the directory cannot survive as a stale PNG that the upload lane
 * would still find and ship.
 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  const { origin, panels, slots, locales, outDir } = options;
  const result: RenderResult = { written: [], skipped: [] };
  const browser = await chromium.launch();

  try {
    for (const locale of locales) {
      for (const slot of slots) {
        const dir = join(outDir, locale, slot.id);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });

        const context = await browser.newContext({
          viewport: viewportFor(slot),
          deviceScaleFactor: slot.scale,
          locale,
        });
        const page = await context.newPage();

        for (const panel of panels) {
          const query = `?panel=${panel.slug}&device=${encodeURIComponent(slot.id)}&locale=${locale}`;
          // `networkidle` rather than `load`: a panel fetches its own captions and
          // sets its capture from them, so the image request does not exist yet
          // when `load` fires. Checking `document.images` before that would find
          // an empty list and call an unfinished panel complete.
          await page.goto(`${origin}${panel.urlPath}${query}`, { waitUntil: "networkidle" });

          const missing = await settle(page);
          if (missing.length) {
            result.skipped.push({ where: `${locale}/${slot.id}/${panel.slug}`, missing });
            continue;
          }

          const shot = await page.screenshot({ type: "png" });
          const file = join(dir, `${panel.slug}.png`);
          await sharp(shot)
            .flatten({ background: "#ffffff" })
            .toColorspace("srgb")
            .withIccProfile("srgb")
            .png({ compressionLevel: 9 })
            .toFile(file);
          result.written.push(`${locale}/${slot.id}/${panel.slug}.png`);
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return result;
}
