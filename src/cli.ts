#!/usr/bin/env node
/**
 * recadro — App Store screenshots as code.
 *
 * `init` copies a starter into a new set. `dev` and `render` drive one vite
 * server: `dev` opens the lineup and watches, `render` shoots the same
 * URLs at slot pixels. `wait` and `reply` are an agent's side of `dev --live`:
 * notes pinned in the lineup, and one line back. Every command reads the
 * `recadro.json` where it runs, or the one `--config` names; flags win over
 * it, and it wins over the set's conventions.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type { Browser } from "playwright";
import { AGENT_FILES, DEFAULT_STARTER, initSet, installSkill, listStarters, SKILL_PATH, skillVersion, VERSION } from "./init.ts";
import { startServer } from "./server.ts";
import {
  capturesUrl,
  CONFIG_FILE,
  configFile,
  DEFAULT_LOCALE,
  describeCaptures,
  devicesWithCaptures,
  loadSet,
  outTemplate,
  type PanelSet,
} from "./set.ts";
import { SLOTS, selectSlots } from "./slots.ts";
import { reply, wait } from "./wait.ts";

const USAGE = `recadro — App Store screenshots as code

  recadro init   <dir> [--starter <name>] [--captures <dir>] [--skill | --no-skill]
  recadro init   [--config <path>] --skill
  recadro dev    [--config <path>] [--port <n>] [--live]
  recadro render [--config <path>] [--out <dir>] [--devices iPhone,iPad] [--locales en-US] [--incomplete]
  recadro wait   [--config <path>]
  recadro reply  <id> "<what you changed>" [--config <path>]

  --starter     init: the starter to copy into <dir>   (${listStarters().join(", ")}); asked at a terminal when left out, Enter for ${DEFAULT_STARTER}
                init writes ${CONFIG_FILE} in the folder it runs in, naming <dir>; run recadro from that folder
  --captures    init: the captures folder, from here  (written to ${CONFIG_FILE})
  --skill       init: add a /recadro skill for Claude Code at ${SKILL_PATH.split(sep).join("/")} without asking,
                or rewrite one another version wrote; without <dir> and --starter, init adds only the skill.
                --no-skill: don't, and don't ask
  --live        dev: take notes pinned in the lineup, for an agent running \`recadro wait\`

  --config      the set's ${CONFIG_FILE}, or the folder holding it   (default: the one in the folder you run in)
  --out         where renders go       (default: ${CONFIG_FILE} "out", else <set>/out; <locale>/<device>-<slug>.png below it)
  --devices     slots to render        (default: those with captures, else all)
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

/**
 * The `--config` a command line needs to reach the set again: nothing when its
 * `recadro.json` is the one in the working directory, the flag otherwise. For
 * the commands the CLI prints for the next step.
 */
function configFlag(set: PanelSet): string {
  return relative(process.cwd(), set.config) === CONFIG_FILE ? "" : ` --config ${shown(set.config)}`;
}

/** The locales to use, and where they came from, for the summary line. */
function localesFor(set: PanelSet, flag: string | undefined): { locales: string[]; from: string } {
  if (flag) return { locales: list(flag), from: "--locales" };
  if (set.locales.length) return { locales: set.locales, from: "strings/" };
  return { locales: [DEFAULT_LOCALE], from: "no strings/ yet" };
}

/**
 * The slots to render, and why. Without `--devices`, a slot is rendered when it
 * has captures for one of the locales — so an iPhone-only app renders no iPad
 * panels — and every slot is rendered when none has any yet.
 */
function slotsFor(set: PanelSet, locales: string[], flag: string | undefined): { ids: string[]; from: string } {
  if (flag) return { ids: list(flag), from: "--devices" };
  const found = devicesWithCaptures(set, locales);
  if (!found.length) return { ids: SLOTS.map((s) => s.id), from: "no captures yet" };
  const missing = SLOTS.filter((s) => !found.includes(s.id)).map((s) => s.id);
  return { ids: found, from: missing.length ? `no captures for ${missing.join(", ")}` : "captures" };
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
 * Asks which of `options` on the terminal, listed by number; a number or a
 * name answers, Enter alone is `fallback`, anything else asks again, Ctrl+C
 * quits.
 */
async function choose(question: string, options: string[], fallback: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  prompt.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    for (;;) {
      const answer = (await prompt.question(`${question} [1-${options.length}, Enter for ${fallback}] `)).trim();
      if (answer === "") return fallback;
      const chosen = /^\d+$/.test(answer) ? options[Number(answer) - 1] : options.find((option) => option === answer);
      if (chosen) return chosen;
    }
  } finally {
    prompt.close();
  }
}

/**
 * The starter for a new set when `--starter` names none: asked at a terminal,
 * from the folders in the package's `starters/`, so a starter added there is
 * offered with no list to keep; Enter takes the blank one. Anywhere else — an agent, CI — the flag is
 * required, and the error names what it takes.
 */
async function chooseStarter(dir: string): Promise<string> {
  const starters = listStarters();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`init needs a starter when not run at a terminal: recadro init ${shown(dir)} --starter <name>   (${starters.join(", ")})`);
  }
  console.log("Starters:");
  starters.forEach((name, i) => console.log(`  ${String(i + 1).padStart(2)}  ${name}`));
  return choose(`Copy which into ${shown(dir)}?`, starters, DEFAULT_STARTER);
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
async function skillLine(set: PanelSet, yes: boolean, no: boolean): Promise<string> {
  const target = join(set.root, SKILL_PATH);
  const later = `recadro init${configFlag(set)} --skill`;
  // One already there is the tool's own file: kept from this version, rewritten from another, no question.
  if (existsSync(target)) {
    const result = installSkill(set.root);
    if (result.state === "refreshed") return `${shown(target)} (rewritten from recadro ${result.from})`;
    return `${shown(target)} (kept)`;
  }
  if (no) return `not added; ${later} adds /recadro for Claude Code`;
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!yes && !tty) return `not added; ${later} adds /recadro for Claude Code`;
  if (!yes && !(await confirm(`Add a /recadro skill for Claude Code at ${shown(dirname(target))}/?`))) {
    return `not added; ${later} adds it later`;
  }
  installSkill(set.root);
  return shown(target);
}

/** A line for `dev` when the repository's skill was written by another version of recadro, or nothing. */
function staleSkillLine(set: PanelSet): string | null {
  const from = skillVersion(set.root);
  if (!from || from === VERSION) return null;
  return `skill     ${shown(join(set.root, SKILL_PATH))} is from recadro ${from}; recadro init${configFlag(set)} --skill rewrites it`;
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
      config: { type: "string" },
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
    if (positionals.length > 1 || (!dir && (values.starter || !values.skill))) {
      throw new Error(
        `init takes a folder: recadro init <dir> [--starter ${listStarters().join("|")}]\n` +
          `or adds the /recadro skill to the set ${CONFIG_FILE} names: recadro init [--config <path>] --skill`,
      );
    }
    // The skill is all there is to add to a set that exists.
    if (!dir) {
      const set = loadSet(configFile(process.cwd(), values.config));
      console.log(`recadro  skill     ${await skillLine(set, values.skill, values["no-skill"])}`);
      return;
    }
    // The file goes where init runs, which is where recadro will run: the one
    // rule for reading it, so --config would only say where not to put it.
    if (values.config) throw new Error(`init writes ${CONFIG_FILE} in the folder it runs in; run it from where the file should be`);
    const config = join(process.cwd(), CONFIG_FILE);
    if (existsSync(config)) {
      throw new Error(`${CONFIG_FILE} here already names the set at ${shown(loadSet(config).dir)}; a second set is made from another folder`);
    }
    // --captures is given from here, which is the file's folder, so it is
    // written as given, normalised, with forward slashes on every platform.
    const captures = values.captures && (relative(process.cwd(), resolve(values.captures)).split(sep).join("/") || ".");
    // Everything that stops init is checked before it asks, so a question is never answered for nothing.
    if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${shown(dir)} is not empty; init makes a new set`);
    const starter = values.starter ?? (await chooseStarter(dir));
    const result = initSet({ dir, starter, config, captures });
    const set = loadSet(config);
    const names = [set.dir !== process.cwd() ? `set ${shown(set.dir)}` : "", captures ? `captures ${captures}` : ""].filter(Boolean);
    console.log(`recadro  ${shown(dir)} from the ${starter} starter`);
    console.log(`         config    ${shown(config)}  (${names.length ? names.join(", ") : "the set is this folder"})`);
    console.log(`         captures  ${shown(set.captures)}/  (${describeCaptures(set, [DEFAULT_LOCALE])})`);
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
      console.log(`         left      ${left} in the set, for captures still to take`);
    }
    console.log(`         agents    ${Object.keys(AGENT_FILES).join(", ")}, pointing at recadro's SKILL.md and AUTHORING.md`);
    console.log(`         skill     ${await skillLine(set, values.skill, values["no-skill"])}`);
    console.log(`         next      recadro dev  (from here)`);
    return;
  }

  if (command === "reply") {
    const [id, ...words] = positionals;
    if (!/^\d+$/.test(id ?? "") || !words.length) {
      throw new Error(`reply takes a note's id and one line: recadro reply <id> "<what you changed>"`);
    }
    const set = loadSet(configFile(process.cwd(), values.config));
    await reply(set.dir, shown(set.dir), configFlag(set), Number(id), words.join(" "));
    return;
  }
  if (positionals.length) throw new Error(`${command} takes no ${positionals[0]}; name the set's ${CONFIG_FILE} with --config`);

  const set = loadSet(configFile(process.cwd(), values.config));
  const { locales, from: localesFrom } = localesFor(set, values.locales);
  const port = values.port ? Number(values.port) : undefined;

  if (command === "wait") {
    await wait(set.dir, shown(set.dir), configFlag(set));
    return;
  }

  if (command === "dev") {
    const { origin, panels } = await startServer(set, { port, watchFetched: true, live: values.live });
    console.log(`recadro  ${counted(panels.length, "panel")} in ${shown(set.dir)}`);
    console.log(`         locales   ${locales.join(", ")}  (${localesFrom})`);
    console.log(`         captures  ${shown(set.captures)}/  (${describeCaptures(set, locales)})`);
    console.log(`         lineup    ${origin}/`);
    if (values.live) {
      const flag = configFlag(set);
      console.log(`         live      recadro wait${flag}  (prints each note pinned in the lineup; recadro reply <id> "…"${flag} answers)`);
    }
    const stale = staleSkillLine(set);
    if (stale) console.log(`         ${stale}`);
    return;
  }

  // `--out` moves the folder; the layout below it stays the set's.
  const out = values.out ? { ...set.out, base: resolve(values.out) } : set.out;
  // The set's out directory only ever holds complete panels, so whatever
  // uploads from it can take it wholesale. An incomplete shot there would ship
  // an empty frame.
  if (values.incomplete && out.base === set.out.base) {
    throw new Error(`--incomplete shoots panels that must not ship; pass an --out other than ${shown(set.out.base)}`);
  }
  const { ids, from: devicesFrom } = slotsFor(set, locales, values.devices);
  const slots = selectSlots(ids);

  // Before the server starts and anything is written, so a missing browser
  // stops a render that has touched nothing.
  const browser = await openBrowser();
  const { render } = await import("./render.ts");
  mkdirSync(out.base, { recursive: true });
  const server = await startServer(set, { port });
  try {
    console.log(`recadro  ${counted(server.panels.length, "panel")} in ${shown(set.dir)}`);
    console.log(`         devices   ${ids.join(", ")}  (${devicesFrom})`);
    console.log(`         locales   ${locales.join(", ")}  (${localesFrom})`);
    console.log(`         out       ${shown(out.base)}/${outTemplate(out)}\n`);

    const result = await render({
      browser,
      origin: server.origin,
      panels: server.panels,
      slots,
      locales,
      capturesUrl: (device, locale) => capturesUrl(set, device, locale),
      out,
      incomplete: values.incomplete,
    });
    const verb = values.incomplete ? "incomplete" : "skipped";
    for (const file of result.written) console.log(`  wrote   ${file}`);
    for (const { where, missing } of result.incomplete) {
      console.log(`  ${verb} ${where} — no capture at ${missing.join(", ")}`);
    }
    console.log(`\n${result.written.length} written, ${result.incomplete.length} ${verb} → ${shown(out.base)}`);
  } finally {
    await server.vite.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
