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
}

/**
 * Every slot recadro renders, in the order `--devices` reports them.
 *
 * Apple derives the smaller iPhone sizes from 6.9", so they are deliberately
 * absent.
 */
export const SLOTS: readonly Slot[] = [
  { id: "iPhone", device: "iPhone", display: "6.9″", width: 1320, height: 2868, scale: 3 },
  { id: "iPad", device: "iPad", display: "13″", width: 2048, height: 2732, scale: 2 },
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
 * Resolves `--devices` ids to slots, keeping `SLOTS` order rather than the
 * order they were typed in. Throws on an unknown id: a typo that silently
 * rendered nothing would look exactly like a panel with no capture.
 */
export function selectSlots(ids: readonly string[]): Slot[] {
  for (const id of ids) {
    if (!SLOTS.some((slot) => slot.id === id)) {
      throw new Error(`unknown device "${id}". Known: ${SLOTS.map((s) => s.id).join(", ")}`);
    }
  }
  return SLOTS.filter((slot) => ids.includes(slot.id));
}

/**
 * The slot an image of this size is a capture for: the one whose delivered
 * shape is nearest, upright, so an iPhone SE's 750×1334 still reads as the
 * phone and an iPad mini's 1488×2266 as the iPad. A capture can be any
 * simulator's size; the page scales it into the panel.
 */
export function slotForShape(width: number, height: number): Slot {
  const aspect = Math.min(width, height) / Math.max(width, height);
  const off = (slot: Slot) => Math.abs(aspect - slot.width / slot.height);
  return SLOTS.reduce((best, slot) => (off(slot) < off(best) ? slot : best));
}
