/**
 * Fills a panel from recadro's params and this set's strings.
 *
 * strings/<locale>.json maps each panel's slug to its words and, for a panel
 * that shows a screen, the capture's filename in the folder recadro passes as
 * ?captures=. A capture not taken yet leaves the <img> broken — which is how
 * render knows to skip the panel — and hidden, so the empty state shows.
 *
 * Words marked *like this* become <em>. A "detail" region, in percent of the
 * capture — one for every slot, or one per slot keyed by its id, since a
 * screen lays out differently on iPad — is handed to the stylesheet for the
 * enlarged crop, and the capture URL is too, as --capture, for backgrounds.
 */
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const device = params.get("device");
const locale = params.get("locale");
const root = document.documentElement;

root.lang = locale;
root.dataset.device = device;

const strings = await fetch(`../strings/${locale}.json`).then((r) => r.json());
const entry = strings[panel];
if (!entry) throw new Error(`no "${panel}" in strings/${locale}.json`);

for (const node of document.querySelectorAll("[data-string]")) {
  const text = entry[node.dataset.string];
  if (!text) {
    node.remove();
    continue;
  }
  node.replaceChildren(
    ...text.split(/\*([^*]+)\*/).map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part);
      const em = document.createElement("em");
      em.textContent = part;
      return em;
    }),
  );
}

const src = params.get("captures") + encodeURIComponent(entry.capture ?? "");
root.style.setProperty("--capture", `url("${src}")`);

for (const img of document.querySelectorAll("img.capture, img.detail-capture")) {
  img.addEventListener("error", () => {
    img.style.visibility = "hidden";
    root.dataset.empty = "";
  });
  img.src = src;
}

const detail = document.querySelector(".detail");
if (detail) {
  const { x = 0, y = 0, w = 100, h = 100 } = entry.detail?.[device] ?? entry.detail ?? {};
  for (const [name, value] of Object.entries({ x, y, w, h })) detail.style.setProperty(`--${name}`, String(value));
}
