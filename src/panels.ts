/**
 * Panel discovery. A panel is an HTML file in `<panels>/panels/`, and the
 * filename carries everything: the number prefix is the order, the rest is the
 * slug, and the slug is the output basename. There is no manifest to keep in
 * step with the directory.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { CREATIVE, PLACEMENTS, type Slot } from "./slots.ts";

/** One discovered panel. */
export interface Panel {
  /** Filename without `.html` (e.g. `01-rehearse`); also the output basename. */
  slug: string;
  /** Absolute path to the HTML file. */
  file: string;
  /** Server path relative to the vite root, with a leading slash. */
  urlPath: string;
}

/** The root-absolute URL path of `file` on a server rooted at `root`. */
export function urlPathFor(root: string, file: string): string {
  return `/${relative(root, file).split("\\").join("/")}`;
}

/**
 * Lists the creative assets' pages under `panelsDir/creative/`, one per
 * placement, in `PLACEMENTS` order; none when the folder is absent. Throws on
 * a page named for no placement, which would otherwise never be shot. Files
 * that are not pages — a stylesheet, an image — are the set's own.
 */
export function discoverCreative(panelsDir: string, root: string): { panel: Panel; placement: Slot }[] {
  const dir = join(panelsDir, CREATIVE);
  if (!existsSync(dir)) return [];
  const pages = readdirSync(dir).filter((name) => name.endsWith(".html"));
  const ids = PLACEMENTS.map((placement) => placement.id);
  for (const name of pages) {
    const slug = name.slice(0, -".html".length);
    if (!ids.includes(slug)) {
      throw new Error(`${join(dir, name)}: ${CREATIVE}/ takes ${ids.map((id) => `${id}.html`).join(", ")}`);
    }
  }
  return PLACEMENTS.filter((placement) => pages.includes(`${placement.id}.html`)).map((placement) => {
    const file = join(dir, `${placement.id}.html`);
    return { panel: { slug: placement.id, file, urlPath: urlPathFor(root, file) }, placement };
  });
}

/**
 * Lists the panels under `panelsDir/panels/`, ordered by filename.
 *
 * `root` is the vite root the server was started on; the returned `urlPath` is
 * relative to it, so callers can navigate without knowing where on disk the
 * panels live. Throws when the directory is missing — an empty lineup is
 * indistinguishable from a mistyped `set` in `recadro.json`.
 */
export function discoverPanels(panelsDir: string, root: string): Panel[] {
  const dir = join(panelsDir, "panels");
  if (!existsSync(dir)) throw new Error(`no panels directory at ${dir}; "set" in recadro.json names the folder holding panels/`);

  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .sort()
    .map((name) => {
      const file = join(dir, name);
      return {
        slug: name.slice(0, -".html".length),
        file,
        urlPath: urlPathFor(root, file),
      };
    });
}
