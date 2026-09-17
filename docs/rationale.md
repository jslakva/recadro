# Rationale

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

A slot is named for its device, `iPhone` or `iPad`, not for its display size.
The size is what App Store Connect requires today and sits in the table beside
the pixels; the name is what a capture folder, an output folder and a page's
`[data-device]` fork are written against, and those should outlive Apple moving
the required size. A second slot for one device, a foldable say, gets a name of
its own when it comes.

## The contract is four query params

```
tool → page:   ?panel=<slug>&device=<slot>&locale=<locale>&captures=<folder URL>
page → tool:   nothing
tool → disk:   <out>/<locale>/<device>-<NN-slug>.png
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
the slug, or whatever the panel names.

## The set: one file, always, and names for the rest

A set is a folder holding `panels/`. One file, `recadro.json`, says where it
is and where its inputs and outputs are; everything else about it is read
from names:

```
recadro.json              where recadro runs: "set", "captures", "out"; init writes it
<set>/
  panels/NN-slug.html     the panels; the number prefix is the order
  strings/<locale>.*      one entry per locale; the names are the locales
  captures/               where captures are, unless recadro.json says otherwise
  out/<locale>/           renders, unless recadro.json or --out says otherwise
  panel.css, panel.js     the page's own; recadro never reads them
```

- **One place to look.** A command reads `recadro.json` in the folder it runs
  in, or the one `--config` names, and nothing else. The alternative is to
  find the set — the folder above, or the one set below, to some depth,
  skipping the folders that never hold one — and it still ends in a flag for
  a repository with two sets. A search needs a rule for what counts as a set
  and a list of what to skip; a file needs neither, and it puts the set's
  name at the repository root, which is where people stand when they run
  things. The cost is a file of three lines at most, and `init` writes it
  where it runs, so a set runs with `recadro dev` and nothing else.
- **Locales are the names in `strings/`.** `en-US.json`, `de-DE.md`, `zh-Hans`
  as a folder: the extension and the contents are the page's. Adding a language
  is adding its strings, and nothing else changes. A strings file that other
  tooling reads where it is can be symlinked in. A set with no `strings/`
  renders `en-US`.
- **Devices are what the captures are shaped for.** A capture is a phone's or
  an iPad's by its proportions, and that is sturdier than any folder name or
  exact size, which vary by simulator and are scaled into the panel anyway.
  So a flat folder of captures serves the slot they are shaped for, and an
  iPhone-only app renders no iPad panels without saying so anywhere. What
  shape cannot settle is which capture a panel means when both devices have
  one of the same name — a panel asks for `01-home.png` on either — so two
  slots' captures go in a folder each, named for the slot. The locale is the
  other folder name that means something, since captures that differ per
  language are the same names again; a folder named for a locale holds that
  locale's, with the slot folders inside or outside it, and captures shared
  by every locale sit in no locale folder. This mirrors what capture flows
  write — Maestro's folder per device, snapshot's folder per locale — rather
  than asking them to change. A set with no captures at all — text-only, or
  not captured yet — renders every slot.
- **Renders go where the upload reads.** fastlane's `deliver` reads one flat
  folder per locale and picks the slot from the pixel size, so that is the
  default: `<out>/<locale>/<device>-<slug>.png`, the slot in the filename
  because both slots' panels share a slug. Pointing `out` at the fastlane
  folder makes an upload with nothing copied in between. A flow that wants a
  folder per slot says so with `{device}` in the pattern.
- **`recadro.json` holds the three facts names cannot.** Where the set is
  (`"set"`, the file's own folder when left out), where the capture flow
  writes (`"captures": "maestro/screenshots"`) and, rarely, where renders go.
  Its paths are relative to the file, so a repository holds several sets by
  holding a file per set, each in its own folder, and `--config` reaches the
  one not in the working directory. It is strict: a mistyped key or
  placeholder is an error, because one quietly ignored looks exactly like
  captures that do not exist yet.

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
from until one is taken. Asked for no starter, `init` offers the folders it
finds in `starters/`, by name and nothing more: a starter carries no metadata
the tool would read, so adding one is adding a folder, and what each looks
like is the README's to say. Enter takes `blank`, the one with no look, so
the choice made by not choosing commits the set to nothing.

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
without this a capture flow running beside the open lineup, or an edit to a
headline, would change nothing on screen.

## The lineup is the check

There is no validation, because the failure modes are visual: overflow, a
cropped headline, a panel that shot before its capture loaded, the wrong face.
The eye catches every one of them instantly, and a check that duplicates the eye
is dead weight. Asserting the output's pixel dimensions asserts only that the
tool set the viewport it just set.

So `dev` serves every panel side by side, the first three grouped on their own
because that is all a search result shows. It shows the live panels, or the
rendered `out/` on a toggle, where an unrendered panel is a hole — the one
signal there is for a render that failed.

The ground is the store's, white or black. The store shows one image in both
appearances, and a panel's edge is judged against whichever the customer has.
Frames carry no shadow for the same reason: a shadow draws an edge the store
doesn't.

What look like the two surviving checks are unconditional processing instead:
every write is flattened and stamped sRGB, because an alpha channel is never
wanted, so there is nothing to test for.

## Incomplete panels are skipped, text-only panels ship

The tool never learns which capture a panel wants, so it cannot check the
filesystem for it. It watches the page ask instead: it handed the page a
`?captures=` folder, so a request below that folder is a capture request, and
one the server answers with anything but the file — a 404, a redirect, a
failed connection — is a capture the panel wanted and did not get. `render`
skips that panel. `out/` then only ever holds complete panels, so whatever
uploads from it can take it wholesale.

A panel that asks for no capture is complete by construction — text-only story
panels are common in six-panel sets and they have nothing to miss. The
distinction is asked-for-and-absent, not absent.

An earlier version read the page for this: after `networkidle`, any `<img>`
with `naturalWidth === 0` meant the panel was not ready. It worked, and it cost
three rules about how to write a page — no decoration in an `<img>`, no
placeholder that loads, keep the failed `<img>` and hide it — imposed to keep
one check working; and a placeholder swapped in defeated it anyway. Watching
the request costs no rule: decoration may be an `<img>` and fail quietly, a
page may swap a placeholder in and the miss was already seen, a capture drawn
onto a canvas from `fetch` counts the same as one in an `<img>`. The tool reads
nothing of the page; it watches the one URL it owns.

`networkidle` rather than `load` matters: a panel that sets its capture from
captions it fetched has asked for nothing yet when `load` fires, and checking
then would call an unfinished panel complete. And the server answers a path
that is no file with a 404 instead of falling back to a root `index.html`, as
vite does for an app: a web repository often has one, and a missing capture
would otherwise come back as a page of HTML.

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

## The knowledge is a document; the door is a skill

`AUTHORING.md` ships inside the package and is versioned with it: what an agent
needs to know about a set is read from the copy that matches the installed
tool, never from a copy that drifted. A consumer's own agent file points at it.

That was the whole answer for a while — a skill would need an installer the
package cannot run, a copy would stop tracking the version, and it would serve
one agent where a document serves all. Each objection had a fix. `init` is an
installer already, and writing `.claude/skills/recadro/SKILL.md` at the
repository root is one more file it writes, asked about first. A copy stops tracking the version silently; this
one carries the version it was written from, `init <set> --skill` rewrites it
from the installed package, and `dev` says when it is behind. And a skill in a
file format other harnesses read too is not one agent's.

What the skill buys is being visible and being whole. A document inside
`node_modules` works when the agent is pointed at it, and finding it is a
step — one that depends on where the package manager put the package and
where the agent happened to start — that a person then wonders about. The
skill is one flat file: how an agent works on a set, then the installed
`AUTHORING.md` entire, so invoking it loads every rule with no path to
resolve. The split between the two halves is by reader: AUTHORING.md is the
set's reference for anyone with a change to make, a person included, and says
nothing about how to behave; the first half is the agent's, and is where every
"you" went. The package keeps the one source, the skill is a stamped copy of
it, and a set holds only the set: `init` writes no pointer files into it, since
a harness without skills has an agent file of its own for that one line.

## The lineup is the tool's UI, not a panel

The lineup is served by the tool at `/`, from its own files, raw and
uncached — never through vite's HTML transform. Running it through the transform
once broke it: vite extracted the lineup's inline module into a proxy module and
cached it, and since the lineup lives outside the vite root nothing invalidated
the cache, so an edited lineup silently ran the previous version's JavaScript.
The panels are real files under root and keep vite's transform and HMR, which is
the part that needs it.

The lineup's pointer is the one place the tool looks inside a rendered panel, and
it does so the way DevTools does: it names the element under the cursor, gives
the spot in viewport units and delivered pixels, and writes that to the
clipboard for a person to paste to an agent — or, under `dev --live`, sends it
with the person's note to an agent's `wait`. It names and never judges. A
pointer that said a headline overflows would be the validation this section
argues against. What it reads goes to the person, or through the tool to the
agent unread; the tool learns nothing from it.

## Notes go to the agent as they come, through the server that is already there

A person at the lineup and an agent in a terminal are one edit apart, and the
clipboard was the gap between them. `dev --live` closes it with what the tool
already had: the one vite server carries a note from the lineup to a `wait`
that prints it, and a `reply` back to a pin. No second process, no port of its
own, no script written into anyone's page.

`wait` streams and does not exit. The older shape for this — a poll that
exits, so the harness wakes the agent — was chosen when running a command was
all a harness could do; harnesses that report a command's output line by line
as it arrives make a note that lands mid-edit its own event, with no re-run per
round and no burst window. A person's note is not a queue item to lease and
redeliver: once printed it is in the agent's context, so a note printed is a
note delivered, and one nobody has printed yet waits for the first `wait`.

The channel exists only on `--live`. Plain `dev` writes no file, serves no
endpoint and shows no dot, so a person who never talks to an agent sees the
tool they had. Under `--live`, `dev` announces itself in the OS temp directory
under a hash of the set's path — nothing in the repository, so no consumer
gains a gitignore line — and `wait` connects to what it finds there;
connecting is the liveness test, and a server that refuses or answers with
someone else's 404 gets the same one line naming `dev --live`.

Any page in the same browser can POST to localhost, and here that would be a
way to put words in the agent's mouth. Browsers send `Origin` on every
cross-origin POST, so the server takes a note from a page on its own origin
and no other; the agent's endpoints require a header a page cannot send
cross-origin without a preflight nobody answers, so no page can drain the
notes with an image tag. No token, nothing secret to carry. The server prints
no instructions of its own into `wait`'s output: the note is marked as the
person's words and is all that arrives.

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

The browser itself is not a dependency. A package that downloads it on install
runs a script that pnpm skips unless allowed, would put at least 200 MB in front of
`npx recadro init`, and would fetch it for `dev`, which never launches one. So
`render` asks for it at the moment it needs it, which also covers the first
render after an upgrade moves Playwright to a new build.

## The name

*Recadrer* is French for to reframe or to crop; *recuadro* is Spanish for a
framed inset. Reframing raw captures into composed panels is the job.
