# recadro

App Store screenshots as code: compose store panels from raw simulator captures,
plain HTML in, exact slot sizes out. `packages/recadro` is the npm package;
`site/` is the website; `docs/design.md` is the design record — read it before
changing the tool's shape, because most of the shape is deliberate absence.

## The invariant

The tool ↔ layout contract is four query params — `panel`, `device`, `locale`,
`captures` — and the page reports nothing back. The tool reads what a set's
files are called and where they are (`panels/`, the entries in `strings/`, the
captures folders) plus the set's optional `recadro.json`; it never reads what a
page wrote — its markup, strings or tokens — and never learns a layout concept.
`recadro.json` holds only what names cannot say: where captures are, where
renders go. A change that has the tool parse a page's file, or adds a key a page
lays out with, is the change to refuse: that is how a tool with your layout
becomes a tool with its own. What the tool owns is the slot geometry table, the
set layout and the output naming. Everything else is the page's, or the
`vite.config.*` beside the panels.

## Layout rules

- `packages/recadro` imports nothing from `site/`. The site may depend on the
  tool (`workspace:*`); the tool never knows the site exists.
- The package publishes from its own directory. `files` is a whitelist; check
  what ships with `npm pack --dry-run` and expect exactly `dist`, `ui`,
  `assets`, `starters`, README, AUTHORING, LICENSE.
- `AUTHORING.md` is the package's instructions for coding agents in a
  consumer's repo, versioned with the tool on purpose. A change to the CLI's
  flags, output lines or readiness rules is not done until it is updated too.
- `ui/`, `assets/` and `starters/` sit beside `src/` and `dist/` on purpose: the
  tool resolves them from the package root, so `tsx src/cli.ts` and the published
  `dist/cli.js` find them without a copy step.
- No screenshots of rendered panels in git. Demo imagery for the site is
  produced at build time by the tool itself.

## Running

```bash
pnpm -C packages/recadro dev    --panels <dir>   # from source, live
pnpm -C packages/recadro render --panels <dir>
pnpm -C packages/recadro build                    # tsc → dist/
```

`pnpm -C` runs from the package directory, where there is no set to discover,
so name one with `--panels`. To exercise discovery, run
`packages/recadro/node_modules/.bin/tsx packages/recadro/src/cli.ts` from inside
the repo that holds the set.

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
