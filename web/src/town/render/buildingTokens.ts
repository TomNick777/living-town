/**
 * Building scale tokens — the shared measurements every asset draws from.
 *
 * docs/living-town-asset-bible.md §3: one person height as the origin, one
 * floor height, one window language, one roof treatment, one outline, one
 * shadow. residential_a and residential_b must never invent their own window
 * sizes; nothing in this scene is taller than the street light "by feeling".
 */

import { PALETTE as P } from "./palette";

/** Reference person height in px — the pedestrian component draws ≈ this. */
export const PERSON_H = 16;

/** Building massing, in px (z units). */
export const BUILDING = {
  /** Residential floor-to-floor. residential_a = 4 × this + parapet. */
  floorHeight: 28,
  /** Commercial ground floor — visibly taller than a residential floor. */
  shopFloorHeight: 36,
  parapet: 8,
  /** Shrink of the dark inner roof deck, as a fraction of the top face. */
  roofInset: 0.12,
} as const;

/** Facade elements: px heights + fractions of a face edge. */
export const FACADE = {
  windowWidth: 0.14, // ≈10px on a 2-cell face
  windowHeight: 14, // ≈0.5 floor
  windowSill: 8,
  doorWidth: 0.1,
  doorHeight: 20, // ≈1.25 person heights
  /** Projecting depth of awnings, in cells (bible §4: ≤ 0.2 tile). */
  awningDepth: 0.14,
  balconyDepth: 0.16,
  balconyRailH: 10,
} as const;

/** One crisp dark-navy outline everywhere; never pure black. */
export const OUTLINE = {
  colour: "rgba(38,48,58,0.45)",
  width: 0.7,
} as const;

/** Soft contact shadows: light comes from the upper-left… */
export const SHADOW = {
  colour: P.groundShadow,
  /** …so shadows fall to the lower-right in screen space. */
  dx: 3,
  dy: 3,
} as const;

/** Halo around lit glass and lamp heads — "warm light where life happens". */
export const GLOW = {
  colour: P.glow,
  /** Halo spread beyond the lit rect, in px. */
  spread: 2.5,
} as const;
