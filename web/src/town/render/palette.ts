/**
 * Palette — living-town visual system v1 (Visual DNA Lock).
 *
 * Source of truth for every colour in the renderer; asset components never
 * hard-code hex values. Language per docs/living-town-asset-bible.md §5:
 * low-saturation cool bodies (blue-grey / teal-grey / warm grey), dark navy
 * roof decks, and the scene's ONLY warm colours reserved for life — windows,
 * shop glass, sign bands, street lamps. No alarm colours: financial state
 * never becomes a red/green verdict (docs/living-town-visual-language.md).
 */

export interface FaceColours {
  top: string;
  left: string; // south face, towards the street
  right: string; // east face
}

export const PALETTE = {
  // --- ground ------------------------------------------------------------
  grass: "#adb7a3",
  grassAlt: "#acb6a2",
  green: "#9db08c",
  road: "#66717b",
  roadLine: "#99a3ac",
  crosswalkStripe: "#e3e2da",
  sidewalk: "#d9d6cb",
  sidewalkEdge: "#c1beb2",
  water: "#8fb4bd",
  waterAlt: "#8ab0b9",
  ripple: "#c3dade",

  // --- bridge: the road continues over the river --------------------------
  bridgeDeck: "#6b757f",
  bridgeSide: "#575f68",
  bridgeRail: "#3e4750",

  // --- building bodies (top / south / east, light from upper-left) --------
  residentialA: { top: "#c7d1da", left: "#a2b1bf", right: "#8796a5" } as FaceColours,
  residentialB: { top: "#ddd4c2", left: "#c7bca9", right: "#aba191" } as FaceColours,
  store: { top: "#c9d1cf", left: "#adb8b5", right: "#919d9b" } as FaceColours,
  cafe: { top: "#d9c9b1", left: "#c2b097", right: "#a59580" } as FaceColours,
  /** Rooftop gear, parapet rims, awning/balcony slabs — neutral grey-blue. */
  rooftop: { top: "#b4bfca", left: "#98a5b1", right: "#818e9a" } as FaceColours,
  /** Dark flat-roof deck: visibly darker than every wall (bible §5). */
  roofDeck: "#4d5b67",
  vending: { top: "#cf7a5c", left: "#bd674a", right: "#a25640" } as FaceColours,
  vendFront: "#e8e4d8",
  planterBox: { top: "#b5a28c", left: "#a2907a", right: "#8b7a67" } as FaceColours,
  carBody: { top: "#c3cbd1", left: "#a7b1b9", right: "#8d98a1" } as FaceColours,
  lot: "#cbc2ae",
  lotStake: "#867457",

  // --- lights: the warmest colours in the whole scene ----------------------
  windowLit: "#f2d489",
  windowLitSoft: "#e9cf96",
  windowDark: "#525f6b",
  glassDark: "#5e6c78",
  glassLit: "#f3dda6",
  door: "#5e5044",
  doorStep: "#c9c5b8",
  frame: "#66727d",
  /** Awning stripes: cream + one muted accent per shop. */
  awningCream: "#e9e1cf",
  awningOrange: "#d3975c",
  awningTeal: "#7fa2a7",
  signDark: "#4d5a65",

  // --- nature ---------------------------------------------------------------
  trunk: "#7c6857",
  soil: "#6d5c4d",
  canopy: "#7ba084",
  canopyDark: "#6d9276",
  canopyLight: "#94b699",
  canopyHighlight: "#aac7ab",
  shrub: "#87a483",
  shrubLight: "#9db798",
  flowerA: "#d8a29b",
  flowerB: "#e3c67f",
  flowerC: "#c4b3d4",

  // --- street furniture ------------------------------------------------------
  pole: "#48535c",
  lamp: "#f6dc9c",
  lampGlow: "#f4d896",
  benchWood: "#a9855f",
  benchWoodDark: "#8f6f4e",
  metal: "#48535c",
  terracotta: "#b57a6c",
  bin: "#5d6870",
  boxWood: "#c9b08a",
  boxWoodDark: "#b09a76",

  // --- special ---------------------------------------------------------------
  anchorPylon: "#5d6a74",
  anchorFlow: "#e6c37a",
  anchorChevron: "#8f9aa4",
  hazeReview: "#d9c37c",
  hazeUncertain: "#c9908a",

  people: ["#6f7f92", "#a08672", "#7f937f", "#93839c", "#a99a82", "#71909e"],
  skin: "#e9d9c6",

  /** Faint cool tint for public space; tense is restrained, never red. */
  moodSerene: "#f1d7a6",
  moodTense: "#64788a",

  // --- interaction highlights (FB-6; UI semantics, never financial) -------
  /** Hover: a quiet brightened rim on the ground diamond. */
  hoverOutline: "#3c5a76",
  /** Selection: a stronger, double-weight rim in the deep teal. */
  selectedOutline: "#1f4e5f",
  /** Placement ghost: valid = cool teal wash; invalid = muted rust (a UI
   * affordance, not a financial verdict). */
  ghostValid: "rgba(64,122,138,0.35)",
  ghostValidEdge: "#407a8a",
  ghostInvalid: "rgba(150,80,66,0.35)",
  ghostInvalidEdge: "#965042",

  /** Soft contact shadows under solid objects (light from upper-left). */
  groundShadow: "rgba(45,55,65,0.15)",
  /** Halo around lit glass and lamps. */
  glow: "rgba(244,216,150,0.22)",
} as const;
