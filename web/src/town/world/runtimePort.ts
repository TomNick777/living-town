/**
 * Single authority for the loopback world-service port.
 *
 * Resolution order matches LIFE_ENERGY_DB: environment variable, then the
 * committed config file (passed in by the Vite/Node loader), then the
 * compiled default. Harbor keeps binding 8642 unless the operator sets
 * LIFE_ENERGY_WORLD_PORT in that process — this module does not invent a
 * second magic port.
 */

export const DEFAULT_WORLD_SERVICE_PORT = 8642;
export const WORLD_PORT_ENV = "LIFE_ENERGY_WORLD_PORT";

export function resolveWorldServicePort(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
  filePort?: number,
): number {
  const raw = env[WORLD_PORT_ENV]?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  }
  if (typeof filePort === "number" && filePort > 0 && filePort < 65536) return filePort;
  return DEFAULT_WORLD_SERVICE_PORT;
}
