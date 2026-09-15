/**
 * Fills a panel from recadro's params and this set's strings.
 *
 * strings/<locale>.json maps each panel's slug to its words, and words marked
 * *like this* become <em>. The rest is the panel's own HTML: the <img> with
 * data-capture names its capture's filename in the folder recadro passes as
 * ?captures=, and the enlarged copy shows the same capture. A capture not taken
 * yet leaves the <img> broken — which is how render knows to skip the panel —
 * and hidden, so the empty state shows.
 *
 * The root gets the slot as data-device and the locale as lang, so a panel's
 * CSS can fork on either, and the capture URL as --capture, for backgrounds.
 */
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const locale = params.get("locale");
const root = document.documentElement;

root.lang = locale;
root.dataset.device = params.get("device");

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

const capture = document.querySelector("img[data-capture]")?.dataset.capture;
if (capture) {
  const src = params.get("captures") + encodeURIComponent(capture);
  root.style.setProperty("--capture", `url("${src}")`);
  for (const img of document.querySelectorAll("img.capture, img.detail-capture")) {
    img.addEventListener("error", () => {
      img.style.visibility = "hidden";
      root.dataset.empty = "";
    });
    img.src = src;
  }
}
