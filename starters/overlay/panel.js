/**
 * Fills a panel from recadro's params and this set's strings.
 *
 * strings/<locale>.json maps each panel's slug to its words and, for a panel
 * that shows a screen, the capture's filename in the folder recadro passes as
 * ?captures=. A capture not taken yet leaves the <img> broken — which is how
 * render knows to skip the panel — and hidden, so the empty state shows.
 */
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const locale = params.get("locale");

document.documentElement.lang = locale;
document.documentElement.dataset.device = params.get("device");

const strings = await fetch(`../strings/${locale}.json`).then((r) => r.json());
const entry = strings[panel];
if (!entry) throw new Error(`no "${panel}" in strings/${locale}.json`);

for (const node of document.querySelectorAll("[data-string]")) {
  const text = entry[node.dataset.string];
  if (text) node.textContent = text;
  else node.remove();
}

const capture = document.querySelector("img.capture");
if (capture) {
  capture.addEventListener("error", () => {
    capture.style.visibility = "hidden";
    document.documentElement.dataset.empty = "";
  });
  capture.src = params.get("captures") + encodeURIComponent(entry.capture ?? "");
}
