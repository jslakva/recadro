/**
 * App Store Connect display slots: the delivered pixel geometry Apple accepts,
 * and the logical viewport that produces each one. These are facts about the
 * store rather than preferences, which is why they live in the tool and never
 * reach a panel — a layout is `100vw x 100vh` and knows no device size.
 */

/**
 * One App Store Connect screenshot slot as a panel is shot at it: one of the
 * slot's displays, upright or on its side. Also the shape of a creative
 * asset's placement.
 */
export interface Slot {
  /** The slot's name: a captures folder, the `--devices` flag, the output filename or folder. */
  id: string;
  /** The kind of device, as the lineup's device switch names it. */
  device: string;
  /** The display App Store Connect lists the size under, and which way up: "6.9″", "outer display, landscape". */
  display: string;
  /** Delivered pixel width. */
  width: number;
  /** Delivered pixel height. */
  height: number;
  /** Device scale factor. The logical viewport is the pixel size divided by it. */
  scale: number;
}

/** One display a slot takes screenshots of, upright. */
export interface Display {
  /** Its name in a `shape`: "outer", "inner"; empty for a slot's only display. */
  id: string;
  /** How App Store Connect names it. */
  label: string;
  /** Delivered pixel width, upright. */
  width: number;
  /** Delivered pixel height, upright. */
  height: number;
}

/**
 * One App Store Connect screenshot slot: one set of screenshots in the store,
 * at any of the sizes it takes — each of its displays, either way up.
 */
export interface SlotKind {
  /** The slot's name: a captures folder, the `--devices` flag, the output filename or folder. */
  id: string;
  /** The kind of device, as the lineup's device switch names it. */
  device: string;
  /** Device scale factor. */
  scale: number;
  /** The displays it takes, the first the one a panel is shot at unless its `shape` says. */
  displays: readonly Display[];
  /**
   * Whether a capture is matched to this slot only at one of its exact pixel
   * sizes, either way up, rather than by the nearest shape. For displays whose
   * shape sits close to another slot's, so an iPad mini's capture still reads
   * as the iPad.
   */
  exact?: boolean;
}

/**
 * Every slot recadro renders, in the order `--devices` reports them.
 *
 * Apple derives the smaller iPhone sizes from 6.9", so they are deliberately
 * absent. iPhone Duo is one set of screenshots in App Store Connect that takes
 * either display's size, so it is one slot with two displays.
 */
export const SLOTS: readonly SlotKind[] = [
  { id: "iPhone", device: "iPhone", scale: 3, displays: [{ id: "", label: "6.9″", width: 1320, height: 2868 }] },
  { id: "iPad", device: "iPad", scale: 2, displays: [{ id: "", label: "13″", width: 2048, height: 2732 }] },
  {
    id: "Duo",
    device: "iPhone Duo",
    scale: 3,
    exact: true,
    displays: [
      { id: "outer", label: "outer display", width: 1398, height: 2034 },
      { id: "inner", label: "inner display", width: 2007, height: 2853 },
    ],
  },
];

/** Which of a slot's displays a panel is shot at, and whether on its side. */
export interface Shape {
  /** A display's id; empty for a slot's only display. */
  display: string;
  landscape: boolean;
}

/** The slot of an id, or throws naming the slots. */
export function slotKind(id: string): SlotKind {
  const kind = SLOTS.find((slot) => slot.id === id);
  if (!kind) throw new Error(`unknown device "${id}". Known: ${SLOTS.map((s) => s.id).join(", ")}`);
  return kind;
}

/** The shape a slot's panels take unless `shape` says otherwise: its first display, upright. */
export function defaultShape(kind: SlotKind): Shape {
  return { display: kind.displays[0].id, landscape: false };
}

/**
 * Reads a shape as `recadro.json` writes it, in words: a display's name where
 * the slot has more than one, and "landscape" or "portrait", in any order and
 * each optional — "inner landscape", "landscape", "outer". What it leaves out
 * is the default's. Throws with what the slot takes.
 */
export function parseShape(kind: SlotKind, text: string): Shape {
  const shape = defaultShape(kind);
  const names = kind.displays.map((display) => display.id).filter(Boolean);
  for (const word of text.trim().split(/\s+/)) {
    if (word === "landscape" || word === "portrait") shape.landscape = word === "landscape";
    else if (names.includes(word)) shape.display = word;
    else {
      const takes = [...names, "landscape", "portrait"].map((w) => `"${w}"`).join(", ");
      throw new Error(`"${text}" is no shape for ${kind.id}; it takes ${takes}`);
    }
  }
  return shape;
}

/** A shape in words, as `parseShape` reads it and the CLI prints it: "", "landscape", "inner landscape". */
export function shapeText(shape: Shape): string {
  return [shape.display, shape.landscape ? "landscape" : ""].filter(Boolean).join(" ");
}

/** A slot at one shape: the geometry a panel is shot at. */
export function shaped(kind: SlotKind, shape: Shape): Slot {
  const display = kind.displays.find((d) => d.id === shape.display) ?? kind.displays[0];
  const [width, height] = shape.landscape ? [display.height, display.width] : [display.width, display.height];
  const label = shape.landscape ? `${display.label}, landscape` : display.label;
  return { id: kind.id, device: kind.device, display: label, width, height, scale: kind.scale };
}

/**
 * The creative assets' placements, as slots: the product page header, the
 * search result, and the one image that can fill both. Each is one image per
 * locale rather than one per panel, from the page in `creative/` named for it,
 * at the largest size App Store Connect takes for it.
 */
export const PLACEMENTS: readonly Slot[] = [
  { id: "header", device: "Product page header", display: "21:9", width: 3840, height: 1646, scale: 2 },
  { id: "search", device: "Search result", display: "3:2", width: 3840, height: 2560, scale: 2 },
  { id: "universal", device: "Header and search result", display: "16:9", width: 5244, height: 2950, scale: 2 },
];

/** The name `--devices` and the output use for the creative assets, as a slot's id names its panels. */
export const CREATIVE = "creative";

/**
 * The CSS-pixel viewport that renders `slot` at its delivered size. Playwright
 * sets this together with `deviceScaleFactor`, so the output dimensions come
 * out by construction rather than by assertion.
 */
export function viewportFor(slot: Slot): { width: number; height: number } {
  return { width: slot.width / slot.scale, height: slot.height / slot.scale };
}

/**
 * Resolves `--devices` ids to slots, keeping `SLOTS` order rather than the
 * order they were typed in. Throws on an unknown id: a typo that silently
 * rendered nothing would look exactly like a panel with no capture.
 */
export function selectSlots(ids: readonly string[]): SlotKind[] {
  for (const id of ids) slotKind(id);
  return SLOTS.filter((slot) => ids.includes(slot.id));
}

/**
 * The slot an image of this size is a capture for, and the shape it is: one
 * at exactly one of a slot's sizes, either way up, or else the slot whose
 * display is nearest in shape, upright, among those not matched exactly — so
 * an iPhone SE's 750×1334 still reads as the phone and an iPad mini's
 * 1488×2266 as the iPad, not as a Duo display. A capture can be any
 * simulator's size; the page scales it into the panel.
 */
export function slotForShape(width: number, height: number): { kind: SlotKind; shape: Shape } {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const landscape = width > height;
  for (const kind of SLOTS) {
    const display = kind.displays.find((d) => d.width === short && d.height === long);
    if (display) return { kind, shape: { display: display.id, landscape } };
  }
  const aspect = short / long;
  const off = (kind: SlotKind) => Math.abs(aspect - kind.displays[0].width / kind.displays[0].height);
  const kind = SLOTS.filter((slot) => !slot.exact).reduce((best, slot) => (off(slot) < off(best) ? slot : best));
  return { kind, shape: { display: kind.displays[0].id, landscape } };
}
