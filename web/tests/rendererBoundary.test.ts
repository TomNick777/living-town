/**
 * Renderer boundary tests — the renderer knows levels, never money.
 *
 *   - source-level import audit: render/scene/visual layers only depend on
 *     what the architecture allows; nothing touches Python, SQLite or raw/
 *     canonical data;
 *   - renderer props carry no financial amount;
 *   - the three demos render to observably different markup, and none of
 *     that markup contains a financial figure.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { validateTownState } from "../src/town/adapter/townState";
import { TownRenderer, type TownRendererProps } from "../src/town/render/TownRenderer";
import { PALETTE } from "../src/town/render/palette";
import { LIVING_TOWN_BASE_SCENE } from "../src/town/scene/livingTownScene";
import { composeSceneConfig } from "../src/town/world/compose";
import { SEED_WORLD } from "../src/town/world/seedWorld";
import { buildSceneModel, type SceneModel } from "../src/town/scene/sceneModel";
import { projectTownVisualState } from "../src/town/visual/townVisualProjector";
import type { TownVisualState } from "../src/town/visual/visualState";
import stable from "../src/fixtures/town-state/stable.json";
import busyTight from "../src/fixtures/town-state/busy-tight.json";
import capitalExport from "../src/fixtures/town-state/capital-export.json";

const SRC = join(__dirname, "..", "src");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) specifiers.push(m[1]);
  for (const m of text.matchAll(/import\(["']([^"']+)["']\)/g)) specifiers.push(m[1]);
  return specifiers;
}

const FORBIDDEN_EVERYWHERE = [/sqlite/i, /life-energy\.db/, /\.py\b/, /child_process/, /^node:/, /^fs$/, /^path$/, /python/i];

describe("renderer does not import Python, databases or domain data", () => {
  const render = listFiles(join(SRC, "town", "render"));
  const scene = listFiles(join(SRC, "town", "scene"));
  const visual = listFiles(join(SRC, "town", "visual"));

  it("render/ imports only react, render/, scene/ and visual/", () => {
    for (const file of render) {
      for (const spec of importsOf(file)) {
        const ok = spec === "react" || spec.startsWith("./") || spec.startsWith("../scene/") || spec.startsWith("../visual/");
        expect(ok, `${relative(SRC, file)} imports ${spec}`).toBe(true);
        expect(spec).not.toMatch(/adapter/);
      }
    }
  });

  it("scene/ is self-contained (no visual state, no adapter, no react)", () => {
    for (const file of scene) {
      for (const spec of importsOf(file)) {
        expect(spec.startsWith("./"), `${relative(SRC, file)} imports ${spec}`).toBe(true);
      }
    }
  });

  it("visual/ reads only the adapter contract types", () => {
    for (const file of visual) {
      for (const spec of importsOf(file)) {
        const ok = spec.startsWith("./") || spec.startsWith("../adapter/");
        expect(ok, `${relative(SRC, file)} imports ${spec}`).toBe(true);
      }
    }
  });

  it("no frontend source references SQLite, the ledger database or Python", () => {
    for (const file of listFiles(SRC)) {
      if (file.endsWith(".json") || file.endsWith(".md")) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of [/life-energy\.db/, /\.sqlite\b/i, /better-sqlite3/, /raw_records/, /transaction_interpretation/]) {
        expect(text, `${relative(SRC, file)} matches ${pattern}`).not.toMatch(pattern);
      }
      for (const spec of importsOf(file)) {
        for (const pattern of FORBIDDEN_EVERYWHERE) expect(spec, `${relative(SRC, file)} imports ${spec}`).not.toMatch(pattern);
      }
    }
  });
});

describe("renderer props carry no financial amount", () => {
  it("TownRenderer accepts exactly a SceneModel, a TownVisualState and the FB-6 interaction surface", () => {
    expectTypeOf<TownRendererProps>().toEqualTypeOf<{
      model: SceneModel;
      visual: TownVisualState;
      interaction?: import("../src/town/render/interaction").InteractionProps | null;
    }>();
    expectTypeOf<TownRendererProps>().not.toHaveProperty("townState");
    expectTypeOf<TownRendererProps>().not.toHaveProperty("financial");
    expectTypeOf<TownRendererProps>().not.toHaveProperty("commands");
  });

  it("every leaf of the visual prop is a named level, never a number", () => {
    const visual = projectTownVisualState(validateTownState(busyTight));
    const walk = (v: unknown): boolean =>
      Array.isArray(v) ? v.every(walk) : v && typeof v === "object" ? Object.values(v).every(walk) : typeof v === "string";
    expect(walk(visual)).toBe(true);
  });
});

describe("three demos render to observably different neighbourhoods", () => {
  const model = buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, SEED_WORLD));
  const towns = { A: validateTownState(stable), B: validateTownState(busyTight), C: validateTownState(capitalExport) };
  const markup = Object.fromEntries(
    Object.entries(towns).map(([k, town]) => [k, renderToStaticMarkup(createElement(TownRenderer, { model, visual: projectTownVisualState(town) }))]),
  ) as Record<"A" | "B" | "C", string>;

  const count = (text: string, needle: string | RegExp) => (text.match(typeof needle === "string" ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : needle) ?? []).length;

  it("renders the same fixed block for every state (buildings never come and go)", () => {
    for (const asset of ["residential_a", "residential_b", "convenience_store", "cafe", "bus_stop", "bridge", "variable_lot", "external_connection_anchor"]) {
      const counts = (["A", "B", "C"] as const).map((k) => count(markup[k], `data-asset="${asset}"`));
      expect(counts, asset).toEqual([counts[0], counts[0], counts[0]]);
      expect(counts[0]).toBeGreaterThanOrEqual(1);
    }
  });

  it("B (busy but tight) is more active than A yet less lit — activity and stability move independently", () => {
    const pedestrians = (k: "A" | "B" | "C") => count(markup[k], 'data-asset="pedestrian"');
    const litWindows = (k: "A" | "B" | "C") => count(markup[k], `fill="${PALETTE.windowLit}"`);
    expect(pedestrians("B")).toBeGreaterThan(pedestrians("A"));
    expect(litWindows("B")).toBeLessThan(litWindows("A"));
    expect(litWindows("C")).toBeGreaterThan(litWindows("A"));
    expect(pedestrians("A")).toBe(pedestrians("C"));
  });

  it("only C shows a busy external connection; B shows none", () => {
    const dots = (k: "A" | "B" | "C") => count(markup[k], 'class="anchor-flow-dot"');
    expect(dots("B")).toBe(0);
    expect(dots("A")).toBeGreaterThan(0);
    expect(dots("C")).toBeGreaterThan(dots("A"));
    expect(markup.C).toContain('class="anchor-flow-busy"');
    expect(markup.A).not.toContain('class="anchor-flow-busy"');
  });

  it("public mood is restrained, not alarming: tense is a faint tint, never a red overlay", () => {
    expect(markup.B).toContain(`fill="${PALETTE.moodTense}"`);
    expect(markup.A).not.toContain(`fill="${PALETTE.moodTense}"`);
    expect(markup.C).toContain(`fill="${PALETTE.moodSerene}"`);
    expect(markup.B).not.toMatch(/fill="#(ff0000|f00|e00|d00)"/i);
  });

  it("markup never contains a financial figure or a *_minor key", () => {
    for (const [k, town] of Object.entries(towns)) {
      const text = markup[k as "A" | "B" | "C"];
      expect(text).not.toMatch(/_minor/);
      for (const figure of Object.values(town.financial).filter((v): v is number => typeof v === "number" && Math.abs(v) >= 1000)) {
        expect(text, `${k} leaks ${figure}`).not.toMatch(new RegExp(`(?<![\\d.])${figure}(?![\\d])`));
      }
    }
  });

  it("the three markups differ pairwise", () => {
    expect(markup.A).not.toBe(markup.B);
    expect(markup.B).not.toBe(markup.C);
    expect(markup.A).not.toBe(markup.C);
  });
});
