/**
 * The lineup's manifest: what the lineup page needs about a set and cannot glob
 * for itself. The dev server serves it at `/__recadro/panels.json`; a site that
 * serves the lineup as static files writes it beside them, from the same code.
 */
import { discoverCreative, discoverPanels, urlPathFor } from "./panels.ts";
import {
  capturesUrls,
  checkShapes,
  creativeCapturesUrl,
  DEFAULT_LOCALE,
  devicesWithCaptures,
  outTemplate,
  slotAt,
  type PanelSet,
} from "./set.ts";
import { SLOTS, type Slot } from "./slots.ts";

/**
 * What the lineup needs and cannot glob for itself. Served at
 * `/__recadro/panels.json`; the flow is one-way — no page ever reports back.
 * The lineup itself is not a page in that sense: with `live`, it carries the
 * person's notes to the channel.
 */
export interface LineupManifest {
  /** The panels, each with the geometry it is shot at on every slot. */
  panels: { slug: string; urlPath: string; slots: Record<string, Slot> }[];
  /** The slots at the shape their panels take unless one says otherwise. */
  slots: Slot[];
  /** Locales `strings/` names, or the default one. */
  locales: string[];
  /** Each slot and locale's `?captures=` URL, keyed by slot then locale. */
  captures: Record<string, Record<string, string>>;
  /** Slots with captures, so the lineup can say which have none. */
  devicesWithCaptures: string[];
  /**
   * Root-absolute URL of a render, with `{locale}`, `{device}` and `{slug}` for
   * the lineup to fill, or null when the output folder lies outside the root
   * and cannot be shown.
   */
  outUrl: string | null;
  /** Whether the notes channel is served, so the lineup offers a note field beside the clipboard. */
  live: boolean;
  /** The creative assets' pages, each with the placement it is shot at. */
  creative: { slug: string; urlPath: string; placement: Slot }[];
  /** Each locale's `?captures=` URL for the creative assets. */
  creativeCaptures: Record<string, string>;
  /** How the app appears on the store, the icon as a root-absolute URL, for the store view. */
  app: { name?: string; subtitle?: string; icon?: string };
}

/**
 * The manifest of a loaded set. `live` says whether the notes channel is
 * served beside it.
 */
export function lineupManifest(set: PanelSet, { live = false }: { live?: boolean } = {}): LineupManifest {
  const panels = discoverPanels(set.dir, set.root);
  checkShapes(set, panels.map((panel) => panel.slug));
  const locales = set.locales.length ? set.locales : [DEFAULT_LOCALE];
  const outUrl = urlPathFor(set.root, set.out.base);
  return {
    panels: panels.map(({ slug, urlPath }) => ({
      slug,
      urlPath,
      slots: Object.fromEntries(SLOTS.map((slot) => [slot.id, slotAt(set, slot.id, slug)])),
    })),
    slots: SLOTS.map((slot) => slotAt(set, slot.id)),
    locales,
    captures: capturesUrls(set, locales),
    devicesWithCaptures: devicesWithCaptures(set, locales),
    outUrl: outUrl.startsWith("/..") ? null : `${outUrl}/${outTemplate(set.out)}`,
    live,
    creative: discoverCreative(set.dir, set.root).map(({ panel, placement }) => ({
      slug: panel.slug,
      urlPath: panel.urlPath,
      placement,
    })),
    creativeCaptures: Object.fromEntries(locales.map((locale) => [locale, creativeCapturesUrl(set, locale)])),
    app: { ...set.app, icon: set.app.icon && urlPathFor(set.root, set.app.icon) },
  };
}
