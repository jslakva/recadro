# recadro — App Store screenshots as code

Compose store panels from raw simulator captures. Plain HTML in, exact slot
sizes out. Works with or without fastlane.

```bash
npx recadro dev    --panels ./store/screenshots   # vite + contact sheet, live
npx recadro render --panels ./store/screenshots   # serve, shoot, tear down
```

Both drive the **same** vite server, so Playwright navigates to the identical
URL you have open in a browser. There is no second code path that can disagree
with the preview.

## What it is

A panel is an HTML file. It is `100vw × 100vh` and never learns a device size —
the renderer sets the viewport and the scale factor, so the delivered pixels come
out by construction. Everything else is convention:

```
<panels>/
  panels/01-hero.html       # discovered by glob; the number prefix is the order
  panels/02-feature.html
  panel.css, panel.js       # whatever the panels share; recadro never reads them
  vite.config.ts            # optional, merged when present — the extension point
  out/                      # rendered: <locale>/<device>/<NN-slug>.png
```

The whole tool ↔ layout contract is three query params:

```
tool → page:   ?panel=02-feature&device=6.9&locale=en-US
page → tool:   nothing
tool → disk:   out/<locale>/<device>/<NN-slug>.png, at exact slot pixels
```

There is no manifest and no config schema. A page that needs strings, captures or
design tokens fetches them itself, at paths of its own choosing; recadro opens
none of them. What it owns is the two things that are facts about the App Store
rather than preferences — the slot geometry table and the output naming
`deliver` expects — and both are selected by flag.

## Writing a panel

A panel reads its three params and fetches everything else itself. This is a
complete working set, from a repo that keeps its raw captures in `captures/`
and its panels in `store/screenshots/`:

```html
<!-- store/screenshots/panels/01-hero.html -->
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="../panel.css">
<h1></h1>
<img class="capture" alt="">
<script type="module" src="../panel.js"></script>
```

```js
// store/screenshots/panel.js
const params = new URLSearchParams(location.search);
const panel = params.get("panel");   // "01-hero": the filename without .html
const device = params.get("device"); // "6.9" or "13-iPad"
const locale = params.get("locale"); // "en-US"

document.documentElement.lang = locale;
document.documentElement.dataset.device = device;

// Relative URLs resolve against the page, panels/01-hero.html.
const captions = await fetch(`../captions/${locale}.json`).then((r) => r.json());
document.querySelector("h1").textContent = captions[panel];

const capture = document.querySelector("img.capture");
if (capture) capture.src = `../../../captures/${device}/${panel}.png`;
```

```css
/* store/screenshots/panel.css */
html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; }

body {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5vh;
  padding: 8vh 8vw 0;
  background: #1f3a5f;
  color: #fff;
  font: 700 8vw/1.1 system-ui, sans-serif;
}

h1 { margin: 0; font: inherit; text-align: center; text-wrap: balance; }

img.capture {
  height: 70vh;
  aspect-ratio: 9 / 19.5;
  object-fit: cover;
  border-radius: 4vh;
  background: rgb(255 255 255 / 0.1);
}

[data-device="13-iPad"] body { font-size: 5vw; }
[data-device="13-iPad"] img.capture { aspect-ratio: 3 / 4; border-radius: 2vh; }
```

`captions/en-US.json` maps each slug to its headline. Every path in it is this
example's choice, not recadro's: the strings could come from a Markdown table,
the captures from fastlane `snapshot`'s output, the colours from your web app's
tokens. Sizes are in `vw`/`vh` and the iPad forks on an attribute, so no device
dimension appears anywhere.

The server's root is the repository — the nearest directory holding `.git` —
so a panel can reach anything in the repo by a relative or root-absolute URL.
Outside git it is the nearest JS workspace or `package.json`, and failing both
the panels directory, where nothing beside it is reachable.

## Commands

```
recadro dev    [--panels <dir>] [--port <n>]
recadro render [--panels <dir>] [--out <dir>] [--devices 6.9,13-iPad] [--locales en-US] [--incomplete]
```

`--panels` defaults to the current directory; `--out` to `<panels>/out`.

## The contact sheet is the check

`dev` serves every panel side by side at `/`, which is how a customer meets them
in a search result and the only view in which the *story* can be judged rather
than the layout. The first three are grouped on their own — all a search result
shows — with the rest below. It shows the live panels by default and the
contents of `out/` on a toggle, so a rendered set can be compared against the
design.

There is deliberately no validation. Overflow, a cropped headline, the wrong face
— the eye catches all of these instantly, and a check that duplicates the eye is
dead weight. Asserting the output's dimensions would assert only that the script
set the viewport it just set.

What is unconditional rather than checked: every write is flattened and stamped
sRGB, because an alpha channel is never wanted (App Store Connect rejects
transparency), so there is nothing to test for.

## Incomplete panels are skipped

A panel is incomplete when it carries an `<img>` that resolved to nothing —
typically a capture that does not exist yet. Those render in `dev` (a page can
style a failed image into a deliberate empty state) and are **skipped** by
`render`, so `out/` only ever holds complete panels and an upload lane can read
it wholesale.

A panel with **no** image at all — a text-only story panel — has nothing to fail
and ships. The distinction is present-but-broken, not absent.

The resulting gap in the numbering is harmless: `deliver` uploads what it finds
in filename order.

To look at incomplete panels without a browser — in CI, or from an agent —
`render --incomplete --out <dir>` shoots every panel. It refuses to write into
`<panels>/out`, where an empty frame would ship.

## With fastlane

The interface between render and upload is a directory of PNGs, so a lane is one
line:

```ruby
lane :screenshots do
  sh("npx recadro render --panels ../store/screenshots")
  upload_screenshots   # point deliver at store/screenshots/out
end
```

`deliver` picks each slot from the image dimensions, so nothing else is needed.

## With a coding agent

[`AUTHORING.md`](AUTHORING.md) ships in the package: the contract as
instructions, the mistakes an agent reliably makes with a tool that has no
config, and how to look at its own work without a browser. Point your agent
file at it — one line in `CLAUDE.md` or `AGENTS.md`:

```md
Store screenshots are composed with recadro. Before editing store/screenshots/,
read node_modules/recadro/AUTHORING.md.
```

## Requirements

Node 20.11+, and Playwright's chromium, installed once:

```bash
npx playwright install chromium
```

`dev` does not need it — Playwright is the render pass's dependency, not the
design loop's.

## License

FSL-1.1-ALv2.
