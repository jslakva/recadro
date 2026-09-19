# Authoring panels for recadro

Instructions for a coding agent, or a person, changing a panel set that
recadro renders. Everything here follows from one fact: **a panel is an
ordinary web page, and recadro serves it, sizes it to each slot and shoots
it.** It finds the set's pieces by their names and places and hands the page
four query params; what the page shows — its layout, its words, its tokens,
which capture it loads — is written in the repo like any other page. The
[README](README.md) introduces the tool. How an
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
`--config <path>` names another file, or the folder holding one.

```json
{
  "set": "store/screenshots",
  "captures": "e2e/screenshots",
  "out": "fastlane/screenshots"
}
```

- `set` — The folder holding `panels/` and `strings/`. Default: the file's
  own folder.
- `captures` — The captures folder, laid out as under Captures below. Must be
  inside the repository: a page loads captures by URL from its root. Default:
  `<set>/captures`.
- `out` — Where renders go, as a folder or a pattern. Must be inside the
  repository, or the lineup cannot show them. Default: `<set>/out`.
  - `{locale}` — A folder per locale. Left out, it is added at the end.
  - `{device}` — A folder per slot, the file named `<slug>.png`. Left out,
    the slot prefixes the filename: `<device>-<slug>.png`.

  Each placeholder is a whole folder name.

  `"fastlane/screenshots"` writes `fastlane/screenshots/en-US/iPhone-01-hero.png`,
  the tree fastlane's `deliver` reads, which picks the slot from the pixel
  size. `"renders/{locale}/{device}"` writes `renders/en-US/iPhone/01-hero.png`.

Every key is optional. Paths are relative to the file's folder, not the set.
Any other key or placeholder is an error. Command-line flags win over the
file.

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
[GitHub](https://github.com/jslakva/recadro/tree/main/starters). `blank` is
the smallest set that works, four files.

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

## Captures and strings

- **Captures** are full-screen simulator screenshots, one per panel and slot.
  `<file>` is the panel's slug unless the page maps it. The folder is read by
  its folder names:

  ```
  captures/<file>.png                     one slot: the one the captures are shaped for
  captures/<slot>/<file>.png              both slots, a folder each: iPhone/ and iPad/
  captures/<locale>/[<slot>/]<file>.png   a locale's own captures; <slot>/<locale>/ reads the same
  ```

  - A folder named for no slot serves the slot its captures are shaped for:
    a phone's proportions or an iPad's, whatever their exact size.
  - Two slots need a folder each, since a panel asks for the same filename on
    both. App Store Connect requires iPad screenshots when the app supports
    iPad.
  - A locale with no folder of its own gets the captures outside any locale
    folder.
  - A slot with no captures is not rendered. A set with no captures at all
    renders every slot.
- **Strings** are one file per locale in `strings/`, named for the locale, in
  whatever format the panels read. Adding `strings/de-DE.json` is the whole of
  adding German; recadro renders it from the name, and a set with no `strings/`
  renders `en-US` alone. A strings file other tooling reads where it is can
  be symlinked in. A different type stack for a language is `:root:lang(de)`
  once the page sets `lang`.
- A panel reporting `no capture at <path>` for a file that exists has a wrong
  filename or the file in a folder serving another slot: the path is what the
  page asked for, from the repository root, so compare it with the file. A
  `{capture:N}` in it is a placeholder `init` left for a capture not yet taken.
  The `captures` line `dev` and `render` print says which slot each folder
  serves.

## Commands

```
recadro init   <dir> [--starter <name>] [--captures <dir>] [--out <dir>] [--config <path>] [--skill | --no-skill]
recadro dev    [--config <path>] [--port <n>] [--live]
recadro render [--config <path>] [--out <dir>] [--devices iPhone,iPad] [--locales en-US] [--incomplete]
recadro wait   [--config <path>]
recadro reply  <id> "<what you changed>" [--config <path>]
recadro skill  [--config <path>]
```

- `--config <path>` — The `recadro.json` to use, or the folder holding one.
  Taken by every command. Default: `recadro.json` in the working directory.

### `init`

Makes a set from a starter: creates the panels from the chosen starter's
design, prefills them with the captures already taken, writes `recadro.json`
where the command runs, or where `--config` says — naming the set, and
`captures` and `out` when the flags give them — and offers to install the
skill if absent.

- `<dir>` — The new set's folder.
- `--starter <name>` — The starter to copy. Default: asked at a terminal,
  Enter taking `blank`. Anywhere else the flag is required, and the error
  lists the starters installed.
- `--captures <dir>` — The captures folder, relative to the working
  directory; written to `recadro.json` relative to the file. Default:
  `<set>/captures`, and no key is written.
- `--out <dir>` — Where renders go, a folder or a pattern as `out` takes;
  given and written as `--captures` is. Default: `<set>/out`, and no key is
  written.
- `--config <path>` — Where to write `recadro.json`: a folder that exists, or
  a `.json` name. Default: the working directory.
- `--skill`, `--no-skill` — Add the skill without asking; don't add it, and
  don't ask. Default: asked at a terminal; not added anywhere else.

With no arguments, `init` prints its usage.

A starter's `{capture:N}` is filled with the Nth capture already taken, in
filename order; one with no capture yet is left as it is.

A starter is copied once and the set is the repo's from then on: nothing
records which starter it came from, and no update to recadro changes it.

### `skill`

Writes the `/recadro` skill for Claude Code at
`.claude/skills/recadro/SKILL.md` in the repository, or rewrites the one
there from the installed recadro, asking first at a terminal. `dev` says
when the installed skill is from another version.

### `dev`

Serves the lineup at `/` — every panel side by side, the first three grouped
on their own, as a search result shows them. Reloads the panels as their
files change, captures and strings included. Pointer mode (`P`) copies a
reference to a spot in a panel, for pasting to an agent.

- It shows the live panels, or the contents of `out` on a toggle, where a
  panel not rendered is a hole naming the file it looked for.
- The ground behind the panels switches between the App Store's light and
  dark backgrounds, starting from the system's appearance.
- A click shows a panel alone, its neighbours dimmed either side on a wide
  window; the arrow keys, a swipe or a click on a neighbour step through the
  set, and Esc comes back.
- The settings are in the address, so a link opens a view:
  `/?device=iPad&locale=de-DE&show=out&store=dark`.
  - `device` — `iPhone` or `iPad`.
  - `locale` — One of the set's locales.
  - `show` — `live`, the panels as pages, or `out`, the renders.
  - `store` — `light` or `dark`, the ground behind the panels. Remembered.
  - `size` — A panel's width, 80 to 420. Remembered.
  - `wrap` — `on` or `off`: the first three on a row of their own.
    Remembered.

  A remembered setting is kept by the browser for next time; the address
  wins over it.

Options:

- `--port <n>` — The port to serve on. Default: 5173, or the next one free.
- `--live` — Also carry notes from the lineup to an agent running `wait`
  (below). With none connected, the pointer copies as before.

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

- `--devices <slot>[,<slot>]` — Render only the named slots, `iPhone` or
  `iPad`. A named slot is rendered whether or not it has captures. Default:
  every slot that has captures; all slots if the set has no captures.
- `--locales <locale>[,<locale>]` — Render only the named locales. Default:
  every locale named in `strings/`; `en-US` if there is no `strings/`.
- `--out <dir>` — Write the renders under `<dir>`, in the same layout.
  Default: `out` in `recadro.json`; `<set>/out` if it has none.
- `--incomplete` — Also render the panels that would be skipped, to look at
  them. Exits 0. Requires an `--out` other than the set's own.

Every PNG is written at its slot's exact pixels, flattened onto white and
stamped sRGB, with no alpha channel, which is what App Store Connect checks.
Nothing of that needs asserting or doing again afterwards, and a transparent
ground in a panel comes out white. How a panel looks is checked by nothing:
overflow, a cropped headline, a fallback font are for the eye, in the lineup
or in the PNGs.

recadro needs Node 20.11 or later, and `render` Playwright's Chromium,
installed apart from the package. Where it is missing, at a terminal `render`
asks to install it; anywhere else it writes nothing and prints the pinned
install command.
Run that one, not a bare `npx playwright install`; it downloads about 200 MB.
In CI, run it before `render`, adding `--with-deps` on Linux.

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

`reply` marks the note done in the lineup, its line opening at the pin and
listed in the lineup's log.

The channel exists only under `--live`: plain `dev` serves no endpoint for
it. It writes nothing into the repository, and the server takes a note only
from the lineup's own page, never from another site open in the same browser.

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
