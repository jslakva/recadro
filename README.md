# recadro — App Store screenshots as code

A raw capture of your app's screen is not a store screenshot. However you take
your captures, with an automated flow or by hand, they are not what the most
popular apps in the store have in their listings. Their images use the store's
slots to pitch the app, one panel at a time: a headline, a screen, a story.
The first three panels, usually all a search result shows, hook the visitor;
the rest elaborate the story to convert them.

That story is yours to write. You know the app, and your coding agent can read
its design tokens and its copy; recadro replaces neither of you. It automates
the work around the story:

- See the story in your browser as the store shows it, laid out in sequence
  while you work on it.
- Keep the design when the app changes. If you tweaked a screen or two, retake
  those captures and a single command re-renders the whole story. You make no
  second trip through a design tool.
- Add a language by adding one strings file for it.
- Get exact files for every device and language, as App Store Connect wants
  them.

## See it live

[recadro.dev](https://recadro.dev) runs the premade starters live. Drop in
your own captures to see the starters, and recadro's lineup, on your app; they
stay in your browser, and nothing is uploaded. There is also a recording of
live mode, with an agent taking notes from the lineup.

## Installation and requirements

recadro is on [npm](https://www.npmjs.com/package/recadro):

```bash
npm install -D recadro
```

With another package manager, use its equivalent (`pnpm add -D recadro`,
`yarn add -D recadro`). In a repo with no `package.json`, a native iOS project
say, `npx recadro` runs it without installing.

It needs Node 20.11+, and for `render`, Playwright's Chromium. The first
`render` offers to install it, about 200 MB; `dev` never needs it.

## How it works

You or your agent write each panel as a plain HTML page in your repo. Design
it however you like, using your app's own tokens and copy if you want. recadro
serves the panels, sizes each one to its slot and, when you're ready, shoots
it.

To begin, create a set:

```bash
npx recadro init store/screenshots --captures path/to/captures   # a new set from a starter, on your captures
```

Then drive it yourself:

```bash
npx recadro dev                      # opens the lineup: every panel side by side, live
npx recadro render                   # renders the final PNGs, at exact slot pixels
```

Or, if you let `init` add its skill, from Claude Code:

```
/recadro live
```

- `dev` shows the first three panels on their own, as in a search result, on
  the store's light and dark grounds. Point at a spot and it copies a
  reference to paste to your agent: the file, the element and the position.
- `render` writes each PNG at its slot's exact pixels, sRGB with no alpha
  channel, for iPhone and iPad and for every language with a strings file, in
  the folders fastlane's `deliver` uploads from. When a screen changes, take
  the capture again and rerun it.
- `dev` and `render` drive the same server, so the preview and the render
  cannot disagree.
- `/recadro live` has your agent start the dev server with a live channel to
  the lineup, so you can point at a spot on a panel and send the agent a note
  right from the browser; the panel reloads as it makes the change.

Any other agent needs one line in the agent file you already keep:

```md
Store screenshots are composed with recadro. Before editing store/screenshots/,
read node_modules/recadro/skills/recadro/SKILL.md and node_modules/recadro/AUTHORING.md.
```

## Documentation

[AUTHORING.md](AUTHORING.md) is the reference, for you and your agent alike:
the set's layout, `recadro.json`, every command and what it prints.

## Questions, features and bug reports

To ask a question, discuss a feature or report a bug, open an
[issue on GitHub](https://github.com/jslakva/recadro/issues).

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
