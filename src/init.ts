/**
 * `init`: a new set copied from a starter. A starter is a premade set in the
 * package; the copy is plain except for `{capture:N}`, filled with the Nth
 * capture already taken, so the panels open showing the app's own screens.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { PKG } from "./pkg.ts";
import { capturesDir, CONFIG_FILE, DEFAULT_LOCALE, loadSet } from "./set.ts";
import { SLOTS } from "./slots.ts";

/** Where the starters ship: one folder per starter, named for it. */
export const STARTERS_DIR = join(PKG, "starters");

/** A placeholder for the Nth capture, counted from 1 in filename order. */
const CAPTURE_PLACEHOLDER = /\{capture:(\d+)\}/g;

/** The files a placeholder is filled in; anything else is copied byte for byte. */
const TEXT_FILES = new Set([".html", ".css", ".js", ".json", ".md", ".txt"]);

/** A file counted as a capture when listing the captures already taken. */
const CAPTURE_FILE = /\.(png|jpe?g|webp)$/i;

/** What `init` was asked to make. */
export interface InitOptions {
  /** Absolute path of the new set; it must not exist or be empty. */
  dir: string;
  /** The starter's name, a folder in `STARTERS_DIR`. */
  starter: string;
  /** A captures pattern for `recadro.json`, when captures are not in the set's own `captures/{device}`. */
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
 * runs the same steps per device. A per-locale pattern is read for the default
 * locale, the one the starters' strings are written in.
 */
function capturesTaken(dir: string): { files: string[]; from: string | null } {
  const set = loadSet(dir);
  for (const slot of SLOTS) {
    const folder = capturesDir(set, slot.id, DEFAULT_LOCALE);
    if (!existsSync(folder)) continue;
    const files = readdirSync(folder)
      .filter((name) => CAPTURE_FILE.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
 * so it never mixes with or overwrites a set. The captures pattern is written
 * and validated before anything is copied; a failure removes what was made.
 */
export function initSet(options: InitOptions): InitResult {
  const { dir, starter, captures } = options;
  const source = join(STARTERS_DIR, starter);
  if (!existsSync(source)) {
    throw new Error(`no starter "${starter}". Starters: ${listStarters().join(", ")}`);
  }
  const existed = existsSync(dir);
  if (existed && readdirSync(dir).length) throw new Error(`${dir} is not empty; init makes a new set`);

  mkdirSync(dir, { recursive: true });
  try {
    if (captures) writeFileSync(join(dir, CONFIG_FILE), `${JSON.stringify({ captures }, null, 2)}\n`);
    const taken = capturesTaken(dir);
    const unfilled = new Set<number>();
    copyStarter(source, dir, taken.files, unfilled);
    return { captures: taken.files, capturesFrom: taken.from, unfilled: [...unfilled].sort((a, b) => a - b) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if (existed) mkdirSync(dir);
    throw error;
  }
}
