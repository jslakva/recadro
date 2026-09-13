#!/usr/bin/env node
/**
 * recadro — App Store screenshots as code.
 *
 * `init` copies a starter into a new set. `dev` and `render` drive one vite
 * server: `dev` opens the contact sheet and watches, `render` shoots the same
 * URLs at slot pixels. Flags win over the set's `recadro.json`, which wins over
 * the set's conventions.
 */
import { mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { initSet, listStarters } from "./init.ts";
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

const USAGE = `recadro — App Store screenshots as code

  recadro init   <dir> --starter <name> [--captures <pattern>]
  recadro dev    [--panels <dir>] [--port <n>]
  recadro render [--panels <dir>] [--out <dir>] [--devices 6.9,13-iPad] [--locales en-US] [--incomplete]

  --starter     init: the starter to copy          (${listStarters().join(", ")})
  --captures    init: where captures are, relative to <dir>, as ${CONFIG_FILE} takes it

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

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (command !== "init" && command !== "dev" && command !== "render") {
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
    },
  });

  if (command === "init") {
    if (positionals.length !== 1 || !values.starter) {
      throw new Error(`init takes a folder and a starter: recadro init <dir> --starter ${listStarters().join("|")}`);
    }
    const dir = resolve(positionals[0]);
    const result = initSet({ dir, starter: values.starter, captures: values.captures });
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
    console.log(`         next      recadro dev --panels ${shown(dir)}`);
    return;
  }
  if (positionals.length) throw new Error(`${command} takes no ${positionals[0]}; name the set with --panels`);

  const set = loadSet(values.panels ? resolve(values.panels) : findSet(process.cwd()));
  const { locales, from: localesFrom } = localesFor(set, values.locales);
  const port = values.port ? Number(values.port) : undefined;

  if (command === "dev") {
    const { origin, panels } = await startServer(set, { port, watchCaptures: true });
    console.log(`recadro  ${counted(panels.length, "panel")} in ${shown(set.dir)}`);
    console.log(`         locales   ${locales.join(", ")}  (${localesFrom})`);
    console.log(`         captures  ${shown(resolve(set.dir, set.captures))}/`);
    console.log(`         sheet     ${origin}/`);
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
  mkdirSync(outDir, { recursive: true });

  // Imported here rather than at the top so `dev` runs before anyone has
  // installed a browser: Playwright is the render pass's dependency, not the
  // design loop's.
  const { render } = await import("./render.ts");
  const server = await startServer(set, { port });
  try {
    console.log(`recadro  ${counted(server.panels.length, "panel")} in ${shown(set.dir)}`);
    console.log(`         devices   ${ids.join(", ")}  (${devicesFrom})`);
    console.log(`         locales   ${locales.join(", ")}  (${localesFrom})`);
    console.log(`         out       ${shown(outDir)}\n`);

    const result = await render({
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
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
