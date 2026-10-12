/**
 * street_light — 路灯,全场景的尺度标尺(bible §3)。
 *
 * ≈ 2.8 × person height, thin tapered pole on a small pedestal, one curved
 * arm, a lantern head with a warm lens and two soft glow halos — the "light
 * pool" that anchors the whole street. No decoration, nothing futuristic.
 */

import { OUTLINE, SHADOW } from "./buildingTokens";
import { type AssetProps } from "./facade";
import { at } from "./iso";
import { PALETTE as P } from "./palette";

const POLE_H = 46;
const ARM_DX = 8;

export function StreetLight({ obj }: AssetProps) {
  const { x, y, z } = obj.grid;
  const base = at(x + 0.5, y + 0.5, z);
  const head = { sx: base.sx + ARM_DX, sy: base.sy - POLE_H - 2 };
  return (
    <g>
      <ellipse cx={base.sx + 2} cy={base.sy + 0.5} rx={4.5} ry={2} fill={SHADOW.colour} />
      {/* pedestal */}
      <polygon
        points={`${base.sx - 2.4},${base.sy} ${base.sx + 0.8},${base.sy - 1.6} ${base.sx + 2.4},${base.sy} ${base.sx - 0.8},${base.sy + 1.6}`}
        fill={P.rooftop.right}
        stroke={OUTLINE.colour}
        strokeWidth={0.5}
      />
      {/* tapered pole */}
      <polygon
        points={`${base.sx - 1},${base.sy} ${base.sx - 0.6},${base.sy - POLE_H} ${base.sx + 0.6},${base.sy - POLE_H} ${base.sx + 1},${base.sy}`}
        fill={P.pole}
      />
      {/* curved arm out to the lantern */}
      <path
        d={`M ${base.sx} ${base.sy - POLE_H + 1} Q ${base.sx + 4.5} ${base.sy - POLE_H - 3.5} ${head.sx} ${head.sy + 1.5}`}
        stroke={P.pole}
        strokeWidth={1.6}
        fill="none"
      />
      {/* warm light pool, then the lantern itself */}
      <circle cx={head.sx} cy={head.sy} r={11} fill={P.lampGlow} opacity={0.09} />
      <circle cx={head.sx} cy={head.sy} r={6} fill={P.lampGlow} opacity={0.16} />
      <polygon
        points={`${head.sx - 4},${head.sy + 1} ${head.sx + 4},${head.sy + 1} ${head.sx + 2.5},${head.sy - 2.5} ${head.sx - 2.5},${head.sy - 2.5}`}
        fill={P.pole}
        stroke={OUTLINE.colour}
        strokeWidth={0.5}
      />
      <ellipse cx={head.sx} cy={head.sy + 1.2} rx={2.6} ry={1.5} fill={P.lamp} />
    </g>
  );
}
