/**
 * Visual projection tests — the ten requirements of the renderer phase
 * (docs/living-town-renderer-architecture.md §12) plus adapter checks.
 */

import { describe, expect, it } from "vitest";
import {
  parseTownStateText,
  TownStateContractError,
  validateTownState,
  type DataHealthBand,
  type PressureBand,
  type StabilityBand,
  type StrengthBand,
  type TownState,
  type VitalityBand,
} from "../src/town/adapter/townState";
import { projectTownVisualState } from "../src/town/visual/townVisualProjector";
import { VISUAL_PROJECTION_VERSION } from "../src/town/visual/visualState";
import stable from "../src/fixtures/town-state/stable.json";
import busyTight from "../src/fixtures/town-state/busy-tight.json";
import capitalExport from "../src/fixtures/town-state/capital-export.json";

const A = validateTownState(stable);
const B = validateTownState(busyTight);
const C = validateTownState(capitalExport);

function withMetric<K extends keyof TownState["state"]>(
  town: TownState,
  metric: K,
  band: TownState["state"][K]["band"],
  score = town.state[metric].score,
): TownState {
  return { ...town, state: { ...town.state, [metric]: { score, band } } };
}

describe("1. deterministic", () => {
  it("projects the same input to byte-identical output on repeated calls", () => {
    for (const town of [A, B, C]) {
      const first = JSON.stringify(projectTownVisualState(town));
      const second = JSON.stringify(projectTownVisualState(town));
      expect(first).toBe(second);
    }
  });

  it("does not mutate the Town State it reads", () => {
    const before = JSON.stringify(A);
    projectTownVisualState(A);
    expect(JSON.stringify(A)).toBe(before);
  });
});

describe("2. same TownState -> same TownVisualState", () => {
  it("is a pure function of the input (structural equality, no timestamps)", () => {
    const copy = JSON.parse(JSON.stringify(B)) as TownState;
    expect(projectTownVisualState(copy)).toEqual(projectTownVisualState(B));
  });

  it("reproduces the three demo states from their fixtures", () => {
    const a = projectTownVisualState(A);
    expect([a.ambient_activity, a.residential_stability, a.consumption_tension, a.reserve_state, a.external_flow_activity, a.data_certainty])
      .toEqual(["NORMAL", "STABLE", "NORMAL", "HEALTHY", "LOW", "HEALTHY"]);
    const b = projectTownVisualState(B);
    expect([b.ambient_activity, b.residential_stability, b.consumption_tension, b.reserve_state, b.external_flow_activity, b.data_certainty])
      .toEqual(["BUSY", "FRAGILE", "SEVERE", "LOW", "NONE", "HEALTHY"]);
    const c = projectTownVisualState(C);
    expect([c.ambient_activity, c.residential_stability, c.consumption_tension, c.reserve_state, c.external_flow_activity, c.data_certainty])
      .toEqual(["NORMAL", "STRONG", "LOW", "STRONG", "HIGH", "HEALTHY"]);
  });
});

describe("3. financial amounts never enter the visual state", () => {
  it("contains no *_minor field and no financial figure anywhere in the output", () => {
    for (const town of [A, B, C]) {
      const visual = projectTownVisualState(town);
      const text = JSON.stringify(visual);
      expect(text).not.toMatch(/_minor/);
      const keys: string[] = [];
      const collect = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); collect(x); }
      };
      collect(visual);
      expect(keys.filter((k) => /amount|income|minor|ratio|score/i.test(k))).toEqual([]);
      const figures = Object.values(town.financial).filter((v): v is number => typeof v === "number" && Math.abs(v) >= 1000);
      expect(figures.length).toBeGreaterThan(0);
      for (const figure of figures) {
        expect(text).not.toMatch(new RegExp(`(?<![\\d.])${figure}(?![\\d])`));
      }
    }
  });

  it("has only named levels and strings as leaves (no numeric fields at all)", () => {
    const visual = projectTownVisualState(B);
    const leaves: unknown[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(v);
    };
    walk(visual);
    expect(leaves.every((leaf) => typeof leaf === "string")).toBe(true);
  });

  it("spending more with identical bands does not change the visual state", () => {
    const richer: TownState = {
      ...A,
      financial: { ...A.financial, life_consumption_minor: A.financial.life_consumption_minor * 10, net_life_consumption_minor: A.financial.net_life_consumption_minor * 10 },
      scenes: Object.fromEntries(
        Object.entries(A.scenes).map(([k, s]) => [k, { ...s!, amount_minor: s!.amount_minor * 10 }]),
      ) as TownState["scenes"],
    };
    expect(projectTownVisualState(richer)).toEqual(projectTownVisualState(A));
  });
});

describe("4. vitality -> ambient_activity", () => {
  it.each<[VitalityBand, string]>([
    ["DORMANT", "QUIET"],
    ["QUIET", "NORMAL"],
    ["ALIVE", "ACTIVE"],
    ["THRIVING", "BUSY"],
  ])("%s -> %s", (band, expected) => {
    expect(projectTownVisualState(withMetric(A, "vitality", band)).ambient_activity).toBe(expected);
  });
});

describe("5. stability -> residential_stability", () => {
  it.each<[StabilityBand, string]>([
    ["FRAGILE", "FRAGILE"],
    ["MODERATE", "STABLE"],
    ["SOLID", "STRONG"],
  ])("%s -> %s", (band, expected) => {
    expect(projectTownVisualState(withMetric(A, "stability", band)).residential_stability).toBe(expected);
  });
});

describe("6. consumption_pressure -> consumption_tension", () => {
  it.each<[PressureBand, string]>([
    ["LOW", "LOW"],
    ["NORMAL", "NORMAL"],
    ["HIGH", "HIGH"],
    ["EXTREME", "SEVERE"],
  ])("%s -> %s", (band, expected) => {
    expect(projectTownVisualState(withMetric(A, "consumption_pressure", band)).consumption_tension).toBe(expected);
  });
});

describe("7. saving_strength -> reserve_state", () => {
  it.each<[StrengthBand, string]>([
    ["NONE", "DEPLETED"],
    ["WEAK", "LOW"],
    ["MODERATE", "HEALTHY"],
    ["STRONG", "STRONG"],
  ])("%s -> %s", (band, expected) => {
    expect(projectTownVisualState(withMetric(A, "saving_strength", band)).reserve_state).toBe(expected);
  });
});

describe("8. investment_outflow -> external_flow_activity", () => {
  it.each<[StrengthBand, string]>([
    ["NONE", "NONE"],
    ["WEAK", "LOW"],
    ["MODERATE", "NORMAL"],
    ["STRONG", "HIGH"],
  ])("%s -> %s", (band, expected) => {
    expect(projectTownVisualState(withMetric(A, "investment_outflow", band)).external_flow_activity).toBe(expected);
  });
});

describe("9. data_health -> data_certainty (kept apart from life levels)", () => {
  it.each<[DataHealthBand, string]>([
    ["HEALTHY", "HEALTHY"],
    ["REVIEW", "REVIEW"],
    ["NEEDS_WORK", "UNCERTAIN"],
  ])("%s -> %s", (band, expected) => {
    expect(projectTownVisualState(withMetric(A, "data_health", band)).data_certainty).toBe(expected);
  });

  it("an unbalanced identity floors HEALTHY to REVIEW (VR-6b) and nothing else", () => {
    const unbalanced: TownState = { ...A, financial: { ...A.financial, balanced: false } };
    const visual = projectTownVisualState(unbalanced);
    expect(visual.data_certainty).toBe("REVIEW");
    expect(visual.explanations.find((e) => e.field === "data_certainty")?.rule).toBe("VR-6b");
    const life = (v: ReturnType<typeof projectTownVisualState>) => [v.ambient_activity, v.residential_stability, v.consumption_tension, v.reserve_state, v.external_flow_activity];
    expect(life(visual)).toEqual(life(projectTownVisualState(A)));
  });

  it("uncertain data does not degrade any life level", () => {
    const uncertain = withMetric(C, "data_health", "NEEDS_WORK", 0.2);
    const visual = projectTownVisualState(uncertain);
    expect(visual.data_certainty).toBe("UNCERTAIN");
    expect(visual.residential_stability).toBe("STRONG");
    expect(visual.reserve_state).toBe("STRONG");
  });
});

describe("10. explanations are traceable", () => {
  it("explains every visual field with a rule id and TownState readings", () => {
    const visual = projectTownVisualState(B);
    const fields = ["ambient_activity", "residential_stability", "consumption_tension", "reserve_state", "external_flow_activity", "data_certainty"];
    for (const field of fields) {
      const e = visual.explanations.find((x) => x.field === field);
      expect(e, field).toBeDefined();
      expect(e!.value).toBe((visual as unknown as Record<string, string>)[field]);
      expect(e!.rule).toMatch(/^VR-\d+[a-z]?$/);
      expect(e!.because.length).toBeGreaterThan(0);
      expect(e!.because.join("\n")).toMatch(/TownState\./);
    }
    expect(visual.explanations.find((e) => e.field === "ambient_activity")!.because[0]).toBe("TownState.state.vitality = THRIVING (score 0.9500)");
    expect(visual.explanations.find((e) => e.field === "residential_stability")!.because[0]).toBe("TownState.state.stability = FRAGILE (score 0.3400)");
  });

  it("explains every scene activation, including absent scenes as IDLE", () => {
    const visual = projectTownVisualState(A);
    expect(visual.scene_activity.HOME).toBe("NORMAL");
    expect(visual.scene_activity.HEALTH).toBe("IDLE");
    expect(visual.explanations.find((e) => e.field === "scene_activity.HEALTH")!.because[0]).toMatch(/absent in period -> IDLE/);
  });

  it("carries both projection versions", () => {
    const visual = projectTownVisualState(A);
    expect(visual.visual_projection_version).toBe(VISUAL_PROJECTION_VERSION);
    expect(visual.visual_projection_version).toBe("living-town-visual-v1");
    expect(visual.source_projection_version).toBe("living-town-v1");
  });
});

describe("scene activation (VR-7) uses active days, never amounts", () => {
  it("maps day steps to IDLE / NORMAL / ACTIVE / HIGH", () => {
    const visual = projectTownVisualState(B);
    expect(visual.scene_activity.HOME).toBe("NORMAL"); // 3 days
    expect(visual.scene_activity.LEISURE).toBe("ACTIVE"); // 6 days
    expect(visual.scene_activity.COMMUTE).toBe("HIGH"); // 22 days
    expect(visual.scene_activity.INVESTMENT).toBe("IDLE"); // absent
  });

  it("a scene with a huge amount but one active day stays NORMAL", () => {
    const town: TownState = {
      ...A,
      scenes: { ...A.scenes, LEISURE: { scene: "LEISURE", transaction_count: 1, amount_minor: 99_000_000, share_of_consumption: 0.9, active_days: 1, trend_vs_previous_period: "UP", previous_amount_minor: 0 } },
    };
    expect(projectTownVisualState(town).scene_activity.LEISURE).toBe("NORMAL");
  });
});

describe("TownStateAdapter", () => {
  it("rejects an unsupported projection version", () => {
    expect(() => validateTownState({ ...stable, projection_version: "living-town-v2" })).toThrow(TownStateContractError);
  });

  it("rejects a non-integer amount (minor units must be integers)", () => {
    expect(() => validateTownState({ ...stable, financial: { ...stable.financial, life_consumption_minor: 12.5 } })).toThrow(/integer/);
  });

  it("rejects an unknown band", () => {
    expect(() => validateTownState({ ...stable, state: { ...stable.state, vitality: { score: 0.5, band: "GLORIOUS" } } })).toThrow(/band/);
  });

  it("accepts the raw stdout of `town state --json` (human table + JSON block)", () => {
    const cli = ["== 生活小镇 · 2026-05", "  vitality   QUIET   0.49", "", JSON.stringify(stable, null, 2)].join("\n");
    expect(parseTownStateText(cli).period.month).toBe("2026-05");
  });

  it("does not recompute: the validated object is the input, untouched", () => {
    expect(validateTownState(stable)).toBe(stable);
  });
});
