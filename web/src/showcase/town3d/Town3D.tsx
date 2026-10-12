import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ReplayEngine } from "../../town/replay/replayEngine";
import { isVisualQaMode, shouldRenderTownFrame } from "../../town/replay/visualQa";
import type { TownVisualState } from "../../town/visual/visualState";
import { buildShowcaseTown } from "./buildShowcaseTown";
import { SHOWCASE_ANCHORS, SHOWCASE_PLACES } from "./showcaseTownMap";
import type { TownWorld } from "./worldTypes";
import {
  POLAR_LIMITS,
  ZOOM_LIMITS,
  framingForSearch,
  frustumExtent,
  zoomForWidth,
} from "./camera";
import { createReplayLayer } from "./replayLayer";
import "./visualQa.css";

interface ViewController { reset: () => void; zoom: (factor: number) => void; rotate: () => void }

export default function Town3D({
  visual,
  replayEngine,
}: {
  visual: TownVisualState;
  replayEngine?: ReplayEngine | null;
}) {
  const interactive = true;
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<ViewController | null>(null);
  const state = useRef({ visual, dusk: false, playing: true });
  const [dusk, setDusk] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const visualQa = isVisualQaMode();
  const [crowdLine, setCrowdLine] = useState<string | null>(null);
  state.current = { visual, dusk, playing };

  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); }
    catch { setError("当前浏览器无法启动 3D 画面，请启用硬件加速后刷新。"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = interactive ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.setAttribute("aria-label", "生活小镇三维街区");
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#dce9e8");
    const camera = new THREE.OrthographicCamera(-40,40,25,-25,0.1,200);
    // 默认取景由 camera.ts 权威管理；qaCam 只在 visualQa 模式下切换候选。
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    [controls.minPolarAngle, controls.maxPolarAngle] = POLAR_LIMITS;
    [controls.minZoom, controls.maxZoom] = ZOOM_LIMITS;
    controls.screenSpacePanning=true;
    controls.enableRotate = interactive;
    controls.enableZoom = interactive;
    controls.enablePan = interactive;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    const reset = () => {
      const framing = framingForSearch(window.location.search, visualQa);
      camera.position.set(...framing.position);
      controls.target.set(...framing.target);
      if (interactive) { controls.target.set(0, 4.2, -8); camera.position.set(42, 35, 44); }
      camera.zoom = zoomForWidth(framing, element.clientWidth);
      camera.updateProjectionMatrix(); controls.update();
    };
    reset();
    const sky = new THREE.HemisphereLight("#eaf8ff", "#8a9a78", 1.8); scene.add(sky);
    const sun = new THREE.DirectionalLight("#fff4db",2.7); sun.position.set(-20,38,22); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-43; sun.shadow.camera.right=43; sun.shadow.camera.top=40; sun.shadow.camera.bottom=-40;
    sun.shadow.camera.near=1; sun.shadow.camera.far=100; sun.shadow.normalBias=0.045; sun.shadow.bias=-0.00015; scene.add(sun);
    const groundGeometry=new THREE.PlaneGeometry(1000,1000);
    const groundMaterial=new THREE.MeshStandardMaterial({color:"#dce9e8",roughness:1});
    const ground=new THREE.Mesh(groundGeometry,groundMaterial); ground.rotation.x=-Math.PI/2; ground.position.y=-1.22; ground.receiveShadow=true; scene.add(ground);
    let world: TownWorld;
    try { world=buildShowcaseTown(scene); }
    catch (cause) { renderer.dispose(); renderer.domElement.remove(); controls.dispose(); setError(`小镇加载失败：${String(cause)}`); return; }
    // Data-driven replay 层：人物 / 建筑反馈 / 点选，全部只消费 engine snapshot。
    let replay: ReturnType<typeof createReplayLayer> | null = null;
    if (replayEngine) {
      replay = createReplayLayer({
        scene, camera, dom: renderer.domElement,
        ...(interactive ? { places: SHOWCASE_PLACES, anchors: SHOWCASE_ANCHORS, groundHeight: () => .28 } : {}),
        onTargetClick: (target) => {
          const selected = replayEngine.getSnapshot().selectedTarget;
          replayEngine.selectTarget(selected === target ? null : target);
        },
      });
    }
    const resize = () => {
      const width=element.clientWidth; const height=element.clientHeight;
      if(!width||!height) return;
      renderer.setSize(width,height);
      const aspect=width/height; const extent=interactive ? Math.max(frustumExtent(aspect), 102 * camera.zoom / aspect, 57 * camera.zoom) : frustumExtent(aspect);
      camera.left=-extent*aspect/2; camera.right=extent*aspect/2; camera.top=extent/2; camera.bottom=-extent/2; camera.updateProjectionMatrix();
    };
    const observer=new ResizeObserver(resize); observer.observe(element); resize();
    api.current = {
      reset,
      zoom(factor) { camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,0.7,3.5); camera.updateProjectionMatrix(); },
      rotate() { const offset=camera.position.clone().sub(controls.target); offset.applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4); camera.position.copy(controls.target).add(offset); controls.update(); },
    };
    const reduce=window.matchMedia("(prefers-reduced-motion: reduce)");
    let previousVisual: TownVisualState | null=null; let previousDusk: boolean | null=null;
    let elapsed=0; let last=performance.now(); let frame=0; let beats=0;
    const loop=(now: number) => {
      const delta=Math.min((now-last)/1000,0.05); last=now;
      if (shouldRenderTownFrame(document.hidden, visualQa)) {
        const current=state.current;
        if(current.playing && (!interactive || replayEngine?.getSnapshot().status === "playing") && !reduce.matches) elapsed+=delta;
        if(previousVisual!==current.visual||previousDusk!==current.dusk) {
          world.update(current.visual,current.dusk);
          sun.color.set(current.dusk?"#ffcb8f":"#fff4db"); sun.intensity=current.dusk?1.65:2.7;
          sky.intensity=current.dusk?1.2:interactive?1.35:1.8;
          sky.color.set(current.visual.consumption_tension==="SEVERE"?"#d9e9ff":"#eaf8ff");
          const background=current.dusk?"#b0bcc9":"#dce9e8";
          (scene.background as THREE.Color).set(background); groundMaterial.color.set(background);
          previousVisual=current.visual; previousDusk=current.dusk;
        }
        world.tick(elapsed,true);
        if (replayEngine && replay) {
          replayEngine.tick(delta);
          const snapshot = replayEngine.getSnapshot();
          replay.update(snapshot, delta);
          if (visualQa) {
            beats += 1;
            const movers = [
              ...snapshot.actors.map((actor) => ({
                kind: "event" as const,
                id: actor.id,
                role: actor.role,
                x: actor.position.x,
                z: actor.position.z,
                phase: actor.phase,
              })),
              ...snapshot.ambientActors.map((actor) => ({
                kind: "ambient" as const,
                id: actor.id,
                role: actor.role,
                x: actor.position.x,
                z: actor.position.z,
                phase: actor.phase,
              })),
            ];
            (window as Window & { __townVisualQa?: unknown }).__townVisualQa = {
              crowd: snapshot.crowd,
              movers,
              documentHidden: document.hidden,
            };
            if (beats % 15 === 0) {
              const crowd = snapshot.crowd;
              setCrowdLine(`${crowd.timeOfDayPhase} · event ${crowd.eventActors} · ambient ${crowd.ambientActors} · total ${crowd.totalActors} · BUSY ${crowd.busyBuildings} · skip ${crowd.skippedEventActors}/${crowd.skippedAmbientActors}`);
            }
          }
        }
        controls.update(); renderer.render(scene,camera);
      }
      frame=requestAnimationFrame(loop);
    };
    frame=requestAnimationFrame(loop);
    const contextLost=(event: Event)=>{event.preventDefault();setError("3D 画面已暂停，刷新页面可重新加载。");};
    renderer.domElement.addEventListener("webglcontextlost",contextLost);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); world.dispose();
      replay?.dispose();
      groundGeometry.dispose(); groundMaterial.dispose(); sun.shadow.dispose();
      renderer.domElement.removeEventListener("webglcontextlost",contextLost); renderer.dispose(); renderer.domElement.remove(); api.current=null;
    };
  }, []);

  return <div className="town-3d-shell">
    <div ref={host} className="town-webgl"/>
    {error && <div className="webgl-error" role="alert">{error}</div>}
    <div className="world-light"><button aria-pressed={!dusk} onClick={()=>setDusk(false)}>☀ 日光</button><button aria-pressed={dusk} onClick={()=>setDusk(true)}>◔ 傍晚</button></div>
    <div className="world-location"><span className="location-line"/><p>青川町<small>AOIKAWA · RIVERSIDE NEIGHBOURHOOD</small></p></div>
    {visualQa && (
      <div className="visual-qa-hud" role="status">
        <strong>Visual QA</strong>
        <span>document.hidden 生产暂停仍是默认；本模式允许后台连续运动。</span>
        <span>{crowdLine ?? "waiting for replay…"}</span>
      </div>
    )}
    {interactive && <div className="world-controls"><button type="button" aria-label="恢复初始视角" onClick={() => api.current?.reset()}>◎</button></div>}
    {!interactive && <div className="world-controls"><button aria-label={playing?"暂停街区动态":"播放街区动态"} onClick={()=>setPlaying(!playing)}>{playing?"Ⅱ":"▷"}</button></div>}
  </div>;
}
