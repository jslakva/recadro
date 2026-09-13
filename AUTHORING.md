# Authoring panels for recadro

For a coding agent, or a person, changing a panel set that recadro renders. The
[README](README.md) explains the tool; this says what to do and what not to.
Every rule here follows from one fact: **recadro reads what a set's files are
called and where they are, never what they say.** The layout, its strings, its
tokens and its capture filenames belong to the repo.

## Find your bearings

A set is a folder holding `panels/`:

```
<set>/
  panels/NN-slug.html     the panels, ordered by filename
  strings/<locale>.*      one entry per locale; the names are the locales
  captures/<device>/      raw captures, unless recadro.json points elsewhere
  recadro.json            optional: "captures" and "out", nothing else
  out/                    renders
  panel.css, panel.js     whatever the panels share
```

- The filename without `.html` (`01-hero`) is the slug, the `?panel=` value and
  the output basename.
- recadro finds the set: the folder a command runs in, the nearest set above
  it, or the one set below it. With several sets in the repo, pass
  `--panels <dir>`; the error lists them.
- Read what the panels share — typically `panel.css` and `panel.js` — before
  changing one panel. The conventions there are the repo's.
- Read `recadro.json` if there is one: it says where the captures are.
- A `vite.config.*` beside `panels/`, if present, is merged into the server; it
  cannot move the root.

## The contract

```
tool → page:   ?panel=<slug>&device=<slot>&locale=<locale>&captures=<folder URL>
page → tool:   nothing
tool → disk:   <out>/<device>/<locale>/<slug>.png
```

| slot      | delivered pixels | viewport (CSS px) | scale |
|-----------|------------------|-------------------|-------|
| `6.9`     | 1320 × 2868      | 440 × 956         | 3     |
| `13-iPad` | 2048 × 2732      | 1024 × 1366       | 2     |

The page is the viewport, `100vw × 100vh`. Those numbers are for your
understanding; they belong in no panel.

`captures` is a root-absolute folder URL ending in `/`, already resolved for
this slot and locale. The page appends a filename: the slug plus `.png`, or
whatever its strings map the slug to.

## recadro.json

Only when captures are not in `<set>/captures/<device>/`, or renders should not
go to `<set>/out`:

```json
{ "captures": "../../e2e/screenshots/{device}/{locale}", "out": "out" }
```

- Paths are relative to the set, and captures must be inside the repository.
- `{device}` is required: every slot has captures of its own. `{locale}` is
  optional and makes the captures per locale.
- Those two keys are all it takes; anything else is an error. Command-line
  flags win over it.

## Captures

Captures are full-screen simulator screenshots, one per panel and slot, at
`captures/<slot>/<file>.png`: `<slot>` exactly `6.9`, plus `13-iPad` when the
app supports iPad (App Store Connect then requires it); `<file>` the panel's
slug (`01-hero.png`) unless the page maps it. Per-locale captures go in
`captures/<slot>/<locale>/`, with `"captures": "captures/{device}/{locale}"`.

## Starting a set

`recadro init <dir> --starter overlay|caption|panorama [--captures <pattern>]` copies a
starter into a new folder, fills its `{capture:N}` placeholders with the
captures already taken, in filename order, and writes `--captures` to
`recadro.json`. In `panorama` the placeholders are in `world.html`, the scene
every panel shows a stretch of, found from the number its filename starts with. Then adapt the copy: the variables at the top of
`panel.css` to the app's colours and fonts, the words in `strings/en-US.json`,
and a `{capture:N}` left over to the capture still to take.

## Don't

- **Don't add keys to `recadro.json` or create another config for recadro.**
  Strings, tokens, which panel shows which capture — the page reads those from
  its own files, and recadro would read none of them.
- **Don't build capture paths in a panel.** Use `?captures=`. A path written
  into `panel.js` breaks the moment captures move or become per locale.
- **Don't write device dimensions into CSS or JS.** Size in `vw`, `vh` and
  `%`. Use `?device=` to fork a layout — set it as an attribute and select on
  it — never for pixel arithmetic.
- **Don't hide a missing capture behind a placeholder that loads.** A panel is
  complete when none of its `<img>`s failed, and `render` ships complete
  panels. Swap a failed capture's `src` for a placeholder and the placeholder
  goes to the App Store. Style the failure instead: keep the `<img>`, hide it on
  `error` with an inline style, and draw the empty state on its container.

  ```js
  img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  ```

  `img.hidden = true` is not enough when any rule gives the image a `display`;
  the broken-image glyph shows through.
- **Don't put decoration in an `<img>`.** Every `<img>` counts toward whether a
  panel is complete, so a missing background or sparkle in one holds the panel
  back. Captures and crops of them are `<img>`; backgrounds, textures and
  ornaments are CSS, which falls back quietly when a file is missing. In CSS,
  `url()` is relative to the stylesheet, not the page.
- **Don't name strings files anything but locales.** Every entry in `strings/`
  named like a locale is rendered; shared strings go elsewhere, such as
  `strings-common.json` beside the folder.
- **Don't animate on load.** The shot is taken once the network is idle and
  fonts are ready, not once motion stops; an entrance animation may be captured
  part-way.
- **Don't keep the network busy.** Polling, analytics or a long-lived request
  holds off `networkidle`, which delays the render or times it out.
- **Don't hardcode an origin or port.** Use relative or root-absolute URLs.

## Paths

- Relative URLs in `fetch`, `src` and `href` resolve against the page,
  `panels/<slug>.html` — even from a shared module script one directory up. So
  a panel's strings are `../strings/${locale}.json`.
- The server's root is the repository: the nearest directory holding `.git`.
  A root-absolute URL (`/design/tokens.css`) resolves from there, and a
  relative one can climb to anywhere in the repo but no further.
- Outside git the root is the nearest JS workspace or `package.json`, and
  failing both the set itself — then nothing beside it is reachable.
- A panel reporting `no capture at <url>` for a file that exists is a wrong
  filename or a wrong `captures` in `recadro.json`. The URL is what the page
  asked for; compare it with the file.

## Look at your work

You have no browser, so the PNGs are your contact sheet. Shoot every panel,
including ones whose capture does not exist yet, somewhere outside the set's
`out`:

```bash
npx recadro render --out <scratch dir> --incomplete
```

Then open `<scratch dir>/<device>/<locale>/<slug>.png` for every panel you
touched, at every slot and locale. Look for a headline that wraps badly or is
cropped, text overflowing the frame, a fallback font, a capture that didn't
load, and a layout that only works on one slot or in one language. Look at the
first three panels together: they are all a search result shows. Don't assert
image dimensions; they are exact by construction.

To produce what ships:

```bash
npx recadro render
```

It first prints what it picked and why:

```
recadro  6 panels in store/screenshots
         devices   6.9  (no captures folder for 13-iPad)
         locales   de-DE, en-US  (strings/)
         out       store/screenshots/out
```

Then `wrote <device>/<locale>/<slug>.png` per shot and
`skipped <device>/<locale>/<slug> — no capture at <url>` per incomplete panel,
and it exits 0 either way — read the lines, not the exit code. A device missing
from `devices` has no captures folder; pass `--devices` to render it anyway.
Each `<out>/<device>/<locale>/` is cleared first, so it only ever holds this
run's complete panels. `--incomplete` refuses to write into the set's `out`.

`render` needs Playwright's chromium once. If it fails for want of a browser,
the install is `npx playwright install chromium` — ask before downloading.

`recadro dev` starts a server and does not exit; it is the contact sheet for a
person with a browser, at `/`. If you start it, run it in the background and
stop it when you are done.

## References from the contact sheet

A person at the contact sheet may paste you what its pointer copies — one spot
on one panel:

```
02-voices · 6.9 · en-US
file     store/screenshots/panels/02-voices.html
point    48.2vw 40.6vh · px 636,1164 of 1320×2868
element  main > header > p.sub "Each character in its own voice."
```

- The first line is the slug, the slot and the locale. Look at that slot, not
  only the default one.
- `file` and any `src` are paths from the server's root, the repository.
- `point` is one spot twice: in the panel's viewport units, which is what its
  CSS is written in, and in the pixels of the PNG `render` writes for that slot.
- `element` is what was under the cursor in the rendered page, with its own
  text or its image source. Text a page fetched is not in its HTML file, so
  search the repo for the quoted text, not for the selector.
- A container as `element` means the spot is between its children: a gap, a
  margin, the space around the capture. Read `point` for where.
- A reference taken from the rendered `out/` view has no `element` line.

The reference says where, not what is wrong; the words that come with it do.
Shoot the panel before and after the change and look at that spot.

## Changing the set

- **New panel:** add `panels/NN-slug.html`. Renaming or renumbering changes
  the output filenames, and the upload order follows them.
- **Text-only panel:** leave out `<img>` entirely. With nothing to fail it is
  complete and ships.
- **New locale:** add its strings file to `strings/`, named for the locale and
  in the same format as the others — `strings/de-DE.json`. That is the whole
  change; recadro renders it from the name. A different type stack is
  `:root:lang(de)` once the page sets `lang`.
- **New device:** captures for it appear in their own folder, named for the
  slot. Slots are recadro's table; the two above are what App Store Connect
  needs, since it derives the smaller iPhone sizes from 6.9".
- **Captures move:** change `captures` in `recadro.json`, or create the file.
  No panel changes.

## Moving an existing set onto this layout

A set made before this layout — or by hand — typically fetches strings from
somewhere outside it and builds capture paths itself. Move it in this order,
and shoot it with `--incomplete` before you start so you have something to
compare against:

1. **Strings.** Put one file per locale in `strings/`, named for the locale,
   holding only what the panels read. When the panels' strings are a section
   of a larger file — a table inside a store listing — move that section out
   on its own and leave the rest where it is. Symlink a file into `strings/`
   only when the panels read it whole and other tooling reads it too. Point the
   panels' fetch at `../strings/${locale}.<ext>`.
2. **Captures.** If the capture flow writes somewhere other than
   `<set>/captures/<device>/`, write `recadro.json` with a `captures` pattern
   for that folder. Its folders must be named for the slots, `6.9` and
   `13-iPad`; if they are not, rename them in the capture flow.
3. **Panels.** Replace every capture path the page builds with `?captures=`
   plus the filename. Keep whatever maps a slug to a capture filename.
4. **Commands.** Drop `--panels`, `--locales` and `--devices` from the repo's
   scripts where the set now says the same thing; keep a flag only where it
   overrides the set on purpose.
5. **Compare.** Shoot again with `--incomplete` into a second folder and look
   at the two sets side by side. Nothing should have changed.

## Why it is shaped this way

A tool that parses a panel's strings or tokens has to learn that one key is the
headline and another the ground, and every such key is a layout concept it then
owns. Reading names and four params, and nothing a page wrote, is what keeps the
layout yours.
[docs/design.md](https://github.com/jslakva/recadro/blob/main/docs/design.md)
has the full reasoning.
