import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildShowcaseTown } from "../src/showcase/town3d/buildShowcaseTown";
import { projectTownVisualState } from "../src/town/visual/townVisualProjector";
import { DEMOS } from "../src/demos/demos";

beforeEach(() => vi.stubGlobal("document", {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }) }),
}));
afterEach(() => vi.unstubAllGlobals());

describe("shipped 3D neighbourhood", () => {
  it("keeps geometry fixed across financial states while dusk changes materials", () => {
    const scene = new THREE.Scene();
    const town = buildShowcaseTown(scene);
    const objects: THREE.Object3D[] = [];
    scene.traverse(object => objects.push(object));
    const materials = new Set<THREE.Material>();
    for (const object of objects) if (object instanceof THREE.Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    const emissive = () => [...materials].filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial)
      .map(m => m.emissive.getHex());
    town.update(projectTownVisualState(DEMOS[0].townState), false);
    const daylight = emissive();
    for (const demo of DEMOS) town.update(projectTownVisualState(demo.townState), true);
    expect(emissive()).not.toEqual(daylight);
    let count = 0; scene.traverse(() => count++);
    expect(count).toBe(objects.length);
    const disposal = [...materials].map(material => vi.spyOn(material, "dispose"));
    town.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposal.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it("keeps animation and instanced geometry finite over a long-running session", () => {
    const scene = new THREE.Scene();
    const town = buildShowcaseTown(scene);
    for (const seconds of [0, 120, 10000]) town.tick(seconds, true);
    let instances = 0;
    scene.traverse(object => {
      expect(object.position.toArray().every(Number.isFinite)).toBe(true);
      if (object instanceof THREE.InstancedMesh) {
        instances += object.count;
        expect(object.instanceMatrix.array.every(Number.isFinite)).toBe(true);
      }
    });
    expect(instances).toBeGreaterThan(1000);
    town.dispose();
  });
});
