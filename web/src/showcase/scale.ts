/**
 * Presentation-scale helpers. Width/opacity use already-projected integers.
 * They never add amounts together to invent a new financial figure.
 */

export function maxAbs(values: readonly number[]): number {
  let peak = 0;
  for (const value of values) {
    const abs = value < 0 ? -value : value;
    if (abs > peak) peak = abs;
  }
  return peak;
}

/** Pixel/percent width for a bar; zero when the series is empty. */
export function barShare(amount: number, peak: number): number {
  if (peak <= 0) return 0;
  const abs = amount < 0 ? -amount : amount;
  return abs / peak;
}
