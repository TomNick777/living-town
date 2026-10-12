/**
 * residential_b — 低层混合居住楼:底层小店面 + 上层住宅。
 *
 * Massing: shopFloor(36) + floor(28) + parapet(8) = 72px (bible §3)。
 * Same tokens as residential_a — same windows, same roof, same outline —
 * but a wide-low silhouette, a cream shop awning and a menu board by the
 * door. Same neighbourhood, different building.
 */

import type { Footprint } from "../scene/coordinates";
import { BUILDING, FACADE } from "./buildingTokens";
import {
  ACWall,
  Balcony,
  Door,
  GlassFront,
  GroundShadow,
  PipeRiser,
  ProjectingAwning,
  RoofDeck,
  RooftopAC,
  VentPipe,
  WallLamp,
  WindowRow,
  type AssetProps,
} from "./facade";
import { boxGeometry, faceRect, IsoBox } from "./iso";
import { PALETTE as P } from "./palette";

const RES_FLOOR = BUILDING.shopFloorHeight; // upper residential floor base
const H = BUILDING.shopFloorHeight + BUILDING.floorHeight + BUILDING.parapet;

export function ResidentialB({ obj, tokens }: AssetProps) {
  const { x, y, z } = obj.grid;
  const fp: Footprint = obj.def.footprint;
  const g = boxGeometry(x, y, fp, z, H);
  const lit = tokens.shopFront !== "quiet";
  const [sa, sb] = g.leftBase;
  return (
    <g>
      <GroundShadow x={x} y={y} fp={fp} z={z} />
      <IsoBox x={x} y={y} fp={fp} z={z} height={H} colours={P.residentialB} />
      <RoofDeck g={g} />
      <RooftopAC x={x + 0.25} y={y + 0.2} z={z + H} />
      <VentPipe x={x + 1.6} y={y + 1.5} z={z + H} />
      {/* upper floor: the same window language as residential_a */}
      <WindowRow obj={obj} face="S" a={sa} b={sb} columns={[0.08, 0.3, 0.52, 0.74]} sill={RES_FLOOR + FACADE.windowSill} tokens={tokens} />
      <WindowRow obj={obj} face="E" a={g.rightBase[0]} b={g.rightBase[1]} columns={[0.15, 0.42, 0.69]} sill={RES_FLOOR + FACADE.windowSill} tokens={tokens} />
      <Balcony x={x} y={y} fp={fp} u0={0.26} w={0.4} z={z + RES_FLOOR} laundry={2} />
      {/* ground-floor corner shop: glass, cream awning, door, menu board */}
      <GlassFront a={sa} b={sb} u0={0.06} u1={0.46} sill={6} h={24} lit={lit} mullions={[0.26]} shelves />
      <ProjectingAwning x={x} y={y} fp={fp} u0={0.04} u1={0.5} zTop={30} colours={[P.awningCream, P.rooftop.left]} segments={4} />
      <Door a={sa} b={sb} u0={0.54} w={0.1} fill={lit ? P.glassLit : P.door} />
      <WallLamp a={sa} b={sb} u={0.585} h={25} />
      <polygon points={faceRect(sa, sb, 0.68, 0.78, 4, 12)} fill={P.signDark} stroke="rgba(38,48,58,0.45)" strokeWidth={0.5} />
      <polygon points={faceRect(sa, sb, 0.7, 0.76, 7, 9.5)} fill={P.awningCream} opacity={0.85} />
      <ACWall a={sa} b={sb} u0={0.84} sill={6} />
      <ACWall a={g.rightBase[0]} b={g.rightBase[1]} u0={0.85} sill={RES_FLOOR + 10} />
      <PipeRiser a={sa} b={sb} u={0.985} h={H} />
    </g>
  );
}
