/**
 * World-service port authority: env > config file > compiled default.
 * Vite proxy, Python serve and tests must resolve the same number.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_SERVICE_PORT,
  WORLD_PORT_ENV,
  resolveWorldServicePort,
} from "../src/town/world/runtimePort";

const CONFIG_PATH = resolve(__dirname, "../../config/local-runtime.json");

describe("world service port authority", () => {
  it("defaults to the published loopback port when nothing overrides", () => {
    expect(DEFAULT_WORLD_SERVICE_PORT).toBe(8642);
    expect(resolveWorldServicePort({})).toBe(8642);
  });

  it("prefers LIFE_ENERGY_WORLD_PORT over the config file", () => {
    expect(resolveWorldServicePort({ [WORLD_PORT_ENV]: "8765" }, 8642)).toBe(8765);
  });

  it("uses the config file when env is unset", () => {
    expect(resolveWorldServicePort({}, 9001)).toBe(9001);
  });

  it("rejects non-integer env values instead of drifting to a second magic port", () => {
    expect(resolveWorldServicePort({ [WORLD_PORT_ENV]: "not-a-port" }, 9001)).toBe(9001);
    expect(resolveWorldServicePort({ [WORLD_PORT_ENV]: "0" })).toBe(DEFAULT_WORLD_SERVICE_PORT);
    expect(resolveWorldServicePort({ [WORLD_PORT_ENV]: "-1" })).toBe(DEFAULT_WORLD_SERVICE_PORT);
  });

  it("keeps the committed config file aligned with the compiled default", () => {
    const file = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { worldServicePort: number; worldServiceHost: string };
    expect(file.worldServiceHost).toBe("127.0.0.1");
    expect(file.worldServicePort).toBe(DEFAULT_WORLD_SERVICE_PORT);
  });
});
