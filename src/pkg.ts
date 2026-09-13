/**
 * Where the package itself is on disk, for the files that ship beside `src/`
 * and `dist/` — the sheet, its assets and the starters — so tsx and the
 * published build find them without a copy step.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The package root, resolved from this module: right from `src/` under tsx and from `dist/` once published. */
export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
