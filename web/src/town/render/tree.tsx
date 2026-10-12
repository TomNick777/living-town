/**
 * tree — 行道树,本项目自己的树木语言(bible §1.10)。
 *
 * Not a green ball: tapered trunk, forked branches, a cluster of layered
 * canopy lobes in three low-saturation greens, a soil cutout in the
 * pavement. Three deterministic size variants (per object id) so rows of
 * trees don't look cloned. Never taller than the street light.
 */

import { OUTLINE, SHADOW } from "./buildingTokens";
import { type AssetProps } from "./facade";
import { at } from "./iso";
import { PALETTE as P } from "./palette";
import { stableHash } from "./tokens";

const SIZES = [0.88, 1, 1.12];

export function Tree({ obj }: AssetProps) {
  const { x, y, z } = obj.grid;
  const b = at(x + 0.5, y + 0.55, z);
  const s = SIZES[stableHash(obj.id) % SIZES.length];
  const trunkH = 20 * s;
  const cy = 31 * s;
  return (
    <g>
      {/* soil cutout + contact shadow */}
      <ellipse cx={b.sx + SHADOW.dx * 0.6} cy={b.sy + 0.8} rx={8.5 * s} ry={3.2 * s} fill={SHADOW.colour} />
      <ellipse cx={b.sx} cy={b.sy} rx={5.5 * s} ry={2.4 * s} fill={P.soil} />
      {/* tapered trunk + forked branches into the canopy */}
      <polygon
        points={`${b.sx - 1.7 * s},${b.sy} ${b.sx - 0.9 * s},${b.sy - trunkH} ${b.sx + 0.9 * s},${b.sy - trunkH} ${b.sx + 1.7 * s},${b.sy}`}
        fill={P.trunk}
      />
      <line x1={b.sx} y1={b.sy - trunkH + 2} x2={b.sx - 6 * s} y2={b.sy - trunkH - 5 * s} stroke={P.trunk} strokeWidth={1.4} />
      <line x1={b.sx} y1={b.sy - trunkH + 2} x2={b.sx + 6 * s} y2={b.sy - trunkH - 6 * s} stroke={P.trunk} strokeWidth={1.4} />
      {/* canopy: layered lobes, lighter towards the light (upper-left) */}
      <ellipse cx={b.sx} cy={b.sy - cy} rx={13.5 * s} ry={10.5 * s} fill={P.canopyDark} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <ellipse cx={b.sx - 8 * s} cy={b.sy - cy + 4 * s} rx={8.5 * s} ry={7.5 * s} fill={P.canopy} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <ellipse cx={b.sx + 8 * s} cy={b.sy - cy + 3 * s} rx={8.5 * s} ry={7.5 * s} fill={P.canopy} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <ellipse cx={b.sx - 1 * s} cy={b.sy - cy - 5 * s} rx={8 * s} ry={6.5 * s} fill={P.canopyLight} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <ellipse cx={b.sx - 4 * s} cy={b.sy - cy - 7 * s} rx={3.6 * s} ry={2.8 * s} fill={P.canopyHighlight} />
    </g>
  );
}
