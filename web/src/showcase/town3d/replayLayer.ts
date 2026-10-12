/**
 * Three.js replay layer: actors, building highlight rings, click proxies.
 *
 * 只消费 ReplaySnapshot（runtime state），不读账本、不读 TownEvent 文档。
 * 人物沿 townMap 路点图给出的折线行走；建筑反馈用独立的 ring + 光柱 +
 * 标签（buildTown 的材质按几何批量共享，不能逐楼改材质）。
 */

import * as THREE from "three";
import type { ReplaySnapshot, TownTarget } from "../../town/replay/replayEngine";
import { CLINIC, LEISURE_HALL, TARGET_PLACES, TRANSIT_HUB } from "./townMap";
import {
  ACTOR_VISUAL_SCALE,
  AMBIENT_PRESENCE,
  EVENT_PRESENCE,
  dwellSlot,
  dwellSway,
  groundHeightAt,
  laneShift,
  roleVisual,
  walkLaneOffset,
  walkSwing,
} from "./actorVisuals";

export interface ReplayLayer {
  update(snapshot: ReplaySnapshot | null, wallDt: number): void;
  dispose(): void;
}

const TARGETS: Exclude<TownTarget, "unknown">[] = [
  "home", "office", "restaurant", "cafe", "supermarket", "logistics",
  "transit", "clinic", "leisure",
];

/** 每个目标的展示锚点：主建筑的门前（与 townMap.DOORS[0] 一致）。 */
const RING_POINTS: Record<Exclude<TownTarget, "unknown">, { x: number; z: number; facesSouth: boolean }> = {
  home: { x: 0, z: -11.45, facesSouth: true },
  office: { x: 18, z: -10.6, facesSouth: true },
  restaurant: { x: 0.2, z: 2.0, facesSouth: true },
  cafe: { x: 25, z: -11.15, facesSouth: true },
  supermarket: { x: -24, z: -10.9, facesSouth: true },
  logistics: { x: TARGET_PLACES.logistics.footprints[0].x, z: TARGET_PLACES.logistics.footprints[0].z - 1.6, facesSouth: false },
  transit: { x: TRANSIT_HUB.x, z: TRANSIT_HUB.z - TRANSIT_HUB.d / 2 - 0.2, facesSouth: false },
  clinic: { x: CLINIC.x, z: CLINIC.z - CLINIC.d / 2 - 0.2, facesSouth: false },
  leisure: { x: LEISURE_HALL.x, z: LEISURE_HALL.z - LEISURE_HALL.d / 2 - 0.2, facesSouth: false },
};

const RING_COLOR = "#ffb95e";
const SELECT_COLOR = "#ffe9b0";
const INCOME_COLOR = "#ffd27a";
const DELIVERY_COLOR = "#6fd0c3";
const ACTOR_COLORS = ["#dfae6d", "#497e9c", "#e6dbcb", "#cc8c79", "#7c9583", "#b17f9c"];

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2c3e46";
  ctx.beginPath();
  ctx.roundRect(8, 16, 240, 64, 14);
  ctx.fill();
  ctx.strokeStyle = "#ffffff55";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#fff6e3";
  ctx.font = 'bold 40px "Microsoft YaHei", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50, 220);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createReplayLayer(params: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  dom: HTMLElement;
  onTargetClick: (target: TownTarget) => void;
  places?: typeof TARGET_PLACES;
  anchors?: typeof RING_POINTS;
  groundHeight?: (x: number, z: number) => number;
}): ReplayLayer {
  const { scene, camera, dom } = params;
  const places = params.places ?? TARGET_PLACES;
  const anchors = params.anchors ?? RING_POINTS;
  const groundHeight = params.groundHeight ?? groundHeightAt;
  const root = new THREE.Group();
  root.name = "replay-layer";
  scene.add(root);

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ------------------------------------------------------------- actors
  // Shared geometry/material pool：12+2 个人物复用同一套资源，
  // role 差异 = 道具可见性 + 色板选择，不是逐人建工厂。
  // 身体原点在脚底（local y=0），blob shadow 落在地面上、不随踏步浮动。
  const geoHead = track(new THREE.SphereGeometry(0.15, 10, 8));
  const geoTorso = track(new THREE.BoxGeometry(0.3, 0.55, 0.22));
  const geoLeg = track(new THREE.BoxGeometry(0.11, 0.72, 0.13).translate(0, -0.36, 0));
  const geoArm = track(new THREE.BoxGeometry(0.085, 0.48, 0.095).translate(0, -0.24, 0));
  const geoHat = track(new THREE.SphereGeometry(0.135, 10, 8));
  const geoBackpack = track(new THREE.BoxGeometry(0.34, 0.44, 0.22));
  const geoParcel = track(new THREE.BoxGeometry(0.3, 0.24, 0.22));
  const geoBag = track(new THREE.BoxGeometry(0.14, 0.26, 0.1));
  const geoShadow = track(new THREE.CircleGeometry(0.38, 18));
  const skin = track(new THREE.MeshStandardMaterial({ color: "#d6ac87", roughness: 0.8 }));
  const pants = track(new THREE.MeshStandardMaterial({ color: "#42525c", roughness: 0.85 }));
  const hair = track(new THREE.MeshStandardMaterial({ color: "#3d4039", roughness: 0.9 }));
  const parcelMat = track(new THREE.MeshStandardMaterial({ color: "#c9a36a", roughness: 0.9 }));
  const backpackMat = track(new THREE.MeshStandardMaterial({ color: "#33505c", roughness: 0.85 }));
  const bagMat = track(new THREE.MeshStandardMaterial({ color: "#5d6b92", roughness: 0.85 }));
  const eventCloth = ACTOR_COLORS.map((color) =>
    track(new THREE.MeshStandardMaterial({ color, roughness: 0.72 })),
  );
  // courier 制服色：高识别度，不与路人共享色板。
  const courierCloth = ["#e2953a", "#d97b3f"].map((color) =>
    track(new THREE.MeshStandardMaterial({ color, roughness: 0.72 })),
  );
  // ambient 更灰更哑：背景人口不得抢过 event actor。
  const ambientCloth = ["#93a0a6", "#9ba392", "#a2988a", "#8a949c", "#968d94"].map((color) =>
    track(new THREE.MeshStandardMaterial({ color, roughness: 0.88 })),
  );
  const shadowEvent = track(new THREE.MeshBasicMaterial({
    color: "#1e3038", transparent: true, opacity: 0.26, depthWrite: false,
  }));
  const shadowAmbient = track(new THREE.MeshBasicMaterial({
    color: "#1e3038", transparent: true, opacity: 0.15, depthWrite: false,
  }));

  function makeActor(): THREE.Group {
    const group = new THREE.Group();
    const shadow = new THREE.Mesh(geoShadow, shadowEvent);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    const body = new THREE.Group();
    const cloth = eventCloth[0];
    const head = new THREE.Mesh(geoHead, skin);
    head.position.y = 1.42;
    const torso = new THREE.Mesh(geoTorso, cloth);
    torso.position.y = 1.0;
    const legL = new THREE.Mesh(geoLeg, pants);
    legL.position.set(-0.085, 0.72, 0);
    const legR = new THREE.Mesh(geoLeg, pants);
    legR.position.set(0.085, 0.72, 0);
    const armL = new THREE.Mesh(geoArm, pants);
    armL.position.set(-0.2, 1.24, 0);
    const armR = new THREE.Mesh(geoArm, pants);
    armR.position.set(0.2, 1.24, 0);
    const hat = new THREE.Mesh(geoHat, hair);
    hat.position.set(0, 1.5, -0.02);
    const backpack = new THREE.Mesh(geoBackpack, backpackMat);
    backpack.position.set(0, 1.02, -0.26);
    const parcel = new THREE.Mesh(geoParcel, parcelMat);
    parcel.position.set(0.26, 0.88, 0.18);
    const bag = new THREE.Mesh(geoBag, bagMat);
    bag.position.set(0.23, 0.84, -0.02);
    body.add(head, torso, legL, legR, armL, armR, hat, backpack, parcel, bag);
    group.add(shadow, body);
    group.userData = {
      body, torso, legL, legR, armL, armR, backpack, parcel, bag, shadow,
      smoothedHeading: 0, initialised: false, currentActorKey: "",
    };
    group.visible = false;
    root.add(group);
    return group;
  }

  const actorPool: THREE.Group[] = [];
  const MAX_ACTOR_POOL = 16;

  // --------------------------------------------------- building feedback
  interface BuildingFx {
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
    label: THREE.Sprite;
    baseScale: number;
  }
  const fxByTarget = new Map<TownTarget, BuildingFx>();

  for (const target of TARGETS) {
    const anchor = anchors[target];
    const group = new THREE.Group();
    group.position.set(anchor.x, 0, anchor.z);
    const ringGeo = track(new THREE.RingGeometry(0.62, 0.86, 40));
    const ringMat = track(new THREE.MeshBasicMaterial({
      color: RING_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    // 车道 / 缘石面到 y≈0.28，环必须浮在路面之上。
    ring.position.y = 0.3;
    const beamGeo = track(new THREE.CylinderGeometry(0.14, 0.2, 3.4, 10, 1, true));
    const beamMat = track(new THREE.MeshBasicMaterial({
      color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 1.8;
    const labelMat = track(new THREE.SpriteMaterial({ map: track(makeLabelTexture(places[target].label)), transparent: true, opacity: 0, depthWrite: false }));
    const label = new THREE.Sprite(labelMat);
    label.position.y = 4.1;
    label.scale.set(2.6, 0.98, 1);
    group.add(ring, beam, label);
    root.add(group);
    fxByTarget.set(target, { ring, beam, label, baseScale: 1 });
  }

  // ------------------------------------------------------ pulse feedback
  // CREDIT（收入 pulse，办公楼金色扩散）与 DELIVERY（宅配送达住宅的
  // 青绿脉冲）都是表现隐喻：renderer 只按 snapshot 的 pulse 列表播放。
  interface PulseFx { ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; startedAt: number }
  const pulsePool: Record<"income" | "delivery", PulseFx[]> = { income: [], delivery: [] };
  const PULSE_DURATION = { income: 3.2, delivery: 2.6 } as const;
  const PULSE_ANCHOR = { income: anchors.office, delivery: anchors.home };
  const PULSE_COLOR = { income: INCOME_COLOR, delivery: DELIVERY_COLOR };

  function makePulse(kind: "income" | "delivery"): PulseFx {
    const ringGeo = track(new THREE.RingGeometry(0.5, 0.72, 40));
    const ringMat = track(new THREE.MeshBasicMaterial({
      color: PULSE_COLOR[kind], transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(PULSE_ANCHOR[kind].x, 0.32, PULSE_ANCHOR[kind].z);
    ring.visible = false;
    root.add(ring);
    return { ring, startedAt: 0 };
  }

  function animatePulses(snapshot: ReplaySnapshot | null) {
    for (const kind of ["income", "delivery"] as const) {
      const pulses = kind === "income" ? snapshot?.incomePulses ?? [] : snapshot?.deliveryPulses ?? [];
      const pool = pulsePool[kind];
      while (pool.length < pulses.length) pool.push(makePulse(kind));
      pool.forEach((fx, index) => {
        const pulse = pulses[index];
        if (!pulse) { fx.ring.visible = false; fx.ring.material.opacity = 0; return; }
        if (!fx.ring.visible) { fx.ring.visible = true; fx.startedAt = clock; }
        const progress = Math.min(1, (clock - fx.startedAt) / PULSE_DURATION[kind]);
        fx.ring.material.opacity = (1 - progress) * 0.75;
        fx.ring.scale.setScalar(0.6 + progress * 2.6);
      });
    }
  }
  // -------------------------------------------------------- click proxies
  const proxyMat = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  const proxyGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const proxies: THREE.Mesh[] = [];
  for (const target of TARGETS) {
    for (const box of places[target].footprints) {
      const proxy = new THREE.Mesh(proxyGeo, proxyMat);
      proxy.position.set(box.x, 3, box.z);
      proxy.scale.set(box.w, 6, box.d);
      proxy.userData.townTarget = target;
      root.add(proxy);
      proxies.push(proxy);
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerNdc: { x: number; y: number } | null = null;
  function onPointerDown(event: PointerEvent) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerNdc = { x: pointer.x, y: pointer.y };
  }
  dom.addEventListener("pointerdown", onPointerDown);

  // -------------------------------------------------------------- update
  let clock = 0;

  /** 朝目标 heading 转：短角插值，转角不再瞬间跳变（远景下的运动可读性）。 */
  function approachAngle(current: number, target: number, rate: number): number {
    let delta = (target - current) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * Math.min(1, rate);
  }

  function animateActors(snapshot: ReplaySnapshot | null, dt: number) {
    const eventActors = snapshot?.actors ?? [];
    const ambientActors = snapshot?.ambientActors ?? [];
    const drawn = [
      ...eventActors.map((actor) => ({ actor, ambient: false as const })),
      ...ambientActors.map((actor) => ({ actor, ambient: true as const })),
    ];
    while (actorPool.length < Math.min(drawn.length, MAX_ACTOR_POOL)) actorPool.push(makeActor());
    actorPool.forEach((actorGroup, index) => {
      const item = drawn[index];
      if (!item) {
        actorGroup.visible = false;
        return;
      }
      const { actor, ambient } = item;
      actorGroup.visible = true;
      const data = actorGroup.userData as {
        body: THREE.Group; torso: THREE.Mesh; legL: THREE.Mesh; legR: THREE.Mesh;
        armL: THREE.Mesh; armR: THREE.Mesh; backpack: THREE.Mesh; parcel: THREE.Mesh;
        bag: THREE.Mesh; shadow: THREE.Mesh; smoothedHeading: number; initialised: boolean;
        currentActorKey: string;
      };
      const desc = roleVisual(actor.role);
      data.backpack.visible = desc.backpack;
      data.parcel.visible = desc.parcel;
      data.bag.visible = desc.bag;
      const palette = desc.uniform ? courierCloth : ambient ? ambientCloth : eventCloth;
      data.torso.material = palette[actor.id % palette.length];
      data.shadow.material = ambient ? shadowAmbient : shadowEvent;

      const walking = actor.phase === "WALKING" || actor.phase === "LEAVING";
      const targetKey = "target" in actor ? actor.target : null;
      const busy = targetKey != null && snapshot?.buildings[targetKey]?.activityLevel === "BUSY";
      // 行走时走确定性车道，停留时散到门口槽位——2~3 人是一个小组，不是一个点。
      const placed = walking
        ? laneShift(actor.position, actor.heading, walkLaneOffset(actor.id))
        : (() => {
            const slot = dwellSlot(actor.id);
            return { x: actor.position.x + slot.dx, z: actor.position.z + slot.dz };
          })();
      actorGroup.position.set(placed.x, groundHeight(placed.x, placed.z), placed.z);
      const actorKey = `${ambient ? "a" : "e"}:${actor.id}`;
      const reused = data.currentActorKey !== actorKey;
      data.currentActorKey = actorKey;
      data.smoothedHeading = reused || !data.initialised ? actor.heading
        : approachAngle(data.smoothedHeading, actor.heading, dt * 10);
      data.initialised = true;
      actorGroup.rotation.y = data.smoothedHeading;
      const presence = ambient ? AMBIENT_PRESENCE : EVENT_PRESENCE;
      actorGroup.scale.setScalar(Math.max(0.001, actor.opacity * presence * ACTOR_VISUAL_SCALE));

      if (walking) {
        const swing = walkSwing(actor.id, clock, busy);
        data.body.position.y = swing.bob;
        data.body.rotation.z = 0;
        data.legL.rotation.x = swing.stride;
        data.legR.rotation.x = -swing.stride;
        data.armL.rotation.x = swing.armSwing;
        data.armR.rotation.x = -swing.armSwing;
        // 手提的包裹随步伐轻晃， courier 在远景中也能凭「晃动的方块」认出。
        data.parcel.position.set(0.26, 0.88 + Math.sin(clock * 6 + actor.id) * 0.02, 0.18);
      } else {
        data.body.position.y = 0;
        data.legL.rotation.x = 0;
        data.legR.rotation.x = 0;
        data.body.rotation.z = dwellSway(actor.id, clock);
        if (desc.uniform) {
          // 到家门口：托起包裹示意「正在配送」。
          data.armR.rotation.x = -1.15;
          data.parcel.position.set(0.24, 1.12, 0.34);
        } else {
          data.armL.rotation.x = 0;
          data.armR.rotation.x = 0;
        }
      }
    });
  }

  function animateBuildings(snapshot: ReplaySnapshot | null) {
    for (const target of TARGETS) {
      const fx = fxByTarget.get(target)!;
      const runtime = snapshot?.buildings[target];
      const selected = snapshot?.selectedTarget === target;
      const highlighted = snapshot?.highlightedEventId != null
        && runtime?.lastEvent?.id === snapshot.highlightedEventId;
      const active = runtime?.state === "active" || selected || highlighted;
      if (!active) {
        // activityLevel 的静态忙度：BUSY 淡淡呼吸，NORMAL 极淡底光，
        // 不与事件高亮争抢注意力，也不做高频闪烁。
        if (runtime?.activityLevel === "BUSY") {
          fx.ring.material.color.set(RING_COLOR);
          fx.ring.material.opacity = 0.11 + 0.05 * Math.sin(clock * 1.6);
          fx.ring.scale.setScalar(1.06);
          fx.beam.material.opacity = 0.05 + 0.02 * Math.sin(clock * 1.2);
        } else if (runtime?.activityLevel === "NORMAL") {
          fx.ring.material.color.set(RING_COLOR);
          fx.ring.material.opacity = 0.035;
          fx.ring.scale.setScalar(1);
          fx.beam.material.opacity = 0;
        } else {
          fx.ring.material.opacity = 0;
          fx.beam.material.opacity = 0;
        }
        fx.label.material.opacity = 0;
        continue;
      }
      const intensity = selected || highlighted ? 1 : runtime?.intensity ?? 0.4;
      const pulse = 1 + Math.sin(clock * 3.4) * 0.07;
      const color = selected || highlighted ? SELECT_COLOR : RING_COLOR;
      fx.ring.material.color.set(color);
      fx.beam.material.color.set(color);
      fx.ring.material.opacity = selected || highlighted ? 0.85 : 0.35 + intensity * 0.3;
      fx.ring.scale.setScalar((0.85 + intensity * 0.55) * pulse);
      fx.beam.material.opacity = (selected || highlighted ? 0.34 : 0.1 + intensity * 0.16) * (0.9 + 0.1 * Math.sin(clock * 2.2));
      fx.label.material.opacity = 0.92;
    }
  }

  return {
    update(snapshot, wallDt) {
      clock += wallDt;
      animateActors(snapshot, wallDt);
      animateBuildings(snapshot);
      animatePulses(snapshot);
      if (pointerNdc) {
        const point = pointerNdc;
        pointerNdc = null;
        raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), camera);
        const hits = raycaster.intersectObjects(proxies, false);
        if (hits.length > 0) {
          const target = hits[0].object.userData.townTarget as TownTarget;
          params.onTargetClick(target);
        }
      }
    },
    dispose() {
      dom.removeEventListener("pointerdown", onPointerDown);
      scene.remove(root);
      for (const item of disposables) item.dispose();
    },
  };
}
