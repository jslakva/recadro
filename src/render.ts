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
import { CREATIVE, viewportFor, type Slot, type SlotKind } from "./slots.ts";

/** Everything one render pass needs. */
export interface RenderOptions {
  /** The browser to shoot in, from `launchBrowser`; the caller closes it. */
  browser: Browser;
  /** Origin of the running server, from `startServer`. */
  origin: string;
  /** Panels to attempt, in filename order. */
  panels: Panel[];
  /** Slots to render each panel into. */
  slots: SlotKind[];
  /** The geometry a panel is shot at on a slot: which display, and which way up. */
  slotFor: (id: string, slug: string) => Slot;
  /** Locale codes: the output folder names under each slot, and the page's `?locale=`. */
  locales: string[];
  /** The page's `?captures=` for one slot and locale: a root-absolute folder URL. */
  capturesUrl: (device: string, locale: string) => string;
  /** Where renders go: the folder and the layout below it, `<out>/<locale>/<device>-<slug>.png` by default. */
  out: OutLayout;
  /** The creative assets' pages, each with the placement it is shot at; none to shoot when absent. */
  creative?: { panel: Panel; placement: Slot }[];
  /** The `?captures=` a creative asset's page gets for one locale. */
  creativeCapturesUrl?: (locale: string) => string;
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
   * Panels that asked for a capture the server did not have, as the file they
   * would have been written to, with the paths asked for. Skipped, or written
   * anyway under `incomplete`.
   */
  incomplete: { where: string; missing: string[] }[];
}

/**
 * What a page asked for under its captures folder and did not get.
 *
 * "Complete" is deliberately not a contract the page implements, and nothing
 * of the page is read for it: the tool watches the one URL it owns. It handed
 * the page a `?captures=` folder, so a request below that folder is a capture
 * request, and one answered with anything but the file — a 404 for a capture
 * not taken yet, a redirect, a failed connection — is a capture the panel
 * wanted and did not get. A 304 is the file: the browser had it from an
 * earlier panel in the same context and the server said so. How the page
 * shows a miss is its business, in the lineup.
 *
 * A panel that asks for no capture, a text-only story panel, has nothing to
 * miss and is complete; a panel that swaps a failed capture for a placeholder
 * still asked, and the answer was still seen. How the page loads a capture —
 * an `<img>`, a CSS `url()`, a `fetch` for a canvas — makes no difference.
 *
 * A request the page itself cancelled, by changing an `<img>`'s `src` while
 * the first was in flight, says nothing about the file, so an abort is not a
 * miss. Anything else that fails is.
 *
 * A miss is reported as a path in the repository, decoded, the way the
 * lineup's pointer names one: the server's origin and port mean nothing to
 * the reader, and `%7Bcapture%3A5%7D` hides a placeholder nobody filled.
 */
class CaptureRequests {
  private prefix = "";
  private missing = new Set<string>();

  constructor(page: Page) {
    page.on("response", (response) => {
      const status = response.status();
      if ((status < 200 || status >= 300) && status !== 304) this.note(response.url());
    });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") this.note(request.url());
    });
  }

  /** Starts collecting for the next page, given its `?captures=` folder. */
  watch(capturesPath: string): void {
    this.prefix = capturesPath;
    this.missing.clear();
  }

  /** The captures asked for and not got since `watch`, in request order. */
  report(): string[] {
    return [...this.missing];
  }

  private note(url: string): void {
    const path = decoded(new URL(url).pathname);
    if (path.startsWith(this.prefix)) this.missing.add(path.slice(1));
  }
}

/** A URL path as the reader sees it: percent-decoded where that decodes. */
function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Waits for the page to be finished: fonts are awaited here, or the first
 * panel ships in a fallback face.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Removes what an earlier render wrote for this slot and locale: the folder
 * when the layout gives the slot one, else this slot's files in the locale's
 * folder, the other slot's left alone. Emptied before a render into it, so a
 * panel deleted from the set cannot survive as a stale PNG that an upload
 * would still find and ship.
 */
function clear(out: OutLayout, device: string, locale: string): string {
  const dir = join(out.base, dirname(outFile(out, device, locale, "x")));
  if (out.layout.includes("{device}")) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    const prefix = `${device}-`;
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

/** Shoots the page open in `page` to `file` under `out.base`: flattened onto white, stamped sRGB, no alpha. */
async function shoot(page: Page, out: OutLayout, file: string): Promise<void> {
  const shot = await page.screenshot({ type: "png" });
  await sharp(shot)
    .flatten({ background: "#ffffff" })
    .toColorspace("srgb")
    .withIccProfile("srgb")
    .png({ compressionLevel: 9 })
    .toFile(join(out.base, file));
}

/**
 * Renders every slot x locale x panel whose capture exists, then every
 * creative asset per locale, or every one at all under `incomplete`.
 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  const { browser, origin, panels, slots, slotFor, locales, capturesUrl, out, incomplete = false } = options;
  const { creative = [], creativeCapturesUrl } = options;
  const result: RenderResult = { written: [], incomplete: [] };

  for (const kind of slots) {
    for (const locale of locales) {
      clear(out, kind.id, locale);

      // One browser context per shape the slot's panels are shot at: most
      // sets have one, and a panel with its own shape gets a context of its own.
      const byShape = new Map<string, { slot: Slot; panels: Panel[] }>();
      for (const panel of panels) {
        const slot = slotFor(kind.id, panel.slug);
        const key = `${slot.width}x${slot.height}`;
        const group = byShape.get(key) ?? byShape.set(key, { slot, panels: [] }).get(key)!;
        group.panels.push(panel);
      }

      const capturesPath = capturesUrl(kind.id, locale);
      const captures = encodeURIComponent(capturesPath);
      for (const { slot, panels: shapedPanels } of byShape.values()) {
        const context = await browser.newContext({
          viewport: viewportFor(slot),
          deviceScaleFactor: slot.scale,
          locale,
        });
        const page = await context.newPage();
        const requests = new CaptureRequests(page);

        for (const panel of shapedPanels) {
          const query =
            `?panel=${panel.slug}&device=${encodeURIComponent(kind.id)}&locale=${locale}&captures=${captures}`;
          // `networkidle` rather than `load`: a panel fetches its own captions and
          // sets its capture from them, so the capture request does not exist yet
          // when `load` fires, and a page asked before it had asked for anything
          // would be called complete.
          requests.watch(decoded(capturesPath));
          await page.goto(`${origin}${panel.urlPath}${query}`, { waitUntil: "networkidle" });
          await settle(page);

          const file = outFile(out, kind.id, locale, panel.slug);
          const missing = requests.report();
          if (missing.length) {
            result.incomplete.push({ where: file.replace(/\.png$/, ""), missing });
            if (!incomplete) continue;
          }

          await shoot(page, out, file);
          result.written.push(file);
        }

        await context.close();
      }
    }
  }

  // The creative assets: one image per placement and locale, each page at its
  // own size, named like a slot's panels under the one name they share.
  for (const locale of creative.length && creativeCapturesUrl ? locales : []) {
    clear(out, CREATIVE, locale);
    const capturesPath = creativeCapturesUrl!(locale);
    for (const { panel, placement } of creative) {
      const context = await browser.newContext({ viewport: viewportFor(placement), deviceScaleFactor: placement.scale, locale });
      const page = await context.newPage();
      const requests = new CaptureRequests(page);
      const query =
        `?panel=${panel.slug}&device=${placement.id}&locale=${locale}&captures=${encodeURIComponent(capturesPath)}`;
      requests.watch(decoded(capturesPath));
      await page.goto(`${origin}${panel.urlPath}${query}`, { waitUntil: "networkidle" });
      await settle(page);

      const file = outFile(out, CREATIVE, locale, panel.slug);
      const missing = requests.report();
      if (missing.length) result.incomplete.push({ where: file.replace(/\.png$/, ""), missing });
      if (!missing.length || incomplete) {
        await shoot(page, out, file);
        result.written.push(file);
      }
      await context.close();
    }
  }

  return result;
}
