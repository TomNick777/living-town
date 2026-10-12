/**
 * residential_a — 中型社区公寓,4 层。
 *
 * Massing: 4 × floorHeight + parapet = 120px (bible §3). Life signals:
 * hashed lit windows per floor, two balconies with plant/laundry, entrance
 * canopy + step + door lamp, wall AC units, dark roof deck with stair box,
 * AC and vent pipe. 不豪华、不破败:同一样 tokens,只是有人住的样子。
 */

import type { Footprint } from "../scene/coordinates";
import { BUILDING, FACADE } from "./buildingTokens";
import {
  ACWall,
  Balcony,
  Door,
  GroundShadow,
  PipeRiser,
  RoofDeck,
  RooftopAC,
  VentPipe,
  WallLamp,
  Window,
  WindowRow,
  type AssetProps,
} from "./facade";
import { boxGeometry, faceRect, IsoBox, at } from "./iso";
import { PALETTE as P } from "./palette";

const FLOORS = [0, BUILDING.floorHeight, BUILDING.floorHeight * 2, BUILDING.floorHeight * 3];
const S_COLUMNS = [0.08, 0.3, 0.52, 0.74];
const E_COLUMNS = [0.15, 0.42, 0.69];

export function ResidentialA({ obj, tokens }: AssetProps) {
  const { x, y, z } = obj.grid;
  const fp: Footprint = obj.def.footprint;
  const H = 4 * BUILDING.floorHeight + BUILDING.parapet;
  const g = boxGeometry(x, y, fp, z, H);
  const antenna = at(x + 1.7, y + 1.7, z + H);
  return (
    <g>
      <GroundShadow x={x} y={y} fp={fp} z={z} />
      <IsoBox x={x} y={y} fp={fp} z={z} height={H} colours={P.residentialA} />
      <RoofDeck g={g} />
      {/* roof: stair box + AC + vent + TV antenna — lived-with, not decorated */}
      <IsoBox x={x + 0.12} y={y + 0.12} fp={{ w: 0.42, h: 0.34 }} z={z + H} height={9} colours={P.rooftop} />
      <RooftopAC x={x + 1.5} y={y + 0.3} z={z + H} />
      <VentPipe x={x + 0.75} y={y + 1.65} z={z + H} />
      <line x1={antenna.sx} y1={antenna.sy} x2={antenna.sx} y2={antenna.sy - 11} stroke={P.pole} strokeWidth={1} />
      <line x1={antenna.sx - 2.5} y1={antenna.sy - 9} x2={antenna.sx + 2.5} y2={antenna.sy - 9} stroke={P.pole} strokeWidth={0.9} />
      {/* upper floors: one window row per floor, per-window hashed light */}
      {[1, 2, 3].map((f) => (
        <WindowRow
          key={`s${f}`}
          obj={obj}
          face="S"
          a={g.leftBase[0]}
          b={g.leftBase[1]}
          columns={S_COLUMNS}
          sill={FLOORS[f] + FACADE.windowSill}
          tokens={tokens}
        />
      ))}
      {[1, 2, 3].map((f) => (
        <WindowRow
          key={`e${f}`}
          obj={obj}
          face="E"
          a={g.rightBase[0]}
          b={g.rightBase[1]}
          columns={E_COLUMNS}
          sill={FLOORS[f] + FACADE.windowSill}
          tokens={tokens}
        />
      ))}
      {/* ground floor: lobby window, entrance, canopy, step, door lamp */}
      <Window a={g.leftBase[0]} b={g.leftBase[1]} u0={0.08} sill={FACADE.windowSill} lit={tokens.windowLight !== "dim"} />
      <Door a={g.leftBase[0]} b={g.leftBase[1]} u0={0.44} />
      <polygon
        points={faceRect(g.leftBase[0], g.leftBase[1], 0.4, 0.6, FACADE.doorHeight, FACADE.doorHeight + 3)}
        fill={P.rooftop.left}
        stroke="rgba(38,48,58,0.45)"
        strokeWidth={0.5}
      />
      <polygon points={faceRect(g.leftBase[0], g.leftBase[1], 0.42, 0.58, 0, 2)} fill={P.doorStep} />
      <WallLamp a={g.leftBase[0]} b={g.leftBase[1]} u={0.62} h={14} />
      {/* balconies over the street face: laundry below, a plant above */}
      <Balcony x={x} y={y} fp={fp} u0={0.3} w={0.36} z={z + FLOORS[1]} laundry={2} />
      <Balcony x={x} y={y} fp={fp} u0={0.08} w={0.36} z={z + FLOORS[2]} pot />
      {/* secondary details: wall AC, drain pipe */}
      <ACWall a={g.leftBase[0]} b={g.leftBase[1]} u0={0.86} sill={12} />
      <ACWall a={g.rightBase[0]} b={g.rightBase[1]} u0={0.585} sill={FLOORS[1] + 12} />
      <PipeRiser a={g.leftBase[0]} b={g.leftBase[1]} u={0.985} h={H} />
    </g>
  );
}
