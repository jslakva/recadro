#!/usr/bin/env node
/**
 * recadro — App Store screenshots as code.
 *
 * Two commands over one vite server: `dev` opens the contact sheet and watches,
 * `render` shoots the same URLs at slot pixels and tears the server down. The
 * only inputs are flags; there is no manifest and no config file.
 */
import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startServer } from "./server.ts";
import { SLOTS, selectSlots } from "./slots.ts";

const USAGE = `recadro — App Store screenshots as code

  recadro dev    [--panels <dir>] [--port <n>]
  recadro render [--panels <dir>] [--out <dir>] [--devices 6.9,13-iPad] [--locales en-US]

  --panels   directory holding panels/ and, after a render, out/  (default: .)
  --out      output directory                     (default: <panels>/out)
  --devices  slots to render        (default: ${SLOTS.map((s) => s.id).join(",")})
  --locales  locales to render                    (default: en-US)
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
    },
  });

  const panelsDir = resolve(values.panels);
  const outDir = values.out
    ? isAbsolute(values.out)
      ? values.out
      : resolve(values.out)
    : join(panelsDir, "out");

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
      });
      for (const file of result.written) console.log(`  wrote   ${file}`);
      for (const { where, missing } of result.skipped) {
        console.log(`  skipped ${where} — no capture at ${missing.join(", ")}`);
      }
      console.log(`\n${result.written.length} written, ${result.skipped.length} skipped → ${outDir}`);
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
