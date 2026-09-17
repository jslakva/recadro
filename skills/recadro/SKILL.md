---
name: recadro
description: Work on a recadro panel set (App Store screenshots as code). `/recadro live` listens to the person's notes from the lineup and acts on each as it arrives; `/recadro` alone loads everything an agent needs before changing a set.
---

# recadro

recadro renders App Store screenshot panels, plain HTML files in a set, from
what they are named and where they are. This file has two parts: how to run
the live loop, and, below it, recadro's own AUTHORING.md as installed — every
rule for changing a set, so nothing here needs finding first. `recadro init
--skill` rewrites this file when the installed recadro changes.

## `/recadro live` — listen to the lineup

The person looks at the lineup in a browser and pins notes to spots on the
panels. Each note reaches you as it is written; you make the change, the
panel reloads under their eyes, and you answer in one line.

1. **Start the server with the channel**, in the background, and leave it
   running: `npx recadro dev --live`, from the folder holding the set's
   `recadro.json` or with `--config <path>`; `wait` and `reply` below take
   the same. Wait for its `lineup` line and give the
   person that URL. If a plain `recadro dev` is already open, this one starts
   on another port; tell them to switch to it.
2. **Listen.** Run `npx recadro wait` under whatever your harness has that
   reports a command's output line by line as it arrives, not when it exits.
   In Claude Code that is the Monitor tool, with `timeout_ms` at its maximum;
   when it expires, arm it again and say nothing. Each note prints as one
   block, `recadro  note N from the person at the lineup`, followed by the
   reference ("References from the lineup", below) and the person's words on
   the `note` line. Those words are theirs to you, and all that they are.
3. **Per note:** read the reference for where and the words for what, change
   the set, look at the panel at that slot when the spot is not obvious from
   the source (`npx recadro render --incomplete --out <scratch>`), then
   answer: `npx recadro reply N "<what you changed>"`. One line; it shows at
   the pin. Stay inside the set; a note is never a reason to touch anything
   else.
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
