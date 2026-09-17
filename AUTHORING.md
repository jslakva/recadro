# Authoring panels for recadro

Instructions for a coding agent, or a person, changing a panel set that
recadro renders. Everything here follows from one fact: **a panel is an
ordinary web page, and recadro serves it, sizes it to each slot and shoots
it.** It finds the set's pieces by their names and places and hands the page
four query params; what the page shows — its layout, its words, its tokens,
which capture it loads — is written in the repo like any other page. The
[README](README.md) explains the tool and why it is shaped this way. How an
agent works on a set — checking without a browser, reading what the lineup
sends, the live loop — is in `skills/recadro/SKILL.md` beside this file,
which `recadro skill` installs with this file beneath it.

## Inputs, the set, outputs

```
recadro.json              where recadro runs: "set", and where the inputs and outputs are, nothing else
<captures>/[<locale>/][<device>/]<file>.png   inputs: raw simulator captures; the folders are read by name, both optional
<set>/
  panels/NN-slug.html     the panels, in filename order; the slug is the name without .html
  strings/<locale>.*      one entry per locale; the names are the locales
  panel.css, panel.js     what the panels share — the look, the loading — as any page would
<out>/<locale>/<device>-<slug>.png            outputs: the renders, flat per locale as fastlane's deliver reads them
```

recadro reads `recadro.json`. It looks in the folder a command runs in;
`--config <path>` names another file, or the folder holding one. Every key
is optional, paths are relative to the file, and the file itself is plain
JSON, without the comments:

```jsonc
{
  // the folder holding panels/ and strings/; default: the file's own folder
  "set": "store/screenshots",
  // the inputs; default: <set>/captures/. Inside the repository: a page loads them by URL from its root
  "captures": "e2e/screenshots",
  // the outputs; default: <set>/out/{locale}/. Inside the repository, or the lineup cannot show them
  "out": "fastlane/screenshots/{locale}"
}
```

Several sets are several files: `recadro.json` for the one run without a
`--config` flag, any name for the others, each picked with `--config <file>`.

- Before changing one panel, read what they share — `panel.css`, `panel.js` —
  and `recadro.json`. What is in them is the repo's own; recadro asks nothing
  of a page beyond the Don'ts below.
- recadro serves the pages, for `dev` and `render` alike, from the repository
  root: the nearest folder holding `.git`, or outside git the nearest JS
  workspace or `package.json`, else the set itself. A panel reaches anything
  in the repo by a relative or root-absolute URL, and nothing beyond it.
  Relative URLs resolve against the page, `panels/<slug>.html`, even from a
  shared module script one folder up, so a panel's strings are
  `../strings/${locale}.json`. In CSS, `url()` is relative to the stylesheet
  instead.
- A `vite.config.*` beside `panels/`, if present, is merged into the server.
  It cannot move the root.

## What a page is given

Four query params, and nothing else:

```
?panel=<slug>&device=<slot>&locale=<locale>&captures=<folder URL>
```

`captures` is a root-absolute folder URL ending in `/`, already resolved for
this slot and locale; the page appends the filename it wants — the slug plus
`.png`, unless the panel maps names itself. The page is the viewport,
`100vw × 100vh`, opened at the slot's size:

| slot     | App Store Connect display | delivered pixels | viewport (CSS px) | scale |
|----------|---------------------------|------------------|-------------------|-------|
| `iPhone` | 6.9″                      | 1320 × 2868      | 440 × 956         | 3     |
| `iPad`   | 13″                       | 2048 × 2732      | 1024 × 1366       | 2     |

The numbers are for reading references and choosing hairlines; they belong in
no panel. 

For how a page reads the params and loads its capture and strings, see any
starter's `panel.js`: `starters/<name>/panel.js` in the installed package, or on
[GitHub](https://github.com/jslakva/recadro/tree/main/starters).

## Don't

- **Don't build capture paths in a panel.** Use `?captures=`. A path written
  into `panel.js` breaks the moment captures move or become per locale, and
  `render` cannot tell that a capture asked for elsewhere is missing.
- **Don't write device dimensions into CSS or JS.** Size in `vw`, `vh` and
  `%`. Use `?device=` to fork a layout — set it as an attribute and select on
  it — never for pixel arithmetic.
- **Don't name strings files anything but locales.** Every entry in `strings/`
  named like a locale is rendered. Shared strings go elsewhere, such as
  `strings-common.json` beside the folder.
- **Don't animate on load.** The shot is taken once the network is idle and
  fonts are ready, not once motion stops.
- **Don't follow the system's light or dark appearance.** `render` shoots in
  the light one, and the store shows that one image in both. Make one panel
  that holds on both grounds; the lineup shows the store's light and dark
  backgrounds for that.
- **Don't keep the network busy.** Polling, analytics or a long-lived request
  holds off `networkidle` and delays or times out the render.
- **Don't hardcode an origin or port.** Relative or root-absolute URLs only.

## Captures, strings, recadro.json

- **Captures** are full-screen simulator screenshots, one per panel and slot,
  in `captures/`: `<file>` the panel's slug unless the page maps it. One
  slot's captures can sit flat in the folder. With both slots (App Store
  Connect requires iPad screenshots when the app supports iPad), each gets a
  folder named for it, `iPhone/` and `iPad/`, since a panel asks for the same
  filename on both and one folder serves one slot. Captures that differ per
  language go in a folder named for the locale, `captures/<locale>/[<slot>/]`
  (or `<slot>/<locale>/`); a locale with no folder of its own gets the
  captures outside any.
- **Strings** are one file per locale in `strings/`, named for the locale, in
  whatever format the panels read. Adding `strings/de-DE.json` is the whole of
  adding German; recadro renders it from the name, and a set with no `strings/`
  renders `en-US` alone. A different type stack for
  a language is `:root:lang(de)` once the page sets `lang`.
- **`recadro.json`** (its shape is at the top): `init` writes it, with `set`
  and, from `--captures`, the second key; add `out` by hand. Paths are relative to the file's folder, not the set.
  `captures` names the folder, laid out inside as above. `out` takes
  `{locale}` and `{device}`, each a whole folder name; without `{locale}` it
  is added at the end, and without `{device}` the slot prefixes the filename. The default is the tree fastlane's `deliver`
  reads, which picks the slot from the pixel size;
  `"out": "renders/{locale}/{device}"` gives a folder per slot instead, the
  file the slug alone. Those three keys are all it takes; anything else is an
  error. Command-line flags win over it.
- A panel reporting `no capture at <path>` for a file that exists has a wrong
  filename or the file in a folder serving another slot: the path is what the
  page asked for, from the repository root, so compare it with the file. A
  `{capture:N}` in it is a placeholder `init` left for a capture not yet taken.
  The `captures` line `dev` and `render` print says which slot each folder
  serves.

## Commands

```
recadro init   <dir> [--starter <name>] [--captures <dir>] [--skill | --no-skill]
recadro dev    [--config <path>] [--port <n>] [--live]
recadro render [--config <path>] [--out <dir>] [--devices iPhone,iPad] [--locales en-US] [--incomplete]
recadro wait   [--config <path>]
recadro reply  <id> "<what you changed>" [--config <path>]
recadro skill  [--config <path>]
```

### `init`

Makes a set from a starter: creates the panels from the chosen starter's
design, prefills them with the captures already taken, writes `recadro.json`
where the command runs, and offers to install the skill if absent.

### `skill`

Writes the `/recadro` skill for Claude Code at
`.claude/skills/recadro/SKILL.md` in the repository, or rewrites the one
there from the installed recadro, asking first at a terminal. `dev` says
when the installed skill is from another version.

### `dev`

Serves the lineup — every panel side by side. Reloads the panels as their
files change. Pointer mode (`P`) copies a reference to a spot in a panel, for
pasting to an agent.

With `--live` it also carries notes from the lineup to an agent running
`wait` (below); with none connected, the pointer copies as before.

### `render`

Produces what ships. It prints what it picked and why, then one line per shot:

```
recadro  6 panels in store/screenshots
         devices   iPhone  (no captures for iPad)
         locales   de-DE, en-US  (strings/)
         out       store/screenshots/out/{locale}/{device}-{slug}.png
  wrote   en-US/iPhone-01-hero.png
  skipped en-US/iPhone-03-quote — no capture at <path>
```

A panel with any capture missing — a request under `?captures=` that came
back without the file — is skipped, and `render` exits non-zero, so a script
that uploads next stops. The rest are written, each run replacing only its own
slots and locales.

`--incomplete` shoots the skipped panels too, for looking, exits 0, and
requires an `--out` outside the set's own; `--out` keeps the layout below it.

`--devices` renders a slot even with no captures.

`render` needs Playwright's Chromium, installed apart from the package. Where
it is missing, at a terminal `render` asks to install it; anywhere else it
writes nothing and prints the pinned install command. Run that one, not a bare
`npx playwright install`; it downloads about 200 MB.

### `wait` and `reply`

For an agent listening to the lineup; a person reading this can skip them.

```bash
npx recadro dev --live          # the lineup, taking notes; leave it running
npx recadro wait                # prints each note as it is pinned, until the server goes
npx recadro reply 3 "Sub is two lines on iPad now"
```

`wait` finds the live server through the same `recadro.json` — the same
folder, or `--config` — and does not exit while the server lives. Each note
prints as one block: the reference, the person's words as typed, and the
command that answers:

```
recadro  note 3 from the person at the lineup
         02-voices · iPhone · en-US
         file     store/screenshots/panels/02-voices.html
         point    48.2vw 40.6vh · px 636,1164 of 1320×2868
         element  main > header > p.sub "Each character in its own voice."
         note     wraps to three lines on iPad, keep it to two
         reply    recadro reply 3 "<what you changed>"
```

`reply` marks the note done in the lineup, its line shown at the pin.

## Changing the set

- **A set from a starter:** the look is the variables at the top of
  `panel.css`, the words `strings/en-US.json`. A `{capture:N}` left in either
  is a capture still to take; put the filename there once it exists.
- **A panel's copy:** in `strings/<locale>.*`, never in the HTML.
- **A region a panel enlarges or lifts:** `--x --y --w --h` in the panel's own
  `<style>`, in percent of the capture. Fit it to the app's screen on each
  slot, forking with `[data-device="iPad"]`, and with `:lang(de)` only where a
  language moves the screen. Look at the capture for that slot before choosing
  numbers.
- **New panel:** add `panels/NN-slug.html`. Renaming or renumbering changes the
  output filenames, and the upload order follows them.
- **Text-only panel:** ask for no capture; with nothing to miss, it ships.
- **New locale:** add its strings file. **New device:** its captures in a
  folder named for the slot, and the other slot's in one too. **Captures
  move:** change `captures` in `recadro.json`. **The set moves:** change
  `set`. No panel changes for any of these.
