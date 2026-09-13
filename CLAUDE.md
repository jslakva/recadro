# recadro

App Store screenshots as code: compose store panels from raw simulator captures,
plain HTML in, exact slot sizes out. `packages/recadro` is the npm package;
`site/` is the website; `docs/design.md` is the design record — read it before
changing the tool's shape, because most of the shape is deliberate absence.

## The invariant

The tool ↔ layout contract is three query params, and the page reports nothing
back. The tool never opens a panel's files — not its captions, captures, tokens
or config — and never learns a layout concept. A change that has it parse
something a panel wrote, or add a config key, is the change to refuse: that is
how a tool with your layout becomes a tool with its own. What the tool owns is
the slot geometry table and the output naming `deliver` expects. Everything
else is convention or the `vite.config.*` beside the panels.

## Layout rules

- `packages/recadro` imports nothing from `site/`. The site may depend on the
  tool (`workspace:*`); the tool never knows the site exists.
- The package publishes from its own directory. `files` is a whitelist; check
  what ships with `npm pack --dry-run` and expect exactly `dist`, `ui`,
  `assets`, README, AUTHORING, LICENSE.
- `AUTHORING.md` is the package's instructions for coding agents in a
  consumer's repo, versioned with the tool on purpose. A change to the CLI's
  flags, output lines or readiness rules is not done until it is updated too.
  There is deliberately no skill: nothing would install it, and a copy would
  stop tracking the version.
- `ui/` and `assets/` sit beside `src/` and `dist/` on purpose: the server
  resolves them from the package root, so `tsx src/cli.ts` and the published
  `dist/cli.js` find them without a copy step.
- No screenshots of rendered panels in git. Demo imagery for the site is
  produced at build time by the tool itself.

## Running

```bash
pnpm -C packages/recadro dev    --panels <dir>   # from source, live
pnpm -C packages/recadro render --panels <dir>
pnpm -C packages/recadro build                    # tsc → dist/
```

Before publishing, test the *built* form — `node dist/cli.js dev …` and
`render …` — not the tsx one; users get `npx recadro`. `render` needs
`npx playwright install chromium` once.

## Conventions

- No ticket system. Reasoning lives in commit bodies and in `docs/design.md`;
  GitHub Issues hold the backlog. A commit subject is prose, no prefixes, no
  attribution trailers. Commit to `main`.
- Every exported function, interface, type and constant has a JSDoc comment
  saying what it does. New source files open with a 2–4 line header saying why
  the file exists.
- Don't install, publish or download anything on your own — hand over the
  command.
- Verify visually. The contact sheet is the check, and a claim that something
  renders correctly should come from having looked at the pixels.
