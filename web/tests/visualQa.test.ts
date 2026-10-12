import { describe, expect, it } from "vitest";
import { isVisualQaMode, shouldRenderTownFrame } from "../src/town/replay/visualQa";

describe("visual QA mode", () => {
  it("is off by default so production still pauses when the tab is hidden", () => {
    expect(isVisualQaMode("")).toBe(false);
    expect(isVisualQaMode("?demo")).toBe(false);
    expect(shouldRenderTownFrame(true, false)).toBe(false);
    expect(shouldRenderTownFrame(false, false)).toBe(true);
  });

  it("lets a hidden document keep ticking only when visualQa is opted in", () => {
    expect(isVisualQaMode("?demo&visualQa=1")).toBe(true);
    expect(isVisualQaMode("visualQa")).toBe(true);
    expect(shouldRenderTownFrame(true, true)).toBe(true);
    expect(shouldRenderTownFrame(false, true)).toBe(true);
  });
});
