/**
 * App Store Connect display slots: the delivered pixel geometry Apple accepts,
 * and the logical viewport that produces each one. These are facts about the
 * store rather than preferences, which is why they live in the tool and never
 * reach a panel — a layout is `100vw x 100vh` and knows no device size.
 */

/** One App Store Connect screenshot slot. */
export interface Slot {
  /** Directory name, matching the capture folders and the `--devices` flag. */
  id: string;
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
 * absent — see `docs/ops.md`, "App Store screenshots".
 */
export const SLOTS: readonly Slot[] = [
  { id: "6.9", width: 1320, height: 2868, scale: 3 },
  { id: "13-iPad", width: 2048, height: 2732, scale: 2 },
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
