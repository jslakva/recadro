/**
 * `init`: a new set copied from a starter. A starter is a premade set in the
 * package; the copy is plain except for `{capture:N}`, filled with the Nth
 * capture already taken, so the panels open showing the app's own screens.
 * Where `init` runs goes the `recadro.json` naming the set, so recadro runs
 * from there with no flag.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { PKG } from "./pkg.ts";
import { capturesDir, capturesIn, DEFAULT_LOCALE, loadSet } from "./set.ts";
import { SLOTS } from "./slots.ts";

/** Where the starters ship: one folder per starter, named for it. */
export const STARTERS_DIR = join(PKG, "starters");

/** A placeholder for the Nth capture, counted from 1 in filename order. */
const CAPTURE_PLACEHOLDER = /\{capture:(\d+)\}/g;

/** The files a placeholder is filled in; anything else is copied byte for byte. */
const TEXT_FILES = new Set([".html", ".css", ".js", ".json", ".md", ".txt"]);


/**
 * Where the package's skill goes in a consumer's repository, from its root.
 * The file is composed here: the package's `skills/recadro/SKILL.md` — how to
 * run the `live` loop — with the installed AUTHORING.md whole beneath it, so
 * invoking the skill loads every rule and nothing has to be found first. A
 * stamp names the version it came from, so `init` can tell one that is behind
 * and `dev` can say so.
 */
export const SKILL_PATH = join(".claude", "skills", "recadro", "SKILL.md");

/** The version of this package, from its own package.json. */
export const VERSION: string = (JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { version: string }).version;

/** The stamp line the composed skill carries, right under its frontmatter. */
const STAMP = /^<!-- written by recadro (\S+); .* -->$/m;

/** The version an installed skill was written from, or null for none or one without a stamp. */
export function skillVersion(root: string): string | null {
  try {
    return readFileSync(join(root, SKILL_PATH), "utf8").match(STAMP)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes the composed skill into a repository, over one already there, and
 * returns the version that one was written from: null for none, or for a
 * file without a stamp. Whether to write over it is the caller's call.
 */
export function installSkill(root: string): string | null {
  const target = join(root, SKILL_PATH);
  const from = skillVersion(root);
  const loop = readFileSync(join(PKG, "skills", "recadro", "SKILL.md"), "utf8");
  // The document's one relative link points at a file that is not beside the skill.
  const authoring = readFileSync(join(PKG, "AUTHORING.md"), "utf8").replace("](README.md)", "](https://github.com/jslakva/recadro#readme)");
  const stamp = `<!-- written by recadro ${VERSION}; recadro skill rewrites it from the installed version -->`;
  const composed =
    loop.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n${stamp}\n`) +
    `\n---\n\nThe rest of this file is recadro ${VERSION}'s AUTHORING.md, as installed.\n\n` +
    authoring;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, composed);
  return from;
}

/** What `init` was asked to make. */
export interface InitOptions {
  /** Absolute path of the new set; it must not exist or be empty. */
  dir: string;
  /** The starter's name, a folder in `STARTERS_DIR`. */
  starter: string;
  /** Absolute path of the `recadro.json` to write, in the folder `init` runs in; it must not exist. */
  config: string;
  /** The captures folder for `recadro.json`, relative to its folder, when captures are not in the set's own `captures/`. */
  captures?: string;
}

/** What `init` did, for the caller's summary. */
export interface InitResult {
  /** The captures filled in, in the order `{capture:N}` counts them. */
  captures: string[];
  /** The slot folder they were listed from, or null when there were none. */
  capturesFrom: string | null;
  /** Placeholder numbers the copy left unfilled, for want of that many captures. */
  unfilled: number[];
}

/**
 * The starter `init` takes when Enter answers its question: the one with no
 * look, so the choice made by not choosing commits a set to nothing.
 */
export const DEFAULT_STARTER = "blank";

/** The starters that ship, by name. */
export function listStarters(): string[] {
  return readdirSync(STARTERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The captures already taken, in filename order, from the first slot that has
 * any. Every slot is expected to hold the same filenames, since a capture flow
 * runs the same steps per device. Captures per locale are read for the default
 * locale, the one the starters' strings are written in.
 */
function capturesTaken(config: string): { files: string[]; from: string | null } {
  const set = loadSet(config);
  for (const slot of SLOTS) {
    const files = capturesIn(capturesDir(set, slot.id, DEFAULT_LOCALE));
    if (files.length) return { files, from: slot.id };
  }
  return { files: [], from: null };
}

/** Copies `from` into `to`, filling capture placeholders in text files and noting the ones left. */
function copyStarter(from: string, to: string, captures: string[], unfilled: Set<number>): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      copyStarter(source, target, captures, unfilled);
    } else if (TEXT_FILES.has(extname(entry.name))) {
      const text = readFileSync(source, "utf8").replace(CAPTURE_PLACEHOLDER, (placeholder, n: string) => {
        const file = captures[Number(n) - 1];
        if (!file) unfilled.add(Number(n));
        return file ?? placeholder;
      });
      writeFileSync(target, text);
    } else {
      copyFileSync(source, target);
    }
  }
}

/**
 * Creates a set from a starter. Refuses a folder that already holds anything,
 * so it never mixes with or overwrites a set, and a `recadro.json` already
 * where it runs, since that folder has its set: a second one is made from
 * another folder. The file is written and read back before anything is
 * copied, so its paths are checked first; a failure removes what was made.
 */
export function initSet(options: InitOptions): InitResult {
  const { dir, starter, config, captures } = options;
  const source = join(STARTERS_DIR, starter);
  if (!existsSync(source)) {
    throw new Error(`no starter "${starter}". Starters: ${listStarters().join(", ")}`);
  }
  if (existsSync(config)) {
    throw new Error(`${config} already names the set at ${loadSet(config).dir}; a second set is made from another folder`);
  }
  const existed = existsSync(dir);
  if (existed && readdirSync(dir).length) throw new Error(`${dir} is not empty; init makes a new set`);

  // The set's path is left out when the set is the file's own folder, the default.
  const set = relative(dirname(config), dir).split(sep).join("/");
  const written = { ...(set && set !== "." ? { set } : {}), ...(captures ? { captures } : {}) };
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(config, `${JSON.stringify(written, null, 2)}\n`);
    const taken = capturesTaken(config);
    const unfilled = new Set<number>();
    copyStarter(source, dir, taken.files, unfilled);
    return { captures: taken.files, capturesFrom: taken.from, unfilled: [...unfilled].sort((a, b) => a - b) };
  } catch (error) {
    rmSync(config, { force: true });
    rmSync(dir, { recursive: true, force: true });
    if (existed) mkdirSync(dir);
    throw error;
  }
}
