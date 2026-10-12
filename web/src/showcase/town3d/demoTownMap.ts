import { TOWN_STYLE as S } from "./demoTownStyle";
import type { TownTarget, TownEvent } from "../../town/adapter/townEvents";
import type { ActorRoute, ReplayRoutes, RoutePoint, AmbientStreetKind } from "../../town/replay/replayEngine";
import type { PlaceInfo } from "./townMap";

// Permanent residential fabric. Period changes never add, remove or resize buildings.
export const RESIDENTIAL_BLOCKS = [
  { x: -27, z: -29, w: 7, d: 7, floors: 3, color: S.wallSand, shop: "日々 BAKERY" },
  { x: -18.5, z: -28, w: 8, d: 7, floors: 4, color: S.wallSage, shop: "青川文具" },
  { x: -8, z: -29.5, w: 6, d: 7, floors: 3, color: S.wall, shop: "暮らし商店" },
  { x: 1, z: -28, w: 7, d: 7, floors: 4, color: S.wallStone, shop: "" },
  { x: 12, z: -29, w: 7, d: 7, floors: 3, color: S.wallSand, shop: "花と日常" },
  { x: 22, z: -28.5, w: 7, d: 7, floors: 4, color: S.wallSage, shop: "" },
  { x: -15.2, z: -15, w: 4, d: 6, floors: 3, color: S.wall, shop: "" },
  { x: .7, z: -15, w: 4, d: 6, floors: 4, color: S.wallStone, shop: "" },
  { x: 17, z: -15, w: 3.8, d: 6, floors: 3, color: S.wallSand, shop: "" },
] as const;
export const RAILWAY = { z: -38, deckY: 3.6, west: -34, east: 34 } as const;

// Demo scene authority: buildings, doors, click proxies and routes share this layout.
export const DEMO_PLACES: Record<TownTarget, PlaceInfo> = {
  home: { target: "home", label: "青川里 · 住宅", footprints: [{ x: -23, z: -15, w: 10, d: 8 }, ...RESIDENTIAL_BLOCKS.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }))] },
  office: { target: "office", label: "青叶办公", footprints: [{ x: -7, z: -15, w: 9, d: 8 }] },
  clinic: { target: "clinic", label: "河岸诊所", footprints: [{ x: 9, z: -15, w: 10, d: 8 }] },
  logistics: { target: "logistics", label: "青川收发站", footprints: [{ x: 24, z: -15, w: 9, d: 8 }] },
  supermarket: { target: "supermarket", label: "青叶市集", footprints: [{ x: -25, z: -1, w: 10, d: 7 }] },
  restaurant: { target: "restaurant", label: "小镇食堂", footprints: [{ x: -13, z: -1, w: 9, d: 7 }] },
  leisure: { target: "leisure", label: "河岸影剧院", footprints: [{ x: 0, z: -3, w: 10, d: 9 }] },
  cafe: { target: "cafe", label: "河边咖啡", footprints: [{ x: 17, z: -1.5, w: 8, d: 7 }] },
  transit: { target: "transit", label: "青川站", footprints: [{ x: 27, z: 1, w: 7, d: 5 }] },
  unknown: { target: "unknown", label: "未映射", footprints: [] },
};
export const DEMO_ANCHORS = Object.fromEntries(Object.entries(DEMO_PLACES).filter(([key]) => key !== "unknown").map(([key, place]) => {
  const b = place.footprints[0];
  return [key, { x: b.x, z: b.z + b.d / 2 + .8, facesSouth: true }];
})) as Record<Exclude<TownTarget, "unknown">, RoutePoint & { facesSouth: boolean }>;

export class DemoWalkways implements ReplayRoutes {
  routeFor(target: TownTarget, seed: number): ActorRoute | null {
    if (target === "unknown") return null;
    const end = DEMO_ANCHORS[target];
    const lane = end.z < 0 ? -8 : 6;
    const spawn = { x: seed % 2 ? -32 : 32, z: lane };
    return { spawn, path: [{ x: end.x, z: lane }, { ...end }], role: "visitor" };
  }
  routeForEvent(event: TownEvent, index: number): ActorRoute | null {
    if (event.behavior !== "DELIVERY") {
      const route = this.routeFor(event.target, event.transaction_id + index);
      if (route && event.behavior === "TRANSIT") { route.role = "transit-passenger"; route.mode = "through"; }
      return route;
    }
    const from = DEMO_ANCHORS.logistics; const to = DEMO_ANCHORS.home;
    return { spawn: { ...from }, path: [{ x: from.x, z: -8 }, { x: to.x, z: -8 }, { ...to }], role: "courier" };
  }
  ambientPlaceRoute(target: TownTarget, seed: number): ActorRoute | null {
    if (target !== "home") return this.routeFor(target, seed);
    const b = RESIDENTIAL_BLOCKS[seed % RESIDENTIAL_BLOCKS.length];
    const lane = b.z < -20 ? -22 : -8;
    return { spawn: { x: seed % 2 ? -32 : 32, z: lane }, path: [{ x: b.x, z: lane }, { x: b.x, z: b.z + b.d / 2 + .8 }], role: "resident" };
  }
  ambientStreetRoute(kind: AmbientStreetKind, seed: number): ActorRoute {
    const z = kind === "north-street" ? -22 : kind === "promenade" ? 9 : 23;
    const direction = seed % 2 ? 1 : -1;
    return { spawn: { x: -31 * direction, z }, path: [{ x: 31 * direction, z }], mode: "through", role: "resident" };
  }
}
