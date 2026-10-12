/**
 * Asset components — one SVG drawing per registry asset.
 *
 * The six Visual-DNA assets (residential_a/b, convenience_store, cafe,
 * tree, street_light) live in their own files and share the facade.tsx
 * primitives; this module keeps the remaining assets — flat tiles, street
 * furniture, living elements — coherent with the same palette and building
 * tokens. No component receives TownState, TownVisualState or any number
 * that means money.
 */

import type { AssetId } from "../scene/assets";
import { pointsAttr } from "../scene/coordinates";
import { OUTLINE } from "./buildingTokens";
import type { AssetProps } from "./facade";
import { along, at, boxGeometry, faceRect, IsoBox, lift, Tile } from "./iso";
import { PALETTE as P } from "./palette";
import { stableHash } from "./tokens";
import { Cafe } from "./cafe";
import { ConvenienceStore } from "./convenienceStore";
import { ResidentialA } from "./residentialA";
import { ResidentialB } from "./residentialB";
import { StreetLight } from "./streetLight";
import { Tree } from "./tree";

export type { AssetProps } from "./facade";

type AssetComponent = (props: AssetProps) => JSX.Element;

// ------------------------------------------------------------- flat tiles

const Water: AssetComponent = ({ obj }) => {
  const { x, y } = obj.grid;
  const alt = (x + y) % 2 === 0;
  const a = at(x + 0.25, y + 0.55);
  const b = at(x + 0.55, y + 0.25);
  return (
    <g>
      <Tile x={x} y={y} fill={alt ? P.water : P.waterAlt} />
      <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={P.ripple} strokeWidth={1} opacity={0.7} />
    </g>
  );
};

const FLOWER_COUNT = { bare: 0, sparse: 1, tended: 2, blooming: 4 } as const;
const FLOWERS = [P.flowerA, P.flowerB, P.flowerC, P.flowerA];

function Flowers({ x, y, count, seed }: { x: number; y: number; count: number; seed: string }) {
  const spots = [
    [0.3, 0.35],
    [0.62, 0.3],
    [0.4, 0.66],
    [0.7, 0.62],
  ];
  return (
    <g>
      {spots.slice(0, count).map(([fx, fy], i) => {
        const p = at(x + fx, y + fy, 3);
        return <circle key={i} cx={p.sx} cy={p.sy} r={2.2} fill={FLOWERS[(i + stableHash(seed)) % FLOWERS.length]} />;
      })}
    </g>
  );
}

const GreenPatch: AssetComponent = ({ obj, tokens }) => {
  const { x, y } = obj.grid;
  return (
    <g>
      <Tile x={x} y={y} fill={P.green} />
      <Flowers x={x} y={y} count={FLOWER_COUNT[tokens.greenery]} seed={obj.id} />
    </g>
  );
};

function axisLine(x: number, y: number, ns: boolean) {
  const a = ns ? at(x + 0.5, y) : at(x, y + 0.5);
  const b = ns ? at(x + 0.5, y + 1) : at(x + 1, y + 0.5);
  return <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={P.roadLine} strokeWidth={1} strokeDasharray="6 6" />;
}

const RoadStraight: AssetComponent = ({ obj }) => {
  const { x, y } = obj.grid;
  const ns = obj.orientation === "N" || obj.orientation === "S";
  return (
    <g>
      <Tile x={x} y={y} fill={P.road} />
      {axisLine(x, y, ns)}
    </g>
  );
};

const RoadCorner: AssetComponent = ({ obj }) => {
  const { x, y } = obj.grid;
  const c = at(x + 0.5, y + 0.5);
  const arms: Record<string, { sx: number; sy: number }> = {
    N: at(x + 0.5, y),
    S: at(x + 0.5, y + 1),
    E: at(x + 1, y + 0.5),
    W: at(x, y + 0.5),
  };
  return (
    <g>
      <Tile x={x} y={y} fill={P.road} />
      {obj.orientation.split("").map((arm) => {
        const p = arms[arm];
        return <line key={arm} x1={c.sx} y1={c.sy} x2={p.sx} y2={p.sy} stroke={P.roadLine} strokeWidth={1} strokeDasharray="6 6" />;
      })}
    </g>
  );
};

const Crosswalk: AssetComponent = ({ obj }) => {
  const { x, y } = obj.grid;
  return (
    <g>
      <Tile x={x} y={y} fill={P.road} />
      {[0.22, 0.42, 0.62, 0.82].map((t) => {
        const a = at(x + 0.12, y + t);
        const b = at(x + 0.88, y + t);
        return <line key={t} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={P.crosswalkStripe} strokeWidth={3} opacity={0.9} />;
      })}
    </g>
  );
};

const Sidewalk: AssetComponent = ({ obj }) => {
  const { x, y } = obj.grid;
  const a = at(x + 0.12, y + 0.5);
  const b = at(x + 0.88, y + 0.5);
  return (
    <g>
      <Tile x={x} y={y} fill={P.sidewalk} stroke={P.sidewalkEdge} />
      {/* one faint paver joint — paving texture, not noise */}
      <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={P.sidewalkEdge} strokeWidth={0.8} opacity={0.7} />
    </g>
  );
};

const Bridge: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  const fp = obj.def.footprint;
  const deck = 6;
  const g = boxGeometry(x, y, fp, z, deck);
  const railH = 9;
  const posts = [0.08, 0.5, 0.92];
  return (
    <g>
      <IsoBox x={x} y={y} fp={fp} z={z} height={deck} colours={{ top: P.bridgeDeck, left: P.bridgeSide, right: P.bridgeSide }} />
      {[
        [lift(g.w, deck), lift(g.s, deck)],
        [lift(g.n, deck), lift(g.e, deck)],
      ].map(([a, b], side) => (
        <g key={side}>
          <line x1={a.sx} y1={a.sy - railH} x2={b.sx} y2={b.sy - railH} stroke={P.bridgeRail} strokeWidth={1.4} />
          {posts.map((u) => {
            const p = along(a, b, u);
            return <line key={u} x1={p.sx} y1={p.sy} x2={p.sx} y2={p.sy - railH} stroke={P.bridgeRail} strokeWidth={1.2} />;
          })}
        </g>
      ))}
    </g>
  );
};

// ------------------------------------------------------- street furniture

const BusStop: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  const roofH = 34;
  const posts = [at(x + 0.15, y + 0.5, z), at(x + 0.85, y + 0.5, z)];
  const glassA = at(x + 0.15, y + 0.28, z);
  const glassB = at(x + 0.85, y + 0.28, z);
  const roof = [at(x + 0.08, y + 0.22, z), at(x + 0.92, y + 0.22, z), at(x + 0.92, y + 0.82, z), at(x + 0.08, y + 0.82, z)].map((p) => lift(p, roofH + 2));
  const bench = boxGeometry(x + 0.18, y + 0.52, { w: 0.64, h: 0.16 }, z + 7, 2.5);
  const sign = at(x + 0.93, y + 0.9, z);
  return (
    <g>
      {/* back glass panel */}
      <polygon
        points={`${glassA.sx},${glassA.sy} ${glassB.sx},${glassB.sy} ${glassB.sx},${glassB.sy - roofH + 5} ${glassA.sx},${glassA.sy - roofH + 5}`}
        fill={P.glassDark}
        opacity={0.35}
        stroke={OUTLINE.colour}
        strokeWidth={0.5}
      />
      {posts.map((p, i) => (
        <line key={i} x1={p.sx} y1={p.sy} x2={p.sx} y2={p.sy - roofH} stroke={P.pole} strokeWidth={1.6} />
      ))}
      {/* bench */}
      {[0.12, 0.88].map((u) => {
        const p = along(bench.w, bench.s, u);
        return <line key={u} x1={p.sx} y1={p.sy + 7} x2={p.sx} y2={p.sy} stroke={P.metal} strokeWidth={1.3} />;
      })}
      <IsoBox x={x + 0.18} y={y + 0.52} fp={{ w: 0.64, h: 0.16 }} z={z + 7} height={2.5} colours={{ top: P.benchWood, left: P.benchWoodDark, right: P.benchWoodDark }} />
      {/* roof slab */}
      <polygon points={pointsAttr(roof)} fill={P.rooftop.top} stroke={OUTLINE.colour} strokeWidth={0.7} />
      {/* route sign on its own thin pole */}
      <line x1={sign.sx} y1={sign.sy} x2={sign.sx} y2={sign.sy - 24} stroke={P.pole} strokeWidth={1.2} />
      <rect x={sign.sx - 2.5} y={sign.sy - 31} width={5} height={7} fill={P.terracotta} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <circle cx={sign.sx} cy={sign.sy - 27.5} r={1.2} fill={P.awningCream} />
    </g>
  );
};

const Bench: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  const seatH = 6;
  const bx = x + 0.15;
  const by = y + 0.4;
  const bfp = { w: 0.7, h: 0.25 };
  const g = boxGeometry(bx, by, bfp, z, seatH);
  const legs = [along(g.w, g.s, 0.1), along(g.w, g.s, 0.9)];
  return (
    <g>
      {legs.map((p, i) => (
        <line key={i} x1={p.sx} y1={p.sy} x2={p.sx} y2={p.sy - seatH} stroke={P.metal} strokeWidth={1.4} />
      ))}
      {/* backrest on the far edge, rising behind the seat */}
      <IsoBox x={bx} y={by} fp={{ w: 0.7, h: 0.07 }} z={z + seatH + 2.5} height={5} colours={{ top: P.benchWood, left: P.benchWoodDark, right: P.benchWoodDark }} />
      <IsoBox x={bx} y={by} fp={bfp} z={z + seatH} height={2.5} colours={{ top: P.benchWood, left: P.benchWoodDark, right: P.benchWoodDark }} />
    </g>
  );
};

const VendingMachine: AssetComponent = ({ obj, tokens }) => {
  const { x, y, z } = obj.grid;
  const fp = { w: 0.32, h: 0.28 };
  const H = 26;
  const g = boxGeometry(x + 0.34, y + 0.36, fp, z, H);
  const lit = tokens.shopFront !== "quiet";
  const front = g.leftBase;
  return (
    <g>
      <ellipse cx={along(front[0], front[1], 0.5).sx + 2} cy={front[0].sy + 1} rx={9} ry={3} fill={P.groundShadow} />
      <IsoBox x={x + 0.34} y={y + 0.36} fp={fp} z={z} height={H} colours={P.vending} />
      {lit && <polygon points={faceRect(front[0], front[1], 0.05, 0.95, 3, H + 1)} fill="rgba(244,216,150,0.22)" />}
      {/* display window + drink rows */}
      <polygon points={faceRect(front[0], front[1], 0.15, 0.85, 12, 21)} fill={lit ? P.vendFront : P.frame} opacity={lit ? 0.95 : 0.85} />
      {[16, 18.5].map((h) =>
        [0.28, 0.5, 0.72].map((u) => {
          const p = along(front[0], front[1], u);
          return <circle key={`${h}-${u}`} cx={p.sx} cy={p.sy - h} r={0.8} fill={lit ? P.awningOrange : P.awningCream} opacity={0.9} />;
        }),
      )}
      <polygon points={faceRect(front[0], front[1], 0.2, 0.8, 4, 8)} fill={P.frame} opacity={0.6} />
    </g>
  );
};

const BicycleRack: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  return (
    <g>
      {[0.25, 0.5, 0.75].map((u) => {
        const p = at(x + u, y + 0.5, z);
        return <path key={u} d={`M ${p.sx - 4} ${p.sy} a 4 5 0 0 1 8 0`} stroke={P.metal} strokeWidth={1.4} fill="none" />;
      })}
    </g>
  );
};

// ----------------------------------------------------------------- nature

const Shrub: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  const b = at(x + 0.5, y + 0.5, z);
  return (
    <g>
      <ellipse cx={b.sx} cy={b.sy - 6} rx={12} ry={8} fill={P.shrub} stroke={OUTLINE.colour} strokeWidth={0.5} />
      <ellipse cx={b.sx - 3} cy={b.sy - 9} rx={7} ry={4.5} fill={P.shrubLight} />
    </g>
  );
};

const Planter: AssetComponent = ({ obj, tokens }) => {
  const { x, y, z } = obj.grid;
  const fp = { w: 0.5, h: 0.3 };
  return (
    <g>
      <IsoBox x={x + 0.25} y={y + 0.35} fp={fp} z={z} height={9} colours={P.planterBox} />
      <g transform={`translate(0, -9)`}>
        <Flowers x={x} y={y} count={Math.min(3, FLOWER_COUNT[tokens.greenery])} seed={obj.id} />
      </g>
    </g>
  );
};

// ----------------------------------------------------------------- living

const Pedestrian: AssetComponent = ({ obj, index = 0 }) => {
  const { x, y, z } = obj.grid;
  const b = at(x + 0.5, y + 0.5, z);
  const colour = P.people[index % P.people.length];
  return (
    <g>
      <ellipse cx={b.sx + 1.5} cy={b.sy} rx={4} ry={2} fill={P.groundShadow} />
      <rect x={b.sx - 3} y={b.sy - 13} width={6} height={11} rx={2.5} fill={colour} />
      <circle cx={b.sx} cy={b.sy - 16} r={3} fill={P.skin} />
    </g>
  );
};

const Bicycle: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  const b = at(x + 0.5, y + 0.55, z);
  return (
    <g>
      <ellipse cx={b.sx} cy={b.sy + 0.5} rx={8} ry={2.2} fill={P.groundShadow} />
      <circle cx={b.sx - 6} cy={b.sy - 4} r={4} stroke={P.metal} strokeWidth={1.2} fill="none" />
      <circle cx={b.sx + 6} cy={b.sy - 4} r={4} stroke={P.metal} strokeWidth={1.2} fill="none" />
      <path
        d={`M ${b.sx - 6} ${b.sy - 4} L ${b.sx - 1} ${b.sy - 9} L ${b.sx + 4} ${b.sy - 4} M ${b.sx - 1} ${b.sy - 9} L ${b.sx + 2} ${b.sy - 10}`}
        stroke={P.metal}
        strokeWidth={1.1}
        fill="none"
      />
    </g>
  );
};

const Car: AssetComponent = ({ obj }) => {
  const { x, y, z } = obj.grid;
  return <IsoBox x={x + 0.2} y={y + 0.3} fp={{ w: 0.6, h: 0.35 }} z={z} height={14} colours={P.carBody} />;
};

// ---------------------------------------------------------------- special

const FLOW_DOTS = { dormant: 0, trickle: 2, steady: 4, busy: 6 } as const;

const ExternalConnectionAnchor: AssetComponent = ({ obj, tokens }) => {
  const { x, y, z } = obj.grid;
  const fp = obj.def.footprint;
  const gateX = x + 0.45;
  const pylonN = at(gateX, y + 0.1, z);
  const pylonS = at(gateX, y + 0.9, z);
  const pylonH = 40;
  const dots = FLOW_DOTS[tokens.anchorFlow];
  const lineA = at(x + 0.05, y + 0.5, z);
  const lineB = at(x + fp.w, y + 0.5, z);
  const chevron = at(x + fp.w - 0.25, y + 0.5, z);
  return (
    <g className={tokens.anchorFlow === "busy" ? "anchor-flow-busy" : undefined}>
      {Array.from({ length: fp.w }, (_, i) => (
        <Tile key={i} x={x + i} y={y} fill={P.road} />
      ))}
      <line x1={lineA.sx} y1={lineA.sy} x2={lineB.sx} y2={lineB.sy} stroke={P.roadLine} strokeWidth={1} strokeDasharray="6 6" />
      <polyline
        points={pointsAttr([
          { sx: chevron.sx - 5, sy: chevron.sy - 5 },
          { sx: chevron.sx + 2, sy: chevron.sy },
          { sx: chevron.sx - 5, sy: chevron.sy + 5 },
        ])}
        fill="none"
        stroke={P.anchorChevron}
        strokeWidth={1.6}
      />
      {[pylonN, pylonS].map((p, i) => (
        <line key={i} x1={p.sx} y1={p.sy} x2={p.sx} y2={p.sy - pylonH} stroke={P.anchorPylon} strokeWidth={3} />
      ))}
      <line x1={pylonN.sx} y1={pylonN.sy - pylonH} x2={pylonS.sx} y2={pylonS.sy - pylonH} stroke={P.anchorPylon} strokeWidth={2.4} />
      <polygon points={`${pylonN.sx},${pylonN.sy - pylonH - 12} ${pylonN.sx + 9},${pylonN.sy - pylonH - 9} ${pylonN.sx},${pylonN.sy - pylonH - 6}`} fill={P.terracotta} />
      {Array.from({ length: dots }, (_, i) => {
        const p = along(lineA, lineB, 0.2 + (i * 0.7) / Math.max(1, dots - 1));
        return <circle key={i} className="anchor-flow-dot" cx={p.sx} cy={p.sy - 3} r={tokens.anchorFlow === "busy" ? 3 : 2.4} fill={P.anchorFlow} opacity={tokens.anchorFlow === "trickle" ? 0.6 : 0.95} />;
      })}
    </g>
  );
};

const VariableLot: AssetComponent = ({ obj, tokens }) => {
  const { x, y, z } = obj.grid;
  const fp = obj.def.footprint;
  const inset = 0.18;
  const stakes = [
    at(x + inset, y + inset, z),
    at(x + fp.w - inset, y + inset, z),
    at(x + fp.w - inset, y + fp.h - inset, z),
    at(x + inset, y + fp.h - inset, z),
  ];
  const stakeH = 9;
  const marker = at(x + fp.w * 0.5, y + fp.h * 0.5, z);
  const hazeColour = tokens.dataHaze === "review" ? P.hazeReview : P.hazeUncertain;
  return (
    <g>
      <Tile x={x} y={y} fp={fp} z={z} fill={P.lot} stroke="rgba(90,80,70,0.25)" />
      <polygon points={pointsAttr(stakes.map((s) => ({ sx: s.sx, sy: s.sy - stakeH })))} fill="none" stroke={P.lotStake} strokeWidth={0.9} strokeDasharray="3 3" />
      {stakes.map((s, i) => (
        <line key={i} x1={s.sx} y1={s.sy} x2={s.sx} y2={s.sy - stakeH} stroke={P.lotStake} strokeWidth={1.6} />
      ))}
      {tokens.dataHaze !== "none" && (
        <g>
          <line x1={marker.sx} y1={marker.sy} x2={marker.sx} y2={marker.sy - 22} stroke={P.lotStake} strokeWidth={1.4} />
          <polygon points={`${marker.sx},${marker.sy - 22} ${marker.sx + 8},${marker.sy - 19} ${marker.sx},${marker.sy - 16}`} fill={hazeColour} />
        </g>
      )}
    </g>
  );
};

export const ASSET_COMPONENTS: Record<AssetId, AssetComponent> = {
  residential_a: ResidentialA,
  residential_b: ResidentialB,
  convenience_store: ConvenienceStore,
  cafe: Cafe,
  road_straight: RoadStraight,
  road_corner: RoadCorner,
  sidewalk: Sidewalk,
  crosswalk: Crosswalk,
  bridge: Bridge,
  water: Water,
  green_patch: GreenPatch,
  street_light: StreetLight,
  bench: Bench,
  vending_machine: VendingMachine,
  bicycle_rack: BicycleRack,
  bus_stop: BusStop,
  tree: Tree,
  shrub: Shrub,
  planter: Planter,
  pedestrian: Pedestrian,
  bicycle: Bicycle,
  car: Car,
  external_connection_anchor: ExternalConnectionAnchor,
  variable_lot: VariableLot,
};
