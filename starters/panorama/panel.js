/**
 * Fills a panel from recadro's params and this set's strings, and places it in
 * the world the panels share.
 *
 * world.html is one scene as wide as the whole set; each panel shows its own
 * stretch of it, found from the number its filename starts with: 01 shows the
 * first 100vw, 02 the next. A phone in the world carries its capture's filename
 * in data-capture, and a panel keeps only the phones it actually shows, so a
 * capture not taken yet holds back just the panels it appears in.
 *
 * Words marked *like this* in strings/ become <em>, and a [data-list] element
 * gets one <li> per entry of the array strings/ gives it.
 */
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const locale = params.get("locale");
const captures = params.get("captures");
const root = document.documentElement;

root.lang = locale;
root.dataset.device = params.get("device");

const strings = await fetch(`../strings/${locale}.json`).then((r) => r.json());
const entry = strings[panel];
if (!entry) throw new Error(`no "${panel}" in strings/${locale}.json`);

/** The nodes for a string, with *marked* words as <em>. */
function marked(text) {
  return text.split(/\*([^*]+)\*/).map((part, i) => {
    if (i % 2 === 0) return document.createTextNode(part);
    const em = document.createElement("em");
    em.textContent = part;
    return em;
  });
}

for (const node of document.querySelectorAll("[data-string]")) {
  const text = entry[node.dataset.string];
  if (text) node.replaceChildren(...marked(text));
  else node.remove();
}

for (const list of document.querySelectorAll("[data-list]")) {
  const items = entry[list.dataset.list] ?? [];
  list.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement("li");
      li.append(...marked(text));
      return li;
    }),
  );
}

root.style.setProperty("--i", String(Number.parseInt(panel, 10) - 1));
root.style.setProperty("--panels", String(Object.keys(strings).length));

const world = document.querySelector(".world");
world.innerHTML = await fetch("../world.html").then((r) => r.text());

for (const phone of world.querySelectorAll("[data-capture]")) {
  const box = phone.getBoundingClientRect();
  if (box.right <= 0 || box.left >= innerWidth) {
    phone.remove();
    continue;
  }
  const img = phone.querySelector("img");
  img.addEventListener("error", () => {
    img.style.visibility = "hidden";
    phone.dataset.empty = "";
  });
  img.src = captures + encodeURIComponent(phone.dataset.capture);
}
