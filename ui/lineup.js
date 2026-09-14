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
const deviceSel = el("device");

for (const slot of manifest.slots) {
  deviceSel.append(new Option(`${slot.id} · ${slot.width}×${slot.height}`, slot.id));
}
for (const locale of manifest.locales) el("locale").append(new Option(locale, locale));
if (manifest.locales.includes("en-US")) el("locale").value = "en-US";
if (!manifest.outUrl) el("mode").querySelector('option[value="out"]').disabled = true;

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
  });

  aim.addEventListener("mouseleave", () => {
    hit.hidden = true;
    tag.textContent = "";
  });

  aim.addEventListener("click", async (event) => {
    const { x, y, node } = probe(event);
    const text = referenceFor(panel, context, x, y, node);
    try {
      await navigator.clipboard.writeText(text);
      flash = { text: "copied", until: Date.now() + 1200 };
    } catch {
      console.log(text);
      flash = { text: "copy failed — reference in console", until: Date.now() + 3000 };
    }
    tag.textContent = flash.text;
  });

  return aim;
}

/** Builds one panel's figure in the current mode; its size comes from the lineup's CSS variables. */
function figureFor(panel, context) {
  const { slot, locale, mode, logicalW, logicalH } = context;
  const figure = document.createElement("figure");
  figure.dataset.slug = panel.slug;
  const frame = document.createElement("div");
  frame.className = "frame";
  const alone = `#${encodeURIComponent(panel.slug)}`;

  const captures = manifest.capturesUrl.replaceAll("{locale}", locale).replaceAll("{device}", slot.id);
  const panelUrl =
    `${panel.urlPath}?panel=${panel.slug}&device=${encodeURIComponent(slot.id)}` +
    `&locale=${encodeURIComponent(locale)}&captures=${encodeURIComponent(captures)}`;
  const pngUrl = `${manifest.outUrl}/${slot.id}/${locale}/${panel.slug}.png`;

  if (mode === "live") {
    const iframe = document.createElement("iframe");
    iframe.src = panelUrl;
    iframe.width = logicalW;
    iframe.height = logicalH;
    // Keys pressed with focus inside a panel still reach the lineup, on every
    // load, since a panel reloading under HMR is a fresh window.
    iframe.addEventListener("load", () => iframe.contentWindow.addEventListener("keydown", onKey));
    frame.append(iframe);
  } else {
    const img = document.createElement("img");
    img.src = pngUrl;
    img.alt = "";
    img.addEventListener("error", () => {
      frame.classList.add("hole");
      frame.replaceChildren(document.createTextNode("not rendered"));
    });
    frame.append(img);
  }
  // Clicking a frame in the lineup shows that panel alone. A hole replaces the
  // frame's children, both overlays included: nothing to enlarge or point at.
  const open = document.createElement("a");
  open.className = "open";
  open.href = alone;
  open.setAttribute("aria-label", `show ${panel.slug} alone`);
  frame.append(open, aimFor(panel, context, frame));

  // The slug shows the panel alone too — not the bare panel URL, which only
  // looks right in a window the slot's size, as render opens it.
  const caption = document.createElement("figcaption");
  const slugLink = document.createElement("a");
  slugLink.className = "slug";
  slugLink.href = alone;
  slugLink.textContent = panel.slug;
  caption.append(slugLink);

  // Seen only when the panel is shown alone: where it sits in the set, its
  // neighbours, and the way back.
  const index = manifest.panels.indexOf(panel);
  const nav = document.createElement("span");
  nav.className = "nav";
  const count = document.createElement("span");
  count.textContent = `${index + 1} of ${manifest.panels.length}`;
  nav.append(count);
  for (const [delta, label] of [[-1, (s) => `‹ ${s}`], [1, (s) => `${s} ›`]]) {
    const neighbour = manifest.panels[index + delta];
    if (!neighbour) continue;
    const link = document.createElement("a");
    link.href = `#${encodeURIComponent(neighbour.slug)}`;
    link.textContent = label(neighbour.slug);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      step(delta);
    });
    nav.append(link);
  }
  const all = document.createElement("a");
  all.href = "#";
  all.textContent = "all";
  nav.append(all);
  caption.append(nav);

  if (mode === "out") {
    const pngLink = document.createElement("a");
    pngLink.href = pngUrl;
    pngLink.target = "_blank";
    pngLink.textContent = "png";
    caption.append(pngLink);
  }

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
  const width = document.documentElement.clientWidth - 40;
  return Math.max(120, Math.floor(Math.min(width, (height * logicalW) / logicalH)));
}

/**
 * Sizes every frame by setting three CSS variables on the lineup, leaving the
 * frames themselves untouched: from the size slider, or fitted to the window
 * when one panel is shown alone.
 */
function resize() {
  const slot = manifest.slots.find((s) => s.id === deviceSel.value);
  const logicalW = slot.width / slot.scale;
  const logicalH = slot.height / slot.scale;
  const focused = el("lineup").querySelector("figure.focused");
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
  if (slug && !was) lineupScroll = scrollY;
  document.body.classList.toggle("focusing", Boolean(slug));
  for (const figure of el("lineup").querySelectorAll("figure")) {
    figure.classList.toggle("focused", figure.dataset.slug === slug);
  }
  el("zoom").disabled = Boolean(slug);
  resize();
  if (slug) scrollTo(0, 0);
  else if (was) scrollTo(0, lineupScroll);
  // Leaving through `#` would keep a bare `#` in the address; drop it.
  if (!slug && location.href.endsWith("#")) history.replaceState(null, "", location.pathname + location.search);
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
  const slot = manifest.slots.find((s) => s.id === deviceSel.value);
  const locale = el("locale").value;
  const mode = el("mode").value;
  const logicalW = slot.width / slot.scale;
  const logicalH = slot.height / slot.scale;
  const context = { slot, locale, mode, logicalW, logicalH };

  // A slot with no captures is still worth designing, but render skips it by
  // default, so the lineup says so while it is the one shown.
  const bare = manifest.devicesWithCaptures.length && !manifest.devicesWithCaptures.includes(slot.id);
  el("status").textContent =
    `${manifest.panels.length} panels · ${logicalW}×${logicalH} logical${bare ? " · no captures for this slot" : ""}`;

  const groups = el("wrap").checked
    ? [
        { label: "first three — all a search result shows", panels: manifest.panels.slice(0, 3) },
        { label: "the rest — only on the product page", panels: manifest.panels.slice(3) },
      ]
    : [{ label: null, panels: manifest.panels }];

  const lineup = el("lineup");
  lineup.replaceChildren();

  for (const group of groups) {
    if (!group.panels.length) continue;
    if (group.label) {
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
  applyFocus();
}

// Size alone never rebuilds: a rebuild makes fresh iframes, every live panel
// loads again from blank, and dragging the slider turns that into a flicker.
for (const id of ["device", "locale", "mode", "wrap"]) {
  el(id).addEventListener("input", draw);
}
el("zoom").addEventListener("input", resize);
window.addEventListener("resize", resize);
window.addEventListener("hashchange", applyFocus);

/** Turns pointer mode on or off; while on, every frame's overlay takes the mouse. */
function setPointing(on) {
  document.body.classList.toggle("pointing", on);
  el("point").setAttribute("aria-pressed", String(on));
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
  const typing = event.target.matches?.("input:not([type=checkbox]):not([type=range]), select");
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "p") setPointing(!document.body.classList.contains("pointing"));
  else if (event.key === "ArrowLeft" && focusedSlug()) step(-1);
  else if (event.key === "ArrowRight" && focusedSlug()) step(1);
}

el("point").addEventListener("click", () => setPointing(!document.body.classList.contains("pointing")));
window.addEventListener("keydown", onKey);
draw();
