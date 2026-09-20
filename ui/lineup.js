/**
 * The lineup's behaviour, in its own file under ui/ on purpose.
 *
 * Served raw by recadro at a fixed path, never through vite's HTML pipeline. An
 * inline `<script type="module">` here was extracted by vite into an html-proxy
 * module and cached in its module graph — and because this file lives outside
 * the vite root, nothing ever invalidated it, so an edited lineup silently ran
 * the previous version's JavaScript. The lineup is the tool's own UI; it wants no
 * transform. The panels inside the iframes are real files under root and keep
 * their HMR.
 */

/**
 * Where the panel list comes from: the tool's own `/__recadro/panels.json`, or
 * the path `?manifest=` names, so one site can show several sets beside a single
 * copy of the lineup. Only a path on this origin is taken.
 */
function manifestUrl() {
  const named = new URLSearchParams(location.search).get("manifest");
  return named?.startsWith("/") && !named.startsWith("//") ? named : "/__recadro/panels.json";
}

const manifest = await fetch(manifestUrl()).then((r) => r.json());
const el = (id) => document.getElementById(id);

/** The radio button in the group `name` holding `value`, or the checked one. */
const radio = (name, value) =>
  document.querySelector(`input[name="${name}"]${value ? `[value="${value}"]` : ":checked"}`);

// The device switch: one segment per slot, named by the kind of device; the
// display size and pixels are in its tooltip and in the status.
for (const slot of manifest.slots) {
  const segment = document.createElement("label");
  segment.title = `${slotName(slot)} · ${slot.width}×${slot.height}`;
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "device", value: slot.id });
  segment.append(input, slot.device ?? slot.id);
  el("device").append(segment);
}
radio("device", manifest.slots[0].id).checked = true;

for (const locale of manifest.locales) el("locale").append(new Option(locale, locale));
if (manifest.locales.includes("en-US")) el("locale").value = "en-US";
// A set in one language has nothing to choose, but still says which it is,
// in the same place a choice would be.
el("locale").hidden = manifest.locales.length < 2;
el("locale-only").hidden = manifest.locales.length > 1;
el("locale-only").textContent = el("locale").value;
if (!manifest.outUrl) radio("mode", "out").disabled = true;

/** A slot as a person names it: "6.9″ iPhone". */
function slotName(slot) {
  return slot.device ? `${slot.display} ${slot.device}` : slot.id;
}

/** Whether a toggle button is pressed. */
const pressed = (id) => el(id).getAttribute("aria-pressed") === "true";

/**
 * A selector for `node` inside its panel: the path from `<body>`, stopping at the
 * nearest id, with `:nth-of-type` only where a sibling shares the tag.
 */
function selectorFor(node) {
  const parts = [];
  for (let n = node; n && n !== n.ownerDocument.body && n !== n.ownerDocument.documentElement; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${CSS.escape(n.id)}`);
      break;
    }
    let part = n.localName + [...n.classList].map((c) => `.${CSS.escape(c)}`).join("");
    const twins = [...n.parentElement.children].filter((s) => s.localName === n.localName);
    if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(n) + 1})`;
    parts.unshift(part);
  }
  return parts.join(" > ") || node.localName;
}

/**
 * What to search the repo for: an image's source, or the element's own text.
 * The source is resolved and, when it is served from root, written as a path in
 * the repo — however the page spelled it, and without a port that means nothing
 * to the reader. Only text directly inside the element counts, so a container
 * doesn't quote every child's words as if they were its own.
 */
function anchorFor(node) {
  if (node.localName === "img") {
    const src = new URL(node.currentSrc || node.src, node.baseURI);
    return ` src="${src.origin === location.origin ? decodeURI(src.pathname).slice(1) : src.href}"`;
  }
  const own = [...node.childNodes]
    .filter((c) => c.nodeType === Node.TEXT_NODE)
    .map((c) => c.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!own) return "";
  return ` "${own.length > 80 ? `${own.slice(0, 79)}…` : own}"`;
}

/**
 * The text a pointer click copies: the panel and slot, the file, the spot in
 * viewport units and in the slot's PNG pixels, and the element there when the
 * panel is live.
 */
function referenceFor(panel, { slot, locale, logicalW, logicalH }, x, y, node) {
  const px = (v, max) => Math.min(Math.floor(v * slot.scale), max - 1);
  const lines = [
    `${panel.slug} · ${slot.id} · ${locale}`,
    `file     ${panel.urlPath.slice(1)}`,
    `point    ${((x / logicalW) * 100).toFixed(1)}vw ${((y / logicalH) * 100).toFixed(1)}vh` +
      ` · px ${px(x, slot.width)},${px(y, slot.height)} of ${slot.width}×${slot.height}`,
  ];
  if (node) lines.push(`element  ${selectorFor(node)}${anchorFor(node)}`);
  return lines.join("\n");
}

/**
 * The part of an element's box that is actually on screen: its bounding box cut
 * down by every ancestor that clips overflow, the panel's own viewport included.
 * An image scaled up inside a clipping box — a crop of a capture — would
 * otherwise outline the whole invisible image instead of the crop.
 */
function visibleRect(node) {
  let { left, top, right, bottom } = node.getBoundingClientRect();
  for (let n = node.parentElement; n; n = n.parentElement) {
    const style = n.ownerDocument.defaultView.getComputedStyle(n);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = n.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Builds the pointer overlay for one frame. It covers the frame only while the
 * lineup is pointing, so the iframe below neither swallows the mouse nor loses the
 * listener when its panel reloads. Hover outlines the element under the cursor;
 * a click copies its reference.
 */
function aimFor(panel, context, frame) {
  const aim = document.createElement("div");
  aim.className = "aim";
  const hit = document.createElement("div");
  hit.className = "hit";
  hit.hidden = true;
  const tag = document.createElement("div");
  tag.className = "tag";
  aim.append(hit, tag);
  // What the tag says after a click, and until when it keeps saying it.
  let flash = { text: "", until: 0 };

  // The spot in the panel's logical pixels, and the element there when live.
  const probe = (event) => {
    const box = aim.getBoundingClientRect();
    const k = box.width / context.logicalW;
    const x = Math.max(0, Math.min((event.clientX - box.left) / k, context.logicalW));
    const y = Math.max(0, Math.min((event.clientY - box.top) / k, context.logicalH));
    const node = frame.querySelector("iframe")?.contentDocument?.elementFromPoint(x, y) ?? null;
    return { x, y, k, node };
  };

  // The tag sits just below and right of the cursor, as DevTools' does, and
  // flips to stay inside the frame, so it never covers a fixed strip of the
  // panel and a click's answer appears where the eye already is.
  const place = (event) => {
    const box = aim.getBoundingClientRect();
    const cx = event.clientX - box.left;
    const cy = event.clientY - box.top;
    const { offsetWidth: w, offsetHeight: h } = tag;
    tag.style.left = `${Math.max(4, Math.min(cx + 12, box.width - w - 4))}px`;
    tag.style.top = `${cy + 18 + h <= box.height - 4 ? cy + 18 : Math.max(4, cy - h - 8)}px`;
  };

  aim.addEventListener("mousemove", (event) => {
    const { x, y, k, node } = probe(event);
    if (node) {
      const r = visibleRect(node);
      Object.assign(hit.style, {
        left: `${r.left * k}px`,
        top: `${r.top * k}px`,
        width: `${r.width * k}px`,
        height: `${r.height * k}px`,
      });
    }
    hit.hidden = !node;
    const where = `${((x / context.logicalW) * 100).toFixed(0)}vw ${((y / context.logicalH) * 100).toFixed(0)}vh`;
    tag.textContent =
      Date.now() < flash.until ? flash.text : node ? `${selectorFor(node).split(" > ").pop()} · ${where}` : where;
    place(event);
  });

  aim.addEventListener("mouseleave", () => {
    hit.hidden = true;
    tag.textContent = "";
  });

  aim.addEventListener("click", async (event) => {
    const { x, y, node } = probe(event);
    const text = referenceFor(panel, context, x, y, node);
    // With an agent listening, the spot takes a note instead; shift keeps the clipboard.
    if (listening && !event.shiftKey) {
      openNote(event, {
        reference: text,
        slug: panel.slug,
        spot: { x: x / context.logicalW, y: y / context.logicalH },
        label: tag.textContent,
      });
      // The field says where; the tag under it would say it twice.
      tag.textContent = "";
      hit.hidden = true;
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash = { text: "copied", until: Date.now() + 1200 };
    } catch {
      console.log(text);
      flash = { text: "not copied — see console", until: Date.now() + 3000 };
    }
    tag.textContent = flash.text;
    place(event);
    el("announce").textContent = flash.text === "copied" ? `reference to ${panel.slug} copied` : flash.text;
  });

  return aim;
}

/** Builds one panel's figure in the current mode; its size comes from the lineup's CSS variables. */
function figureFor(panel, context) {
  const { slot, locale, mode, logicalW, logicalH } = context;
  const figure = document.createElement("figure");
  figure.dataset.slug = panel.slug;
  // Named by its slug alone, not by every link in its caption.
  figure.setAttribute("aria-label", panel.slug);
  const frame = document.createElement("div");
  // Loading until its panel or PNG arrives, so a frame has a footprint on the
  // ground before then; a lazy one far down the page stays so until reached.
  frame.className = "frame loading";
  const alone = `#${encodeURIComponent(panel.slug)}`;

  const captures = manifest.captures[slot.id][locale];
  const panelUrl =
    `${panel.urlPath}?panel=${panel.slug}&device=${encodeURIComponent(slot.id)}` +
    `&locale=${encodeURIComponent(locale)}&captures=${encodeURIComponent(captures)}`;
  const pngUrl = String(manifest.outUrl)
    .replaceAll("{locale}", locale)
    .replaceAll("{device}", slot.id)
    .replaceAll("{slug}", panel.slug);

  if (mode === "live") {
    const iframe = document.createElement("iframe");
    // A long set, or several on one page, loads only the panels near the screen.
    iframe.loading = "lazy";
    iframe.src = panelUrl;
    iframe.width = logicalW;
    iframe.height = logicalH;
    // The frame's link is the one stop per panel; the panel's page is looked at, not used.
    iframe.title = panel.slug;
    iframe.tabIndex = -1;
    // Keys pressed with focus inside a panel still reach the lineup, on every
    // load, since a panel reloading under HMR is a fresh window.
    iframe.addEventListener("load", () => {
      frame.classList.remove("loading");
      iframe.contentWindow.addEventListener("keydown", onKey);
    });
    frame.append(iframe);
  } else {
    const img = document.createElement("img");
    img.src = pngUrl;
    img.alt = "";
    // The hole names the file it looked for, as a path in the repo rather than a
    // URL: a render that never ran and an out/ written in another layout look
    // the same, and only the path tells them apart. It still opens alone; there
    // is nothing in it to point at, and no PNG to link to.
    img.addEventListener("load", () => frame.classList.remove("loading"));
    img.addEventListener("error", () => {
      frame.classList.replace("loading", "hole");
      const note = document.createElement("p");
      note.className = "hole-note";
      // One piece per folder, so a narrow frame wraps the path at its slashes
      // rather than inside a name.
      const path = document.createElement("code");
      const parts = decodeURI(pngUrl).slice(1).split("/");
      for (const [i, part] of parts.entries()) {
        const piece = document.createElement("span");
        piece.textContent = i < parts.length - 1 ? `${part}/` : part;
        path.append(piece);
      }
      note.append("not rendered", path);
      img.replaceWith(note);
      frame.querySelector(".aim")?.remove();
      for (const link of figure.querySelectorAll("a.png")) link.remove();
    });
    frame.append(img);
  }
  // Clicking a frame in the lineup shows that panel alone.
  const open = document.createElement("a");
  open.className = "open";
  open.href = alone;
  open.setAttribute("aria-label", `show ${panel.slug} alone`);
  // Shown alone, the frame is already open, and a sideways swipe of 40px or
  // more steps to the neighbour, as a phone pages. Scrolling cancels it.
  let swipeFrom = null;
  // A swipe that stepped also ends in a click, which must not step again.
  let swiped = false;
  open.addEventListener("pointerdown", (event) => {
    swipeFrom = focusedSlug() ? event.clientX : null;
  });
  open.addEventListener("pointercancel", () => {
    swipeFrom = null;
  });
  open.addEventListener("pointerup", (event) => {
    if (swipeFrom === null) return;
    const dx = event.clientX - swipeFrom;
    swipeFrom = null;
    if (Math.abs(dx) < 40) return;
    swiped = true;
    step(dx < 0 ? 1 : -1);
  });
  // Shown alone, the frame is already open; a neighbour beside it steps there,
  // replacing the history entry as the arrows do.
  open.addEventListener("click", (event) => {
    const shown = focusedSlug();
    if (!shown) return;
    event.preventDefault();
    if (shown !== panel.slug && !swiped) location.replace(alone);
    swiped = false;
  });
  frame.append(open, aimFor(panel, context, frame));

  // The slug shows the panel alone too — not the bare panel URL, which only
  // looks right in a window the slot's size, as render opens it.
  const caption = document.createElement("figcaption");
  const slugLink = document.createElement("a");
  slugLink.className = "slug";
  slugLink.href = alone;
  slugLink.textContent = panel.slug;
  // The frame's link goes to the same place, so Tab stops there only. Under a
  // neighbour of the panel shown alone, it steps, as the frame does.
  slugLink.tabIndex = -1;
  slugLink.addEventListener("click", (event) => {
    if (!focusedSlug()) return;
    event.preventDefault();
    location.replace(alone);
  });
  caption.append(slugLink);

  // The rendered file itself, beside the slug in the lineup and on the way back
  // when the panel is shown alone.
  const pngLink = () => {
    const link = document.createElement("a");
    link.className = "png";
    link.href = pngUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "png";
    return link;
  };
  if (mode === "out") caption.append(pngLink());

  // Seen only when the panel is shown alone: a pager as wide as the frame, the
  // neighbours at its edges in the direction a swipe or an arrow goes, this
  // panel and its place in the set between them, and the way back beneath.
  const index = manifest.panels.indexOf(panel);
  const pager = document.createElement("nav");
  pager.className = "pager";
  pager.setAttribute("aria-label", "panels");
  const here = document.createElement("span");
  here.className = "here";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = `${index + 1}/${manifest.panels.length}`;
  here.append(panel.slug, " ", count);
  pager.append(here);
  for (const [delta, side, label] of [[-1, "prev", (s) => `‹ ${s}`], [1, "next", (s) => `${s} ›`]]) {
    const neighbour = manifest.panels[index + delta];
    if (!neighbour) continue;
    const link = document.createElement("a");
    link.className = side;
    link.href = `#${encodeURIComponent(neighbour.slug)}`;
    link.textContent = label(neighbour.slug);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      step(delta);
    });
    if (delta < 0) here.before(link);
    else pager.append(link);
  }
  const back = document.createElement("span");
  back.className = "back";
  const all = document.createElement("a");
  all.href = "#";
  all.textContent = "all panels";
  const keys = document.createElement("span");
  keys.className = "keys";
  keys.textContent = "← → to step, Esc to go back";
  back.append(all, ...(mode === "out" ? [pngLink()] : []), keys);
  pager.append(back);
  caption.append(pager);

  figure.append(frame, caption);
  return figure;
}

/**
 * The widest frame for a panel shown alone that leaves its caption and the
 * body's bottom padding inside the window. Measured from the figure as laid
 * out, because the header wraps on a narrow window and has no fixed height.
 */
function fitWidth(figure, logicalW, logicalH) {
  const frame = figure.querySelector(".frame").getBoundingClientRect();
  const below = figure.getBoundingClientRect().bottom - frame.bottom;
  const padding = parseFloat(getComputedStyle(document.body).paddingBottom);
  const height = Math.floor(innerHeight - (frame.top + scrollY) - below - padding);
  const strip = getComputedStyle(figure.closest(".strip"));
  const width = document.documentElement.clientWidth - parseFloat(strip.paddingLeft) - parseFloat(strip.paddingRight);
  return Math.max(120, Math.floor(Math.min(width, (height * logicalW) / logicalH)));
}

/** Whether the size slider has been moved; until then its size follows the window. */
let zoomMoved = false;

/**
 * The frame width that puts three panels side by side across a phone-sized
 * window, from the strip's own gutters, as a search result shows them there.
 * Null on a wider window.
 */
function threeAcross() {
  const strip = el("lineup").querySelector(".strip");
  if (!strip || !matchMedia("(max-width: 600px)").matches) return null;
  const style = getComputedStyle(strip);
  const inner = document.documentElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return Math.floor((inner - 2 * parseFloat(style.columnGap)) / 3);
}

/**
 * Sizes every frame by setting three CSS variables on the lineup, leaving the
 * frames themselves untouched: from the size slider, or fitted to the window
 * when one panel is shown alone.
 */
function resize() {
  const slot = manifest.slots.find((s) => s.id === radio("device").value);
  const logicalW = slot.width / slot.scale;
  const logicalH = slot.height / slot.scale;
  const focused = el("lineup").querySelector("figure.focused");
  if (!focused && !zoomMoved) el("zoom").value = String(threeAcross() ?? el("zoom").defaultValue);
  const thumbW = focused ? fitWidth(focused, logicalW, logicalH) : Number(el("zoom").value);
  const k = thumbW / logicalW;
  const lineup = el("lineup").style;
  lineup.setProperty("--thumb-w", `${thumbW}px`);
  lineup.setProperty("--frame-h", `${Math.round(logicalH * k)}px`);
  lineup.setProperty("--k", String(k));
}

/** The panel the URL's hash names, if it names one. */
function focusedSlug() {
  const slug = decodeURIComponent(location.hash.slice(1));
  return manifest.panels.some((p) => p.slug === slug) ? slug : null;
}

/** Where the lineup was scrolled before a panel was shown alone, to return to. */
let lineupScroll = 0;
// The lineup restores its own scroll. Left to the browser, Back would scroll to
// the entry's old position before the hash change could record the current one.
history.scrollRestoration = "manual";

/**
 * Shows the panel the hash names alone, fitted to the window, or the whole lineup
 * when it names none. The other figures are hidden rather than removed, so going
 * in and out reloads no panel and the lineup comes back scrolled where it was.
 */
function applyFocus() {
  const slug = focusedSlug();
  const was = document.body.classList.contains("focusing");
  const previous = el("lineup").querySelector("figure.focused")?.dataset.slug;
  if (slug && !was) lineupScroll = scrollY;
  document.body.classList.toggle("focusing", Boolean(slug));
  const at = manifest.panels.findIndex((p) => p.slug === slug);
  for (const figure of el("lineup").querySelectorAll("figure")) {
    const i = manifest.panels.findIndex((p) => p.slug === figure.dataset.slug);
    figure.classList.toggle("focused", figure.dataset.slug === slug);
    figure.classList.toggle("before", at >= 0 && i === at - 1);
    figure.classList.toggle("after", at >= 0 && i === at + 1);
  }
  // Neither size nor wrap has anything to change on one panel fitted to the window.
  el("zoom").disabled = Boolean(slug);
  el("wrap").disabled = Boolean(slug);
  resize();
  if (slug) scrollTo(0, 0);
  else if (was) scrollTo(0, lineupScroll);
  // Leaving through `#` would keep a bare `#` in the address; drop it.
  if (!slug && location.href.endsWith("#")) history.replaceState(null, "", location.pathname + location.search);
  // Keyboard focus follows the panel shown: onto the next one after a step, and
  // back onto the one that was alone on leaving, so it never falls to the page.
  // Entering needs nothing, since the link that opened it keeps focus.
  const target = was && slug !== previous ? (slug ?? previous) : null;
  if (target && !document.activeElement?.closest("header")) {
    el("lineup").querySelector(`figure[data-slug="${CSS.escape(target)}"] .open`)?.focus({ preventScroll: true });
  }
}

/**
 * Shows the panel `delta` places along from the one shown alone. It replaces the
 * history entry rather than adding one, so Back leads to the lineup, not through
 * every panel stepped past.
 */
function step(delta) {
  const next = manifest.panels[manifest.panels.findIndex((p) => p.slug === focusedSlug()) + delta];
  if (next) location.replace(`#${encodeURIComponent(next.slug)}`);
}

/** Rebuilds the lineup from the current controls. */
function draw() {
  const slot = manifest.slots.find((s) => s.id === radio("device").value);
  const locale = el("locale").value;
  const mode = radio("mode").value;
  const logicalW = slot.width / slot.scale;
  const logicalH = slot.height / slot.scale;
  const context = { slot, locale, mode, logicalW, logicalH };

  // What the frames are: the slot by name, the sizes a panel is written and
  // delivered at, and the count. A slot with no captures is still worth
  // designing, but render skips it by default, so the lineup says so while it
  // is the one shown.
  const bare = manifest.devicesWithCaptures.length && !manifest.devicesWithCaptures.includes(slot.id);
  el("status").textContent = [
    slotName(slot),
    `${logicalW}×${logicalH} logical`,
    `${slot.width}×${slot.height} px`,
    `${manifest.panels.length} panels`,
    bare && "no captures for this slot",
  ]
    .filter(Boolean)
    .join(" · ");

  const groups = pressed("wrap")
    ? [
        { label: "First three — all a search result shows", panels: manifest.panels.slice(0, 3) },
        { label: "The rest — only on the product page", panels: manifest.panels.slice(3) },
      ]
    : [{ label: null, panels: manifest.panels }];

  // The first heading shares its row with the status, above the panels.
  el("first-group").textContent = groups[0].label ?? "";
  el("first-group").hidden = !groups[0].label;

  const lineup = el("lineup");
  lineup.replaceChildren();

  for (const [i, group] of groups.entries()) {
    if (!group.panels.length) continue;
    if (group.label && i > 0) {
      const heading = document.createElement("h2");
      heading.className = "group";
      heading.textContent = group.label;
      lineup.append(heading);
    }
    const strip = document.createElement("div");
    strip.className = "strip";
    for (const panel of group.panels) strip.append(figureFor(panel, context));
    lineup.append(strip);
  }
  drawPins();
  applyFocus();
}

/*
 * The notes channel, under `dev --live` only. The lineup hears from the server
 * whether an agent's `recadro wait` is connected and what became of each note;
 * with one listening, the pointer's click opens a note field at the spot and
 * the note goes to the agent with the reference. Without the channel — plain
 * `dev`, or the lineup served as a static page — none of this exists and the
 * pointer copies as it always did.
 */

/** Whether a `recadro wait` is connected right now. */
let listening = false;
/** Every note the server knows, by id. */
const notes = new Map();
/**
 * Pins the person clicked away, kept for the tab across a reload under the
 * key of the server run, since a new run counts notes from 1 again.
 */
let dismissed = new Set();
let dismissedKey = "";
/** Pins showing as a box: clicked open, or a reply that arrived while the page was up. */
const opened = new Set();

/** Loads what this tab dismissed under the server run the state names. */
function loadDismissed(started) {
  dismissedKey = `recadro-dismissed:${started}`;
  try {
    dismissed = new Set(JSON.parse(sessionStorage.getItem(dismissedKey) ?? "[]"));
  } catch {
    dismissed = new Set();
  }
}

/** Dismisses a pin for this tab, reload included. */
function dismiss(id) {
  dismissed.add(id);
  opened.delete(id);
  try {
    sessionStorage.setItem(dismissedKey, JSON.stringify([...dismissed]));
  } catch {
    // Storage refused: the pin stays away until the next reload.
  }
}
/** What the open note field is about, or null while it is closed. */
let pending = null;

/** Shows whether an agent is listening: the dot, its words, and what a pointer click will do. */
function setListening(on) {
  listening = on;
  el("agent").classList.toggle("on", on);
  el("agent-text").textContent = on ? "agent listening" : "no agent listening";
  el("agent").title = on
    ? "A recadro wait is connected: a pointer click sends it a note"
    : "Run `recadro wait` in your agent to take notes from the pointer";
  el("point").title = on
    ? "Point at a spot to send the agent a note, shift-click to copy a reference (P, Esc)"
    : "Point at a spot to copy a reference for a coding agent (P, Esc)";
  if (!on) closeNote();
}

/**
 * Draws every note as a pin on its panel's frame, at the spot the note was
 * pinned to, in every frame showing that panel. Numbered as `wait` prints
 * them; the words on hover, with the agent's line once it came.
 */
function drawPins() {
  for (const pin of el("lineup").querySelectorAll(".pin")) pin.remove();
  for (const note of notes.values()) {
    if (!note.spot || dismissed.has(note.id)) continue;
    for (const frame of el("lineup").querySelectorAll(`figure[data-slug="${CSS.escape(note.slug)}"] .frame`)) {
      const pin = document.createElement("span");
      pin.className = `pin${noteState(note)}`;
      // A pin shows as a box when clicked open, or when its reply arrived under the person's eyes; after a reload every pin is a circle.
      const box = opened.has(note.id);
      const left = box && note.spot.x > 0.5;
      const up = box && note.spot.y > 0.7;
      // A box opens away from the spot; past the middle it opens the other way, anchored by the far edge, so the frame does not clip it.
      if (left) pin.style.right = `${(1 - note.spot.x) * 100}%`;
      else pin.style.left = `${note.spot.x * 100}%`;
      if (up) pin.style.bottom = `${(1 - note.spot.y) * 100}%`;
      else pin.style.top = `${note.spot.y * 100}%`;
      const state = note.reply ? "answered" : note.delivered ? "with the agent" : "waiting for an agent";
      if (box) {
        pin.classList.add("box");
        pin.classList.toggle("left", left);
        pin.classList.toggle("up", up);
        const n = document.createElement("span");
        n.className = "n";
        n.textContent = note.id;
        n.title = state;
        const text = document.createElement("span");
        text.className = "text";
        if (note.reply) {
          text.textContent = note.reply;
          text.title = `you: ${note.note}`;
        } else {
          const said = document.createElement("span");
          said.className = "said";
          said.textContent = "you: ";
          text.append(said, note.note);
        }
        const x = document.createElement("button");
        x.type = "button";
        x.className = "x";
        x.textContent = "×";
        x.title = note.reply ? "Dismiss" : "Fold to the circle";
        x.setAttribute("aria-label", x.title);
        // Folding an open box keeps the note; dismissing an answered pin is for this tab, and the log still lists it.
        x.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (note.reply) dismiss(note.id);
          else opened.delete(note.id);
          drawPins();
        });
        pin.append(n, text, x);
        pin.addEventListener("click", (event) => event.stopPropagation());
      } else {
        pin.textContent = note.id;
        pin.title = `${note.note}\n(${state} — click to open)`;
        pin.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          opened.add(note.id);
          drawPins();
        });
      }
      frame.append(pin);
    }
  }
}

/** A note's state as a class: nothing while it waits for an agent, working once `wait` printed it, done once answered. */
function noteState(note) {
  return note.reply ? " done" : note.delivered ? " working" : "";
}

/**
 * Draws the log: every note in order, the words after the panel's slug, the
 * agent's line beneath once it came, each with the same circle as its pin.
 * A click on an entry brings its panel into view. Follows the newest entry
 * unless the person has scrolled up to read.
 */
function drawLog() {
  const log = el("log");
  const list = el("log-list");
  if (!notes.size) {
    log.hidden = true;
    return;
  }
  const following = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
  log.hidden = false;
  const open = [...notes.values()].filter((note) => !note.reply).length;
  el("log-count").textContent = open ? `${notes.size}, ${open} open` : `${notes.size}`;
  list.replaceChildren();
  for (const note of [...notes.values()].sort((a, b) => a.id - b.id)) {
    const entry = document.createElement("li");
    entry.title = note.reply ? "answered — click to see the panel" : note.delivered ? "with the agent" : "waiting for an agent";
    const n = document.createElement("span");
    n.className = `n${noteState(note)}`;
    n.textContent = note.id;
    const body = document.createElement("span");
    const ask = document.createElement("span");
    ask.className = "ask";
    const where = document.createElement("span");
    where.className = "where";
    where.textContent = note.slug;
    ask.append(where, note.note);
    body.append(ask);
    if (note.reply) {
      const reply = document.createElement("span");
      reply.className = "reply";
      reply.textContent = note.reply;
      body.append(reply);
    }
    entry.append(n, body);
    entry.addEventListener("click", () => {
      el("lineup").querySelector(`figure[data-slug="${CSS.escape(note.slug)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    list.append(entry);
  }
  if (following) list.scrollTop = list.scrollHeight;
}

/** Takes one note's state from the server, redraws, and says what changed. */
function takeNote(note) {
  const before = notes.get(note.id);
  notes.set(note.id, note);
  // A reply that just came opens its box; one found on a reload waits for a click.
  if (note.reply && !before?.reply) {
    opened.add(note.id);
    el("announce").textContent = `agent replied to note ${note.id}: ${note.reply}`;
  }
  drawPins();
  drawLog();
}

/**
 * Fits the note's text field to its words: the two lines it has at rest, then
 * a line at a time up to the height its CSS allows, and past that it scrolls.
 * Measured with the scrollbar off, since one that shows mid-measure narrows
 * the lines and adds a row that is not there.
 */
function fitNote() {
  const text = el("note-text");
  text.style.overflowY = "hidden";
  text.style.height = "auto";
  const wanted = text.scrollHeight + 2; // its two 1px borders, the box being border-box
  text.style.height = `${wanted}px`;
  if (wanted > parseFloat(getComputedStyle(text).maxHeight)) text.style.overflowY = "auto";
}

/**
 * Opens the note field beside the spot just clicked: below and right of the
 * cursor as the tag sits, or above it where below has no room. The side is
 * chosen for the field at its tallest, so typing never moves it across the
 * spot: below, it grows down from its top; above, it is held by its bottom
 * edge and grows up. A second click elsewhere moves it there; the words typed
 * so far stay.
 */
function openNote(event, about) {
  pending = about;
  const form = el("note");
  const text = el("note-text");
  el("note-ref").textContent = about.label || about.slug;
  el("note-hint").textContent = "Enter sends · Esc cancels";
  el("note-hint").classList.remove("failed");
  form.hidden = false;
  fitNote();
  const { offsetWidth: w, offsetHeight: h } = form;
  const tallest = h + parseFloat(getComputedStyle(text).maxHeight) - text.offsetHeight;
  // `bottom` is measured from the viewport, which a horizontal scrollbar makes shorter than the window.
  const height = document.documentElement.clientHeight;
  const below = height - 8 - (event.clientY + 18);
  const above = event.clientY - 8 - 8;
  const down = below >= tallest || below >= above;
  form.style.left = `${Math.max(8, Math.min(event.clientX + 12, innerWidth - w - 8))}px`;
  form.style.top = down ? `${event.clientY + 18}px` : "auto";
  form.style.bottom = down ? "auto" : `${height - (event.clientY - 8)}px`;
  text.focus();
}

/** Closes the note field, keeping nothing. */
function closeNote() {
  pending = null;
  el("note").hidden = true;
  el("note-text").value = "";
  // Back to its two lines; a hidden field has no height to measure.
  el("note-text").style.height = "";
  el("note-text").style.overflowY = "";
}

/** Sends the note with its reference; the pin appears when the server tells every lineup. */
async function sendNote() {
  const text = el("note-text").value.trim();
  if (!pending || !text) return;
  const about = pending;
  try {
    const res = await fetch("/__recadro/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: about.reference, note: text, slug: about.slug, spot: about.spot }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { id } = await res.json();
    el("announce").textContent = `note ${id} sent to the agent`;
    closeNote();
  } catch {
    el("note-hint").textContent = "not sent — is dev --live still running?";
    el("note-hint").classList.add("failed");
  }
}

if (manifest.live) {
  el("agent").hidden = false;
  setListening(false);
  const events = new EventSource("/__recadro/notes/events");
  events.addEventListener("state", (event) => {
    const state = JSON.parse(event.data);
    loadDismissed(state.started);
    notes.clear();
    for (const note of state.notes) notes.set(note.id, note);
    drawPins();
    drawLog();
    setListening(state.listening);
  });
  events.addEventListener("listening", (event) => setListening(JSON.parse(event.data).listening));
  events.addEventListener("note", (event) => takeNote(JSON.parse(event.data)));
  // The server is gone, or restarting: nobody is listening until it says otherwise.
  events.addEventListener("error", () => setListening(false));

  el("log-head").addEventListener("click", () => {
    const closed = el("log").classList.toggle("closed");
    el("log-fold").textContent = closed ? "unfold" : "fold";
    el("log-head").title = closed ? "Unfold the log" : "Fold the log to one line";
  });
  el("note").addEventListener("submit", (event) => {
    event.preventDefault();
    sendNote();
  });
  el("note-text").addEventListener("input", fitNote);
  el("note-text").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendNote();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      closeNote();
    }
  });
  el("note-copy").addEventListener("click", async () => {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.reference);
      el("announce").textContent = `reference to ${pending.slug} copied`;
    } catch {
      console.log(pending.reference);
      el("announce").textContent = "not copied — see console";
    }
    closeNote();
  });
}

/** One key in this browser's storage, read and written without failing where storage is unavailable. */
const remembered = {
  get: (name) => {
    try {
      return localStorage.getItem(`recadro.lineup.${name}`);
    } catch {
      return null;
    }
  },
  set: (name, value) => {
    try {
      localStorage.setItem(`recadro.lineup.${name}`, value);
    } catch {
      // Private windows and blocked storage: the query still keeps the setting.
    }
  },
};

/**
 * The lineup's settings by their name in its query, each with how to read and
 * set its control and which values it takes. The ground, size and wrap are how
 * a person likes to look, so this browser remembers them; device, locale and
 * what to show belong to the set on screen, and every set served on one port
 * shares one storage.
 */
const SETTINGS = {
  device: {
    read: () => radio("device").value,
    write: (v) => (radio("device", v).checked = true),
    valid: (v) => manifest.slots.some((s) => s.id === v),
  },
  locale: {
    read: () => el("locale").value,
    write: (v) => {
      el("locale").value = v;
      el("locale-only").textContent = v;
    },
    valid: (v) => manifest.locales.includes(v),
  },
  show: {
    read: () => radio("mode").value,
    write: (v) => (radio("mode", v).checked = true),
    valid: (v) => v === "live" || (v === "out" && Boolean(manifest.outUrl)),
  },
  store: {
    read: () => radio("store").value,
    write: (v) => (radio("store", v).checked = true),
    valid: (v) => v === "dark" || v === "light",
    kept: true,
  },
  size: {
    read: () => el("zoom").value,
    write: (v) => {
      el("zoom").value = v;
      zoomMoved = true;
    },
    valid: (v) => /^\d+$/.test(v) && Number(v) >= Number(el("zoom").min) && Number(v) <= Number(el("zoom").max),
    kept: true,
  },
  wrap: {
    read: () => (pressed("wrap") ? "on" : "off"),
    write: (v) => el("wrap").setAttribute("aria-pressed", String(v === "on")),
    valid: (v) => v === "on" || v === "off",
    kept: true,
  },
};

/**
 * Sets each control from the lineup's query, so a reload or a link keeps the
 * view and a page embedding the lineup can choose it; failing that, from what
 * this browser remembers; failing both, the page's own default stays.
 */
function restoreSettings() {
  const query = new URLSearchParams(location.search);
  for (const [name, setting] of Object.entries(SETTINGS)) {
    const value = [query.get(name), setting.kept ? remembered.get(name) : null].find((v) => v !== null && setting.valid(v));
    if (value !== undefined) setting.write(value);
  }
}

/**
 * Keeps a setting the person just changed: in the query, replacing the history
 * entry rather than adding one, and in this browser when it is remembered.
 */
function keepSetting(name) {
  const value = SETTINGS[name].read();
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState(history.state, "", url);
  if (SETTINGS[name].kept) remembered.set(name, value);
}

// Size alone never rebuilds: a rebuild makes fresh iframes, every live panel
// loads again from blank, and dragging the slider turns that into a flicker.
// The radio groups report a change from whichever button was chosen.
for (const [id, name] of [["device", "device"], ["locale", "locale"], ["mode", "show"]]) {
  el(id).addEventListener("change", () => {
    keepSetting(name);
    draw();
  });
}
el("wrap").addEventListener("click", () => {
  el("wrap").setAttribute("aria-pressed", String(!pressed("wrap")));
  keepSetting("wrap");
  draw();
});
el("zoom").addEventListener("input", () => {
  zoomMoved = true;
  resize();
});
// Kept on release: a drag fires input per pixel, and browsers throttle a page
// that rewrites its address that often.
el("zoom").addEventListener("change", () => keepSetting("size"));
window.addEventListener("resize", resize);

/**
 * Paints the ground behind the panels as the App Store's in light or dark
 * appearance. Only the ground: a screenshot is the same image in both, which is
 * why both are worth a look. No rebuild, so no panel reloads.
 */
function applyStore() {
  document.body.dataset.store = radio("store").value;
}

radio("store", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark").checked = true;
restoreSettings();
applyStore();
el("store").addEventListener("change", () => {
  keepSetting("store");
  applyStore();
});
window.addEventListener("hashchange", applyFocus);

/** Turns pointer mode on or off; while on, every frame's overlay takes the mouse. */
function setPointing(on) {
  document.body.classList.toggle("pointing", on);
  el("point").setAttribute("aria-pressed", String(on));
  if (!on) closeNote();
}

/**
 * The lineup's keys: P toggles the pointer, the arrows step through panels shown
 * alone, and Esc leaves the pointer first and then the single panel.
 */
function onKey(event) {
  if (event.key === "Escape") {
    if (document.body.classList.contains("pointing")) setPointing(false);
    else if (focusedSlug()) location.hash = "";
    return;
  }
  const typing = event.target.matches?.("input:not([type=range]), select, textarea");
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "p") setPointing(!document.body.classList.contains("pointing"));
  else if (event.key === "ArrowLeft" && focusedSlug()) step(-1);
  else if (event.key === "ArrowRight" && focusedSlug()) step(1);
}

el("point").addEventListener("click", () => setPointing(!document.body.classList.contains("pointing")));
window.addEventListener("keydown", onKey);
draw();
