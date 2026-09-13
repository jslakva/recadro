# Authoring panels for recadro

For a coding agent, or a person, changing a panel set that recadro renders. The
[README](README.md) explains the tool; this says what to do and what not to.
Every rule here follows from one fact: **recadro reads nothing a panel wrote.**
The layout, its strings, its captures and its tokens belong to the repo.

## Find your bearings

- The panel set is the directory holding `panels/`. Panels are
  `panels/NN-slug.html`, ordered by filename. The filename without `.html`
  (`01-hero`) is the slug, the `?panel=` value and the output basename.
- Read what the panels share — typically a `panel.css` and a `panel.js` beside
  `panels/` — before changing one panel. The conventions there are the repo's.
- There is no recadro config to look for. A `vite.config.*` beside `panels/`,
  if present, is merged into the server; it cannot move the root.

## The contract

```
tool → page:   ?panel=<slug>&device=<slot>&locale=<locale>
page → tool:   nothing
tool → disk:   <out>/<locale>/<device>/<slug>.png
```

| slot      | delivered pixels | viewport (CSS px) | scale |
|-----------|------------------|-------------------|-------|
| `6.9`     | 1320 × 2868      | 440 × 956         | 3     |
| `13-iPad` | 2048 × 2732      | 1024 × 1366       | 2     |

The page is the viewport, `100vw × 100vh`. Those numbers are for your
understanding; they belong in no panel.

## Don't

- **Don't create a config, manifest or schema for recadro.** It would read
  none of it. Data files a page fetches for itself are fine; they are the
  page's.
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
- **Don't animate on load.** The shot is taken once the network is idle and
  fonts are ready, not once motion stops; an entrance animation may be captured
  part-way.
- **Don't keep the network busy.** Polling, analytics or a long-lived request
  holds off `networkidle`, which delays the render or times it out.
- **Don't hardcode an origin or port.** Use relative or root-absolute URLs.

## Paths

- Relative URLs in `fetch`, `src` and `href` resolve against the page,
  `panels/<slug>.html` — even from a shared module script one directory up.
- The server's root is the repository: the nearest directory holding `.git`.
  A root-absolute URL (`/fastlane/screenshots/…`) resolves from there, and a
  relative one can climb to anywhere in the repo but no further.
- Outside git the root is the nearest JS workspace or `package.json`, and
  failing both the panel set itself — then nothing beside it is reachable.
- A panel reporting `no capture at <url>` for a file that exists is a wrong
  path. The URL is what the page asked for; compare it with the file.

## Look at your work

You have no browser, so the PNGs are your contact sheet. Shoot every panel,
including ones whose capture does not exist yet, somewhere outside `out/`:

```bash
npx recadro render --panels <set> --out <scratch dir> --incomplete
```

Then open `<scratch dir>/<locale>/<device>/<slug>.png` for every panel you
touched, at every slot. Look for a headline that wraps badly or is cropped,
text overflowing the frame, a fallback font, a capture that didn't load, and a
layout that only works on one slot. Look at the first three panels together:
they are all a search result shows. Don't assert image dimensions; they are
exact by construction.

To produce what ships:

```bash
npx recadro render --panels <set>
```

It prints `wrote <locale>/<device>/<slug>.png` per shot and
`skipped <locale>/<device>/<slug> — no capture at <url>` per incomplete panel,
and exits 0 either way — read the lines, not the exit code. `out/` is cleared
per locale and slot first, so it only ever holds this run's complete panels.
`--incomplete` refuses to write there.

`render` needs Playwright's chromium once. If it fails for want of a browser,
the install is `npx playwright install chromium` — ask before downloading.

`recadro dev` starts a server and does not exit; it is the contact sheet for a
person with a browser, at `/`. If you start it, run it in the background and
stop it when you are done.

## Changing the set

- **New panel:** add `panels/NN-slug.html`. Renaming or renumbering changes
  the output filenames, and the upload order follows them.
- **Text-only panel:** leave out `<img>` entirely. With nothing to fail it is
  complete and ships.
- **New locale:** pass `--locales en-US,de-DE`. The page gets `?locale=de-DE`
  and must find its own strings; a different type stack is `:root:lang(de)`
  once the page sets `lang`.
- **New device:** not a panel change. Slots are recadro's table; the two above
  are what App Store Connect needs, since it derives the smaller iPhone sizes
  from 6.9".

## Why it is shaped this way

A tool that parses a panel's tokens has to learn that one key is the ground and
another the frame radius, and every such key is a layout concept it then owns.
Keeping the contract to three params is what keeps the layout yours.
[docs/design.md](https://github.com/jslakva/recadro/blob/main/docs/design.md)
has the full reasoning.
