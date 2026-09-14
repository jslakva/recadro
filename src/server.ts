/**
 * The one vite server both commands drive. `dev` opens a browser at it and
 * `render` points Playwright at the identical URLs, so there is no second code
 * path that can disagree with the preview.
 */
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join, sep } from "node:path";
import { createServer, loadConfigFromFile, mergeConfig, type InlineConfig, type Plugin, type ViteDevServer } from "vite";
import { discoverPanels, urlPathFor, type Panel } from "./panels.ts";
import { PKG } from "./pkg.ts";
import {
  capturesBase,
  capturesUrl,
  DEFAULT_LOCALE,
  devicesWithCaptures,
  loadSet,
  type PanelSet,
} from "./set.ts";
import { SLOTS } from "./slots.ts";

/** A file `dev` treats as a capture when it appears or changes under the captures folder. */
const CAPTURE_FILE = /\.(png|jpe?g|webp|heic)$/i;

/** A running server, plus what the caller needs to build panel URLs. */
export interface PanelServer {
  /** The vite server; close it when done. */
  vite: ViteDevServer;
  /** Origin the server is listening on, e.g. `http://localhost:5199`. */
  origin: string;
  /** Panels in the set, in filename order. */
  panels: Panel[];
}

/** How to start the server. */
export interface ServerOptions {
  /** Port to listen on; vite picks one when absent. */
  port?: number;
  /** Reload the panels when a capture or a file they fetch changes. For `dev`; `render` has nothing to reload. */
  watchFetched?: boolean;
}

/**
 * What the lineup needs and cannot glob for itself. Served at
 * `/__recadro/panels.json`; the flow is one-way — no page ever reports back.
 */
interface LineupManifest {
  panels: { slug: string; urlPath: string }[];
  slots: typeof SLOTS;
  /** Locales `strings/` names, or the default one. */
  locales: string[];
  /** The `?captures=` URL with `{locale}` and `{device}` left for the lineup to fill. */
  capturesUrl: string;
  /** Slots with a captures folder, so the lineup can say which have none. */
  devicesWithCaptures: string[];
  /** Root-absolute URL of the output folder, or null when it lies outside the root and cannot be shown. */
  outUrl: string | null;
}

/**
 * Loads a `vite.config.*` sitting beside the panels, if there is one.
 *
 * The extension point for the page side: a project that wants Tailwind, Sass or
 * an alias adds a vite config next to its panels and recadro learns nothing
 * about it. The format is one the world already knows.
 */
async function loadPanelConfig(panelsDir: string): Promise<InlineConfig> {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, undefined, panelsDir);
  return loaded?.config ?? {};
}

/** The tool's own files, by request path: what to read and how to label it. */
const OWN_FILES: Record<string, { file: string; type: string }> = {
  "/__recadro/lineup.js": { file: "ui/lineup.js", type: "text/javascript" },
  "/__recadro/mark.png": { file: "assets/mark.png", type: "image/png" },
  "/__recadro/wordmark.png": { file: "assets/wordmark.png", type: "image/png" },
  "/__recadro/favicon.png": { file: "assets/favicon.png", type: "image/png" },
};

/**
 * Sends one of the tool's own files, read fresh and never cached.
 *
 * `no-store` because the lineup is edited while the server is up and a stale
 * copy is indistinguishable from a broken one.
 */
function sendOwnFile(res: ServerResponse, file: string, type: string): void {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(readFileSync(join(PKG, file)));
}

/**
 * The lineup's manifest, from the set as it is on disk now. Read per request, so
 * a panel or a strings file added while the server runs shows on reload.
 */
function manifestFor(set: PanelSet): LineupManifest {
  const current = loadSet(set.dir);
  const locales = current.locales.length ? current.locales : [DEFAULT_LOCALE];
  const outUrl = urlPathFor(current.root, current.outDir);
  return {
    panels: discoverPanels(current.dir, current.root).map(({ slug, urlPath }) => ({ slug, urlPath })),
    slots: SLOTS,
    locales,
    capturesUrl: capturesUrl(current),
    devicesWithCaptures: devicesWithCaptures(current, locales),
    outUrl: outUrl.startsWith("/..") ? null : outUrl,
  };
}

/**
 * Reloads every panel when a file a page asked for by URL appears, changes or
 * goes away: a capture, a strings file, a scene or anything else in the set
 * that a panel fetches. vite reloads a page for what it imports, and these are
 * outside its module graph, so an edit to them would otherwise change nothing
 * on screen. Files vite does track — the panels themselves, their stylesheet
 * and script — are left to it, and out/ is skipped, since render writes there.
 * Debounced, because a capture flow or an editor writes in bursts. The lineup
 * itself has no vite client and stays; the panels inside it reload.
 */
function watchFetched(server: ViteDevServer, set: PanelSet): void {
  const captures = capturesBase(set);
  const panels = join(set.dir, "panels") + sep;
  server.watcher.add(captures);
  let pending: NodeJS.Timeout | undefined;
  server.watcher.on("all", (_event, file) => {
    const capture = file.startsWith(captures + sep) && CAPTURE_FILE.test(file);
    const fetched =
      file.startsWith(set.dir + sep) &&
      !file.startsWith(panels) &&
      !file.startsWith(set.outDir + sep) &&
      !server.moduleGraph.getModulesByFile(file)?.size;
    if (!capture && !fetched) return;
    clearTimeout(pending);
    pending = setTimeout(() => server.ws.send({ type: "full-reload" }), 300);
  });
}

/**
 * Serves the lineup at `/`, its script, and its manifest.
 *
 * Registered from the `configureServer` body rather than its returned hook, so
 * it runs before vite's own middlewares and `/` is the lineup rather than a root
 * `index.html` that has nothing to do with panels.
 *
 * None of these go through vite. The lineup is the tool's own UI and wants no
 * transform — and running it through `transformIndexHtml` actively broke it:
 * vite extracted the inline module into an html-proxy entry and cached it in the
 * module graph, which nothing invalidated because `lineup.html` lives outside the
 * vite root, so an edited lineup silently ran the previous version's JavaScript.
 * Hence a separate `lineup.js` under `ui/` and raw sends. The panels are real
 * files under root and keep vite's transform and HMR.
 */
function recadroPlugin(set: PanelSet, options: ServerOptions): Plugin {
  return {
    name: "recadro",
    configureServer(server) {
      if (options.watchFetched) watchFetched(server, set);

      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "/").split("?")[0];

        if (path === "/__recadro/panels.json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(manifestFor(set)));
          return;
        }

        const own = OWN_FILES[path];
        if (own) {
          sendOwnFile(res, own.file, own.type);
          return;
        }

        if (path === "/" || path === "/index.html") {
          sendOwnFile(res, "ui/lineup.html", "text/html");
          return;
        }

        next();
      });
    },
  };
}

/**
 * Starts the server on the repository that contains the set, so the panels, the
 * raw captures and any stylesheet they link are all inside root and nothing
 * needs `server.fs.allow`.
 */
export async function startServer(set: PanelSet, options: ServerOptions = {}): Promise<PanelServer> {
  const ours: InlineConfig = {
    root: set.root,
    configFile: false,
    logLevel: "warn",
    server: { port: options.port, host: "localhost" },
    plugins: [recadroPlugin(set, options)],
  };

  const vite = await createServer(mergeConfig(await loadPanelConfig(set.dir), ours));
  await vite.listen();

  const resolved = vite.resolvedUrls?.local[0];
  if (!resolved) throw new Error("vite reported no local URL");

  return { vite, origin: resolved.replace(/\/$/, ""), panels: discoverPanels(set.dir, set.root) };
}
