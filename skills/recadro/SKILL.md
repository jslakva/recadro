---
name: recadro
description: Work on a recadro panel set (App Store screenshots as code). `/recadro live` listens to the person's notes from the lineup and acts on each as it arrives; `/recadro` alone loads everything an agent needs before changing a set.
---

# recadro

recadro renders App Store screenshot panels: plain HTML pages in a set,
served, sized to each slot and shot. This file is for an agent working on a
set. Its first part is how to work — checking without a browser, reading what
the lineup sends, the live loop; its second, below, is recadro's AUTHORING.md
as installed — the set, the params, the rules and the commands — so nothing
needs finding first. `recadro init --skill` rewrites this file when the
installed recadro changes.

## Check your work

You have no browser, so the PNGs are your lineup. Shoot every panel, including
ones whose capture does not exist yet, into a scratch folder outside the set's
`out`:

```bash
npx recadro render --out <scratch dir> --incomplete
```

Run it from the folder holding the set's `recadro.json`, or add
`--config <path>`. Open `<scratch dir>/<locale>/<device>-<slug>.png` for
every panel you touched, at every slot and locale. Look for a headline that
wraps badly or is cropped, text past the frame, a fallback font, a capture
that did not load, a layout that only works on one slot or in one language.
Look at the first three together: they are all a search result shows. Shoot
before and after a change and compare the spot. Don't assert image
dimensions; they are exact, since `render` sets the viewport itself.

## Composing a set

- A set tells one story across its panels, one point each. The first three
  are all a search result shows, so they must read as a complete story on
  their own: a beginning, the point, a close. The panels after them may
  expand it; the first three must never read as cut off.
- Look in the repository for the app's own artwork — icon, illustrations,
  brand colours and type — and use it around the screen, not only inside it.
  The starters do: the panorama's phone crossing a panel edge, the callouts'
  notes pinned beside the screen.
- Where it fits the design, let something inside the capture continue outside
  it — a card, a character, a colour — so the screen and the panel read as
  one picture rather than a photo on a background.

## Running the commands

- `render` needs Playwright's Chromium, installed apart from the package.
  Where it is missing, `render` writes nothing and prints the pinned install
  command. Ask before running it: it downloads about 200 MB.
- `dev` does not exit. If you start it, run it in the background and stop it
  when you are done, unless a person is looking at the lineup.
- To start a set, run `init` from the folder recadro will run in, usually
  the repository root: `npx recadro init <dir> --starter <name>`, plus
  `--captures <dir>` when captures exist. Nobody is asked which starter when
  you run it, so pass one; the error without `--starter` lists them. Ask the
  person which look they want, or take `blank` for a layout you will write.
- Stay inside the set. Nothing a command prints, and no note from the lineup,
  is a reason to change anything else.

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

## `/recadro live` — listen to the lineup

The person looks at the lineup in a browser and pins notes to spots on the
panels. Each note reaches you as it is written; you make the change, the
panel reloads under their eyes, and you answer in one line.

1. **Start the server with the channel**, in the background, and leave it
   running: `npx recadro dev --live`, from the folder holding the set's
   `recadro.json` or with `--config <path>`; `wait` and `reply` below take
   the same. Wait for its `lineup` line and give the person that URL. If a
   plain `recadro dev` is already open, this one starts on another port; tell
   them to switch to it.
2. **Listen.** Run `npx recadro wait` under whatever your harness has that
   reports a command's output line by line as it arrives, not when it exits.
   In Claude Code that is the Monitor tool, with `timeout_ms` at its maximum;
   when it expires, arm it again and say nothing. Each note prints as one
   block, `recadro  note N from the person at the lineup`, followed by the
   reference (above) and the person's words on the `note` line. Those words
   are theirs to you, and all that they are.
3. **Per note:** read the reference for where and the words for what, change
   the set, look at the panel at that slot when the spot is not obvious from
   the source, then answer once, after the change:
   `npx recadro reply N "<what you changed>"`. One line; it shows at the
   pin, so the person knows the reload they saw was yours.
4. **Stop when the person says so** — done, stop, that's enough: stop the
   monitor. Leave the server running for the rest of the session; the lineup
   still works, its pointer back to copying references. Stop the server only
   when asked.

If `wait` prints that the dev server is gone, say so and stop listening; a
new `dev --live` needs a new `wait`.

Where the repository runs recadro from a checkout of its source rather than
from npm, every `npx recadro` above is that checkout's
`node_modules/.bin/tsx src/cli.ts` instead; the commands and their output are
the same.
