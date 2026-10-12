/**
 * Isometric drawing primitives. Every shape is derived from grid coordinates
 * through scene/coordinates.ts — no hand-placed pixels.
 */

import { gridToScreen, groundQuad, pointsAttr, type Footprint, type ScreenPos } from "../scene/coordinates";
import { OUTLINE } from "./buildingTokens";
import type { FaceColours } from "./palette";

export type Quad = [ScreenPos, ScreenPos, ScreenPos, ScreenPos];

export function lift(p: ScreenPos, height: number): ScreenPos {
  return { sx: p.sx, sy: p.sy - height };
}

export function along(a: ScreenPos, b: ScreenPos, u: number): ScreenPos {
  return { sx: a.sx + (b.sx - a.sx) * u, sy: a.sy + (b.sy - a.sy) * u };
}

/**
 * A quad on a vertical face whose base edge runs from `a` to `b`, spanning
 * fractions u0..u1 of that edge and heights hBottom..hTop above it.
 */
export function faceRect(a: ScreenPos, b: ScreenPos, u0: number, u1: number, hBottom: number, hTop: number): string {
  return pointsAttr([
    lift(along(a, b, u0), hBottom),
    lift(along(a, b, u1), hBottom),
    lift(along(a, b, u1), hTop),
    lift(along(a, b, u0), hTop),
  ]);
}

export interface BoxGeometry {
  n: ScreenPos;
  e: ScreenPos;
  s: ScreenPos;
  w: ScreenPos;
  top: Quad;
  /** South face (bottom-left on screen): base edge W -> S. */
  leftBase: [ScreenPos, ScreenPos];
  /** East face (bottom-right on screen): base edge S -> E. */
  rightBase: [ScreenPos, ScreenPos];
  height: number;
}

export function boxGeometry(x: number, y: number, fp: Footprint, z: number, height: number): BoxGeometry {
  const [n, e, s, w] = groundQuad(x, y, fp, z);
  return {
    n,
    e,
    s,
    w,
    top: [lift(n, height), lift(e, height), lift(s, height), lift(w, height)],
    leftBase: [w, s],
    rightBase: [s, e],
    height,
  };
}

export function IsoBox({
  x,
  y,
  fp,
  z = 0,
  height,
  colours,
  stroke = OUTLINE.colour,
}: {
  x: number;
  y: number;
  fp: Footprint;
  z?: number;
  height: number;
  colours: FaceColours;
  stroke?: string;
}) {
  const g = boxGeometry(x, y, fp, z, height);
  return (
    <g>
      <polygon points={faceRect(g.leftBase[0], g.leftBase[1], 0, 1, 0, height)} fill={colours.left} stroke={stroke} strokeWidth={OUTLINE.width} />
      <polygon points={faceRect(g.rightBase[0], g.rightBase[1], 0, 1, 0, height)} fill={colours.right} stroke={stroke} strokeWidth={OUTLINE.width} />
      <polygon points={pointsAttr(g.top)} fill={colours.top} stroke={stroke} strokeWidth={OUTLINE.width} />
    </g>
  );
}

/** Flat diamond tile for one or more cells. */
export function Tile({
  x,
  y,
  fp = { w: 1, h: 1 },
  z = 0,
  fill,
  stroke,
  strokeWidth = 0.6,
  opacity,
}: {
  x: number;
  y: number;
  fp?: Footprint;
  z?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}) {
  return (
    <polygon
      points={pointsAttr(groundQuad(x, y, fp, z))}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? strokeWidth : 0}
      opacity={opacity}
    />
  );
}

/** Screen point of a fractional grid position — for small props inside a cell. */
export function at(x: number, y: number, z = 0): ScreenPos {
  return gridToScreen(x, y, z);
}
