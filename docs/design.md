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

## The contract is three query params

```
tool → page:   ?panel=<slug>&device=<slot>&locale=<locale>
page → tool:   nothing
tool → disk:   out/<locale>/<device>/<NN-slug>.png
```

The page fetches its own strings, captures and tokens, at paths it chooses. The
tool opens none of them. This is the line that keeps recadro from growing a
schema: the moment the tool parses a token file it has to know that one key is
the ground and another the frame radius, and every token added is one more
layout concept it understands — which is how a tool with your layout becomes a
tool with its own.

## No manifest, no config

Convention carries what a config would. Panels are files in `panels/`, found by
glob and ordered by filename — the number prefix is the order and the rest is
the slug, which is also the output basename. The headline is an `<h1>` because
the file is HTML. A panel wanting its own ground is a `<style>` block in that
panel. A locale wanting a different type stack is `:root:lang(xx)`.

The one extension point is a `vite.config.*` beside the panels, merged when
present. It is a format the world already knows, so someone who wants Tailwind
or Sass adds it themselves and the tool learns nothing.

## One server, two commands

`dev` and `render` drive the same vite server and the same URLs. Playwright
navigates to exactly what the browser shows, so there is no second code path
that can disagree with the preview — which is what makes the preview trustworthy
enough to be the only check.

The server is what makes `file://` unnecessary, and `file://` was the problem:
`fetch()` is blocked there, so a page could not read its own captions without a
build step between every edit and every look.

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
panels, so an upload lane can read it wholesale.

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
directory an upload lane reads would ship an empty frame.

## The root is the repository

The vite root is the nearest directory holding `.git`, not the nearest
`package.json`: a panel reaches for captures and stylesheets wherever the repo
keeps them, a URL cannot climb above root, and a native iOS repo has no
`package.json` at all. Outside git, vite's own workspace search is the
fallback.

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
