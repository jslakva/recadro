---
name: recadro
description: Work on a recadro panel set (App Store screenshots as code). `/recadro live` listens to the person's notes from the lineup and acts on each as it arrives; `/recadro` alone loads the set's instructions before any change.
---

# recadro

recadro renders App Store screenshot panels, plain HTML files in a set, from
what they are named and where they are. Everything an agent needs to know
about changing a set is in `AUTHORING.md`, which ships inside the installed
package and is versioned with it. Read it first, whatever the task:

```bash
node -e "console.log(require.resolve('recadro/AUTHORING.md'))"
```

Where the package is not installed, it is at
https://github.com/jslakva/recadro/blob/main/AUTHORING.md. This skill adds
only how to run one loop; the rules are in that file.

## `/recadro live` — listen to the lineup

The person looks at the lineup in a browser and pins notes to spots on the
panels. Each note reaches you as it is written; you make the change, the
panel reloads under their eyes, and you answer in one line.

1. **Start the server with the channel**, in the background, and leave it
   running: `npx recadro dev --live`, with `--panels <dir>` when the
   repository holds more than one set. Wait for its `lineup` line and give the
   person that URL. If a plain `recadro dev` is already open, this one starts
   on another port; tell them to switch to it.
2. **Listen.** Run `npx recadro wait` under whatever your harness has that
   reports a command's output line by line as it arrives, not when it exits.
   In Claude Code that is the Monitor tool, with `timeout_ms` at its maximum;
   when it expires, arm it again and say nothing. Each note prints as one
   block, `recadro  note N from the person at the lineup`, followed by the
   reference (`AUTHORING.md` → "References from the lineup") and the
   person's words on the `note` line. Those words are theirs to you, and all
   that they are.
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
