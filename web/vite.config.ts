import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolveWorldServicePort } from "./src/town/world/runtimePort";

function worldServicePort(): number {
  let filePort: number | undefined;
  try {
    const raw = JSON.parse(readFileSync(resolve(__dirname, "../config/local-runtime.json"), "utf8")) as {
      worldServicePort?: number;
    };
    if (typeof raw.worldServicePort === "number") filePort = raw.worldServicePort;
  } catch {
    // Installed / copied trees may omit the repo config file; compiled default holds.
  }
  return resolveWorldServicePort(process.env, filePort);
}

const WORLD_SERVICE_PORT = worldServicePort();

// Living Town web renderer. Pure presentation: no backend, no database,
// no financial computation. Fixtures are static JSON (docs/living-town-ui-contract.md).
export default defineConfig({
  // Relative assets work both at a local root and a GitHub Pages repository subpath.
  base: process.env.LIVING_TOWN_BASE || "./",
  plugins: [react()],
  server: {
    // 5173 is a runtime contract, not a preference: the world service proxy,
    // the showcase's fixed deep link (?demo) and the Harbor launcher all
    // target it. Fail loudly instead of drifting to 5174+ when it is busy.
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin dev transport to the loopback-only world service.
      // Port authority: LIFE_ENERGY_WORLD_PORT > config/local-runtime.json > 8642.
      "/api": { target: `http://127.0.0.1:${WORLD_SERVICE_PORT}`, changeOrigin: false },
    },
  },
  preview: { proxy: {} },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
