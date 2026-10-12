import { useEffect, useMemo, useReducer, useState } from "react";
import { DEMOS } from "./demos/demos";
import { parseTownStateText, TownStateContractError, type TownState } from "./town/adapter/townState";
import { ASSET_REGISTRY } from "./town/scene/assets";
import { LIVING_TOWN_BASE_SCENE } from "./town/scene/livingTownScene";
import { buildSceneModel } from "./town/scene/sceneModel";
import { composeSceneConfig } from "./town/world/compose";
import { SEED_WORLD } from "./town/world/seedWorld";
import { fetchWorld, WorldUnavailableError } from "./town/world/client";
import { sendCommand, WorldCommandRejectedError, type CommandType } from "./town/world/commands";
import { isLocalPlacementValid } from "./town/world/ghost";
import type { TownWorldState } from "./town/world/types";
import { initialTownUIState, townUIReducer } from "./town/ui/townUIState";
import type { InteractionProps } from "./town/render/interaction";
import { TownRenderer } from "./town/render/TownRenderer";
import { projectTownVisualState } from "./town/visual/townVisualProjector";
import "./app.css";

type Source = { kind: "demo"; key: "A" | "B" | "C" } | { kind: "file"; name: string; townState: TownState };

/**
 * World line status. Fail-closed: when the local service is unreachable the
 * app shows SERVICE UNAVAILABLE, never a fake persistent town. The seed view
 * is reachable only through the explicit, clearly-labelled, read-only DEMO
 * MODE the user has to opt into.
 */
type WorldStatus =
  | { kind: "loading" }
  | { kind: "ready"; world: TownWorldState }
  | { kind: "unavailable"; reason: string }
  | { kind: "demo" };

const LEVEL_LABELS: Record<string, string> = {
  ambient_activity: "活动",
  residential_stability: "住宅稳定",
  consumption_tension: "消费张力",
  reserve_state: "储备",
  external_flow_activity: "对外流动",
  data_certainty: "数据可信",
};

const PLACEABLE_ASSETS = Object.values(ASSET_REGISTRY)
  .filter((def) => def.category === "building")
  .map((def) => def.id);

export default function App() {
  const [source, setSource] = useState<Source>({ kind: "demo", key: "A" });
  const [error, setError] = useState<string | null>(null);
  const [worldStatus, setWorldStatus] = useState<WorldStatus>({ kind: "loading" });
  const [ui, dispatchUI] = useReducer(townUIReducer, initialTownUIState);
  const [busy, setBusy] = useState(false);
  const [changeAssetChoice, setChangeAssetChoice] = useState<string>(PLACEABLE_ASSETS[0]);

  useEffect(() => {
    let cancelled = false;
    fetchWorld()
      .then((world) => {
        if (!cancelled) setWorldStatus({ kind: "ready", world });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setWorldStatus({
            kind: "unavailable",
            reason: e instanceof WorldUnavailableError ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const world = worldStatus.kind === "ready" ? worldStatus.world : worldStatus.kind === "demo" ? SEED_WORLD : null;
  const interactive = worldStatus.kind === "ready";
  const model = useMemo(
    () => (world ? buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, world)) : null),
    [world],
  );

  const townState = source.kind === "demo" ? DEMOS.find((d) => d.key === source.key)!.townState : source.townState;
  const visual = useMemo(() => projectTownVisualState(townState), [townState]);
  const levels = [
    ["ambient_activity", visual.ambient_activity],
    ["residential_stability", visual.residential_stability],
    ["consumption_tension", visual.consumption_tension],
    ["reserve_state", visual.reserve_state],
    ["external_flow_activity", visual.external_flow_activity],
    ["data_certainty", visual.data_certainty],
  ] as const;

  async function reloadWorld(): Promise<boolean> {
    try {
      const fresh = await fetchWorld();
      setWorldStatus({ kind: "ready", world: fresh });
      dispatchUI({ type: "WORLD_RELOADED", buildingIds: fresh.buildings.map((b) => b.building_id) });
      return true;
    } catch (e: unknown) {
      setWorldStatus({
        kind: "unavailable",
        reason: e instanceof WorldUnavailableError ? e.message : String(e),
      });
      return false;
    }
  }

  /** The only write path from the UI: one command envelope, revision-checked.
   * On VERSION_CONFLICT the world is re-fetched — never blind-overwritten. */
  async function applyCommand(command: { type: CommandType; [field: string]: unknown }) {
    if (!interactive || busy) return;
    setBusy(true);
    try {
      const fresh = await sendCommand({ ...command, expected_revision: worldStatus.world.revision });
      setWorldStatus({ kind: "ready", world: fresh });
      dispatchUI({ type: "WORLD_RELOADED", buildingIds: fresh.buildings.map((b) => b.building_id) });
      dispatchUI({ type: "COMMAND_SUCCEEDED" });
      if (command.type === "DemolishBuilding") {
        dispatchUI({ type: "DESELECT" }); // demolished: inspector closes (§15)
      }
    } catch (e: unknown) {
      if (e instanceof WorldCommandRejectedError) {
        dispatchUI({ type: "COMMAND_FAILED", code: e.code, message: e.message });
        if (e.code === "VERSION_CONFLICT") await reloadWorld(); // fresh world, human decides again
      } else {
        setWorldStatus({ kind: "unavailable", reason: String(e) });
      }
    } finally {
      setBusy(false);
    }
  }

  // Escape cancels placement first, then deselects (§15).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      dispatchUI({ type: "CANCEL_PLACEMENT" });
      dispatchUI({ type: "DESELECT" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseTownStateText(await file.text());
      setSource({ kind: "file", name: file.name, townState: parsed });
      setError(null);
    } catch (e) {
      setError(e instanceof TownStateContractError ? e.message : `无法读取：${String(e)}`);
    }
  }

  const mode = ui.placementMode;

  const interaction: InteractionProps | null =
    model && world
      ? {
          model,
          hoveredBuildingId: ui.hoveredBuildingId,
          selectedBuildingId: ui.selectedBuildingId,
          ghost: ui.ghost,
          ghostAssetId:
            mode?.kind === "create"
              ? mode.assetId
              : mode?.kind === "move"
                ? (world.buildings.find((b) => b.building_id === mode.buildingId)?.asset_id ?? null)
                : null,
          placementActive: mode !== null,
          onHoverBuilding: (buildingId) => dispatchUI({ type: "HOVER_BUILDING", buildingId }),
          onLeaveBuilding: () => dispatchUI({ type: "CLEAR_HOVER" }),
          onSelectBuilding: (buildingId) => dispatchUI({ type: "SELECT_BUILDING", buildingId }),
          onBackgroundClick: () => dispatchUI({ type: "DESELECT" }),
          onCellClick: (cell) => {
            if (mode?.kind === "create") {
              applyCommand({ type: "CreateBuilding", asset_id: mode.assetId, grid_x: cell.x, grid_y: cell.y });
            } else if (mode?.kind === "move") {
              applyCommand({
                type: "MoveBuilding",
                building_id: mode.buildingId,
                grid_x: cell.x,
                grid_y: cell.y,
              });
            }
          },
          onGhostMove: (cell) => {
            const assetId =
              mode?.kind === "create"
                ? mode.assetId
                : mode?.kind === "move"
                  ? world.buildings.find((b) => b.building_id === mode.buildingId)?.asset_id
                  : undefined;
            if (!assetId) return;
            const valid = isLocalPlacementValid(
              world,
              assetId,
              cell.x,
              cell.y,
              mode?.kind === "move" ? mode.buildingId : undefined,
            );
            dispatchUI({ type: "GHOST_MOVE", cell, valid });
          },
        }
      : null;

  return (
    <main className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>生活小镇</h1>
          <span className="app-period">{visual.period_month}</span>
          <span className="app-version">
            {visual.source_projection_version} → {visual.visual_projection_version}
          </span>
        </div>
        <nav className="demo-switch" aria-label="demo states">
          {DEMOS.map((demo) => (
            <button
              key={demo.key}
              type="button"
              className={source.kind === "demo" && source.key === demo.key ? "active" : undefined}
              onClick={() => {
                setSource({ kind: "demo", key: demo.key });
                setError(null);
              }}
              title={demo.subtitle}
            >
              {demo.key} · {demo.title}
            </button>
          ))}
          <label className="file-load">
            载入 Town State JSON
            <input type="file" accept=".json,.txt" onChange={onFile} />
          </label>
        </nav>
      </header>

      {source.kind === "file" && <p className="app-note">已载入 {source.name}（经 adapter 校验，未做任何财务计算）</p>}
      {error && <p className="app-error">{error}</p>}
      {worldStatus.kind === "demo" && (
        <p className="app-demo-banner" role="status">
          演示模式 — 只读的内置种子小镇，不是你的持久世界，无法保存任何改动
        </p>
      )}

      <section className="town-stage">
        {model ? (
          <TownRenderer model={model} visual={visual} interaction={interactive ? interaction : null} />
        ) : worldStatus.kind === "unavailable" ? (
          <div className="app-unavailable" role="alert">
            <h2>世界服务不可用（SERVICE UNAVAILABLE）</h2>
            <p>无法连接本地世界服务，因此不能显示你的真实小镇。</p>
            <p className="app-unavailable-reason">原因：{worldStatus.reason}</p>
            <p>请启动服务后刷新页面：</p>
            <pre>life-energy town world serve</pre>
            <button type="button" onClick={() => setWorldStatus({ kind: "demo" })}>
              以只读演示模式查看内置种子小镇
            </button>
          </div>
        ) : (
          <p className="app-note">正在连接本地世界服务…</p>
        )}
      </section>

      {world && interactive && (
        <BuildingInspector
          world={world}
          ui={ui}
          busy={busy}
          onChangeAssetChoice={setChangeAssetChoice}
          changeAssetChoice={changeAssetChoice}
          dispatchUI={dispatchUI}
          onCommand={applyCommand}
        />
      )}

      <footer className="app-footer">
        <ul className="level-strip" aria-label="visual levels">
          {levels.map(([field, value]) => (
            <li key={field}>
              <span className="level-name">{LEVEL_LABELS[field]}</span>
              <span className="level-value">{value}</span>
            </li>
          ))}
        </ul>
        <details className="explanations">
          <summary>为什么是这样？</summary>
          <ul>
            {visual.explanations
              .filter((e) => !e.field.startsWith("scene_activity.") || e.value !== "IDLE")
              .map((e) => (
                <li key={e.field}>
                  <code>
                    {e.field} = {e.value}
                  </code>
                  <span className="rule">{e.rule}</span>
                  <ul>
                    {e.because.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </details>
      </footer>
    </main>
  );
}

/** Inspector (App layer, outside the renderer): world facts of the selected
 * building + the four baseline actions. Closed when nothing is selected. */
function BuildingInspector(props: {
  world: TownWorldState;
  ui: ReturnType<typeof townUIReducer>;
  busy: boolean;
  changeAssetChoice: string;
  onChangeAssetChoice: (assetId: string) => void;
  dispatchUI: React.Dispatch<Parameters<typeof townUIReducer>[1]>;
  onCommand: (command: { type: CommandType; [field: string]: unknown }) => void;
}) {
  const { world, ui, busy, changeAssetChoice, onChangeAssetChoice, dispatchUI, onCommand } = props;
  if (!ui.selectedBuildingId) {
    return (
      <section className="inspector inspector-empty" aria-label="building inspector">
        <p>
          {ui.placementMode?.kind === "create" ? (
            <>放置模式：{ui.placementMode.assetId} — 点击格子建造，Esc 取消</>
          ) : ui.placementMode?.kind === "move" ? (
            <>移动模式 — 点击目标格子，Esc 取消</>
          ) : (
            <>点击建筑查看详情并操作（创建请先选择下方建筑类型）</>
          )}
        </p>
        <div className="inspector-create">
          <select
            value={ui.placementMode?.kind === "create" ? ui.placementMode.assetId : PLACEABLE_ASSETS[0]}
            onChange={(e) => dispatchUI({ type: "START_CREATE", assetId: e.target.value })}
          >
            {PLACEABLE_ASSETS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || ui.placementMode?.kind === "create"}
            onClick={() => dispatchUI({ type: "START_CREATE", assetId: PLACEABLE_ASSETS[0] })}
          >
            放置模式
          </button>
          {ui.lastCommandError && (
            <button type="button" className="inspector-error" onClick={() => dispatchUI({ type: "CLEAR_COMMAND_ERROR" })} title="点击清除">
              {ui.lastCommandError.code}: {ui.lastCommandError.message} ✕
            </button>
          )}
        </div>
      </section>
    );
  }

  const building = world.buildings.find((b) => b.building_id === ui.selectedBuildingId);
  if (!building) return null;

  return (
    <section className="inspector" aria-label="building inspector">
      <dl className="inspector-fields">
        <dt>building_id</dt>
        <dd>
          <code>{building.building_id}</code>
        </dd>
        <dt>asset_id</dt>
        <dd>{building.asset_id}</dd>
        <dt>grid</dt>
        <dd>
          ({building.grid_x}, {building.grid_y})
        </dd>
        <dt>orientation</dt>
        <dd>{building.orientation}</dd>
        <dt>lifecycle</dt>
        <dd>{building.lifecycle}</dd>
      </dl>
      <div className="inspector-actions">
        <button
          type="button"
          disabled={busy || ui.placementMode?.kind === "move"}
          onClick={() => dispatchUI({ type: "START_MOVE" })}
        >
          移动（点击目标格子）
        </button>
        <select value={changeAssetChoice} onChange={(e) => onChangeAssetChoice(e.target.value)}>
          {PLACEABLE_ASSETS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCommand({ type: "ChangeBuildingAsset", building_id: building.building_id, asset_id: changeAssetChoice })
          }
        >
          改建
        </button>
        <button
          type="button"
          className="inspector-demolish"
          disabled={busy}
          onClick={() => onCommand({ type: "DemolishBuilding", building_id: building.building_id })}
        >
          拆除
        </button>
        <button type="button" onClick={() => dispatchUI({ type: "DESELECT" })}>
          关闭
        </button>
      </div>
      {ui.lastCommandError && (
        <button type="button" className="inspector-error" onClick={() => dispatchUI({ type: "CLEAR_COMMAND_ERROR" })} title="点击清除">
          {ui.lastCommandError.code}: {ui.lastCommandError.message} ✕
        </button>
      )}
    </section>
  );
}
