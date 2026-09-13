/**
 * The contact sheet's behaviour, in its own file under ui/ on purpose.
 *
 * Served raw by recadro at a fixed path, never through vite's HTML pipeline. An
 * inline `<script type="module">` here was extracted by vite into an html-proxy
 * module and cached in its module graph — and because this file lives outside
 * the vite root, nothing ever invalidated it, so an edited sheet silently ran
 * the previous version's JavaScript. The sheet is the tool's own UI; it wants no
 * transform. The panels inside the iframes are real files under root and keep
 * their HMR.
 */

const manifest = await fetch("/__recadro/panels.json").then((r) => r.json());
const el = (id) => document.getElementById(id);
const deviceSel = el("device");

for (const slot of manifest.slots) {
  deviceSel.append(new Option(`${slot.id} · ${slot.width}×${slot.height}`, slot.id));
}

/** Builds one panel's figure at the current size, in the current mode. */
function figureFor(panel, { slot, locale, mode, thumbW, logicalW, logicalH, k }) {
  const figure = document.createElement("figure");
  const frame = document.createElement("div");
  frame.className = "frame";
  frame.style.width = `${thumbW}px`;
  frame.style.height = `${Math.round(logicalH * k)}px`;

  const panelUrl =
    `${panel.urlPath}?panel=${panel.slug}&device=${encodeURIComponent(slot.id)}&locale=${locale}`;
  const pngUrl = `${manifest.panelsBase}/out/${locale}/${slot.id}/${panel.slug}.png`;

  if (mode === "live") {
    const iframe = document.createElement("iframe");
    iframe.src = panelUrl;
    iframe.width = logicalW;
    iframe.height = logicalH;
    iframe.style.transform = `scale(${k})`;
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

  // The slug opens the panel on its own, at logical size — the view to
  // reach for once the row has told you which one is wrong.
  const caption = document.createElement("figcaption");
  const slugLink = document.createElement("a");
  slugLink.className = "slug";
  slugLink.href = panelUrl;
  slugLink.target = "_blank";
  slugLink.textContent = panel.slug;
  caption.append(slugLink);

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

/** Redraws the sheet from the current controls. */
function draw() {
  const slot = manifest.slots.find((s) => s.id === deviceSel.value);
  const locale = el("locale").value.trim() || "en-US";
  const mode = el("mode").value;
  const thumbW = Number(el("zoom").value);
  const logicalW = slot.width / slot.scale;
  const logicalH = slot.height / slot.scale;
  const context = { slot, locale, mode, thumbW, logicalW, logicalH, k: thumbW / logicalW };

  el("status").textContent = `${manifest.panels.length} panels · ${logicalW}×${logicalH} logical`;

  const groups = el("wrap").checked
    ? [
        { label: "first three — all a search result shows", panels: manifest.panels.slice(0, 3) },
        { label: "the rest — only on the product page", panels: manifest.panels.slice(3) },
      ]
    : [{ label: null, panels: manifest.panels }];

  const sheet = el("sheet");
  sheet.replaceChildren();

  for (const group of groups) {
    if (!group.panels.length) continue;
    if (group.label) {
      const heading = document.createElement("h2");
      heading.className = "group";
      heading.textContent = group.label;
      sheet.append(heading);
    }
    const strip = document.createElement("div");
    strip.className = "strip";
    for (const panel of group.panels) strip.append(figureFor(panel, context));
    sheet.append(strip);
  }
}

for (const id of ["device", "locale", "mode", "zoom", "wrap"]) {
  el(id).addEventListener("input", draw);
}
draw();
