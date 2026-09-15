/**
 * The panel set: what the tool learns about a folder holding `panels/` from
 * names and one optional file — where it is, its locales, its captures, its
 * output. What a panel, a strings file or a stylesheet says is never read here.
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { searchForWorkspaceRoot } from "vite";
import { urlPathFor } from "./panels.ts";
import { SLOTS } from "./slots.ts";

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
 * paths relative to the set. `captures` is a pattern: `{device}` is the slot id
 * and `{locale}`, when present, makes the captures per locale. A pattern
 * without `{device}` is a folder holding one folder per slot.
 */
const DEFAULTS = { captures: "captures/{device}", out: "out" };

/** The placeholders a `captures` pattern may use. */
const PLACEHOLDERS = ["{device}", "{locale}"];

/** A set as the commands use it: where it is and what its names say. */
export interface PanelSet {
  /** Absolute path of the folder holding `panels/`. */
  dir: string;
  /** The server root: the repository the set sits in. */
  root: string;
  /** Whether a `recadro.json` was found; everything below is a default otherwise. */
  configured: boolean;
  /** The captures pattern, relative to `dir`, placeholders unfilled. */
  captures: string;
  /** Absolute path renders go to unless `--out` says otherwise. */
  outDir: string;
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
    config[key as keyof typeof DEFAULTS] = value;
  }

  for (const placeholder of config.captures.match(/\{[^}]*\}/g) ?? []) {
    if (!PLACEHOLDERS.includes(placeholder)) {
      throw new Error(`${file}: "captures" has ${placeholder}; the placeholders are ${PLACEHOLDERS.join(" and ")}`);
    }
  }
  // Every slot has captures of its own; a folder named without {device} holds
  // them one folder per slot, as the set's own captures/ does.
  if (!config.captures.includes("{device}")) {
    config.captures = `${config.captures.replace(/\/+$/, "")}/{device}`;
  }
  return { configured: true, ...config };
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

  return { dir, root, configured, captures, outDir: resolve(dir, out), locales: localesIn(dir) };
}

/** The absolute folder holding one slot's captures in one locale. */
export function capturesDir(set: PanelSet, device: string, locale: string): string {
  return resolve(set.dir, set.captures.replaceAll("{locale}", locale).replaceAll("{device}", device));
}

/**
 * The captures folder as the URL a page is given in `?captures=`, root-absolute
 * with a trailing slash so a page appends a filename. Left with `{device}` and
 * `{locale}` in it when no slot and locale are given, for the lineup
 * to fill.
 */
export function capturesUrl(set: PanelSet, device = "{device}", locale = "{locale}"): string {
  return `${urlPathFor(set.root, capturesDir(set, device, locale))}/`;
}

/**
 * The slots worth rendering by default: those with a captures folder for at
 * least one of `locales`. A set with no captures folder at all — text-only, or
 * not captured yet — gets every slot, so it still renders.
 */
export function devicesWithCaptures(set: PanelSet, locales: readonly string[]): string[] {
  const found = SLOTS.filter((slot) => locales.some((locale) => existsSync(capturesDir(set, slot.id, locale))));
  return found.map((slot) => slot.id);
}

/**
 * The static part of the captures pattern — everything before the first
 * placeholder — as an absolute folder. `dev` watches below it.
 */
export function capturesBase(set: PanelSet): string {
  const segments = set.captures.split(/[\\/]/);
  const first = segments.findIndex((segment) => segment.includes("{"));
  return resolve(set.dir, segments.slice(0, first).join("/"));
}
