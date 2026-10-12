/**
 * Camera framing authority tests — locks the readability acceptance math.
 *
 * 这两条约束来自 Pedestrian Readability 验收：
 *  1. 基准 desktop viewport 下人物屏幕高度达到可辨认阈值；
 *  2. 城市边界（含高架与接触网）仍完整投影在视锥内——
 *     不许为了人物把城市裁掉一半。
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ACTOR_BASE_HEIGHT,
  ACTOR_VISUAL_SCALE,
} from "../src/showcase/town3d/actorVisuals";
import {
  CAMERA_CANDIDATES,
  DEFAULT_FRAMING,
  NARROW_ZOOM,
  framingForSearch,
  frustumExtent,
  projectedWorldHeightPx,
  zoomForWidth,
} from "../src/showcase/town3d/camera";

// 基准验收视口：1512×850 desktop；画布 = calc(100svh - 230px)，宽约减去页边距。
const CANVAS = { width: 1436, height: 620 };
const ASPECT = CANVAS.width / CANVAS.height;

function framingActorPx(framing: (typeof CAMERA_CANDIDATES)["A"]): number {
  return projectedWorldHeightPx(
    framing,
    ACTOR_BASE_HEIGHT * ACTOR_VISUAL_SCALE,
    CANVAS.height,
    ASPECT,
    framing.zoom,
  );
}

/** 复刻 Town3D 的 camera 构造 + reset + resize，再投影城市包围盒。 */
function cityFitsInFraming(framing: (typeof CAMERA_CANDIDATES)["A"]): boolean {
  const camera = new THREE.OrthographicCamera(-40, 40, 25, -25, 0.1, 200);
  camera.position.set(...framing.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(...framing.target);
  camera.zoom = framing.zoom;
  const extent = frustumExtent(ASPECT);
  camera.left = (-extent * ASPECT) / 2;
  camera.right = (extent * ASPECT) / 2;
  camera.top = extent / 2;
  camera.bottom = -extent / 2;
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  // 生活区硬约束：街道、两岸与建筑体量（x ±29，z -22.5..21.5，y 0..6.6）
  // 必须完整入画——不许为了人物把城市裁掉一角。
  const hard: [number, number, number][] = [];
  for (const x of [-29, 29]) for (const z of [-22.5, 21.5]) for (const y of [0, 6.6]) {
    hard.push([x, y, z]);
  }
  // 装饰性高架接触网柱尖（y 8.5）允许 ≤5% 溢出：旧 framing 下它已在边缘。
  const soft: [number, number, number][] = [];
  for (const x of [-29, 29]) for (const z of [-22.5, 21.5]) soft.push([x, 8.5, z]);
  const v = new THREE.Vector3();
  const fits = (points: [number, number, number][], limit: number) =>
    points.every(([x, y, z]) => {
      v.set(x, y, z).project(camera);
      return Math.abs(v.x) <= limit && Math.abs(v.y) <= limit && v.z <= 1;
    });
  return fits(hard, 1) && fits(soft, 1.05);
}

describe("default camera framing", () => {
  it("makes actors readable at the reference desktop viewport", () => {
    expect(framingActorPx(DEFAULT_FRAMING)).toBeGreaterThanOrEqual(32);
  });

  it("keeps the whole town (both banks + viaduct) inside the frustum", () => {
    expect(cityFitsInFraming(DEFAULT_FRAMING)).toBe(true);
  });

  it("pins the chosen candidate so accidental framing drift fails CI", () => {
    expect(DEFAULT_FRAMING.position).toEqual([36, 26, 45]);
    expect(DEFAULT_FRAMING.target).toEqual([0, 4.2, 0.4]);
    expect(DEFAULT_FRAMING.zoom).toBeCloseTo(1.3, 5);
  });

  it("prefers the closest readable framing that still fits the city", () => {
    for (const framing of Object.values(CAMERA_CANDIDATES)) {
      if (cityFitsInFraming(framing)) {
        expect(framingActorPx(framing)).toBeLessThanOrEqual(framingActorPx(DEFAULT_FRAMING) + 0.001);
      }
    }
  });
});

describe("framing selection is QA-only", () => {
  it("ignores qaCam outside visualQa mode", () => {
    expect(framingForSearch("?demo&qaCam=A", false)).toBe(DEFAULT_FRAMING);
    expect(framingForSearch("?demo&visualQa=1&qaCam=A", true)).toBe(CAMERA_CANDIDATES.A);
    expect(framingForSearch("?demo&visualQa=1&qaCam=nope", true)).toBe(DEFAULT_FRAMING);
  });

  it("keeps the narrow-screen zoom rule", () => {
    expect(zoomForWidth(DEFAULT_FRAMING, 1436)).toBe(DEFAULT_FRAMING.zoom);
    expect(zoomForWidth(DEFAULT_FRAMING, 640)).toBe(NARROW_ZOOM);
  });
});
