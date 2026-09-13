# Design

Why recadro is shaped the way it is. Short, because most of the shape is the
absence of things.

## The problem

Store screenshots are composed panels — a headline, the screen inside a device
frame, a brand ground — and every tool that makes them gives you *its* layout for
*its* config file. Change the layout and you are in a design tool by hand;
change the app and you redo the set. What is wanted is a layout you own, in a
language you already know, that regenerates from raw captures on one command.

That language is HTML. Everyone who ships an app has someone who can write a
page of CSS, and a page of CSS is diffable, reviewable and previewable in the
browser already open.

## Author at logical size, render at scale

Apple's slots are pixel sizes: 1320×2868 for the 6.9" iPhone, 2048×2732 for the
13" iPad. Those are 440×956 CSS pixels at scale factor 3 and 1024×1366 at scale
2. The renderer sets the viewport and the scale; the panel is `100vw × 100vh`
and never sees a device dimension. The exact pixels come out by construction,
the slot table stays inside the tool where a layout cannot depend on it, and a
new device is a row in that table.

## The contract is four query params

```
tool → page:   ?panel=<slug>&device=<slot>&locale=<locale>&captures=<folder URL>
page → tool:   nothing
tool → disk:   <out>/<device>/<locale>/<NN-slug>.png
```

The tool reads what a set's files are called and where they are. It never
reads what they say: not a panel's markup, not its strings, not its tokens.
This is the line that keeps recadro from growing a schema: the moment the tool
parses a strings or token file it has to know that one key is the headline and
another the ground, and every key added is one more layout concept it
understands — which is how a tool with your layout becomes a tool with its own.

`captures` is a param and strings are not because of who decides where they
live. Strings sit at a fixed place in the set that a page can name itself.
Captures land wherever the repo's capture flow writes them, per slot and
sometimes per locale, so the tool resolves that folder once and hands it to
every panel. The page still chooses the filename in it: a capture named after
the slug, or whatever its strings map the slug to.

## The set: conventions first, one optional file

A set is a folder holding `panels/`. Everything else about it is read from
names, and the one file that exists is optional:

```
<set>/
  panels/NN-slug.html     the panels; the number prefix is the order
  strings/<locale>.*      one entry per locale; the names are the locales
  captures/<device>/      where captures are, unless recadro.json says otherwise
  recadro.json            optional: "captures" and "out"
  out/                    renders, unless recadro.json or --out says otherwise
  panel.css, panel.js     the page's own; recadro never reads them
```

- **Found, not flagged.** With no `--panels`, a command uses the folder it runs
  in, or the nearest set above it within the repository, or the one set below
  it. A repository with several sets names one. The goal is that a set runs
  with `recadro dev` and nothing else.
- **Locales are the names in `strings/`.** `en-US.json`, `de-DE.md`, `zh-Hans`
  as a folder: the extension and the contents are the page's. Adding a language
  is adding its strings, and nothing else changes. A strings file that other
  tooling reads where it is can be symlinked in. A set with no `strings/`
  renders `en-US`.
- **Devices are the captures folders that exist.** An iPhone-only app has no
  `13-iPad` folder and renders no iPad panels without saying so anywhere. A set
  with no captures folder at all — text-only, or not captured yet — renders
  every slot.
- **`recadro.json` holds the two facts names cannot.** Where the capture flow
  writes (`"captures": "../../maestro/{device}/{locale}"`, where `{locale}`
  makes captures per locale) and, rarely, where renders go. It sits in the set,
  so its paths are relative to the set and a repository can hold several sets.
  It is strict: a mistyped key or placeholder is an error, because one quietly
  ignored looks exactly like captures that do not exist yet.

Flags win over `recadro.json`, which wins over the conventions. What never
becomes a key is anything a page lays out with: the strings format, the tokens,
capture filenames, which panel shows which capture. A panel wanting its own
ground is a `<style>` block in that panel; a locale wanting a different type
stack is `:root:lang(xx)`.

The extension point for the page side is a `vite.config.*` beside the panels,
merged when present. It is a format the world already knows, so someone who
wants Tailwind or Sass adds it themselves and the tool learns nothing.

## Starters are copied, not referenced

A starter is a premade set that ships in the package. `init` copies it once
into a new folder and the set is the repo's from then on: nothing records which
starter it came from, and no update to the starter reaches it. The one thing
the copy changes is `{capture:N}`, replaced as plain text with the Nth capture
already taken, so a starter opens on the app's own screens — the tool swaps a
token in files it ships, and still parses nothing a page wrote. A placeholder
without a capture stays as it is, which is also where the empty state comes
from until one is taken.

## One server, two commands

`dev` and `render` drive the same vite server and the same URLs. Playwright
navigates to exactly what the browser shows, so there is no second code path
that can disagree with the preview — which is what makes the preview trustworthy
enough to be the only check.

The server is what makes `file://` unnecessary, and `file://` was the problem:
`fetch()` is blocked there, so a page could not read its own captions without a
build step between every edit and every look.

`dev` also reloads the panels when a file they ask for by URL changes: a
capture, a strings file, anything else in the set a page fetches. vite reloads
a page for the files it imports, and these are outside its module graph, so
without this a capture flow running beside the open sheet, or an edit to a
headline, would change nothing on screen.

## The contact sheet is the check

There is no validation, because the failure modes are visual: overflow, a
cropped headline, a panel that shot before its capture loaded, the wrong face.
The eye catches every one of them instantly, and a check that duplicates the eye
is dead weight. Asserting the output's pixel dimensions asserts only that the
tool set the viewport it just set.

So `dev` serves every panel side by side, the first three grouped on their own
because that is all a search result shows. It shows the live panels, or the
rendered `out/` on a toggle, where an unrendered panel is a hole — the one
signal there is for a render that failed.

What look like the two surviving checks are unconditional processing instead:
every write is flattened and stamped sRGB, because an alpha channel is never
wanted, so there is nothing to test for.

## Incomplete panels are skipped, text-only panels ship

The tool never learns which capture a panel wants, so it cannot check the
filesystem for it. It asks the rendered page instead: after `networkidle` and
`document.fonts.ready`, any `<img>` with `naturalWidth === 0` means the panel
is not ready, and `render` skips it. `out/` then only ever holds complete
panels, so whatever uploads from it can take it wholesale.

A panel with no image at all is complete by construction — text-only story
panels are common in six-panel sets and they have nothing to fail. The
distinction is present-but-broken, not absent.

`networkidle` rather than `load` matters: a panel that sets its capture from
captions it fetched has no image request yet when `load` fires, and checking
then would call an unfinished panel complete.

A skipped panel is still worth looking at — its empty frame is designed too —
and `dev` shows it only to a browser. An agent or a CI job has pixels to read
and no browser, so `render --incomplete` shoots every panel. It refuses the
default `out/`: the flag is for looking, and an incomplete shot in the
directory an upload reads would ship an empty frame.

## The root is the repository

The vite root is the nearest directory holding `.git`, not the nearest
`package.json`: a panel reaches for captures and stylesheets wherever the repo
keeps them, a URL cannot climb above root, and a native iOS repo has no
`package.json` at all. Outside git, vite's own workspace search is the
fallback. The same limit is why captures must resolve inside the root: a
`recadro.json` pointing above it is an error at startup rather than a set of
panels that can never load their captures.

## Agents get a document, not a skill

`AUTHORING.md` ships inside the package and a consumer's own agent file points
at it. A skill would need an installer the package cannot run, a copy of it
would stop tracking the installed version, and it would serve one agent where a
document serves all of them. What a skill adds is being loaded unasked, and the
one line in the consumer's agent file does that.

## The sheet is the tool's UI, not a panel

The contact sheet is served by the tool at `/`, from its own files, raw and
uncached — never through vite's HTML transform. Running it through the transform
once broke it: vite extracted the sheet's inline module into a proxy module and
cached it, and since the sheet lives outside the vite root nothing invalidated
the cache, so an edited sheet silently ran the previous version's JavaScript.
The panels are real files under root and keep vite's transform and HMR, which is
the part that needs it.

The sheet's pointer is the one place the tool looks inside a rendered panel, and
it does so the way DevTools does: it names the element under the cursor, gives
the spot in viewport units and delivered pixels, and writes that to the
clipboard for a person to paste to an agent. It names and never judges. A
pointer that said a headline overflows would be the validation this section
argues against, and nothing it reads ever reaches the tool.

## Why not an existing tool

- **fastlane `frameit`** — fixed caption-over-device layout, and device frames
  that lag Apple's releases by years.
- **Config-driven generators** (appshots and kin) — the right sizes, one layout
  family, a schema of their own.
- **GUI generators** — hand-driven; a UI change means redoing them by hand,
  which throws away what an automated capture flow bought.
- **A second SwiftUI app whose views lay out the captures** — the same idea,
  the wrong toolchain for a web-skilled team.

Every one gives you its layout for a config file. HTML gives you yours.

## Playwright, deliberately

Headless Chrome's CLI can hit the slot sizes exactly. What it cannot do is ask
the page whether it is ready — the skip signal — or wait on a condition instead
of a timer, and its one-URL-per-process model launches a browser per panel per
device. Playwright reuses one browser, evaluates the readiness check, waits on
`networkidle`, and pins the browser build so two machines emit the same pixels.
Driving system Chrome over the DevTools protocol would keep all of that with no
dependency; it is the option if the dependency ever matters more than the
pinned browser does.

## The name

*Recadrer* is French for to reframe or to crop; *recuadro* is Spanish for a
framed inset. Reframing raw captures into composed panels is the job.
