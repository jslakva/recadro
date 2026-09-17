/**
 * `init`: a new set copied from a starter. A starter is a premade set in the
 * package; the copy is plain except for `{capture:N}`, filled with the Nth
 * capture already taken, so the panels open showing the app's own screens.
 * Beside it go two agent files pointing at the package's AUTHORING.md.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
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

/**
 * The agent files `init` writes into a set, by name. Agents that read an
 * instruction file in a subfolder load one when they work in the set: Cursor
 * reads `AGENTS.md`, Claude Code only `CLAUDE.md`, which imports it. They point
 * at AUTHORING.md rather than import it, because where the package is
 * installed relative to the set is unknown when `init` runs, and a wrong import
 * loads nothing. recadro never reads them.
 */
export const AGENT_FILES: Record<string, string> = {
  "AGENTS.md": `# A recadro panel set

This folder is a set of App Store screenshot panels that
[recadro](https://github.com/jslakva/recadro) renders. Before changing anything
in it, read \`AUTHORING.md\` in the installed recadro package, usually
\`node_modules/recadro/AUTHORING.md\`: the instructions for coding agents,
versioned with the tool. Where recadro is not installed, read it on GitHub:
https://github.com/jslakva/recadro/blob/main/AUTHORING.md

\`recadro init\` wrote this file and \`CLAUDE.md\`; recadro never reads either.
`,
  "CLAUDE.md": "@AGENTS.md\n",
};

/**
 * Where the package's skill goes in a consumer's repository, from its root.
 * The file is composed here: the package's `skills/recadro/SKILL.md` — how to
 * run the `live` loop — with the installed AUTHORING.md whole beneath it, so
 * invoking the skill loads every rule and nothing has to be found first. A
 * stamp names the version it came from; `--skill` rewrites it when that is
 * not the installed one.
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

/** What `installSkill` did: written afresh, kept as it was, or rewritten from an older version. */
export type SkillState = { state: "written" } | { state: "kept" } | { state: "refreshed"; from: string };

/**
 * Writes the composed skill into a repository. One already there from this
 * version is kept; one from another version is rewritten, since it is the
 * tool's own file and the document under the loop has moved on.
 */
export function installSkill(root: string): SkillState {
  const target = join(root, SKILL_PATH);
  const from = skillVersion(root);
  if (from === VERSION) return { state: "kept" };
  const loop = readFileSync(join(PKG, "skills", "recadro", "SKILL.md"), "utf8");
  // The document's one relative link points at a file that is not beside the skill.
  const authoring = readFileSync(join(PKG, "AUTHORING.md"), "utf8").replace("](README.md)", "](https://github.com/jslakva/recadro#readme)");
  const stamp = `<!-- written by recadro ${VERSION}; recadro init <set> --skill rewrites it from the installed version -->`;
  const composed =
    loop.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n${stamp}\n`) +
    `\n---\n\nThe rest of this file is recadro ${VERSION}'s AUTHORING.md, as installed.\n\n` +
    authoring;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, composed);
  return from ? { state: "refreshed", from } : { state: "written" };
}

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
    for (const [name, text] of Object.entries(AGENT_FILES)) writeFileSync(join(dir, name), text);
    return { captures: taken.files, capturesFrom: taken.from, unfilled: [...unfilled].sort((a, b) => a - b) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if (existed) mkdirSync(dir);
    throw error;
  }
}
