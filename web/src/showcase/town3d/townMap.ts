/**
 * Town map for the data-driven replay: prototype building places and the
 * walkway graph of the 3D neighbourhood (buildTown.ts geometry).
 *
 * 这是「人物必须受道路约束」的数据来源：所有移动路径都来自这张手工
 * 维护的小型路点图（沿车道 / 人行道 / 步道 / 桥），不做穿墙直线。
 * 坐标是 buildTown.ts 的世界米； Prototype 阶段用约定 + 浏览器 smoke
 * 对齐，未来可由 SceneModel 自动生成。
 */

import type { ActorRoute, AmbientStreetKind, ReplayRoutes, RoutePoint } from "../../town/replay/replayEngine";
import type { TownEvent, TownTarget } from "../../town/adapter/townEvents";

export interface BuildingFootprint {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface PlaceInfo {
  target: TownTarget;
  label: string;
  footprints: BuildingFootprint[];
}

// ------------------------------------------------------- prototype places
// 坐标与 buildTown.ts 的建筑一一对应；logistics 是上轮新增的收发站，
// transit / clinic / leisure 是 V2 河南岸生活带的三个最小资产。
// 注意：target 是语义目标类型；同一 target 未来可对应多栋场景建筑。

export const DEPOT: BuildingFootprint & { label: string } = {
  x: 15.8, z: 21.3, w: 3.2, d: 2.2, label: "青川宅配",
};

export const TRANSIT_HUB: BuildingFootprint & { label: string } = {
  x: -18.8, z: 21.8, w: 4.6, d: 2.4, label: "青川巴士站",
};

export const LEISURE_HALL: BuildingFootprint & { label: string } = {
  x: 21.3, z: 21.9, w: 4.6, d: 2.4, label: "青川文娱馆",
};

export const CLINIC: BuildingFootprint & { label: string } = {
  x: 26, z: 21.7, w: 3, d: 2.2, label: "青川诊所",
};

export const TARGET_PLACES: Record<TownTarget, PlaceInfo> = {
  home: {
    target: "home",
    label: "青川荘",
    footprints: [
      { x: 0, z: -14.7, w: 5.4, d: 5.5 },   // 青川荘（主）
      { x: 25, z: -1.5, w: 4.6, d: 5.3 },   // 别馆
    ],
  },
  office: {
    target: "office",
    label: "青叶办公",
    footprints: [{ x: 18, z: -14, w: 5.9, d: 5.8 }],
  },
  restaurant: {
    target: "restaurant",
    label: "小镇食堂",
    footprints: [
      { x: 0.2, z: -1.4, w: 5.1, d: 5.7 },  // 小镇食堂（主）
      { x: 7, z: 8.15, w: 2.9, d: 1.9 },    // おにぎり
    ],
  },
  cafe: {
    target: "cafe",
    label: "珈琲と日常",
    footprints: [
      { x: 25, z: -14.5, w: 4.5, d: 5.7 },  // 珈琲と日常（主）
      { x: -24, z: -1.8, w: 5.5, d: 6.2 },  // RIVER COFFEE
      { x: 18, z: -1.5, w: 5.7, d: 5.8 },   // 日和 COFFEE
      { x: -24, z: 8.15, w: 2.9, d: 1.9 },  // 川辺の茶屋
    ],
  },
  supermarket: {
    target: "supermarket",
    label: "青葉 MARKET",
    footprints: [
      { x: -24, z: -14.3, w: 5.3, d: 5.8 }, // 青葉 MARKET（主）
      { x: -6.5, z: -1.2, w: 5.2, d: 5.3 }, // 暮らし MART
      { x: 6.8, z: -14, w: 4.8, d: 5.3 },   // 生活商店
      { x: 25, z: 8.15, w: 2.4, d: 1.9 },   // 日和 雑貨
    ],
  },
  logistics: {
    target: "logistics",
    label: DEPOT.label,
    footprints: [{ x: DEPOT.x, z: DEPOT.z, w: DEPOT.w, d: DEPOT.d }],
  },
  transit: {
    target: "transit",
    label: TRANSIT_HUB.label,
    footprints: [{ x: TRANSIT_HUB.x, z: TRANSIT_HUB.z, w: TRANSIT_HUB.w, d: TRANSIT_HUB.d }],
  },
  clinic: {
    target: "clinic",
    label: CLINIC.label,
    footprints: [{ x: CLINIC.x, z: CLINIC.z, w: CLINIC.w, d: CLINIC.d }],
  },
  leisure: {
    target: "leisure",
    label: LEISURE_HALL.label,
    footprints: [{ x: LEISURE_HALL.x, z: LEISURE_HALL.z, w: LEISURE_HALL.w, d: LEISURE_HALL.d }],
  },
  unknown: { target: "unknown", label: "未知去处", footprints: [] },
};

/** 每个目标的门口（人物停靠点）+ 所接步道节点。 */
interface Door {
  point: RoutePoint;
  nodeId: string;
}

const DOORS: Record<Exclude<TownTarget, "unknown">, Door[]> = {
  home: [
    { point: { x: 0, z: -11.45 }, nodeId: "A:0" },
    { point: { x: 25, z: 1.7 }, nodeId: "C:25" },
  ],
  office: [{ point: { x: 18, z: -10.6 }, nodeId: "A:18" }],
  restaurant: [
    { point: { x: 0.2, z: 2.0 }, nodeId: "C:0.2" },
    { point: { x: 7, z: 9.2 }, nodeId: "P:7" },
  ],
  cafe: [
    { point: { x: 25, z: -11.15 }, nodeId: "A:25" },
    { point: { x: -24, z: 1.9 }, nodeId: "C:-24" },
    { point: { x: 18, z: 1.9 }, nodeId: "C:18" },
    { point: { x: -24, z: 9.2 }, nodeId: "P:-24" },
  ],
  supermarket: [
    { point: { x: -24, z: -10.9 }, nodeId: "A:-24" },
    { point: { x: -6.5, z: 2.0 }, nodeId: "C:-6.5" },
    { point: { x: 6.8, z: -10.85 }, nodeId: "A:6.8" },
    { point: { x: 25, z: 9.2 }, nodeId: "P:25" },
  ],
  logistics: [{ point: { x: DEPOT.x, z: DEPOT.z - DEPOT.d / 2 - 0.5 }, nodeId: "S:15.8" }],
  transit: [{ point: { x: TRANSIT_HUB.x, z: TRANSIT_HUB.z - TRANSIT_HUB.d / 2 - 0.2 }, nodeId: "S:-18.8" }],
  clinic: [{ point: { x: CLINIC.x, z: CLINIC.z - CLINIC.d / 2 - 0.2 }, nodeId: "S:26" }],
  leisure: [{ point: { x: LEISURE_HALL.x, z: LEISURE_HALL.z - LEISURE_HALL.d / 2 - 0.2 }, nodeId: "S:21.3" }],
};

// ----------------------------------------------------------- walkway graph
// 线状人行道（z 为横线，x 为竖线连接器），全部落在车道边缘 / 步道上。

interface Node {
  id: string;
  x: number;
  z: number;
}

function line(prefix: string, z: number, xs: number[]): Node[] {
  return xs.map((x) => ({ id: `${prefix}:${x}`, x, z }));
}

const NODES: Node[] = [
  ...line("A", -10.85, [-27.5, -24, -17, -12, 0, 6.8, 12, 18, 25, 27.5]),
  ...line("B", -6.15, [-12, 12]),
  ...line("C", 2.15, [-27.5, -24, -17, -12, -6.5, 0.2, 12, 18, 25, 27.5]),
  ...line("D", 6.85, [-27.5, -17, -12, 0.2, 12, 27.5]),
  ...line("P", 9.6, [-27.5, -24, -17, -12, 0.2, 7, 12, 19, 25, 27.5]),
  // 两座桥（x=-12 主桥 / x=19 宅配桥）与南岸步道。
  // S 线上的 -18.8 / 21.3 / 26 是 V2 三栋新建筑的门接点（共线加点
  // 不改变既有最短路径的长度与选择）。
  { id: "BR1:10.4", x: -12, z: 10.4 }, { id: "BR1:14.5", x: -12, z: 14.5 }, { id: "BR1:18.8", x: -12, z: 18.8 },
  { id: "BR2:10.4", x: 19, z: 10.4 }, { id: "BR2:14.5", x: 19, z: 14.5 }, { id: "BR2:18.8", x: 19, z: 18.8 },
  ...line("S", 19.6, [-27.5, -18.8, -12, 0, 12, 15.8, 19, 21.3, 26, 27.5]),
];

const NODE_BY_ID = new Map(NODES.map((node) => [node.id, node]));

function chain(nodes: Node[]): [string, string][] {
  const edges: [string, string][] = [];
  for (let i = 0; i + 1 < nodes.length; i += 1) edges.push([nodes[i].id, nodes[i + 1].id]);
  return edges;
}

const byLine = (prefix: string) => NODES.filter((node) => node.id.startsWith(`${prefix}:`));

const EDGES: [string, string][] = [
  ...chain(byLine("A")),
  ...chain(byLine("B")),
  ...chain(byLine("C")),
  ...chain(byLine("D")),
  ...chain(byLine("P")),
  ...chain(byLine("S")),
  // 东西向道路两端的环通（街尾过街）
  ["A:-27.5", "C:-27.5"], ["A:27.5", "C:27.5"],
  // 南北向道路 x=-12 / x=12：跨过 z=-8.5 道路（B）与 z=4.5 道路
  ["A:-12", "B:-12"], ["B:-12", "C:-12"], ["C:-12", "D:-12"], ["D:-12", "P:-12"],
  ["A:12", "B:12"], ["B:12", "C:12"], ["C:12", "D:12"], ["D:12", "P:12"],
  // 街尾连接 D 线
  ["C:-27.5", "D:-27.5"], ["C:27.5", "D:27.5"],
  // D -> 滨河步道（避开四栋低层商铺的缺口）
  ["D:-27.5", "P:-27.5"], ["D:-17", "P:-17"], ["D:-12", "P:-12"], ["D:0.2", "P:0.2"], ["D:12", "P:12"], ["D:27.5", "P:27.5"],
  // 两座桥
  ["P:-12", "BR1:10.4"], ["BR1:10.4", "BR1:14.5"], ["BR1:14.5", "BR1:18.8"], ["BR1:18.8", "S:-12"],
  ["P:19", "BR2:10.4"], ["BR2:10.4", "BR2:14.5"], ["BR2:14.5", "BR2:18.8"], ["BR2:18.8", "S:19"],
];

const ADJACENCY = new Map<string, { id: string; dist: number }[]>();
for (const [a, b] of EDGES) {
  const na = NODE_BY_ID.get(a);
  const nb = NODE_BY_ID.get(b);
  if (!na || !nb) throw new Error(`walkway edge references unknown node: ${a} <-> ${b}`);
  const dist = Math.hypot(nb.x - na.x, nb.z - na.z);
  if (!ADJACENCY.has(a)) ADJACENCY.set(a, []);
  if (!ADJACENCY.has(b)) ADJACENCY.set(b, []);
  ADJACENCY.get(a)!.push({ id: b, dist });
  ADJACENCY.get(b)!.push({ id: a, dist });
}

/** Dijkstra（图很小，O(n²) 足够）；返回节点 id 序列（含端点）。 */
export function walkwayPath(startId: string, goalId: string): string[] {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(startId, 0);
  while (true) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        current = id;
        currentDist = d;
      }
    }
    if (current === null) break;
    if (current === goalId) break;
    visited.add(current);
    for (const edge of ADJACENCY.get(current) ?? []) {
      const candidate = currentDist + edge.dist;
      if (candidate < (dist.get(edge.id) ?? Infinity)) {
        dist.set(edge.id, candidate);
        prev.set(edge.id, current);
      }
    }
  }
  if (!dist.has(goalId)) return [];
  const path = [goalId];
  while (path[0] !== startId) {
    const from = prev.get(path[0]);
    if (!from) return [];
    path.unshift(from);
  }
  return path;
}

// ------------------------------------------------------------ spawn points

const SPAWNS: { point: RoutePoint; nodeId: string }[] = [
  { point: { x: 0, z: -11.45 }, nodeId: "A:0" },        // 青川荘门口 -> resident
  { point: { x: -27.5, z: -10.85 }, nodeId: "A:-27.5" }, // 街西口 -> visitor
  { point: { x: 27.5, z: -10.85 }, nodeId: "A:27.5" },   // 街东口 -> visitor
];

// TRANSIT 的 presentation route 两端：街道入口（南岸步道两端）与
// 最近的桥端出口。只表达「乘客从街口来、在站停靠、往出口散去」，
// 不是真实 GPS 行程。
const TRANSIT_ENTRIES: { point: RoutePoint; nodeId: string; exitNodeId: string }[] = [
  { point: { x: -27.5, z: 19.6 }, nodeId: "S:-27.5", exitNodeId: "S:-12" },
  { point: { x: 27.5, z: 19.6 }, nodeId: "S:27.5", exitNodeId: "S:19" },
];

function nodePoints(startId: string, goalId: string): RoutePoint[] {
  return walkwayPath(startId, goalId).map((id) => {
    const node = NODE_BY_ID.get(id)!;
    return { x: node.x, z: node.z };
  });
}

/** 确定性：同一条流水永远得到同一条路线。 */
export class TownWalkways implements ReplayRoutes {
  routeFor(target: TownTarget, seed: number): ActorRoute | null {
    const doors = DOORS[target as Exclude<TownTarget, "unknown">];
    if (!doors || doors.length === 0) return null;
    const door = doors[seed % doors.length];
    const spawnIndex = Math.floor(seed / 7) % SPAWNS.length;
    const spawn = SPAWNS[spawnIndex];
    const nodePath = walkwayPath(spawn.nodeId, door.nodeId);
    if (nodePath.length === 0) return null;
    const points = nodePath
      .map((id) => NODE_BY_ID.get(id)!)
      .map((node) => ({ x: node.x, z: node.z }));
    return {
      spawn: { ...spawn.point },
      path: [...points, { ...door.point }],
      // 从家门出发的是 resident，从街口来的是 visitor——只是表达角色，
      // 不是 NPC 身份系统。
      role: spawnIndex === 0 ? "resident" : "visitor",
    };
  }

  /** V2：按事件行为给路线。TRANSIT 进站停靠后从桥端散去（through），
   * DELIVERY 是配送员从宅配站到主宅的往返，VISIT 走普通到访路线。 */
  routeForEvent(event: TownEvent, index: number): ActorRoute | null {
    if (event.behavior === "TRANSIT") {
      const entry = TRANSIT_ENTRIES[event.transaction_id % TRANSIT_ENTRIES.length];
      const hub = DOORS.transit[0];
      const toHub = nodePoints(entry.nodeId, hub.nodeId);
      const toExit = nodePoints(hub.nodeId, entry.exitNodeId);
      if (toHub.length === 0 || toExit.length === 0) return null;
      return {
        spawn: { ...entry.point },
        path: [...toHub, { ...hub.point }, ...toExit],
        mode: "through",
        role: "transit-passenger",
      };
    }
    if (event.behavior === "DELIVERY") {
      const depot = DOORS.logistics[0];
      const homeDoor = DOORS.home[0];
      const toHome = nodePoints(depot.nodeId, homeDoor.nodeId);
      if (toHome.length === 0) return null;
      return {
        spawn: { ...depot.point },
        path: [...toHome, { ...homeDoor.point }],
        role: "courier",
      };
    }
    return this.routeFor(event.target, event.transaction_id + index);
  }

  ambientPlaceRoute(target: TownTarget, seed: number): ActorRoute | null {
    const doors = DOORS[target as Exclude<TownTarget, "unknown">];
    if (!doors || doors.length === 0) return null;
    const door = doors[seed % doors.length];
    const linger = lingerPoint(door, seed);
    if (target === "home") {
      const street = SPAWNS[1 + (seed % 2)]; // 街口，不是门口挤人
      const path = nodePoints(door.nodeId, street.nodeId);
      if (path.length === 0) return null;
      return {
        spawn: { ...door.point },
        path: [...path, { ...street.point }],
        role: "resident",
        mode: "visit",
      };
    }
    if (target === "logistics") {
      const along = seed % 2 === 0 ? "S:12" : "S:19";
      const path = nodePoints(door.nodeId, along);
      if (path.length === 0) return null;
      return {
        spawn: { ...door.point },
        path: [...path],
        role: "courier",
        mode: "visit",
      };
    }
    if (target === "transit") {
      const entry = TRANSIT_ENTRIES[seed % TRANSIT_ENTRIES.length];
      const toHub = nodePoints(entry.nodeId, door.nodeId);
      if (toHub.length === 0) return null;
      return {
        spawn: { ...entry.point },
        path: [...toHub, linger],
        role: "transit-passenger",
        mode: "visit",
      };
    }
    const spawn = SPAWNS[Math.floor(seed / 5) % SPAWNS.length];
    const toDoor = nodePoints(spawn.nodeId, door.nodeId);
    if (toDoor.length === 0) return null;
    return {
      spawn: { ...spawn.point },
      path: [...toDoor, linger],
      role: spawn === SPAWNS[0] ? "resident" : "visitor",
      mode: "visit",
    };
  }

  ambientStreetRoute(kind: AmbientStreetKind, seed: number): ActorRoute | null {
    const spec = STREET_ROUTES[kind];
    const reverse = seed % 2 === 1;
    const startId = reverse ? spec.goal : spec.start;
    const goalId = reverse ? spec.start : spec.goal;
    const path = nodePoints(startId, goalId);
    if (path.length === 0) return null;
    const start = NODE_BY_ID.get(startId)!;
    return {
      spawn: { x: start.x, z: start.z },
      path,
      role: "visitor",
      mode: "through",
    };
  }
}

function lingerPoint(door: Door, seed: number): RoutePoint {
  const node = NODE_BY_ID.get(door.nodeId);
  if (!node) return { ...door.point };
  const t = 0.35 + (seed % 5) * 0.07;
  return {
    x: door.point.x + (node.x - door.point.x) * t,
    z: door.point.z + (node.z - door.point.z) * t,
  };
}

const STREET_ROUTES: Record<AmbientStreetKind, { start: string; goal: string }> = {
  "north-street": { start: "A:-27.5", goal: "A:27.5" },
  promenade: { start: "P:-27.5", goal: "P:27.5" },
  "bridge-a-south": { start: "P:-12", goal: "S:-27.5" },
  "bridge-b-north": { start: "S:19", goal: "A:18" },
};
