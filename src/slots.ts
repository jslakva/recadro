/**
 * App Store Connect display slots: the delivered pixel geometry Apple accepts,
 * and the logical viewport that produces each one. These are facts about the
 * store rather than preferences, which is why they live in the tool and never
 * reach a panel — a layout is `100vw x 100vh` and knows no device size.
 */

/** One App Store Connect screenshot slot. */
export interface Slot {
  /** The slot's name: a captures folder, the `--devices` flag, the output filename or folder. */
  id: string;
  /** The kind of device, as the lineup's device switch names it. */
  device: string;
  /** The display size App Store Connect lists the slot under. */
  display: string;
  /** Delivered pixel width. */
  width: number;
  /** Delivered pixel height. */
  height: number;
  /** Device scale factor. The logical viewport is the pixel size divided by it. */
  scale: number;
  /**
   * Whether a capture is matched to this slot only at its exact pixel size,
   * either way up, rather than by the nearest shape. For a display whose shape
   * sits close to another's, so an iPad mini's capture still reads as the iPad.
   */
  exact?: boolean;
}

/**
 * Every slot recadro renders, upright, in the order `--devices` reports them.
 *
 * Apple derives the smaller iPhone sizes from 6.9", so they are deliberately
 * absent. iPhone Duo has two displays, and App Store Connect takes screenshots
 * for each, so it is two slots.
 */
export const SLOTS: readonly Slot[] = [
  { id: "iPhone", device: "iPhone", display: "6.9″", width: 1320, height: 2868, scale: 3 },
  { id: "iPad", device: "iPad", display: "13″", width: 2048, height: 2732, scale: 2 },
  { id: "DuoOuter", device: "Duo outer", display: "iPhone", width: 1398, height: 2034, scale: 3, exact: true },
  { id: "DuoInner", device: "Duo inner", display: "iPhone", width: 2007, height: 2853, scale: 3, exact: true },
];

/**
 * The CSS-pixel viewport that renders `slot` at its delivered size. Playwright
 * sets this together with `deviceScaleFactor`, so the output dimensions come
 * out by construction rather than by assertion.
 */
export function viewportFor(slot: Slot): { width: number; height: number } {
  return { width: slot.width / slot.scale, height: slot.height / slot.scale };
}

/**
 * The slots as a set renders them: those `landscape` names turned on their
 * side, the rest upright. App Store Connect takes either orientation at the
 * same size; one slot is one orientation, since a panel set is written for
 * one shape of page.
 */
export function orientedSlots(landscape: readonly string[]): Slot[] {
  return SLOTS.map((slot) => (landscape.includes(slot.id) ? { ...slot, width: slot.height, height: slot.width } : slot));
}

/**
 * Resolves `--devices` ids to slots, keeping `SLOTS` order rather than the
 * order they were typed in, each turned as `landscape` says. Throws on an
 * unknown id: a typo that silently rendered nothing would look exactly like a
 * panel with no capture.
 */
export function selectSlots(ids: readonly string[], landscape: readonly string[]): Slot[] {
  for (const id of ids) {
    if (!SLOTS.some((slot) => slot.id === id)) {
      throw new Error(`unknown device "${id}". Known: ${SLOTS.map((s) => s.id).join(", ")}`);
    }
  }
  return orientedSlots(landscape).filter((slot) => ids.includes(slot.id));
}

/**
 * The slot an image of this size is a capture for: one at exactly its size,
 * either way up, or else the one whose delivered shape is nearest, upright,
 * among those not matched exactly — so an iPhone SE's 750×1334 still reads as
 * the phone and an iPad mini's 1488×2266 as the iPad, not as a Duo display. A
 * capture can be any simulator's size; the page scales it into the panel.
 */
export function slotForShape(width: number, height: number): Slot {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const exact = SLOTS.find((slot) => slot.width === short && slot.height === long);
  if (exact) return exact;
  const aspect = short / long;
  const off = (slot: Slot) => Math.abs(aspect - slot.width / slot.height);
  return SLOTS.filter((slot) => !slot.exact).reduce((best, slot) => (off(slot) < off(best) ? slot : best));
}
