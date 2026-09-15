# recadro — App Store screenshots as code

Compose store panels from raw simulator captures. Plain HTML in, exact slot
sizes out.

```bash
npx recadro init store/screenshots --starter caption   # a new set from a starter
npx recadro dev      # vite + the lineup: every panel side by side, live
npx recadro render   # serve, shoot, tear down
```

Both drive the **same** vite server, so Playwright navigates to the identical
URL you have open in a browser. There is no second code path that can disagree
with the preview.

## What it is

A panel is an HTML file. It is `100vw × 100vh` and never learns a device size —
the renderer sets the viewport and the scale factor, so the delivered pixels come
out by construction. A set of panels is a folder, and recadro reads it by names:

```
store/screenshots/          # the set, found from wherever you run recadro
  panels/01-hero.html       # the panels; the number prefix is the order
  panels/02-feature.html
  strings/en-US.json        # one per locale; the file names are the locales
  captures/6.9/01-hero.png  # raw captures, one folder per device
  panel.css, panel.js       # whatever the panels share; recadro never reads them
  recadro.json              # optional: only when captures live elsewhere
  out/                      # rendered: <device>/<locale>/<NN-slug>.png
```

The whole tool ↔ layout contract is four query params:

```
tool → page:   ?panel=02-feature&device=6.9&locale=en-US&captures=/store/screenshots/captures/6.9/
page → tool:   nothing
tool → disk:   out/<device>/<locale>/<NN-slug>.png, at exact slot pixels
```

recadro reads what things are called, never what they say. A page fetches its
own strings and tokens and picks its own capture filenames; recadro opens none
of them. What it owns is what is a fact about the App Store rather than a
preference — the slot geometry — and where a set keeps its pieces.

- **Locales** are the names in `strings/`. Add `strings/de-DE.json` and
  `render` renders German too.
- **Devices** are the folders in `captures/`. No `13-iPad` folder, no iPad
  panels; no captures at all yet, every slot.
- **The set** is found: the folder you run in, the nearest set above it, or the
  one set below it.

## Writing a panel

A panel reads its four params and fetches everything else itself. This is a
complete working set:

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
const panel = params.get("panel");       // "01-hero": the filename without .html
const device = params.get("device");     // "6.9" or "13-iPad"
const locale = params.get("locale");     // "en-US"
const captures = params.get("captures"); // this locale and device's captures folder

document.documentElement.lang = locale;
document.documentElement.dataset.device = device;

// Relative URLs resolve against the page, panels/01-hero.html.
const strings = await fetch(`../strings/${locale}.json`).then((r) => r.json());
document.querySelector("h1").textContent = strings[panel];

const capture = document.querySelector("img.capture");
if (capture) {
  // A capture that does not exist yet stays a broken <img> — that is how
  // render knows to skip the panel — and is hidden rather than replaced.
  capture.addEventListener("error", () => { capture.style.visibility = "hidden"; });
  capture.src = `${captures}${panel}.png`;
}
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

`strings/en-US.json` maps each slug to its headline. Its format is this
example's choice, not recadro's: the strings could be a Markdown table, the
colours your web app's tokens. Sizes are in `vw`/`vh` and the iPad forks on an
attribute, so no device dimension appears anywhere.

The server's root is the repository — the nearest directory holding `.git` —
so a panel can reach anything in the repo by a relative or root-absolute URL.
Outside git it is the nearest JS workspace or `package.json`, and failing both
the set itself, where nothing beside it is reachable.

## Starting from a starter

`init` copies a premade set into a new folder:

```bash
npx recadro init store/screenshots --starter overlay --captures "../../e2e/screenshots/{device}"
```

- **`overlay`** — the capture fills the panel, and a band of colour over its
  top carries the headline, with highlighted words; one panel magnifies part
  of the screen.
- **`caption`** — a headline and a subline over the screen, framed in a device,
  and one review panel with no screen. Along the way it shows a highlighted
  word, a sparkle, a blurred copy of the capture as the background, an enlarged
  detail, a background image from the set's `assets/`, and a sticker.
- **`panorama`** — one scene as wide as the whole set, drawn once in
  `world.html`, with each panel showing its own stretch, so the panels read as
  one picture side by side: a phone that spills into the next panel, a panel
  of points instead of a screen, a phone lying across the edge of the last two,
  turned in 3D.
- **`exploded`** — each phone tipped back in an orthographic view, with parts
  of its own screen lifted straight up off it in layers; the regions are
  `"layers"` in strings, in percent of the capture.
  Phones are drawn `steel`, `hairline` or with no frame at all, one attribute
  in `world.html`; `--panorama-image` swaps the drawn scene for a picture.

The copy is plain except for `{capture:N}` placeholders, each filled with
the Nth capture already taken, in filename order, so the panels open showing
the app. A placeholder with no capture yet stays as it is until one is taken.
From there the set is yours: the variables at the top of `panel.css` are
the look, `strings/en-US.json` the words. `--captures` is written to
`recadro.json`; leave it out when captures go in the set's own `captures/`.

## When captures live elsewhere

A capture flow usually writes where it writes. Tell the set with
`recadro.json` beside `panels/`:

```json
{ "captures": "../../e2e/screenshots/{device}/{locale}" }
```

Paths are relative to the set. `{device}` is the slot id and is required;
`{locale}`, when present, makes the captures per locale. The folder must be
inside the repository. The only other key is `out`, for renders somewhere
other than `<set>/out`. Unknown keys are an error.

## Commands

```
recadro init   <dir> --starter <name> [--captures <pattern>]
recadro dev    [--panels <dir>] [--port <n>]
recadro render [--panels <dir>] [--out <dir>] [--devices 6.9,13-iPad] [--locales en-US] [--incomplete]
```

Flags win over `recadro.json`, which wins over the set's names. `--panels`
defaults to the set found from the working directory, `--locales` to the names
in `strings/` (or `en-US`), `--devices` to the slots with a captures folder (or
all), `--out` to `<set>/out`. Both commands print what they picked and why.

## The lineup is the check

`dev` serves every panel side by side at `/`, which is how a customer meets them
in a search result and the only view in which the *story* can be judged rather
than the layout. The first three are grouped on their own — all a search result
shows — with the rest below. It shows the live panels by default and the
contents of `out/` on a toggle, so a rendered set can be compared against the
design; a panel with no PNG there is a hole naming the file it looked for. When a capture, a strings file or anything else a panel fetches
changes, the panels reload.

The ground behind them switches between the App Store's light and dark
backgrounds, starting from your system's appearance. The store shows each
screenshot on both, and an edge that holds on one can vanish on the other.

The lineup keeps its settings in its address (`/?store=light&device=13-iPad`),
so a reload keeps the view, two tabs can show two, and a link opens the same
one. The ground, size and wrap are remembered too, for the next time you open
it.

Click a panel to see it alone, as large as the window allows, with its
neighbours dimmed either side on a wide window, so an edge that has to carry
into the next panel can still be judged; the arrow keys, a swipe or a click on
a neighbour step through the set and Esc comes back to the lineup. On a phone,
the first three sit across the screen, as a search result shows them there.

The pointer (`P`) copies a reference to one spot on one panel — its file, the
point in viewport units and delivered pixels, the element there — for pasting
into a coding agent. [AUTHORING.md](AUTHORING.md) tells the agent how to read it.

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
`render`, so `out/` only ever holds complete panels and can be uploaded
wholesale.

A panel with **no** image at all — a text-only story panel — has nothing to fail
and ships. The distinction is present-but-broken, not absent.

To look at incomplete panels without a browser — in CI, or from an agent —
`render --incomplete --out <dir>` shoots every panel. It refuses to write into
the set's own `out`, where an empty frame would ship.

## With a coding agent

[`AUTHORING.md`](AUTHORING.md) ships in the package: the contract as
instructions, the mistakes an agent reliably makes with a tool that reads names
and not contents, and how to look at its own work without a browser. Point your
agent file at it — one line in `CLAUDE.md` or `AGENTS.md`:

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

**Free for any app, paid or free.** Making screenshots with recadro asks
nothing of you or your app. The screenshots are yours, and so is a set you
start from a starter: `starters/` is [MIT-0](starters/LICENSE), with no notice
to keep.

recadro itself is [FSL-1.1-ALv2](LICENSE), the Functional Source License. Use
it, change it and share it for any purpose except a commercial product or
service that does what recadro does; free tools may build on it. Each version
becomes Apache 2.0 two years after its release. A commercial product built on a
version younger than that needs a license from
[Johnny Slakva](https://slakva.me/).
