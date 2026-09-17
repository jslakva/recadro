#!/usr/bin/env node
/**
 * recadro — App Store screenshots as code.
 *
 * `init` copies a starter into a new set. `dev` and `render` drive one vite
 * server: `dev` opens the lineup and watches, `render` shoots the same
 * URLs at slot pixels. `wait` and `reply` are an agent's side of `dev --live`:
 * notes pinned in the lineup, and one line back. Flags win over the set's
 * `recadro.json`, which wins over the set's conventions.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type { Browser } from "playwright";
import { AGENT_FILES, initSet, installSkill, listStarters, SKILL_PATH } from "./init.ts";
import { startServer } from "./server.ts";
import {
  capturesUrl,
  CONFIG_FILE,
  DEFAULT_LOCALE,
  devicesWithCaptures,
  findSet,
  loadSet,
  type PanelSet,
} from "./set.ts";
import { SLOTS, selectSlots } from "./slots.ts";
import { reply, wait } from "./wait.ts";

const USAGE = `recadro — App Store screenshots as code

  recadro init   <dir> --starter <name> [--captures <pattern>] [--skill | --no-skill]
  recadro dev    [--panels <dir>] [--port <n>] [--live]
  recadro render [--panels <dir>] [--out <dir>] [--devices iPhone,iPad] [--locales en-US] [--incomplete]
  recadro wait   [--panels <dir>]
  recadro reply  <id> "<what you changed>" [--panels <dir>]

  --starter     init: the starter to copy          (${listStarters().join(", ")})
  --captures    init: the folder holding a folder per device, from here (written to ${CONFIG_FILE})
  --skill       init: add a /recadro skill for Claude Code at ${SKILL_PATH.split(sep).join("/")} without asking;
                on an existing set, init adds only the skill.  --no-skill: don't, and don't ask
  --live        dev: take notes pinned in the lineup, for an agent running \`recadro wait\`

  --panels      the set: a folder holding panels/       (default: found from here)
  --out         output directory       (default: ${CONFIG_FILE} "out", else <set>/out)
  --devices     slots to render        (default: those with a captures folder, else all)
  --locales     locales to render      (default: the names in <set>/strings/, else ${DEFAULT_LOCALE})
  --incomplete  shoot panels missing a capture too, to look at them;
                needs an --out other than the set's own
`;

/** Splits a comma-separated flag, dropping empty entries. */
function list(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/** A count with its noun, singular for one. */
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A path as the person running the command would type it: relative below here, absolute elsewhere. */
function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel || ".";
}

/** The locales to use, and where they came from, for the summary line. */
function localesFor(set: PanelSet, flag: string | undefined): { locales: string[]; from: string } {
  if (flag) return { locales: list(flag), from: "--locales" };
  if (set.locales.length) return { locales: set.locales, from: "strings/" };
  return { locales: [DEFAULT_LOCALE], from: "no strings/ yet" };
}

/**
 * The slots to render, and why. Without `--devices`, a slot is rendered when it
 * has a captures folder for one of the locales — so an iPhone-only app renders
 * no iPad panels — and every slot is rendered when none has one yet.
 */
function slotsFor(set: PanelSet, locales: string[], flag: string | undefined): { ids: string[]; from: string } {
  if (flag) return { ids: list(flag), from: "--devices" };
  const found = devicesWithCaptures(set, locales);
  if (!found.length) return { ids: SLOTS.map((s) => s.id), from: "no captures folders yet" };
  const missing = SLOTS.filter((s) => !found.includes(s.id)).map((s) => s.id);
  return { ids: found, from: missing.length ? `no captures folder for ${missing.join(", ")}` : "captures folders" };
}

/** Asks a yes-or-no question on the terminal; Enter alone is yes, Ctrl+C quits. */
async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  prompt.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    const answer = (await prompt.question(`${question} [Y/n] `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
}

/**
 * The browser for a render pass. Playwright's Chromium installs apart from the
 * package, so it can be missing: at a terminal, render asks to install it;
 * anywhere else — CI, an agent — it stops and names the command, since a
 * download that size is not render's to start unasked.
 *
 * Imported here rather than at the top so `dev` never loads Playwright:
 * it is the render pass's dependency, not the design loop's.
 */
async function openBrowser(): Promise<Browser> {
  const { INSTALL_COMMAND, installBrowser, launchBrowser } = await import("./browser.ts");
  const browser = await launchBrowser();
  if (browser) return browser;

  const missing = "render needs Playwright's Chromium, and the build it uses is not installed";
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${missing}; install it once with: ${INSTALL_COMMAND}`);
  }
  console.log(`${missing}.`);
  if (!(await confirm("Install it now?"))) throw new Error(`not installed; to install it later: ${INSTALL_COMMAND}`);
  await installBrowser();
  console.log("");
  const installed = await launchBrowser();
  if (!installed) throw new Error(`installed, but Playwright still finds no browser; try: ${INSTALL_COMMAND}`);
  return installed;
}

/**
 * Whether to add the `/recadro` skill to the repository, and the summary line
 * saying what happened. Asked at a terminal, Enter meaning yes, as `render`
 * asks about Chromium; anywhere else — an agent, CI — nothing is written and
 * the line names the flag, since a half-asked question helps nobody. A skill
 * already there is kept and not asked about.
 */
async function skillLine(root: string, dir: string, yes: boolean, no: boolean): Promise<string> {
  const target = join(root, SKILL_PATH);
  if (existsSync(target)) return `${shown(target)} (kept)`;
  const later = `recadro init ${shown(dir)} --skill`;
  if (no) return `not added; ${later} adds /recadro for Claude Code`;
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!yes && !tty) return `not added; ${later} adds /recadro for Claude Code`;
  if (!yes && !(await confirm(`Add a /recadro skill for Claude Code at ${shown(dirname(target))}/?`))) {
    return `not added; ${later} adds it later`;
  }
  installSkill(root);
  return shown(target);
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (!["init", "dev", "render", "wait", "reply"].includes(command)) {
    console.error(`unknown command "${command}"\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      starter: { type: "string" },
      captures: { type: "string" },
      panels: { type: "string" },
      out: { type: "string" },
      port: { type: "string" },
      devices: { type: "string" },
      locales: { type: "string" },
      incomplete: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      skill: { type: "boolean", default: false },
      "no-skill": { type: "boolean", default: false },
    },
  });

  if (command === "init") {
    const dir = positionals.length === 1 ? resolve(positionals[0]) : null;
    if (!dir || (!values.starter && !values.skill && !existsSync(join(dir, "panels")))) {
      throw new Error(
        `init takes a folder and a starter: recadro init <dir> --starter ${listStarters().join("|")}\n` +
          `or a set that exists, to add the /recadro skill to its repository: recadro init <dir> [--skill]`,
      );
    }
    // A set that exists: the skill is all there is to add, asked about as after a starter.
    if (!values.starter) {
      const set = loadSet(dir);
      console.log(`recadro  skill     ${await skillLine(set.root, dir, values.skill, values["no-skill"])}`);
      return;
    }
    // Given from where the command runs, like --panels and --out; recadro.json
    // holds it relative to the set, with forward slashes on every platform.
    const captures = values.captures && relative(dir, resolve(values.captures)).split(sep).join("/");
    const result = initSet({ dir, starter: values.starter, captures });
    const set = loadSet(dir);
    console.log(`recadro  ${shown(dir)} from the ${values.starter} starter`);
    console.log(`         captures  ${shown(resolve(set.dir, set.captures))}/`);
    if (result.capturesFrom) {
      const first = result.captures[0];
      const last = result.captures.at(-1);
      const range = result.captures.length > 1 ? `${first} … ${last}` : first;
      console.log(`         filled    ${counted(result.captures.length, "capture")} from ${result.capturesFrom}: ${range}`);
    } else {
      console.log("         filled    nothing: no captures taken yet");
    }
    if (result.unfilled.length) {
      const left = result.unfilled.map((n) => `{capture:${n}}`).join(", ");
      console.log(`         left      ${left} in strings/, for captures still to take`);
    }
    console.log(`         agents    ${Object.keys(AGENT_FILES).join(", ")}, pointing at recadro's AUTHORING.md`);
    console.log(`         skill     ${await skillLine(set.root, dir, values.skill, values["no-skill"])}`);
    console.log(`         next      recadro dev --panels ${shown(dir)}`);
    return;
  }

  if (command === "reply") {
    const [id, ...words] = positionals;
    if (!/^\d+$/.test(id ?? "") || !words.length) {
      throw new Error(`reply takes a note's id and one line: recadro reply <id> "<what you changed>"`);
    }
    const set = loadSet(values.panels ? resolve(values.panels) : findSet(process.cwd()));
    await reply(set.dir, shown(set.dir), Number(id), words.join(" "));
    return;
  }
  if (positionals.length) throw new Error(`${command} takes no ${positionals[0]}; name the set with --panels`);

  const set = loadSet(values.panels ? resolve(values.panels) : findSet(process.cwd()));
  const { locales, from: localesFrom } = localesFor(set, values.locales);
  const port = values.port ? Number(values.port) : undefined;

  if (command === "wait") {
    await wait(set.dir, shown(set.dir));
    return;
  }

  if (command === "dev") {
    const { origin, panels } = await startServer(set, { port, watchFetched: true, live: values.live });
    console.log(`recadro  ${counted(panels.length, "panel")} in ${shown(set.dir)}`);
    console.log(`         locales   ${locales.join(", ")}  (${localesFrom})`);
    console.log(`         captures  ${shown(resolve(set.dir, set.captures))}/`);
    console.log(`         lineup    ${origin}/`);
    if (values.live) console.log(`         live      recadro wait  (prints each note pinned in the lineup; recadro reply <id> "…" answers)`);
    return;
  }

  const outDir = values.out ? resolve(values.out) : set.outDir;
  // The set's out directory only ever holds complete panels, so whatever
  // uploads from it can take it wholesale. An incomplete shot there would ship
  // an empty frame.
  if (values.incomplete && outDir === set.outDir) {
    throw new Error(`--incomplete shoots panels that must not ship; pass an --out other than ${shown(set.outDir)}`);
  }
  const { ids, from: devicesFrom } = slotsFor(set, locales, values.devices);
  const slots = selectSlots(ids);

  // Before the server starts and anything is written, so a missing browser
  // stops a render that has touched nothing.
  const browser = await openBrowser();
  const { render } = await import("./render.ts");
  mkdirSync(outDir, { recursive: true });
  const server = await startServer(set, { port });
  try {
    console.log(`recadro  ${counted(server.panels.length, "panel")} in ${shown(set.dir)}`);
    console.log(`         devices   ${ids.join(", ")}  (${devicesFrom})`);
    console.log(`         locales   ${locales.join(", ")}  (${localesFrom})`);
    console.log(`         out       ${shown(outDir)}\n`);

    const result = await render({
      browser,
      origin: server.origin,
      panels: server.panels,
      slots,
      locales,
      capturesUrl: (device, locale) => capturesUrl(set, device, locale),
      outDir,
      incomplete: values.incomplete,
    });
    const verb = values.incomplete ? "incomplete" : "skipped";
    for (const file of result.written) console.log(`  wrote   ${file}`);
    for (const { where, missing } of result.incomplete) {
      console.log(`  ${verb} ${where} — no capture at ${missing.join(", ")}`);
    }
    console.log(`\n${result.written.length} written, ${result.incomplete.length} ${verb} → ${shown(outDir)}`);
  } finally {
    await server.vite.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
