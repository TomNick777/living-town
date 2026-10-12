/**
 * Isometric coordinate system — the single source of screen positions.
 *
 * Grid space: integer cells (x to the south-east, y to the south-west,
 * z = height in pixels above ground). Screen space: SVG user units.
 *
 *   sx = (x - y) * TILE_W / 2
 *   sy = (x + y) * TILE_H / 2 - z
 *
 * Nothing else in the renderer may place an asset with hand-written pixels.
 */

export const TILE_W = 64;
export const TILE_H = 32;

export interface GridPos {
  x: number;
  y: number;
  z: number;
}

export interface ScreenPos {
  sx: number;
  sy: number;
}

export interface Footprint {
  w: number; // cells along +x
  h: number; // cells along +y
}

export interface GridBounds {
  minX: number;
  maxX: number; // inclusive
  minY: number;
  maxY: number; // inclusive
}

export function gridToScreen(x: number, y: number, z = 0): ScreenPos {
  return {
    sx: ((x - y) * TILE_W) / 2,
    sy: ((x + y) * TILE_H) / 2 - z,
  };
}

/**
 * Inverse projection (z=0): the grid cell that CONTAINS the given screen
 * point. Continuous grid coordinates are floored, so a point inside a cell's
 * diamond maps to that cell; points exactly on edges round to one side (ties
 * are irrelevant for click targeting).
 */
export function screenToGrid(sx: number, sy: number): { x: number; y: number } {
  const u = sx / (TILE_W / 2);
  const v = sy / (TILE_H / 2);
  return { x: Math.floor((u + v) / 2), y: Math.floor((v - u) / 2) };
}

/** Screen-space centre of a footprint's ground rectangle. */
export function footprintCentre(x: number, y: number, fp: Footprint, z = 0): ScreenPos {
  return gridToScreen(x + fp.w / 2, y + fp.h / 2, z);
}

/**
 * The four corners of a ground rectangle, clockwise from the top (north)
 * corner: N, E, S, W in screen space. Used for tiles and box top faces.
 */
export function groundQuad(x: number, y: number, fp: Footprint, z = 0): [ScreenPos, ScreenPos, ScreenPos, ScreenPos] {
  return [
    gridToScreen(x, y, z),
    gridToScreen(x + fp.w, y, z),
    gridToScreen(x + fp.w, y + fp.h, z),
    gridToScreen(x, y + fp.h, z),
  ];
}

export function pointsAttr(points: ScreenPos[]): string {
  return points.map((p) => `${round(p.sx)},${round(p.sy)}`).join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Painter's order for one object. Flat tiles always come first; solid
 * objects are sorted by the far corner of their footprint (larger x+y is
 * closer to the viewer), then by z. Ties are broken by id in the model so the
 * order is total and deterministic.
 */
export function drawKey(x: number, y: number, z: number, fp: Footprint, flat: boolean): number {
  const far = x + fp.w - 1 + (y + fp.h - 1);
  return (flat ? 0 : 1_000_000) + far * 1000 + z;
}

/** SVG viewBox that contains every cell of the bounds plus tall objects. */
export function viewBoxFor(bounds: GridBounds, tallestPx: number, padding = 24): { x: number; y: number; w: number; h: number } {
  const left = gridToScreen(bounds.minX, bounds.maxY + 1).sx;
  const right = gridToScreen(bounds.maxX + 1, bounds.minY).sx;
  const top = gridToScreen(bounds.minX, bounds.minY).sy - tallestPx;
  const bottom = gridToScreen(bounds.maxX + 1, bounds.maxY + 1).sy;
  return {
    x: left - padding,
    y: top - padding,
    w: right - left + padding * 2,
    h: bottom - top + padding * 2,
  };
}
