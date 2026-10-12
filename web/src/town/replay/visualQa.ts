/**
 * Development / acceptance flag for observing continuous 3D actor motion.
 *
 * Production keeps `document.hidden → pause` so a background tab does not
 * burn a Three.js render loop. `?visualQa=1` (or `?visualQa`) opts into
 * foreground-style ticking even when the document is hidden, so courier /
 * transit / ambient motion can be verified without changing the default.
 */

export function isVisualQaMode(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  const params = new URLSearchParams(search.startsWith("?") || search.length === 0 ? search : `?${search}`);
  if (!params.has("visualQa")) return false;
  const value = params.get("visualQa");
  return value === "" || value === "1" || value === "true";
}

export function shouldRenderTownFrame(hidden: boolean, visualQa: boolean): boolean {
  return !hidden || visualQa;
}
