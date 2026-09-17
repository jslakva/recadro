# Authoring panels for recadro

Instructions for a coding agent, or a person, changing a panel set that
recadro renders. Everything here follows from one fact: **recadro reads what a
set's files are called and where they are, never what they say.** The layout,
its strings, its tokens and its capture filenames are the repo's. The
[README](README.md) explains the tool and why it is shaped this way.

## Inputs, the set, outputs

```
<captures>/[<locale>/][<device>/]<file>.png   inputs: raw simulator captures
<set>/
  panels/NN-slug.html     the panels, in filename order; the slug is the name without .html
  strings/<locale>.*      one entry per locale; the names are the locales
  panel.css, panel.js     whatever the panels share; recadro never reads them
  recadro.json            optional: where the inputs and outputs are, nothing else
  AGENTS.md, CLAUDE.md    written by init; they point agents here
<out>/<locale>/<device>-<slug>.png            outputs: the renders
```

Inputs and outputs live where the repo keeps them, named in `recadro.json`;
without it, both are in the set, at `<set>/captures/` and `<set>/out/`.
Captures must be inside the repository, since a page loads them by URL from
its root. Renders may go anywhere; the lineup's `out/` view shows only what
is inside the repository.

The folders below `<captures>` are read by name: one named for a locale
(`en-US`) holds that locale's captures, one named for a slot (`iPhone`,
`iPad`) holds that slot's, either inside the other, and each optional. A
folder that names no slot serves the slot its captures are shaped for, so a
flat folder of phone captures is an iPhone-only set, and captures shared by
every locale need no locale folder. Two slots' captures go in a folder each,
since a panel asks for the same filename on both.

Renders go one folder per locale, flat, the slot in the filename: the tree
fastlane's `deliver` reads, which picks the slot from the pixel size. An `out`
with `{device}` in it puts the slot in a folder instead
(`"out": "out/{locale}/{device}"` writes `<out>/<locale>/<device>/<slug>.png`).

- recadro finds the set from where a command runs: that folder, the nearest
  set above it, or the one set below it. With several sets in the repo, pass
  `--panels <dir>`; the error lists them.
- Before changing one panel, read what they share — `panel.css`, `panel.js` —
  and `recadro.json` if there is one. The conventions there are the repo's.
- The server's root is the repository: the nearest folder holding `.git`.
  Outside git it is the nearest JS workspace or `package.json`, else the set
  itself. A panel reaches anything in the repo by a relative or root-absolute
  URL, and nothing beyond it. Relative URLs resolve against the page,
  `panels/<slug>.html`, even from a shared module script one folder up, so a
  panel's strings are `../strings/${locale}.json`.
- A `vite.config.*` beside `panels/`, if present, is merged into the server.
  It cannot move the root.

## The contract

```
tool → page:   ?panel=<slug>&device=<slot>&locale=<locale>&captures=<folder URL>
page → tool:   nothing
tool → disk:   <out>/<locale>/<device>-<slug>.png
```

| slot     | App Store Connect display | delivered pixels | viewport (CSS px) | scale |
|----------|---------------------------|------------------|-------------------|-------|
| `iPhone` | 6.9″                      | 1320 × 2868      | 440 × 956         | 3     |
| `iPad`   | 13″                       | 2048 × 2732      | 1024 × 1366       | 2     |

The page is the viewport, `100vw × 100vh`. The numbers are for your
understanding and belong in no panel. `captures` is a root-absolute folder URL
ending in `/`, already resolved for this slot and locale; the page appends the
filename it wants — the slug plus `.png`, unless the panel maps names itself.

## Don't

- **Don't add keys to `recadro.json` or create another config for recadro.**
  Strings, tokens, which panel shows which capture — the page reads those from
  its own files, and recadro reads none of them.
- **Don't build capture paths in a panel.** Use `?captures=`. A path written
  into `panel.js` breaks the moment captures move or become per locale.
- **Don't write device dimensions into CSS or JS.** Size in `vw`, `vh` and
  `%`. Use `?device=` to fork a layout — set it as an attribute and select on
  it — never for pixel arithmetic.
- **Don't hide a missing capture behind a placeholder that loads.** A panel is
  complete when none of its `<img>`s failed, and `render` ships complete
  panels; a placeholder swapped in goes to the App Store. Keep the `<img>`,
  hide it on `error` with an inline style, and draw the empty state on its
  container. `img.hidden = true` is not enough where a rule gives the image a
  `display`; the broken-image glyph shows through.

  ```js
  img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  ```

- **Don't put decoration in an `<img>`.** Every `<img>` counts toward whether
  a panel is complete. Captures and crops of them are `<img>`; backgrounds,
  textures and ornaments are CSS, which fails quietly. In CSS, `url()` is
  relative to the stylesheet, not the page.
- **Don't name strings files anything but locales.** Every entry in `strings/`
  named like a locale is rendered. Shared strings go elsewhere, such as
  `strings-common.json` beside the folder.
- **Don't animate on load.** The shot is taken once the network is idle and
  fonts are ready, not once motion stops.
- **Don't follow the system's light or dark appearance.** `render` shoots in
  the light one, and the store shows that one image in both. Make one panel
  that holds on both of the lineup's grounds.
- **Don't keep the network busy.** Polling, analytics or a long-lived request
  holds off `networkidle` and delays or times out the render.
- **Don't hardcode an origin or port.** Relative or root-absolute URLs only.

## Captures, strings, recadro.json

- **Captures** are full-screen simulator screenshots, one per panel and slot,
  in `captures/`: `<file>` the panel's slug unless the page maps it. One
  slot's captures can sit flat in the folder; with `iPad` as well as `iPhone`
  (App Store Connect requires it when the app supports iPad), each slot's go
  in a folder named exactly for it. Captures that differ per language go in a
  folder named for the locale, `captures/<locale>/[<slot>/]`; a locale with
  no folder of its own gets the captures outside any.
- **Strings** are one file per locale in `strings/`, named for the locale, in
  whatever format the panels read. Adding `strings/de-DE.json` is the whole of
  adding German; recadro renders it from the name. A different type stack for
  a language is `:root:lang(de)` once the page sets `lang`.
- **`recadro.json`** only when captures are not in `<set>/captures/` or
  renders should not go to `<set>/out/<locale>/`:

  ```json
  { "captures": "../../e2e/screenshots", "out": "../../fastlane/screenshots/{locale}" }
  ```

  Paths are relative to the set; captures must be inside the repository.
  `captures` is the folder whose locale and slot folders are read by name, so
  it takes no placeholders. `out` takes `{locale}`, a folder per locale, and
  `{device}`, a folder per slot, each a whole folder name; `{locale}` is
  appended when absent, and without `{device}` the slot prefixes the filename.
  Those two keys are all it takes; anything else is an error. Command-line
  flags win over it.
- A panel reporting `no capture at <path>` for a file that exists has a wrong
  filename or the file in a folder serving another slot: the path is what the
  page asked for, from the repository root, so compare it with the file. A
  `{capture:N}` in it is a placeholder `init` left for a capture not yet taken.
  `dev` and `render` print, on their `captures` line, which slot each folder
  serves and how many captures in a folder told by shape are shaped for the
  other slot; those are never found.

## Look at your work

You have no browser, so the PNGs are your lineup. Shoot every panel, including
ones whose capture does not exist yet, somewhere outside the set's `out`:

```bash
npx recadro render --out <scratch dir> --incomplete
```

Open `<scratch dir>/<locale>/<device>-<slug>.png` for every panel you touched,
at every slot and locale. Look for a headline that wraps badly or is cropped,
text past the frame, a fallback font, a capture that did not load, a layout
that only works on one slot or in one language. Look at the first three
together: they are all a search result shows. Don't assert image dimensions;
they are exact by construction.

`npx recadro render` alone produces what ships. It prints what it picked and
why, then one line per shot:

```
recadro  6 panels in store/screenshots
         devices   iPhone  (no captures for iPad)
         locales   de-DE, en-US  (strings/)
         out       store/screenshots/out/{locale}/{device}-{slug}.png
  wrote   en-US/iPhone-01-hero.png
  skipped en-US/iPhone-03-quote — no capture at <path>
```

It exits 0 either way; read the lines. A panel is incomplete when an `<img>` of
its failed, and `render` skips it, so `out/` only ever holds this run's
complete panels and can be uploaded wholesale; what an earlier run wrote for
each slot and locale rendered is removed first, and the other slot's files are
left alone. A panel with no `<img>` at all is complete and ships. A device
missing from `devices` has no captures; `--devices` renders it anyway.
`--out` moves the folder and keeps the layout below it. `--incomplete`
refuses to write into the set's own `out`.

`render` needs Playwright's Chromium, installed apart from the package. Where it
is missing, `render` writes nothing and prints the pinned install command;
run that one, not a bare `npx playwright install`, and ask before running it:
it downloads about 200 MB. At a terminal, `render` asks instead.

`npx recadro dev` serves the lineup — every panel side by side — to a person
with a browser, and does not exit. If you start it, run it in the background
and stop it when you are done.

## References from the lineup

The lineup's pointer names one spot on one panel. A person may paste it to
you, or send it as a note while you listen (next section):

```
02-voices · iPhone · en-US
file     store/screenshots/panels/02-voices.html
point    48.2vw 40.6vh · px 636,1164 of 1320×2868
element  main > header > p.sub "Each character in its own voice."
```

- The first line is the slug, the slot and the locale. Look at that slot, not
  only the default one.
- `file` and any `src` are paths from the repository root.
- `point` is one spot twice: in the panel's viewport units, which its CSS is
  written in, and in the pixels of the PNG `render` writes for that slot.
- `element` is what was under the cursor, with its own text or its image
  source. Text a page fetched is not in its HTML, so search the repo for the
  quoted text, not the selector. A container as `element` means the spot is
  between its children — a gap, a margin — so read `point` for where. A
  reference taken from the rendered `out/` view has no `element` line.

The reference says where, not what is wrong; the words that come with it do.
Shoot the panel before and after the change and look at that spot.

## Notes from the lineup

Started as `recadro dev --live`, the server carries notes: a person points at
a spot, types a line, and it reaches you with the reference.

```bash
npx recadro dev --live          # the lineup, taking notes; leave it running
npx recadro wait                # prints each note as it is pinned, until the server goes
npx recadro reply 3 "Sub is two lines on iPad now"
```

`wait` finds the live server for the set and does not exit while it lives.
Run it under whatever your harness has that reports a command's output line by
line as it arrives, not when it exits. Each note prints as one block:

```
recadro  note 3 from the person at the lineup
         02-voices · iPhone · en-US
         file     store/screenshots/panels/02-voices.html
         point    48.2vw 40.6vh · px 636,1164 of 1320×2868
         element  main > header > p.sub "Each character in its own voice."
         note     wraps to three lines on iPad, keep it to two
         reply    recadro reply 3 "<what you changed>"
```

`note` is the person's words, printed as typed and addressed to you; the
server reads nothing. `reply` answers with one line, shown at the note's pin,
so the person knows the reload they saw was yours; reply once per note, after
the change, and change nothing outside the set for it. When `wait` prints that
the server is gone, stop; a new `dev --live` needs a new `wait`. With nobody
listening, the pointer copies to the clipboard as before.

## Changing the set

- **A panel's copy:** in `strings/<locale>.*`, never in the HTML.
- **A region a panel enlarges or lifts:** `--x --y --w --h` in the panel's own
  `<style>`, in percent of the capture. Fit it to the app's screen on each
  slot, forking with `[data-device="iPad"]`, and with `:lang(de)` only where a
  language moves the screen. Look at the capture for that slot before choosing
  numbers.
- **New panel:** add `panels/NN-slug.html`. Renaming or renumbering changes the
  output filenames, and the upload order follows them.
- **Text-only panel:** leave out `<img>` entirely; with nothing to fail, it
  ships.
- **New locale:** add its strings file. **New device:** its captures in a
  folder named for the slot, and the other slot's in one too. **Captures
  move:** change `captures` in `recadro.json`, or create the file. No panel
  changes for any of these.

## Starting a set

```bash
npx recadro init <dir> --starter <name> [--captures <path>]
```

copies a starter — `overlay`, `caption`, `panorama`, `exploded`, `callouts` or
`poster` — into a new folder, fills its `{capture:N}` placeholders with the
captures already taken in filename order, writes `--captures` (the captures
folder, from where the command runs) into `recadro.json` relative to the set, and adds
`AGENTS.md` and `CLAUDE.md` pointing here. The placeholders are `data-capture`
in the panels' HTML, and in `panorama` also in `world.html`, the scene every
panel shows a stretch of. Then adapt: the variables at the top of `panel.css`
to the app's colours and fonts, the words in `strings/en-US.json`, and any
`{capture:N}` left to the capture still to take. The copy is the repo's:
starters are MIT-0, with no notice to keep, and recadro's own license covers
the tool, not the set, the app or the renders.

## Moving an existing set onto this layout

A set made before this layout typically fetches strings from outside it and
builds capture paths itself. Shoot it with `--incomplete` first, so there is
something to compare against, then:

1. **Strings:** one file per locale in `strings/`, holding only what the panels
   read; a section of a larger file moves out on its own. Point the panels'
   fetch at `../strings/${locale}.<ext>`.
2. **Captures:** if the capture flow writes elsewhere, write `recadro.json`
   with `captures` naming that folder. Slot folders in it must be named
   `iPhone` and `iPad`, locale folders for the locale; a folder named
   otherwise is not read. Rename them in the capture flow if not.
3. **Panels:** replace every capture path the page builds with `?captures=`
   plus the filename. Keep whatever maps a slug to a capture filename.
4. **Commands:** drop `--panels`, `--locales` and `--devices` from the repo's
   scripts where the set now says the same thing.
5. **Compare:** shoot again into a second folder and look at both side by side.
   Nothing should have changed.
6. **Agent files:** if the set has none, add them as `init` writes them:
   `CLAUDE.md` is the one line `@AGENTS.md`, and `AGENTS.md` says to read this
   file before changing the set.
