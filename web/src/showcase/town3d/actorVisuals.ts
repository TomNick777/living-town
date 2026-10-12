/**
 * Pedestrian readability descriptors — pure functions, no THREE.
 *
 * renderer（replayLayer）用这里的结果决定人物多大、拿什么、站在哪条
 * 车道、停在哪一格、脚踩在多高的地面上。全部由 role / id 确定性派生：
 * 同一 replay 序列永远得到同一画面，不引入随机数或物理。
 *
 * 视觉层级约定：
 * - 可读性优先于真实比例：人物整体放大 ~26%，但仍远小于 5-11m 的建筑，
 *   建筑是主体、人是生活细节；
 * - event actor 比 ambient actor 略大、更饱和 —— 用户不需要知道字段名，
 *   直觉上会觉得「事件的人更重要」；
 * - courier / transit-passenger 靠道具轮廓区分，不靠颜色。
 */

import type { ActorRole } from "../../town/replay/replayEngine";

/** 人物基础身高（米，含帽）：放大后 ≈2.0m，建筑仍 ≥5.6m。 */
export const ACTOR_BASE_HEIGHT = 1.6;
export const ACTOR_VISUAL_SCALE = 1.26;
export const EVENT_PRESENCE = 1;
export const AMBIENT_PRESENCE = 0.88;

export interface RoleVisual {
  /** 背包：courier 的轮廓锚点，默认相机距离下仍可见。 */
  backpack: boolean;
  /** 手提包裹：配送员到家时最显眼。 */
  parcel: boolean;
  /** 单肩挎包：transit-passenger 的克制差异。 */
  bag: boolean;
  /** true = 用专属制服色板（courier），不走通用 cloth 色板。 */
  uniform: boolean;
}

export function roleVisual(role: ActorRole): RoleVisual {
  switch (role) {
    case "courier":
      return { backpack: true, parcel: true, bag: false, uniform: true };
    case "transit-passenger":
      return { backpack: false, parcel: false, bag: true, uniform: false };
    default:
      return { backpack: false, parcel: false, bag: false, uniform: false };
  }
}

/**
 * 行走时的纵向车道偏移（米，垂直于前进方向）。
 * 同一事件错队出发的同伴因此不会前后叠成一条线；正负交错避免
 * 所有人都挤进路中心。
 */
const LANE_OFFSETS = [-0.38, 0.34, -0.05, 0.62, -0.66];

export function walkLaneOffset(id: number): number {
  return LANE_OFFSETS[id % LANE_OFFSETS.length];
}

/**
 * 停留时围绕锚点的槽位（deterministic local slot）。
 * 半径 0.42-0.62m、8 个方位：同一门口的 2-3 人看起来是一小群人，
 * 而不是重叠的一个点；也不会排成机械直线。
 */
export function dwellSlot(id: number): { dx: number; dz: number } {
  const angle = ((id * 2654435761) >>> 0) % 8; // 黄金比例散列 -> 8 方位
  const radius = 0.42 + ((id >>> 2) % 3) * 0.1;
  const theta = (angle / 8) * Math.PI * 2 + 0.4; // 0.4 rad 起步，避开正北对齐
  return {
    dx: Math.cos(theta) * radius,
    dz: Math.sin(theta) * radius,
  };
}

/** 把车道偏移应用到沿 heading 的位置上（垂直方向）。 */
export function laneShift(
  position: { x: number; z: number },
  heading: number,
  offset: number,
): { x: number; z: number } {
  // heading = atan2(dx, dz)：前进方向 (sin h, cos h)，垂直方向 (cos h, -sin h)。
  return {
    x: position.x + Math.cos(heading) * offset,
    z: position.z - Math.sin(heading) * offset,
  };
}

/**
 * 地面高度查询：人物脚底和 blob shadow 必须踩在所在路面上，
 * 否则就是漂浮图标。数值对齐 buildTown.ts 的实体表面顶面。
 */
export function groundHeightAt(x: number, z: number): number {
  const onBridge = (Math.abs(x + 12) < 1.9 || Math.abs(x - 19) < 1.9) && z > 10.2 && z < 18.9;
  if (onBridge) return 0.62; // 桥面顶（含铺装线）
  const onEastWestRoad = Math.abs(z + 8.5) < 2.4 || Math.abs(z - 4.5) < 2.4;
  const onNorthSouthRoad = (Math.abs(x + 12) < 2.4 || Math.abs(x - 12) < 2.4) && z < 9.2;
  if (onEastWestRoad || onNorthSouthRoad) return 0.18; // 车道顶面
  if (z >= 9.2 && z <= 10.2) return 0.3; // 滨河步道北护沿
  if (z >= 18.6 && z <= 20.2) return 0.3; // 南岸护沿/步道接驳
  return 0.1; // 街区铺装 / 南岸地面
}

/** 静止与行走的可感知差异：摆幅（弧度）与踏步（米）。 */
export function walkSwing(id: number, clock: number, busy: boolean): {
  stride: number;
  bob: number;
  armSwing: number;
} {
  const speed = busy ? 10.5 : 8.5;
  const phase = clock * speed + id * 1.7;
  const swing = Math.sin(phase);
  return {
    stride: swing * 0.62,
    bob: Math.abs(Math.cos(phase)) * 0.07,
    armSwing: -swing * 0.5,
  };
}

/** 停留时的微动：轻微重心摆动，与走路明显不同、又不像突然卡死。 */
export function dwellSway(id: number, clock: number): number {
  return Math.sin(clock * 1.15 + id * 2.1) * 0.035;
}
