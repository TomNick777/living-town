/**
 * Facade primitives — the shared drawing vocabulary for building faces.
 *
 * Every window, door, awning, sign, balcony and roof in Living Town is drawn
 * through these helpers so the core assets stay one visual system
 * (docs/living-town-asset-bible.md). All measurements come from
 * buildingTokens.ts; all colours from palette.ts. No component may place a
 * hand-written pixel: everything hangs off a face base edge or a grid point.
 */

import type { Footprint, ScreenPos } from "../scene/coordinates";
import { groundQuad, pointsAttr } from "../scene/coordinates";
import type { PlacedObject } from "../scene/sceneModel";
import { BUILDING, FACADE, GLOW, OUTLINE, SHADOW } from "./buildingTokens";
import { along, at, boxGeometry, faceRect, lift, IsoBox, type BoxGeometry } from "./iso";
import { PALETTE as P } from "./palette";
import { LIT_WINDOW_PERCENT, stableHash, type RenderTokens } from "./tokens";

export interface AssetProps {
  obj: PlacedObject;
  tokens: RenderTokens;
  /** Ordinal among living elements (colour variation only). */
  index?: number;
}

/** Deterministic per-window light: the same window always lights the same. */
export function isLitWindow(objId: string, face: string, i: number, tokens: RenderTokens): boolean {
  return stableHash(`${objId}:${face}:${i}`) < LIT_WINDOW_PERCENT[tokens.windowLight];
}

// ------------------------------------------------------------------ facade

/** One framed window; lit glass carries a soft warm halo. */
export function Window({
  a,
  b,
  u0,
  sill,
  w = FACADE.windowWidth,
  h = FACADE.windowHeight,
  lit,
}: {
  a: ScreenPos;
  b: ScreenPos;
  u0: number;
  sill: number;
  w?: number;
  h?: number;
  lit: boolean;
}) {
  const len = Math.hypot(b.sx - a.sx, b.sy - a.sy);
  const sf = GLOW.spread / len;
  return (
    <g>
      {lit && (
        <polygon
          points={faceRect(a, b, u0 - sf, u0 + w + sf, sill - GLOW.spread, sill + h + GLOW.spread)}
          fill={GLOW.colour}
        />
      )}
      <polygon points={faceRect(a, b, u0 - 0.018, u0 + w + 0.018, sill - 2, sill + h + 2)} fill={P.frame} />
      <polygon points={faceRect(a, b, u0, u0 + w, sill, sill + h)} fill={lit ? P.windowLit : P.windowDark} />
    </g>
  );
}

/** A row of windows on one face, lit by the stable per-window hash. */
export function WindowRow({
  obj,
  face,
  a,
  b,
  columns,
  sill,
  tokens,
}: {
  obj: PlacedObject;
  face: string;
  a: ScreenPos;
  b: ScreenPos;
  columns: number[];
  sill: number;
  tokens: RenderTokens;
}) {
  return (
    <g>
      {columns.map((u0, i) => (
        <Window key={i} a={a} b={b} u0={u0} sill={sill} lit={isLitWindow(obj.id, face, i, tokens)} />
      ))}
    </g>
  );
}

/** Shopfront glass with frame, optional mullions and interior shelf lines. */
export function GlassFront({
  a,
  b,
  u0,
  u1,
  sill,
  h,
  lit,
  mullions = [],
  shelves = false,
}: {
  a: ScreenPos;
  b: ScreenPos;
  u0: number;
  u1: number;
  sill: number;
  h: number;
  lit: boolean;
  mullions?: number[];
  shelves?: boolean;
}) {
  return (
    <g>
      <polygon points={faceRect(a, b, u0 - 0.015, u1 + 0.015, sill - 2, sill + h + 2)} fill={P.frame} />
      <polygon points={faceRect(a, b, u0, u1, sill, sill + h)} fill={lit ? P.glassLit : P.glassDark} opacity={lit ? 0.95 : 0.9} />
      {shelves &&
        lit &&
        [0.38, 0.68].map((t) => (
          <polygon
            key={t}
            points={faceRect(a, b, u0 + 0.01, u1 - 0.01, sill + h * t, sill + h * t + 1.1)}
            fill={P.frame}
            opacity={0.7}
          />
        ))}
      {mullions.map((m) => (
        <polygon key={m} points={faceRect(a, b, m - 0.008, m + 0.008, sill, sill + h)} fill={P.frame} />
      ))}
    </g>
  );
}

export function Door({
  a,
  b,
  u0,
  w = FACADE.doorWidth,
  h = FACADE.doorHeight,
  fill = P.door,
}: {
  a: ScreenPos;
  b: ScreenPos;
  u0: number;
  w?: number;
  h?: number;
  fill?: string;
}) {
  return (
    <g>
      <polygon points={faceRect(a, b, u0 - 0.015, u0 + w + 0.015, 0, h + 2)} fill={P.frame} />
      <polygon points={faceRect(a, b, u0, u0 + w, 0, h)} fill={fill} />
    </g>
  );
}

/**
 * A projecting striped awning hanging off a south face at zTop. The front
 * face carries the stripes; the top face keeps colours[0].
 */
export function ProjectingAwning({
  x,
  y,
  fp,
  u0,
  u1,
  zTop,
  depth = FACADE.awningDepth,
  colours,
  segments = 5,
}: {
  x: number;
  y: number;
  fp: Footprint;
  u0: number;
  u1: number;
  zTop: number;
  depth?: number;
  colours: [string, string];
  segments?: number;
}) {
  const h = 2.5;
  const g = boxGeometry(x + u0 * fp.w, y + fp.h, { w: (u1 - u0) * fp.w, h: depth }, zTop - h, h);
  return (
    <g>
      {Array.from({ length: segments }, (_, i) => (
        <polygon
          key={i}
          points={faceRect(g.leftBase[0], g.leftBase[1], i / segments, (i + 1) / segments, 0, h)}
          fill={i % 2 === 0 ? colours[0] : colours[1]}
        />
      ))}
      <polygon points={faceRect(g.leftBase[0], g.leftBase[1], 0, 1, 0, h)} fill="none" stroke={OUTLINE.colour} strokeWidth={0.6} />
      <polygon points={pointsAttr(g.top)} fill={colours[0]} stroke={OUTLINE.colour} strokeWidth={0.6} opacity={0.95} />
    </g>
  );
}

/**
 * A projecting balcony slab with railing, off a south face at floor base z.
 * Optional potted plant and hanging laundry — micro detail, spend sparingly
 * (bible §8).
 */
export function Balcony({
  x,
  y,
  fp,
  u0,
  w,
  z,
  depth = FACADE.balconyDepth,
  pot = false,
  laundry = 0,
}: {
  x: number;
  y: number;
  fp: Footprint;
  u0: number;
  w: number;
  z: number;
  depth?: number;
  pot?: boolean;
  laundry?: number;
}) {
  const bfp = { w: w * fp.w, h: depth };
  const bx = x + u0 * fp.w;
  const g = boxGeometry(bx, y + fp.h, bfp, z, 2.5);
  const railH = FACADE.balconyRailH;
  const [fa, fb] = g.leftBase;
  const railTop = [lift(fa, 2.5 + railH), lift(fb, 2.5 + railH)] as const;
  const laundryColours = [P.terracotta, P.people[3]];
  return (
    <g>
      <IsoBox x={bx} y={y + fp.h} fp={bfp} z={z} height={2.5} colours={P.rooftop} />
      <line x1={lift(g.n, 2.5 + railH * 0.7).sx} y1={lift(g.n, 2.5 + railH * 0.7).sy} x2={lift(g.w, 2.5 + railH * 0.7).sx} y2={lift(g.w, 2.5 + railH * 0.7).sy} stroke={P.pole} strokeWidth={0.8} />
      <line x1={lift(g.s, 2.5 + railH * 0.7).sx} y1={lift(g.s, 2.5 + railH * 0.7).sy} x2={lift(g.e, 2.5 + railH * 0.7).sx} y2={lift(g.e, 2.5 + railH * 0.7).sy} stroke={P.pole} strokeWidth={0.8} />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const p = along(fa, fb, t);
        return <line key={t} x1={p.sx} y1={p.sy - 2.5} x2={p.sx} y2={p.sy - 2.5 - railH} stroke={P.pole} strokeWidth={0.8} />;
      })}
      <line x1={railTop[0].sx} y1={railTop[0].sy} x2={railTop[1].sx} y2={railTop[1].sy} stroke={P.pole} strokeWidth={1.1} />
      {Array.from({ length: laundry }, (_, i) => {
        const p = along(fa, fb, 0.3 + i * 0.25);
        return <rect key={i} x={p.sx - 1.4} y={p.sy - 2.5 - railH + 0.5} width={2.8} height={4.2} fill={laundryColours[i % laundryColours.length]} />;
      })}
      {pot && (
        <g>
          <circle cx={along(fa, fb, 0.15).sx} cy={along(fa, fb, 0.15).sy - 4.5} r={1.7} fill={P.terracotta} />
          <circle cx={along(fa, fb, 0.15).sx} cy={along(fa, fb, 0.15).sy - 6.2} r={1.3} fill={P.canopyLight} />
        </g>
      )}
    </g>
  );
}

/** Wall-mounted AC unit — the workhorse secondary detail (bible §8). */
export function ACWall({
  a,
  b,
  u0,
  sill,
  w = 0.07,
  h = 6,
}: {
  a: ScreenPos;
  b: ScreenPos;
  u0: number;
  sill: number;
  w?: number;
  h?: number;
}) {
  return (
    <g>
      <polygon points={faceRect(a, b, u0, u0 + w, sill, sill + h)} fill={P.vendFront} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <polygon points={faceRect(a, b, u0 + w * 0.2, u0 + w * 0.7, sill + h * 0.35, sill + h * 0.65)} fill={P.frame} opacity={0.7} />
    </g>
  );
}

/** Small warm door lamp: light where someone comes home. */
export function WallLamp({ a, b, u, h }: { a: ScreenPos; b: ScreenPos; u: number; h: number }) {
  const p = lift(along(a, b, u), h);
  return (
    <g>
      <circle cx={p.sx} cy={p.sy} r={3.5} fill={GLOW.colour} />
      <circle cx={p.sx} cy={p.sy} r={1.3} fill={P.lamp} />
    </g>
  );
}

/** Vertical drain pipe hugging a face edge. */
export function PipeRiser({ a, b, u, h }: { a: ScreenPos; b: ScreenPos; u: number; h: number }) {
  const p0 = along(a, b, u);
  return <line x1={p0.sx} y1={p0.sy} x2={p0.sx} y2={p0.sy - h} stroke={P.frame} strokeWidth={1.2} opacity={0.8} />;
}

// -------------------------------------------------------------------- roof

/** The dark inner roof deck inside the parapet — the reference roof signature. */
export function RoofDeck({ g, inset = BUILDING.roofInset }: { g: BoxGeometry; inset?: number }) {
  const cx = (g.top[0].sx + g.top[2].sx) / 2;
  const cy = (g.top[0].sy + g.top[2].sy) / 2;
  const centre = { sx: cx, sy: cy };
  const inner = g.top.map((p) => along(p, centre, inset));
  return <polygon points={pointsAttr(inner)} fill={P.roofDeck} stroke={OUTLINE.colour} strokeWidth={0.6} />;
}

/** Rooftop AC unit (tiny box + fan dot). */
export function RooftopAC({ x, y, z }: { x: number; y: number; z: number }) {
  const p = at(x + 0.08, y + 0.065, z);
  return (
    <g>
      <IsoBox x={x} y={y} fp={{ w: 0.16, h: 0.13 }} z={z} height={5} colours={P.rooftop} />
      <circle cx={p.sx} cy={p.sy - 5} r={1.3} fill={P.bin} />
    </g>
  );
}

/** Rooftop vent pipe. */
export function VentPipe({ x, y, z, h = 7 }: { x: number; y: number; z: number; h?: number }) {
  const p = at(x, y, z);
  return (
    <g>
      <line x1={p.sx} y1={p.sy} x2={p.sx} y2={p.sy - h} stroke={P.pole} strokeWidth={1.4} />
      <line x1={p.sx - 2} y1={p.sy - h} x2={p.sx + 2} y2={p.sy - h} stroke={P.pole} strokeWidth={1.2} />
    </g>
  );
}

// -------------------------------------------------------------- sign / misc

/** Wall sign board; the only glyph in town is a coffee cup, drawn abstractly. */
export function SignBoard({
  a,
  b,
  u0,
  u1,
  h0,
  h1,
  fill,
  glyph,
}: {
  a: ScreenPos;
  b: ScreenPos;
  u0: number;
  u1: number;
  h0: number;
  h1: number;
  fill: string;
  glyph?: "cup";
}) {
  const mid = lift(along(a, b, (u0 + u1) / 2), (h0 + h1) / 2);
  return (
    <g>
      <polygon points={faceRect(a, b, u0, u1, h0, h1)} fill={fill} stroke={OUTLINE.colour} strokeWidth={0.6} />
      {glyph === "cup" && (
        <g>
          <rect x={mid.sx - 2.4} y={mid.sy - 1.9} width={4} height={3.2} rx={0.9} fill={P.awningCream} />
          <circle cx={mid.sx + 2.5} cy={mid.sy - 0.3} r={1} fill="none" stroke={P.awningCream} strokeWidth={0.7} />
        </g>
      )}
    </g>
  );
}

/** Soft contact shadow under a solid object: offset to the lower-right. */
export function GroundShadow({ x, y, fp, z = 0 }: { x: number; y: number; fp: Footprint; z?: number }) {
  const q = groundQuad(x, y, fp, z).map((p) => ({ sx: p.sx + SHADOW.dx, sy: p.sy + SHADOW.dy }));
  return <polygon points={pointsAttr(q)} fill={SHADOW.colour} />;
}
