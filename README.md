# recadro — App Store screenshots as code

The apps at the top of the store do not show bare screenshots; their listings
tell a story, one panel at a time. recadro composes those panels from raw
simulator captures. Plain HTML in, exact slot sizes out.

```bash
npx recadro init store/screenshots --starter caption   # a new set from a starter, and recadro.json here naming it
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
recadro.json                # where you run recadro: names the set, and where captures and renders are
store/screenshots/          # the set
  panels/01-hero.html       # the panels; the number prefix is the order
  panels/02-feature.html
  strings/en-US.json        # one per locale; the file names are the locales
  captures/01-hero.png      # raw captures; a folder per device, and per locale, when needed
  panel.css, panel.js       # whatever the panels share; recadro never reads them
  out/                      # rendered: <locale>/<device>-<NN-slug>.png
```

The whole tool ↔ layout contract is four query params:

```
tool → page:   ?panel=02-feature&device=iPhone&locale=en-US&captures=/store/screenshots/captures/
page → tool:   nothing
tool → disk:   out/<locale>/<device>-<NN-slug>.png, at exact slot pixels
```

recadro reads what things are called, never what they say. A page fetches its
own strings and tokens and picks its own capture filenames; recadro opens none
of them. What it owns is what is a fact about the App Store rather than a
preference — the slot geometry — and where a set keeps its pieces.

- **Locales** are the names in `strings/`. Add `strings/de-DE.json` and
  `render` renders German too.
- **Devices** are what the captures are shaped for. A folder of phone
  captures is an iPhone-only set and renders no iPad panels; captures for
  both go in a folder each, `iPhone/` and `iPad/`; no captures at all yet,
  every slot. Captures that differ per language go in a folder named for the
  locale.
- **The set** is what `recadro.json` names, and recadro reads that file in the
  folder you run in — nothing is searched. `init` writes it there, three lines
  at most, so from then on the command is `recadro dev` with no flag. A json
  elsewhere is `--config <path>`.

## Writing a panel

A panel reads its four params and fetches everything else itself. The
smallest set that works is the [`blank`](starters/blank) starter, four files:

- [`panels/01-hero.html`](starters/blank/panels/01-hero.html) — a headline
  and an `<img>` naming its capture, and the script that fills them.
- [`panel.js`](starters/blank/panel.js) — reads the params, sets the
  headline from the strings file and the image from the captures folder. A
  capture not taken yet is asked for and not there — that is how `render`
  knows to skip the panel — and the broken `<img>` is hidden.
- [`panel.css`](starters/blank/panel.css) — the headline over the screen,
  and one fork for iPad.
- [`strings/en-US.json`](starters/blank/strings/en-US.json) — the headline.

Commented-out lines in each show where more words, more screens and a
language's own type go. `npx recadro init store/screenshots --starter blank`
copies it, with the first capture already taken filled in.

`strings/en-US.json` maps each slug to its headline. Its format is this
starter's choice, not recadro's: the strings could be a Markdown table, the
colours your web app's tokens. Sizes are in `vw`/`vh` and the iPad forks on an
attribute, so no device dimension appears anywhere.

The server's root is the repository — the nearest directory holding `.git` —
so a panel can reach anything in the repo by a relative or root-absolute URL.
Outside git it is the nearest JS workspace or `package.json`, and failing both
the set itself, where nothing beside it is reachable.

## Starting from a starter

`init` copies a premade set into a new folder:

```bash
npx recadro init store/screenshots --starter overlay --captures path/to/captures
```

Without `--starter`, `init` at a terminal lists the starters installed and
asks which, Enter taking `blank`. This makes the set and writes `recadro.json` in the folder you
run in, naming it (`{ "set": "store/screenshots" }`), so recadro runs from
that folder with no flag; run `init` from where you will run recadro.
`--captures` is the captures folder and `--out` where renders go, both from
the same place; `init` writes them into the file too. Bare `init` prints
this.

- **`blank`** — one panel, a headline over the screen, and nothing else: the
  set above, for a layout you write yourself or hand to an agent.
- **`overlay`** — the capture fills the panel, and a band of colour over its
  top carries the headline, with highlighted words; one panel magnifies part
  of the screen.
- **`caption`** — a headline and a subline over the screen, framed in a device,
  and one review panel with no screen. Along the way it shows a highlighted
  word with a stroke drawn under it, a blurred copy of the capture as the
  background, an enlarged detail, a background image from the set's `assets/`,
  and a sticker.
- **`panorama`** — one scene as wide as the whole set, drawn once in
  `world.html`, with each panel showing its own stretch, so the panels read as
  one picture side by side: a phone turned in 3D lying across the edge of the
  second and third, a phone that spills into the next panel, and a closing
  panel of points instead of a screen. Phones are drawn
  `steel`, `hairline` or with no frame at all, one attribute in `world.html`;
  `--panorama-image` swaps the drawn scene for a picture.
- **`exploded`** — each phone tipped back in an orthographic view, with parts
  of its own screen lifted straight up off it in layers.
- **`callouts`** — the phone straight on, with notes pinned to points on its
  screen: a label at the panel's edge, a leader line, and a dot where the line
  lands. One panel lights a region of the screen and dims the rest.
- **`poster`** — type first: a heavy condensed headline set left on a flat
  colour that changes from panel to panel, phones in a thick outline with a
  hard shadow, a sticker for the subline, and one panel fanning two screens.

The copy is plain except for `{capture:N}` placeholders, each filled with
the Nth capture already taken, in filename order, so the panels open showing
the app. A placeholder with no capture yet stays as it is until one is taken.
From there the set is yours: the variables at the top of `panel.css` are
the look, `strings/en-US.json` the words, and each panel's HTML what it shows
— its capture's filename, and any region of the screen it enlarges or lifts,
as `--x --y --w --h` in percent of the capture in the panel's `<style>`. A
screen lays out differently on iPad, so a region forks with
`[data-device="iPad"]`, and with `:lang(de)` for a language that needs it.
Leave `--captures` out when captures go in the set's own `captures/`.

## When captures live elsewhere

A capture flow usually writes where it writes. Say so in `recadro.json`:

```json
{ "set": "store/screenshots", "captures": "e2e/screenshots" }
```

Paths are relative to the file's own folder, and the folder must be inside the
repository.
What is below it is read by name: a folder named for a locale holds that
locale's captures, one named for a slot holds that slot's, either inside the
other and each optional; a folder naming no slot serves the slot its captures
are shaped for. So a Maestro flow's `iPhone/` and `iPad/`, a flat folder from
one simulator, and `<locale>/<slot>/` from a flow run per language all read
as they are.

The only other key is `out`, for renders somewhere other than `<set>/out`.
Renders go one folder per locale, flat, the slot prefixed to the filename —
the tree fastlane's `deliver` reads, so `"out": "fastlane/screenshots"`
is an upload with no copying in between. `{device}` in the pattern puts the
slot in a folder instead: `"out": "renders/{locale}/{device}"`. `set` left out
means the set is the file's own folder, which is what `init .` writes. Unknown
keys and other placeholders are an error.

## Commands

```
recadro init   <dir> [--starter <name>] [--captures <dir>] [--out <dir>] [--skill | --no-skill]
recadro dev    [--config <path>] [--port <n>] [--live]
recadro render [--config <path>] [--out <dir>] [--devices iPhone,iPad] [--locales en-US] [--incomplete]
recadro wait   [--config <path>]
recadro reply  <id> "<what you changed>" [--config <path>]
recadro skill  [--config <path>]
```

Flags win over `recadro.json`, which wins over the set's names. `--config`
defaults to the `recadro.json` in the working directory, `--locales` to the
names in `strings/` (or `en-US`), `--devices` to the slots with captures (or
all), `--out` to `<set>/out`, keeping the layout below it. Both commands print
what they picked and why.

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

The lineup keeps its settings in its address (`/?store=light&device=iPad`),
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

Started as `dev --live`, the lineup sends notes instead of copying them: with
an agent running `recadro wait` — a dot in the header says when one is — a
pointer click opens a field at the spot, the note goes to the agent with the
reference, and a pin marks it until the agent's `recadro reply` comes back,
shown on hover. The panel reloads under your eyes as the agent saves. With
nobody listening, the click copies as before; shift-click copies regardless.

There is deliberately no validation. Overflow, a cropped headline, the wrong face
— the eye catches all of these instantly, and a check that duplicates the eye is
dead weight. Asserting the output's dimensions would assert only that the script
set the viewport it just set.

What is unconditional rather than checked: every write is flattened and stamped
sRGB, because an alpha channel is never wanted (App Store Connect rejects
transparency), so there is nothing to test for.

## Incomplete panels are skipped

A panel is incomplete when it asked for a capture that is not there: a request
under the folder `?captures=` named came back without the file, typically a
capture that does not exist yet. Those render in `dev` (a page can style a
missing capture into a deliberate empty state) and are **skipped** by `render`,
so `out/` only ever holds complete panels and can be uploaded wholesale. The
skip is also a non-zero exit, so a script that renders and then uploads
stops before a listing with a hole; the complete panels are written all the
same.

A panel that asks for **no** capture — a text-only story panel — has nothing to
miss and ships. The distinction is asked-for-and-absent, not absent. Nothing of
the page is read for it: recadro watches the one URL it handed the page, so
how a page loads a capture, and what it shows in its place, is its own.

To look at incomplete panels without a browser — in CI, or from an agent —
`render --incomplete --out <dir>` shoots every panel. It refuses to write into
the set's own `out`, where an empty frame would ship.

## With a coding agent

[`AUTHORING.md`](AUTHORING.md) ships in the package: the contract as
instructions, the mistakes an agent reliably makes with a tool that reads names
and not contents, how to look at its own work without a browser, and how to
take notes from the lineup live.

`init` offers to add a `/recadro` skill for Claude Code at
`.claude/skills/recadro/SKILL.md` in the repository — asked at a terminal,
`--skill` or `--no-skill` to answer without the question, `recadro skill`
from the folder with `recadro.json` to add it later. The skill is one flat file:
how an agent works on a set — checking its work without a browser, reading
what the lineup sends, the `/recadro live` loop — with the installed
`AUTHORING.md` whole beneath it, so invoking it loads every rule and nothing
has to be found first. The first part is the package's own
`skills/recadro/SKILL.md`, readable as a document by any agent. It carries
the version it was written from; after updating recadro, `recadro skill`
rewrites it, asking first at a terminal, and `dev` says so while it is
behind.

Without the skill — another harness, or a declined question — point the
agent file you already keep at the two package files, one line:

```md
Store screenshots are composed with recadro. Before editing store/screenshots/,
read node_modules/recadro/skills/recadro/SKILL.md and node_modules/recadro/AUTHORING.md.
```

## Requirements

Node 20.11+, and for `render`, Playwright's Chromium. It does not install with
the package: it is about 200 MB that `dev` never uses. The first `render`
without it asks to install it; where nobody is at a terminal to answer, it
stops and prints the install command instead, pinned to the Playwright recadro
uses. In CI, run that command before `render`, adding `--with-deps` on Linux.

What App Store Connect checks, recadro makes true by construction: each PNG at
its slot's exact pixels, sRGB, no alpha channel. What it cannot make true is
the content, which is what the lineup is for.

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
