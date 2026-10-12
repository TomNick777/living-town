/**
 * Default camera framing authority for the Living Town 3D view.
 *
 * 相机参数集中在这里，Town3D 只消费——防止散落的魔法数字在下次
 * 调整视觉时被无意回退。`?visualQa=1&qaCam=A|B|C` 仅在 QA 模式下
 * 覆盖候选 framing，用于截图对比；生产页面永远使用 DEFAULT_FRAMING。
 *
 * 验收锚（cameraFraming.test.ts 锁死）：
 * - 基准 viewport 1512×850（画布高约 620px）下人物屏幕高度 ≥ 34px；
 * - 全部城镇（x ±29、z -22.5..22.5、含高架/train）投影在视锥内 ——
 *   不许为了看清人把城市裁掉一半。
 */

export type FramingKey = "A" | "B" | "C";

export interface CameraFraming {
  position: [number, number, number];
  target: [number, number, number];
  /** 默认（宽屏）正交 zoom；窄屏另有 NARROW_ZOOM。 */
  zoom: number;
  label: string;
}

/** 视锥尺寸规则：保持既有 43/73 常数，缩放交给 zoom。 */
export const FRUSTUM_MIN_EXTENT = 43;
export const FRUSTUM_TALL_EXTENT = 73;
export const NARROW_WIDTH_PX = 700;
export const NARROW_ZOOM = 1.62;
export const ZOOM_LIMITS: readonly [number, number] = [0.7, 3.5];
export const POLAR_LIMITS: readonly [number, number] = [Math.PI / 7, Math.PI / 2.55];

export const CAMERA_CANDIDATES: Record<FramingKey, CameraFraming> = {
  // A：现有 framing，只轻微拉近。
  A: {
    position: [37, 34, 43],
    target: [0, 2.5, 0],
    zoom: 1.18,
    label: "A · 现状轻微拉近",
  },
  // B：更近一档，target 略向南移，让北岸建筑与南岸生活带都完整入画。
  B: {
    position: [35, 33, 42],
    target: [0, 2.2, 1.6],
    zoom: 1.34,
    label: "B · 近一档双岸保全",
  },
  // C：压低俯视角（elevation ≈21°），人物的纵向轮廓不再被俯拍压扁；
  //   低角度让街面在屏幕纵向上占更少，等价 zoom 下城市反而保全得更完整。
  C: {
    position: [36, 26, 45],
    target: [0, 4.2, 0.4],
    zoom: 1.3,
    label: "C · 低俯角轮廓优先",
  },
};

/** 选定结果：候选 C（camera polish 实测对比后锁定，见 cameraFraming.test）。 */
export const DEFAULT_FRAMING: CameraFraming = CAMERA_CANDIDATES.C;

export function framingForSearch(
  search: string,
  visualQa: boolean,
): CameraFraming {
  if (visualQa) {
    const key = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("qaCam");
    if (key === "A" || key === "B" || key === "C") return CAMERA_CANDIDATES[key];
  }
  return DEFAULT_FRAMING;
}

export function zoomForWidth(framing: CameraFraming, widthPx: number): number {
  return widthPx < NARROW_WIDTH_PX ? NARROW_ZOOM : framing.zoom;
}

export function frustumExtent(aspect: number): number {
  return Math.max(FRUSTUM_MIN_EXTENT, FRUSTUM_TALL_EXTENT / aspect);
}

/**
 * 世界垂直物体在屏幕上的像素高度估算：正交相机下
 * screenPx = worldHeight · cos(elevation) / (extent / zoom) · canvasHeightPx。
 * 人物可读性的验收公式。
 */
export function projectedWorldHeightPx(
  framing: CameraFraming,
  worldHeight: number,
  canvasHeightPx: number,
  aspect: number,
  zoom: number,
): number {
  const [px, py, pz] = framing.position;
  const [tx, ty, tz] = framing.target;
  const horizontal = Math.hypot(px - tx, pz - tz);
  const elevation = Math.atan2(py - ty, horizontal);
  const visibleHeight = frustumExtent(aspect) / zoom;
  return (worldHeight * Math.cos(elevation) / visibleHeight) * canvasHeightPx;
}
