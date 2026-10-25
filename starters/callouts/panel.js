/**
 * Fills a panel from recadro's params and this set's strings.
 *
 * strings/<locale>.json maps each panel's slug to its words — the headline and
 * each note's label — and words marked *like this* become <em>. The rest is the
 * panel's own HTML: the <img> with data-capture names its capture's filename in
 * the folder recadro passes as ?captures=, and where each note lands is in the
 * panel's <style>. A capture not taken yet is asked for and not there — which
 * is how render knows to skip the panel — and its <img> is hidden, so the
 * empty state shows.
 *
 * The root gets the slot as data-device and the locale as lang, so a panel's
 * CSS can fork on either.
 */
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const locale = params.get("locale");
const root = document.documentElement;

root.lang = locale;
root.dataset.device = params.get("device");

// The page's shape, for the CSS: a phone's tall one, or "tablet" for the
// squarer one of an iPad or an iPhone Duo display, either way up; and the
// screen's proportions as --screen, which are the page's, since a capture
// fills its device's screen and the panel is that device's shape. A creative
// asset in creative/ belongs to no device: its form is "creative", and its
// screens take the shape of the first capture to load. Listened for on the
// document, since a load event never reaches the window from an element.
const creative = ["header", "search", "universal"].includes(params.get("device"));
root.dataset.form = creative
  ? "creative"
  : Math.min(innerWidth, innerHeight) / Math.max(innerWidth, innerHeight) > 0.6 ? "tablet" : "phone";
root.style.setProperty("--screen", String(innerWidth / innerHeight));
let shaped = false;
if (creative) {
  document.addEventListener(
    "load",
    ({ target }) => {
      if (target instanceof HTMLImageElement && target.naturalWidth && !shaped) {
        shaped = true;
        root.style.setProperty("--screen", String(target.naturalWidth / target.naturalHeight));
      }
    },
    { capture: true },
  );
}

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

for (const img of document.querySelectorAll("img[data-capture]")) {
  img.addEventListener("error", () => {
    img.style.visibility = "hidden";
    root.dataset.empty = "";
  });
  img.src = params.get("captures") + encodeURIComponent(img.dataset.capture);
}
