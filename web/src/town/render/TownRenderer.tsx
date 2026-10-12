/**
 * TownRenderer — paints SceneModel + TownVisualState as one SVG.
 *
 * Knows nothing about income, spending or investment. It receives a fixed
 * scene and a set of named visual levels, turns the levels into render
 * tokens (tokens.ts) and hands each asset component its tokens. Living
 * elements (static pedestrians in v1) are merged into the same painter's
 * order as every other object.
 */

import { ASSET_REGISTRY } from "../scene/assets";
import { drawKey, gridToScreen } from "../scene/coordinates";
import type { PlacedObject, SceneModel } from "../scene/sceneModel";
import type { TownVisualState } from "../visual/visualState";
import { ASSET_COMPONENTS } from "./assetComponents";
import { TownInteractionLayer, type InteractionProps } from "./interaction";
import { Tile } from "./iso";
import { PALETTE as P } from "./palette";
import { renderTokens, type RenderTokens } from "./tokens";

/** `interaction` is the consciously-added FB-6 surface: when present the
 * renderer mounts the interaction layer (hit geometry, hover/selection
 * outlines, placement ghost). All interaction data arrives via props — the
 * renderer stays pure display with no world-client knowledge. */
export interface TownRendererProps {
  model: SceneModel;
  visual: TownVisualState;
  interaction?: InteractionProps | null;
}

function livingObjects(model: SceneModel, tokens: RenderTokens): PlacedObject[] {
  const def = ASSET_REGISTRY.pedestrian;
  return model.livingSpots.slice(0, tokens.pedestrians).map((spot, i) => ({
    id: `pedestrian-${i}`,
    asset: "pedestrian",
    def,
    grid: spot,
    orientation: "S",
    screen: gridToScreen(spot.x, spot.y, spot.z),
    key: drawKey(spot.x, spot.y, spot.z, def.footprint, false),
  }));
}

function MoodOverlay({ tokens, viewBox }: { tokens: RenderTokens; viewBox: SceneModel["viewBox"] }) {
  if (tokens.publicMood === "calm") return null;
  const fill = tokens.publicMood === "serene" ? P.moodSerene : P.moodTense;
  const opacity = tokens.publicMood === "serene" ? 0.06 : 0.07;
  return <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill={fill} opacity={opacity} pointerEvents="none" />;
}

export function TownRenderer({ model, visual, interaction }: TownRendererProps) {
  const tokens = renderTokens(visual);
  const vb = model.viewBox;
  const objects = [...model.objects, ...livingObjects(model, tokens)].sort(
    (a, b) => a.key - b.key || a.id.localeCompare(b.id),
  );
  let livingIndex = 0;

  return (
    <svg
      className="town-renderer"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width="100%"
      role="img"
      aria-label="Living town neighbourhood block"
      data-ambient={visual.ambient_activity}
      data-visual-version={visual.visual_projection_version}
    >
      <g className="ground">
        {model.ground.map((cell) => (
          <Tile key={`${cell.x},${cell.y}`} x={cell.x} y={cell.y} fill={(cell.x + cell.y) % 2 === 0 ? P.grass : P.grassAlt} />
        ))}
      </g>
      <g className="objects">
        {objects.map((obj) => {
          const Component = ASSET_COMPONENTS[obj.asset];
          const index = obj.def.category === "living" ? livingIndex++ : undefined;
          return (
            <g key={obj.id} data-asset={obj.asset} data-id={obj.id}>
              <Component obj={obj} tokens={tokens} index={index} />
            </g>
          );
        })}
      </g>
      {interaction && <TownInteractionLayer {...interaction} />}
      <MoodOverlay tokens={tokens} viewBox={vb} />
    </svg>
  );
}
