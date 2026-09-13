/**
 * The one vite server both commands drive. `dev` opens a browser at it and
 * `render` points Playwright at the identical URLs, so there is no second code
 * path that can disagree with the preview.
 */
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  loadConfigFromFile,
  mergeConfig,
  searchForWorkspaceRoot,
  type InlineConfig,
  type Plugin,
  type ViteDevServer,
} from "vite";
import { discoverPanels, type Panel } from "./panels.ts";
import { SLOTS } from "./slots.ts";

/**
 * The package root. Resolved relative to this module so it is right both when
 * running from `src/` under tsx and from `dist/` once published — `ui/` and
 * `assets/` sit beside both.
 */
const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A running server, plus what the caller needs to build panel URLs. */
export interface PanelServer {
  /** The vite server; close it when done. */
  vite: ViteDevServer;
  /** Origin the server is listening on, e.g. `http://localhost:5199`. */
  origin: string;
  /** Panels discovered under `--panels`, in filename order. */
  panels: Panel[];
}

/**
 * What the contact sheet needs and cannot glob for itself. Served at
 * `/__recadro/panels.json`; the flow is one-way — no page ever reports back.
 */
interface SheetManifest {
  panelsBase: string;
  panels: { slug: string; urlPath: string }[];
  slots: typeof SLOTS;
}

/**
 * Loads a `vite.config.*` sitting beside the panels, if there is one.
 *
 * This is the whole extension point: a project that wants Tailwind, Sass or an
 * alias adds a vite config next to its panels and recadro learns nothing. The
 * format is one the world already knows, so the bespoke-config surface stays at
 * zero.
 */
async function loadPanelConfig(panelsDir: string): Promise<InlineConfig> {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, undefined, panelsDir);
  return loaded?.config ?? {};
}

/** The tool's own files, by request path: what to read and how to label it. */
const OWN_FILES: Record<string, { file: string; type: string }> = {
  "/__recadro/sheet.js": { file: "ui/sheet.js", type: "text/javascript" },
  "/__recadro/mark.png": { file: "assets/mark.png", type: "image/png" },
  "/__recadro/wordmark.png": { file: "assets/wordmark.png", type: "image/png" },
};

/**
 * Sends one of the tool's own files, read fresh and never cached.
 *
 * `no-store` because the sheet is edited while the server is up and a stale
 * copy is indistinguishable from a broken one.
 */
function sendOwnFile(res: ServerResponse, file: string, type: string): void {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(readFileSync(join(PKG, file)));
}

/**
 * Serves the contact sheet at `/`, its script, and its manifest.
 *
 * Registered from the `configureServer` body rather than its returned hook, so
 * it runs before vite's own middlewares and `/` is the sheet rather than a root
 * `index.html` that has nothing to do with panels.
 *
 * None of these go through vite. The sheet is the tool's own UI and wants no
 * transform — and running it through `transformIndexHtml` actively broke it:
 * vite extracted the inline module into an html-proxy entry and cached it in the
 * module graph, which nothing invalidated because `sheet.html` lives outside the
 * vite root, so an edited sheet silently ran the previous version's JavaScript.
 * Hence a separate `sheet.js` under `ui/` and raw sends. The panels are real
 * files under root and keep vite's transform and HMR.
 */
function recadroPlugin(panelsDir: string, root: string): Plugin {
  return {
    name: "recadro",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "/").split("?")[0];

        if (path === "/__recadro/panels.json") {
          const manifest: SheetManifest = {
            panelsBase: `/${relative(root, panelsDir).split("\\").join("/")}`,
            panels: discoverPanels(panelsDir, root).map(({ slug, urlPath }) => ({ slug, urlPath })),
            slots: SLOTS,
          };
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(manifest));
          return;
        }

        const own = OWN_FILES[path];
        if (own) {
          sendOwnFile(res, own.file, own.type);
          return;
        }

        if (path === "/" || path === "/index.html") {
          sendOwnFile(res, "ui/sheet.html", "text/html");
          return;
        }

        next();
      });
    },
  };
}

/**
 * The vite root for `panelsDir`: the repository it sits in.
 *
 * Derived rather than flagged, and it has to be the repository rather than
 * anything narrower, because a panel reaches for captures and stylesheets
 * wherever the repo keeps them — `../../fastlane/screenshots`, a web app's
 * tokens — and a URL cannot climb above root. The nearest `.git` (a directory,
 * or a file in a worktree or submodule) marks it.
 *
 * vite's `searchForWorkspaceRoot` alone is not enough: it stops at a JS
 * workspace or the nearest `package.json`, and a native iOS repo has neither,
 * which would leave the root at the panels directory. It is the fallback
 * outside git.
 */
function rootFor(panelsDir: string): string {
  for (let dir = panelsDir; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return searchForWorkspaceRoot(panelsDir);
  }
}

/**
 * Starts the server on the repository that contains `panelsDir`, so the panels,
 * the raw captures and any stylesheet they link are all inside root and nothing
 * needs `server.fs.allow`.
 */
export async function startServer(panelsDir: string, port?: number): Promise<PanelServer> {
  const root = rootFor(panelsDir);
  const ours: InlineConfig = {
    root,
    configFile: false,
    logLevel: "warn",
    server: { port, host: "localhost" },
    plugins: [recadroPlugin(panelsDir, root)],
  };

  const vite = await createServer(mergeConfig(await loadPanelConfig(panelsDir), ours));
  await vite.listen();

  const resolved = vite.resolvedUrls?.local[0];
  if (!resolved) throw new Error("vite reported no local URL");

  return { vite, origin: resolved.replace(/\/$/, ""), panels: discoverPanels(panelsDir, root) };
}
