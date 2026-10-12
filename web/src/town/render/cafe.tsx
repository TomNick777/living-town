/**
 * cafe — 社区小咖啡店,单层,比便利店更安静。
 *
 * Massing: shopFloor(36) + taller parapet(10) = 46px (bible §3)。Signature:
 * teal/cream striped awning, counter window with stools in silhouette,
 * dark fascia sign with an abstract cup glyph (the town's own mark, not a
 * brand), chalkboard menu, one potted plant. Softer and quieter than the
 * convenience store's light.
 */

import type { Footprint } from "../scene/coordinates";
import { BUILDING, OUTLINE } from "./buildingTokens";
import {
  Door,
  GlassFront,
  GroundShadow,
  PipeRiser,
  ProjectingAwning,
  RoofDeck,
  SignBoard,
  VentPipe,
  WallLamp,
  Window,
  type AssetProps,
} from "./facade";
import { along, boxGeometry, faceRect, IsoBox } from "./iso";
import { PALETTE as P } from "./palette";

const H = BUILDING.shopFloorHeight + 10;
const AWNING_TOP = BUILDING.shopFloorHeight - 6;

export function Cafe({ obj, tokens }: AssetProps) {
  const { x, y, z } = obj.grid;
  const fp: Footprint = obj.def.footprint;
  const g = boxGeometry(x, y, fp, z, H);
  const lit = tokens.shopFront !== "quiet";
  const [sa, sb] = g.leftBase;
  const pot = along(sa, sb, 0.545);
  return (
    <g>
      <GroundShadow x={x} y={y} fp={fp} z={z} />
      <IsoBox x={x} y={y} fp={fp} z={z} height={H} colours={P.cafe} />
      <RoofDeck g={g} />
      <VentPipe x={x + 0.75} y={y + 0.35} z={z + H} />
      {/* counter window: warm glass, counter line, two stools in silhouette */}
      <GlassFront a={sa} b={sb} u0={0.08} u1={0.5} sill={8} h={20} lit={lit} />
      {lit && (
        <g>
          <polygon points={faceRect(sa, sb, 0.09, 0.49, 17, 18.4)} fill={P.frame} opacity={0.7} />
          {[0.17, 0.36].map((u) => {
            const p = along(sa, sb, u);
            return (
              <g key={u}>
                <line x1={p.sx} y1={p.sy - 7} x2={p.sx} y2={p.sy - 12} stroke={P.benchWoodDark} strokeWidth={1} />
                <circle cx={p.sx} cy={p.sy - 12.5} r={1.7} fill={P.benchWoodDark} />
              </g>
            );
          })}
        </g>
      )}
      <Door a={sa} b={sb} u0={0.58} w={0.16} />
      <WallLamp a={sa} b={sb} u={0.66} h={25} />
      {/* striped awning across the whole front */}
      <ProjectingAwning x={x} y={y} fp={fp} u0={0.04} u1={0.96} zTop={AWNING_TOP + 4} colours={[P.awningTeal, P.awningCream]} segments={5} />
      {/* fascia sign with the abstract cup */}
      <SignBoard a={sa} b={sb} u0={0.3} u1={0.55} h0={AWNING_TOP + 8} h1={H - 2} fill={P.signDark} glyph="cup" />
      {/* chalkboard menu + one potted plant — micro details, that's all */}
      <polygon points={faceRect(sa, sb, 0.84, 0.93, 0, 9)} fill={P.signDark} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <polygon points={faceRect(sa, sb, 0.865, 0.905, 5, 7)} fill={P.awningCream} opacity={0.85} />
      <ellipse cx={pot.sx} cy={pot.sy} rx={2} ry={1.4} fill={P.terracotta} />
      <circle cx={pot.sx} cy={pot.sy - 2.4} r={1.5} fill={P.canopyLight} />
      {/* side window towards the river */}
      <Window a={g.rightBase[0]} b={g.rightBase[1]} u0={0.25} sill={12} h={14} lit={lit} />
      <PipeRiser a={g.rightBase[0]} b={g.rightBase[1]} u={0.94} h={H} />
    </g>
  );
}
