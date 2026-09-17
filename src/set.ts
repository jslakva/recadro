/**
 * The panel set: what the tool learns about a folder holding `panels/` from
 * names and one optional file — where it is, its locales, its captures, its
 * output. What a panel, a strings file or a stylesheet says is never read here.
 */
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { searchForWorkspaceRoot } from "vite";
import { urlPathFor } from "./panels.ts";
import { imageSize } from "./shape.ts";
import { SLOTS, slotForShape } from "./slots.ts";

/** A panel file as discovery counts it: a number prefix, a slug, `.html`. */
const PANEL_FILE = /^\d+-.+\.html$/;

/**
 * An entry in `strings/` that names a locale — `en-US.json`, `de-DE.md`, `ja`,
 * `zh-Hans.json`. The extension and the contents are the page's business; only
 * the name before the extension counts.
 */
const LOCALE_NAME = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** The locale a set without `strings/` renders in. */
export const DEFAULT_LOCALE = "en-US";

/** Folders discovery never looks inside: dependencies and build output. Hidden folders are skipped too. */
const SKIPPED = new Set(["node_modules", "Pods", "DerivedData", "build", "dist"]);

/** How many levels below the working directory discovery looks for a set. */
const SEARCH_DEPTH = 6;

/** The name of the set's one optional file. */
export const CONFIG_FILE = "recadro.json";

/**
 * Every key `recadro.json` takes, with the value a set without it gets. Both are
 * paths relative to the set. `captures` is a folder, read by the names below
 * it. `out` is a pattern: `{locale}` is a folder per locale, and `{device}`,
 * when present, a folder per slot inside or outside it; without it the slot
 * goes in the filename.
 */
const DEFAULTS = { captures: "captures", out: "out/{locale}" };

/** The placeholders an `out` pattern may use. */
const PLACEHOLDERS = ["{locale}", "{device}"];

/** A file counted as a capture: what a simulator or a capture flow writes and a page can show. */
export const CAPTURE_FILE = /\.(png|jpe?g|webp)$/i;

/**
 * Where renders go. `base` is the static part of the `out` pattern, absolute,
 * which `--out` replaces; `layout` is the rest, from `{locale}` on, which the
 * pattern keeps: `{locale}`, `{locale}/{device}` or `{device}/{locale}`.
 */
export interface OutLayout {
  base: string;
  layout: string;
}

/** A set as the commands use it: where it is and what its names say. */
export interface PanelSet {
  /** Absolute path of the folder holding `panels/`. */
  dir: string;
  /** The server root: the repository the set sits in. */
  root: string;
  /** Whether a `recadro.json` was found; everything below is a default otherwise. */
  configured: boolean;
  /** The captures folder, relative to `dir`, as configured. */
  captures: string;
  /** Where renders go: the folder, and the layout of locale and slot below it. */
  out: OutLayout;
  /** Locales named in `strings/`, sorted; empty when it names none. */
  locales: string[];
}

/**
 * The server root for a path: the repository it sits in.
 *
 * Derived rather than flagged, and it has to be the repository rather than
 * anything narrower, because a panel reaches for captures and stylesheets
 * wherever the repo keeps them — `../../maestro/screenshots`, a web app's
 * tokens — and a URL cannot climb above root. The nearest `.git` (a directory,
 * or a file in a worktree or submodule) marks it.
 *
 * vite's `searchForWorkspaceRoot` alone is not enough: it stops at a JS
 * workspace or the nearest `package.json`, and a native iOS repo has neither,
 * which would leave the root at the set itself. It is the fallback outside git.
 */
export function rootFor(path: string): string {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return searchForWorkspaceRoot(path);
  }
}

/** Lists a folder, or nothing when it cannot be read. */
function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Whether `dir` is a set: it holds `panels/` with at least one `NN-slug.html`. */
function isSet(dir: string): boolean {
  return entries(join(dir, "panels")).some((entry) => entry.isFile() && PANEL_FILE.test(entry.name));
}

/**
 * Finds the set to use when no `--panels` is given.
 *
 * The working directory, or the nearest folder above it within the repository,
 * wins when it is a set — so a command run from `panels/` or `strings/` means
 * the set around it. Otherwise discovery looks below, up to `SEARCH_DEPTH`
 * levels, skipping hidden folders, dependencies and build output. One set found
 * is used; none or several is an error that says what to pass instead.
 */
export function findSet(cwd: string): string {
  const root = rootFor(cwd);
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (isSet(dir)) return dir;
    if (dir === root || dirname(dir) === dir) break;
  }

  const found: string[] = [];
  let level = [cwd];
  for (let depth = 0; depth < SEARCH_DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const entry of entries(dir)) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED.has(entry.name)) continue;
        const child = join(dir, entry.name);
        if (isSet(child)) found.push(child);
        else next.push(child);
      }
    }
    level = next;
  }

  if (found.length === 1) return found[0];
  if (!found.length) {
    throw new Error(
      `no panel set in ${cwd} or below it. A set is a folder holding panels/NN-slug.html; pass --panels <dir>.`,
    );
  }
  const options = found.sort().map((dir) => `  --panels ${relative(cwd, dir)}`);
  throw new Error(`${found.length} panel sets found; pick one:\n${options.join("\n")}`);
}

/**
 * Reads `recadro.json` beside `panels/`, or returns the defaults when there is
 * none. Strict on purpose: a mistyped key or placeholder that was quietly
 * ignored would look exactly like captures that do not exist yet.
 */
function readConfig(dir: string): { configured: boolean; captures: string; out: string } {
  const file = join(dir, CONFIG_FILE);
  if (!existsSync(file)) return { configured: false, ...DEFAULTS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file}: expected an object`);
  }

  const config = { ...DEFAULTS };
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in DEFAULTS)) {
      throw new Error(`${file}: unknown key "${key}"; ${CONFIG_FILE} takes ${Object.keys(DEFAULTS).join(", ")}`);
    }
    if (typeof value !== "string" || !value.trim()) throw new Error(`${file}: "${key}" must be a path`);
    config[key as keyof typeof DEFAULTS] = value.replace(/\/+$/, "");
  }

  if (config.captures.includes("{")) {
    throw new Error(
      `${file}: "captures" is a folder, with no placeholders; its locale and device folders are read by name`,
    );
  }
  for (const placeholder of config.out.match(/\{[^}]*\}/g) ?? []) {
    if (!PLACEHOLDERS.includes(placeholder)) {
      throw new Error(`${file}: "out" has ${placeholder}; the placeholders are ${PLACEHOLDERS.join(" and ")}`);
    }
  }
  // Renders are per locale whatever the pattern says, so a folder named without
  // {locale} holds one folder per locale, as the default does.
  if (!config.out.includes("{locale}")) config.out = `${config.out}/{locale}`;
  return { configured: true, ...config };
}

/**
 * Splits an `out` pattern into the static folder before its first placeholder
 * and the layout from there on, so `--out` can replace the one and keep the
 * other. A placeholder inside a folder name (`renders-{locale}`) is refused:
 * the layout is folders, one per locale and per slot.
 */
function outLayout(dir: string, pattern: string): OutLayout {
  const segments = pattern.split(/[\\/]/);
  const first = segments.findIndex((segment) => segment.includes("{"));
  const layout = segments.slice(first);
  if (layout.some((segment) => segment !== "{locale}" && segment !== "{device}")) {
    throw new Error(`${join(dir, CONFIG_FILE)}: "out" ${pattern}: {locale} and {device} must each be a whole folder name`);
  }
  return { base: resolve(dir, segments.slice(0, first).join("/")), layout: layout.join("/") };
}

/**
 * The locales `strings/` names, sorted: its files without their extension, and
 * its folders. Symlinks count, so a strings file other tooling reads where it
 * is can be linked into the set rather than moved.
 */
function localesIn(dir: string): string[] {
  const names = entries(join(dir, "strings"))
    .map((entry) => (entry.isDirectory() ? entry.name : entry.name.replace(/\.[^.]+$/, "")))
    .filter((name) => LOCALE_NAME.test(name));
  return [...new Set(names)].sort();
}

/**
 * Loads the set at `dir`. Throws when its captures would resolve outside the
 * server root, where no page could load them.
 */
export function loadSet(dir: string): PanelSet {
  const root = rootFor(dir);
  const { configured, captures, out } = readConfig(dir);

  const capturesAt = resolve(dir, captures);
  const fromRoot = relative(root, capturesAt);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`captures resolve to ${capturesAt}, outside the server root ${root}; a page cannot load them`);
  }

  return { dir, root, configured, captures, out: outLayout(dir, out), locales: localesIn(dir) };
}

/** Whether `path` is a folder. */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The captures directly in `dir`, in filename order, numbers compared as numbers. */
export function capturesIn(dir: string): string[] {
  return entries(dir)
    .filter((entry) => entry.isFile() && CAPTURE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** How many captures in a folder are shaped for each slot, in `SLOTS` order; slots with none left out. */
export function shapesIn(dir: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of capturesIn(dir)) {
    const size = imageSize(join(dir, name));
    if (!size) continue;
    const id = slotForShape(size.width, size.height).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Map(SLOTS.filter((slot) => counts.has(slot.id)).map((slot) => [slot.id, counts.get(slot.id)!]));
}

/**
 * The slot a folder of captures serves, told by their shape: the slot most of
 * them are nearest to. Null for a folder with no captures in it. A folder
 * serves one slot; two devices' captures go in a folder each.
 */
export function slotOf(dir: string): string | null {
  let best: [string, number] | null = null;
  for (const entry of shapesIn(dir)) if (!best || entry[1] > best[1]) best = entry;
  return best?.[0] ?? null;
}

/** The absolute captures folder. `dev` watches below it. */
export function capturesBase(set: PanelSet): string {
  return resolve(set.dir, set.captures);
}

/**
 * The folder holding one slot's captures in one locale, absolute.
 *
 * Read from names below the captures folder: a folder named for the locale, a
 * folder named for the slot, either inside the other, and each optional. A
 * folder that names no slot serves the one its captures are shaped for. The
 * most specific folder that exists wins; when none does, the folder where
 * they would go, so a missing capture is reported at a path that makes sense.
 */
export function capturesDir(set: PanelSet, device: string, locale: string): string {
  const base = capturesBase(set);
  const candidates: string[][] = [[locale, device], [device, locale], [locale], [device], []];
  for (const parts of candidates) {
    const dir = join(base, ...parts);
    if (!isDir(dir)) continue;
    if (parts.includes(device) || slotOf(dir) === device) return dir;
  }
  return isDir(join(base, locale)) ? join(base, locale, device) : join(base, device);
}

/**
 * The captures folder as the URL a page is given in `?captures=`, root-absolute
 * with a trailing slash so a page appends a filename.
 */
export function capturesUrl(set: PanelSet, device: string, locale: string): string {
  return `${urlPathFor(set.root, capturesDir(set, device, locale))}/`;
}

/** Every slot and locale's `?captures=` URL, keyed by slot then locale: what the lineup fills its frames from. */
export function capturesUrls(set: PanelSet, locales: readonly string[]): Record<string, Record<string, string>> {
  return Object.fromEntries(
    SLOTS.map((slot) => [slot.id, Object.fromEntries(locales.map((locale) => [locale, capturesUrl(set, slot.id, locale)]))]),
  );
}

/**
 * The slots worth rendering by default: those with captures for at least one
 * of `locales`, in a folder named for the slot or one shaped for it. A set
 * with no captures at all — text-only, or not captured yet — gets every slot,
 * so it still renders.
 */
export function devicesWithCaptures(set: PanelSet, locales: readonly string[]): string[] {
  const found = SLOTS.filter((slot) => locales.some((locale) => isDir(capturesDir(set, slot.id, locale))));
  return found.map((slot) => slot.id);
}

/**
 * How the captures are laid out, for the line a command prints: each slot
 * with captures and whether its folder is named or told by shape — and, in a
 * folder told by shape, how many captures are shaped for another slot, since
 * those are never found — and whether they are per locale. "none yet" for a
 * set without any.
 */
export function describeCaptures(set: PanelSet, locales: readonly string[]): string {
  const base = capturesBase(set);
  const found: string[] = [];
  let perLocale = false;
  for (const slot of SLOTS) {
    const dirs = [...new Set(locales.map((locale) => capturesDir(set, slot.id, locale)).filter(isDir))];
    if (!dirs.length) continue;
    const parts = dirs.map((dir) => relative(base, dir).split(/[\\/]/));
    if (parts.some((p) => locales.some((locale) => p.includes(locale)))) perLocale = true;
    if (parts.some((p) => p.includes(slot.id))) {
      found.push(`${slot.id}/`);
      continue;
    }
    const odd = dirs.flatMap((dir) => [...shapesIn(dir)].filter(([id]) => id !== slot.id));
    const others = odd.length ? `; ${odd.map(([id, n]) => `${n} shaped for ${id}`).join(", ")}, never found` : "";
    found.push(`${slot.id} by shape${others}`);
  }
  if (!found.length) return "none yet";
  return `${found.join(", ")}${perLocale ? ", per locale" : ""}`;
}

/** The file one render is written to, relative to `out.base`: the slot is a folder when the layout names it, else the filename's prefix. */
export function outFile(out: OutLayout, device: string, locale: string, slug: string): string {
  return outTemplate(out).replaceAll("{locale}", locale).replaceAll("{device}", device).replaceAll("{slug}", slug);
}

/** `outFile` with its placeholders unfilled, for the lineup to fill: `{locale}/{device}-{slug}.png`. */
export function outTemplate(out: OutLayout): string {
  return `${out.layout}/${out.layout.includes("{device}") ? "{slug}.png" : "{device}-{slug}.png"}`;
}
