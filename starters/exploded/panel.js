/**
 * Fills a panel from recadro's params and this set's strings, and takes its
 * screen apart.
 *
 * strings/<locale>.json maps each panel's slug to its words, and words marked
 * *like this* become <em>. The rest is the panel's own HTML: the <img> with
 * data-capture names its capture's filename in the folder recadro passes as
 * ?captures=, and each .layer is a region the panel's <style> places. Every
 * layer gets the capture cut to its region, and a socket on the screen with the
 * same classes, so one rule places both and hides both.
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

const screen = document.querySelector(".screen");
for (const layer of document.querySelectorAll(".layer")) {
  const socket = document.createElement("div");
  socket.className = layer.className.replace(/\blayer\b/, "socket");
  screen.append(socket);
  layer.append(Object.assign(document.createElement("img"), { alt: "" }));
}

const capture = document.querySelector("img[data-capture]")?.dataset.capture;
const src = params.get("captures") + encodeURIComponent(capture ?? "");
for (const img of document.querySelectorAll(".phone img")) {
  img.addEventListener("error", () => {
    img.style.visibility = "hidden";
    root.dataset.empty = "";
  });
  img.src = src;
}
