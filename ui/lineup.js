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

for (const slot of manifest.slots) deviceSel.append(new Option(slot.name ?? slot.id, slot.id));
for (const locale of manifest.locales) el("locale").append(new Option(locale, locale));
if (manifest.locales.includes("en-US")) el("locale").value = "en-US";
// A set in one language has nothing to choose; the status names the locale instead.
el("locale").hidden = manifest.locales.length < 2;

/** The radio button in the group `name` holding `value`, or the checked one. */
const radio = (name, value) =>
  document.querySelector(`input[name="${name}"]${value ? `[value="${value}"]` : ":checked"}`);
if (!manifest.outUrl) radio("mode", "out").disabled = true;

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
    // A long set, or several on one page, loads only the panels near the screen.
    iframe.loading = "lazy";
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
  // Shown alone, the frame is already open, and a sideways swipe of 40px or
  // more steps to the neighbour, as a phone pages. Scrolling cancels it.
  let swipeFrom = null;
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
    if (Math.abs(dx) >= 40) step(dx < 0 ? 1 : -1);
  });
  open.addEventListener("click", (event) => {
    if (focusedSlug()) event.preventDefault();
  });
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
  const slot = manifest.slots.find((s) => s.id === deviceSel.value);
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
  const mode = radio("mode").value;
  const logicalW = slot.width / slot.scale;
  const logicalH = slot.height / slot.scale;
  const context = { slot, locale, mode, logicalW, logicalH };

  // What the frames are: the locale when there is no choice of one, the sizes a
  // panel is written and delivered at, and the count. A slot with no captures
  // is still worth designing, but render skips it by default, so the lineup
  // says so while it is the one shown.
  const bare = manifest.devicesWithCaptures.length && !manifest.devicesWithCaptures.includes(slot.id);
  el("status").textContent = [
    el("locale").hidden && locale,
    `${logicalW}×${logicalH} logical`,
    `${slot.width}×${slot.height} px`,
    `${manifest.panels.length} panels`,
    bare && "no captures for this slot",
  ]
    .filter(Boolean)
    .join(" · ");

  const groups = el("wrap").checked
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
  applyFocus();
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
    read: () => deviceSel.value,
    write: (v) => (deviceSel.value = v),
    valid: (v) => manifest.slots.some((s) => s.id === v),
  },
  locale: {
    read: () => el("locale").value,
    write: (v) => (el("locale").value = v),
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
    read: () => (el("wrap").checked ? "on" : "off"),
    write: (v) => (el("wrap").checked = v === "on"),
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
for (const [id, name] of [["device", "device"], ["locale", "locale"], ["mode", "show"], ["wrap", "wrap"]]) {
  el(id).addEventListener("change", () => {
    keepSetting(name);
    draw();
  });
}
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
