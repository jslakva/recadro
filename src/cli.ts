#!/usr/bin/env node
/**
 * recadro — App Store screenshots as code.
 *
 * Two commands over one vite server: `dev` opens the contact sheet and watches,
 * `render` shoots the same URLs at slot pixels and tears the server down. The
 * only inputs are flags; there is no manifest and no config file.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startServer } from "./server.ts";
import { SLOTS, selectSlots } from "./slots.ts";

const USAGE = `recadro — App Store screenshots as code

  recadro dev    [--panels <dir>] [--port <n>]
  recadro render [--panels <dir>] [--out <dir>] [--devices 6.9,13-iPad] [--locales en-US] [--incomplete]

  --panels      directory holding panels/ and, after a render, out/  (default: .)
  --out         output directory                     (default: <panels>/out)
  --devices     slots to render        (default: ${SLOTS.map((s) => s.id).join(",")})
  --locales     locales to render                    (default: en-US)
  --incomplete  shoot panels missing a capture too, to look at them;
                needs an --out other than <panels>/out
`;

/** Splits a comma-separated flag, dropping empty entries. */
function list(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      panels: { type: "string", default: "." },
      out: { type: "string" },
      port: { type: "string" },
      devices: { type: "string", default: SLOTS.map((s) => s.id).join(",") },
      locales: { type: "string", default: "en-US" },
      incomplete: { type: "boolean", default: false },
    },
  });

  const panelsDir = resolve(values.panels);
  // `resolve` normalises absolute paths too, so `out/` and `out` compare equal.
  const outDir = values.out ? resolve(values.out) : join(panelsDir, "out");

  if (command === "dev") {
    const { origin, panels } = await startServer(panelsDir, values.port ? Number(values.port) : undefined);
    console.log(`recadro  ${panels.length} panel(s) from ${panelsDir}`);
    console.log(`         contact sheet  ${origin}/`);
    for (const panel of panels) console.log(`         ${panel.slug.padEnd(16)} ${origin}${panel.urlPath}`);
    return;
  }

  if (command === "render") {
    const slots = selectSlots(list(values.devices));
    const locales = list(values.locales);
    // `out/` only ever holds complete panels, so an upload lane can read it
    // wholesale. An incomplete shot landing there would ship an empty frame.
    if (values.incomplete && (!values.out || outDir === join(panelsDir, "out"))) {
      throw new Error("--incomplete shoots panels that must not ship; pass an --out other than <panels>/out");
    }
    mkdirSync(outDir, { recursive: true });

    // Imported here rather than at the top so `dev` runs before anyone has
    // installed a browser: Playwright is the render pass's dependency, not the
    // design loop's.
    const { render } = await import("./render.ts");
    const server = await startServer(panelsDir, values.port ? Number(values.port) : undefined);
    try {
      const result = await render({
        origin: server.origin,
        panels: server.panels,
        slots,
        locales,
        outDir,
        incomplete: values.incomplete,
      });
      const verb = values.incomplete ? "incomplete" : "skipped";
      for (const file of result.written) console.log(`  wrote   ${file}`);
      for (const { where, missing } of result.incomplete) {
        console.log(`  ${verb} ${where} — no capture at ${missing.join(", ")}`);
      }
      console.log(`\n${result.written.length} written, ${result.incomplete.length} ${verb} → ${outDir}`);
    } finally {
      await server.vite.close();
    }
    return;
  }

  console.error(`unknown command "${command}"\n\n${USAGE}`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
