/**
 * Fills the panel from recadro's four params, and nothing else.
 *
 * strings/<locale>.json maps the panel's slug to its headline. The <img> names
 * its capture in data-capture, a filename in the folder recadro passes as
 * ?captures=. A capture not taken yet is asked for and not there — which is
 * how render knows to skip the panel — and the broken <img> is hidden. The
 * root gets the slot as data-device and the locale as lang, for the CSS.
 */
const params = new URLSearchParams(location.search);
const panel = params.get("panel"); // "01-hero": the filename without .html
const device = params.get("device"); // "iPhone" or "iPad"
const locale = params.get("locale"); // "en-US"
const captures = params.get("captures"); // this locale and device's captures folder, ending in a slash

document.documentElement.lang = locale;
document.documentElement.dataset.device = device;

// Relative URLs resolve against the page, panels/01-hero.html.
const strings = await fetch(`../strings/${locale}.json`).then((r) => r.json());
document.querySelector("h1").textContent = strings[panel];

// More words per panel: make each panel's entry an object,
//   { "01-hero": { "headline": "Say what it does.", "subline": "…" } }
// and fill every element by the name it carries, the <h1> as data-string="headline":
//   for (const node of document.querySelectorAll("[data-string]")) {
//     node.textContent = strings[panel][node.dataset.string];
//   }

const img = document.querySelector("img.capture");
img.addEventListener("error", () => {
  img.style.visibility = "hidden";
});
img.src = captures + encodeURIComponent(img.dataset.capture);

// More screens in one panel: an <img data-capture="…"> each, given its src the same way:
//   for (const img of document.querySelectorAll("img.capture")) { … }
