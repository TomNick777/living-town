/**
 * convenience_store — 社区便利店,单层临街。
 *
 * Massing: shopFloor(36) + parapet(8) = 44px (bible §3)。Signature: fully
 * lit glass front with shelves behind, cream+orange sign band (the town's
 * own fictional mark — no brand), glass door, a crate by the door. The
 * liveliest warm light on the street, one step above the cafe.
 */

import type { Footprint } from "../scene/coordinates";
import { BUILDING, OUTLINE } from "./buildingTokens";
import {
  Door,
  GlassFront,
  GroundShadow,
  PipeRiser,
  RoofDeck,
  RooftopAC,
  Window,
  type AssetProps,
} from "./facade";
import { boxGeometry, faceRect, IsoBox } from "./iso";
import { PALETTE as P } from "./palette";

const SIGN_BAND_H0 = BUILDING.shopFloorHeight - 6;
const H = BUILDING.shopFloorHeight + BUILDING.parapet;

export function ConvenienceStore({ obj, tokens }: AssetProps) {
  const { x, y, z } = obj.grid;
  const fp: Footprint = obj.def.footprint;
  const g = boxGeometry(x, y, fp, z, H);
  const lit = tokens.shopFront !== "quiet";
  const lively = tokens.shopFront === "lively";
  const [sa, sb] = g.leftBase;
  return (
    <g>
      <GroundShadow x={x} y={y} fp={fp} z={z} />
      <IsoBox x={x} y={y} fp={fp} z={z} height={H} colours={P.store} />
      <RoofDeck g={g} />
      <RooftopAC x={x + 0.3} y={y + 0.25} z={z + H} />
      {/* front: glass with shelves behind, mullions, glass door */}
      <GlassFront a={sa} b={sb} u0={0.05} u1={0.62} sill={4} h={26} lit={lit} mullions={[0.24, 0.43]} shelves />
      <Door a={sa} b={sb} u0={0.68} w={0.12} fill={lit ? P.glassLit : P.glassDark} />
      {/* crate by the door — deliveries happen here */}
      <polygon points={faceRect(sa, sb, 0.84, 0.91, 0, 5)} fill={P.boxWood} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <polygon points={faceRect(sa, sb, 0.84, 0.91, 2.2, 2.8)} fill={P.boxWoodDark} />
      {/* sign band: cream base + muted orange stripe, glowing when open */}
      {lit && <polygon points={faceRect(sa, sb, 0, 1, SIGN_BAND_H0 - 2, BUILDING.shopFloorHeight + 2)} fill="rgba(244,216,150,0.22)" />}
      <g opacity={lit ? 1 : 0.75}>
        <polygon points={faceRect(sa, sb, 0.02, 0.98, SIGN_BAND_H0, BUILDING.shopFloorHeight)} fill={P.awningCream} stroke={OUTLINE.colour} strokeWidth={0.6} />
        <polygon points={faceRect(sa, sb, 0.02, 0.98, SIGN_BAND_H0 + 2, SIGN_BAND_H0 + 4)} fill={P.awningOrange} />
      </g>
      {/* light spilling onto the pavement when the store is busy */}
      {lively && <polygon points={faceRect(sa, sb, 0.62, 0.86, 0, 3)} fill={P.glassLit} opacity={0.35} />}
      {/* side window keeps the east face alive */}
      <Window a={g.rightBase[0]} b={g.rightBase[1]} u0={0.2} sill={12} h={16} lit={lit} />
      <PipeRiser a={g.rightBase[0]} b={g.rightBase[1]} u={0.94} h={H} />
    </g>
  );
}
