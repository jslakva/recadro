/**
 * The render pass: Playwright drives the same server and the same URLs the
 * browser shows, at the slot's scale factor, and writes exact App Store pixels.
 *
 * There is no validation here beyond the completeness check — the lineup
 * is the check. What looks like the two survivors is unconditional processing:
 * every write is flattened and stamped sRGB, because an alpha channel is never
 * wanted (ASC rejects transparency) and so there is nothing to test for.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import type { Panel } from "./panels.ts";
import { outFile, type OutLayout } from "./set.ts";
import { viewportFor, type Slot } from "./slots.ts";

/** Everything one render pass needs. */
export interface RenderOptions {
  /** The browser to shoot in, from `launchBrowser`; the caller closes it. */
  browser: Browser;
  /** Origin of the running server, from `startServer`. */
  origin: string;
  /** Panels to attempt, in filename order. */
  panels: Panel[];
  /** Slots to render each panel into. */
  slots: Slot[];
  /** Locale codes: the output folder names under each slot, and the page's `?locale=`. */
  locales: string[];
  /** The page's `?captures=` for one slot and locale: a root-absolute folder URL. */
  capturesUrl: (device: string, locale: string) => string;
  /** Where renders go: the folder and the layout below it, `<out>/<locale>/<device>-<slug>.png` by default. */
  out: OutLayout;
  /**
   * Shoot incomplete panels too, instead of skipping them. For looking, never
   * for shipping: the caller keeps this away from the set's own output
   * directory, which is uploaded wholesale.
   */
  incomplete?: boolean;
}

/** What a pass produced, for the caller's summary line. */
export interface RenderResult {
  /** Files written, as paths relative to `out.base`. */
  written: string[];
  /**
   * Panels with an image that resolved to nothing, as the file they would have
   * been written to, with the srcs. Skipped, or written anyway under `incomplete`.
   */
  incomplete: { where: string; missing: string[] }[];
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
 *
 * A missing image is reported as a path in the repository, decoded, the way the
 * lineup's pointer names one: the server's origin and port mean nothing to the
 * reader, and `%7Bcapture%3A5%7D` hides a placeholder nobody filled.
 */
async function settle(page: Page): Promise<string[]> {
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
    return images
      .filter((img) => img.naturalWidth === 0)
      .map((img) => {
        const src = new URL(img.currentSrc || img.src, document.baseURI);
        if (src.origin !== location.origin) return src.href;
        try {
          return decodeURIComponent(src.pathname).slice(1);
        } catch {
          return src.pathname.slice(1);
        }
      });
  });
}

/**
 * Removes what an earlier render wrote for this slot and locale: the folder
 * when the layout gives the slot one, else this slot's files in the locale's
 * folder, the other slot's left alone. Emptied before a render into it, so a
 * panel deleted from the set cannot survive as a stale PNG that an upload
 * would still find and ship.
 */
function clear(out: OutLayout, slot: Slot, locale: string): string {
  const dir = join(out.base, dirname(outFile(out, slot.id, locale, "x")));
  if (out.layout.includes("{device}")) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    const prefix = `${slot.id}-`;
    for (const name of safeList(dir)) {
      if (name.startsWith(prefix) && name.endsWith(".png")) rmSync(join(dir, name), { force: true });
    }
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The names in a folder, or none when it does not exist. */
function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Renders every slot x locale x panel whose capture exists, or every panel at
 * all under `incomplete`.
 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  const { browser, origin, panels, slots, locales, capturesUrl, out, incomplete = false } = options;
  const result: RenderResult = { written: [], incomplete: [] };

  for (const slot of slots) {
    for (const locale of locales) {
      clear(out, slot, locale);

      const context = await browser.newContext({
        viewport: viewportFor(slot),
        deviceScaleFactor: slot.scale,
        locale,
      });
      const page = await context.newPage();

      const captures = encodeURIComponent(capturesUrl(slot.id, locale));
      for (const panel of panels) {
        const query =
          `?panel=${panel.slug}&device=${encodeURIComponent(slot.id)}&locale=${locale}&captures=${captures}`;
        // `networkidle` rather than `load`: a panel fetches its own captions and
        // sets its capture from them, so the image request does not exist yet
        // when `load` fires. Checking `document.images` before that would find
        // an empty list and call an unfinished panel complete.
        await page.goto(`${origin}${panel.urlPath}${query}`, { waitUntil: "networkidle" });

        const file = outFile(out, slot.id, locale, panel.slug);
        const missing = await settle(page);
        if (missing.length) {
          result.incomplete.push({ where: file.replace(/\.png$/, ""), missing });
          if (!incomplete) continue;
        }

        const shot = await page.screenshot({ type: "png" });
        await sharp(shot)
          .flatten({ background: "#ffffff" })
          .toColorspace("srgb")
          .withIccProfile("srgb")
          .png({ compressionLevel: 9 })
          .toFile(join(out.base, file));
        result.written.push(file);
      }

      await context.close();
    }
  }

  return result;
}
