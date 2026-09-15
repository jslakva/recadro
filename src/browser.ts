/**
 * The browser `render` shoots in. Playwright's Chromium installs apart from the
 * package, and each Playwright version wants its own build, so a first render,
 * or the first after an upgrade, can find none. This finds that out, and
 * installs the build with the same Playwright that will launch it.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium, type Browser } from "playwright";

/** The Playwright recadro resolves, on disk; its `cli.js` is not in the package's exports, so it is found from here. */
const PLAYWRIGHT = dirname(createRequire(import.meta.url).resolve("playwright/package.json"));

/** That Playwright's version, which decides the Chromium build it launches. */
const VERSION: string = JSON.parse(readFileSync(join(PLAYWRIGHT, "package.json"), "utf8")).version;

/**
 * What a person runs to install the browser. Pinned to recadro's Playwright,
 * because a bare `npx playwright` can resolve another version and fetch a build
 * render never launches. Only the headless shell, the build `render` uses.
 */
export const INSTALL_COMMAND = `npx playwright@${VERSION} install chromium --only-shell`;

/** Launches headless Chromium, or returns null when Playwright finds its build not installed. */
export async function launchBrowser(): Promise<Browser | null> {
  try {
    return await chromium.launch();
  } catch (error) {
    // Playwright's own wording, which Playwright itself matches on to explain it.
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) return null;
    throw error;
  }
}

/** Installs the headless shell with recadro's own Playwright, its download progress on this terminal. */
export function installBrowser(): Promise<void> {
  const args = [join(PLAYWRIGHT, "cli.js"), "install", "chromium", "--only-shell"];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`the install stopped (${signal ?? `exit ${code}`}); to run it yourself: ${INSTALL_COMMAND}`));
    });
  });
}
