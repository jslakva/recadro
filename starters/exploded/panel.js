/**
 * Fills a panel from recadro's params and this set's strings, and takes its
 * screen apart.
 *
 * strings/<locale>.json gives each panel its words, its capture's filename and
 * "layers": regions of the capture in percent — x and y the top left corner, w
 * and h the size — one array for every slot, or one per slot keyed by its id.
 * Each region is cut from the capture and lifted off the screen by one step,
 * or by its own "z" in steps, and grown by the stylesheet's --zoom or its own
 * "zoom", leaving a dimmed socket where it came from.
 *
 * Words marked *like this* become <em>.
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

/** Places an element over a region of the screen, in percent, through --x --y --w --h. */
function place(element, { x = 0, y = 0, w = 100, h = 100 }) {
  for (const [name, value] of Object.entries({ x, y, w, h })) element.style.setProperty(`--${name}`, String(value));
}

const screen = document.querySelector(".screen");
const lifted = document.querySelector(".lifted");
const regions = entry.layers?.[device] ?? entry.layers ?? [];
regions.forEach((region) => {
  const socket = document.createElement("div");
  socket.className = "socket";
  place(socket, region);
  screen.append(socket);

  const layer = document.createElement("div");
  layer.className = "layer";
  layer.style.setProperty("--z", String(region.z ?? 1));
  if (region.zoom) layer.style.setProperty("--layer-zoom", String(region.zoom));
  place(layer, region);
  const img = document.createElement("img");
  img.alt = "";
  layer.append(img);
  lifted.append(layer);
});

const src = params.get("captures") + encodeURIComponent(entry.capture ?? "");
for (const img of document.querySelectorAll(".phone img")) {
  img.addEventListener("error", () => {
    img.style.visibility = "hidden";
    root.dataset.empty = "";
  });
  img.src = src;
}
