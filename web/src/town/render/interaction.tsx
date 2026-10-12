/**
 * TownInteractionLayer — invisible hit geometry + hover/selection/ghost
 * overlays for the SVG renderer (FB-6).
 *
 * Pure display + events: it receives everything through props, knows nothing
 * about the world client, SQLite or commands (renderer boundary — render/
 * must not import ../world/). Hit targets are per-building ground diamonds
 * plus a facade cover, so clicks land on the building, not the gaps.
 *
 * While a placement mode is active, every click is a cell click: on the open
 * ground it is the cell under the cursor; on a building shape it is that
 * building's anchor cell. The ghost shows validity locally; the server has
 * the final word.
 */

import type React from "react";
import { groundQuad, pointsAttr, screenToGrid } from "../scene/coordinates";
import { ASSET_REGISTRY } from "../scene/assets";
import type { PlacedObject, SceneModel } from "../scene/sceneModel";
import { PALETTE as P } from "./palette";

export interface GhostPreview {
  x: number;
  y: number;
  valid: boolean;
}

export interface InteractionProps {
  model: SceneModel;
  hoveredBuildingId: string | null;
  selectedBuildingId: string | null;
  /** Present only while a placement mode is active. */
  ghost: GhostPreview | null;
  ghostAssetId: string | null;
  /** When true, all clicks mean "place here" and buildings are not selectable. */
  placementActive: boolean;
  onHoverBuilding: (buildingId: string) => void;
  onLeaveBuilding: () => void;
  onSelectBuilding: (buildingId: string) => void;
  onBackgroundClick: () => void;
  onCellClick: (cell: { x: number; y: number }) => void;
  onGhostMove: (cell: { x: number; y: number }) => void;
}

function buildingObjects(model: SceneModel): PlacedObject[] {
  return model.objects.filter((o) => o.def.category === "building");
}

/** Screen (SVG user units) point of a mouse event, via the current CTM. */
function eventToUserPoint(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null {
  const target = e.currentTarget as SVGGElement;
  const ctm = target.getScreenCTM();
  if (!ctm) return null;
  const inverse = ctm.inverse();
  return {
    x: e.clientX * inverse.a + e.clientY * inverse.c + inverse.e,
    y: e.clientX * inverse.b + e.clientY * inverse.d + inverse.f,
  };
}

export function TownInteractionLayer({ model, ...props }: InteractionProps) {
  const buildings = buildingObjects(model);
  const ghostDef = props.ghostAssetId ? ASSET_REGISTRY[props.ghostAssetId as keyof typeof ASSET_REGISTRY] : undefined;

  return (
    <g
      className="town-interaction"
      onPointerMove={(e) => {
        if (!props.placementActive) return;
        const point = eventToUserPoint(e);
        if (point) props.onGhostMove(screenToGrid(point.x, point.y));
      }}
      onClick={(e) => {
        if (props.placementActive) {
          const point = eventToUserPoint(e);
          if (point) props.onCellClick(screenToGrid(point.x, point.y));
          return;
        }
        props.onBackgroundClick();
      }}
    >
      {ghostDef && props.ghost && (
        <polygon
          className="town-ghost"
          data-ghost-valid={props.ghost.valid}
          points={pointsAttr(groundQuad(props.ghost.x, props.ghost.y, ghostDef.footprint, 0))}
          fill={props.ghost.valid ? P.ghostValid : P.ghostInvalid}
          stroke={props.ghost.valid ? P.ghostValidEdge : P.ghostInvalidEdge}
          strokeWidth={1.2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {buildings.map((building) => {
        const hovered = props.hoveredBuildingId === building.id;
        const selected = props.selectedBuildingId === building.id;
        const quad = groundQuad(building.grid.x, building.grid.y, building.def.footprint, building.grid.z);
        const facadeHeight = building.def.heightPx;
        const facade = {
          x: Math.min(quad[3].sx, quad[0].sx),
          y: quad[0].sy - facadeHeight,
          w: Math.max(quad[1].sx, quad[2].sx) - Math.min(quad[3].sx, quad[0].sx),
          h: quad[2].sy - quad[0].sy + facadeHeight,
        };
        const anchorCell = { x: building.grid.x, y: building.grid.y };
        return (
          <g key={building.id} className="town-hit" data-hit-id={building.id}>
            {(hovered || selected) && (
              <polygon
                points={pointsAttr(quad)}
                fill="none"
                stroke={selected ? P.selectedOutline : P.hoverOutline}
                strokeWidth={selected ? 2.4 : 1.4}
                pointerEvents="none"
              />
            )}
            <polygon
              points={pointsAttr(quad)}
              fill="transparent"
              className="town-hit-ground"
              onPointerEnter={() => props.onHoverBuilding(building.id)}
              onPointerLeave={() => props.onLeaveBuilding()}
              onClick={(e) => {
                e.stopPropagation();
                if (props.placementActive) {
                  props.onCellClick(anchorCell);
                  return;
                }
                props.onSelectBuilding(building.id);
              }}
              style={{ cursor: "pointer" }}
            />
            {/* facade cover: invisible rectangle over the building body so
                clicks on the walls hit the building, not the background */}
            <rect
              x={facade.x}
              y={facade.y}
              width={facade.w}
              height={facade.h}
              fill="transparent"
              onClick={(e) => {
                e.stopPropagation();
                if (props.placementActive) {
                  props.onCellClick(anchorCell);
                  return;
                }
                props.onSelectBuilding(building.id);
              }}
              style={{ cursor: "pointer" }}
            />
          </g>
        );
      })}
    </g>
  );
}
