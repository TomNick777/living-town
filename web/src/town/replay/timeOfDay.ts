/**
 * Presentation time-of-day rhythm derived from the replay clock.
 *
 * This is not a reconstruction of the user's real schedule and is not a
 * lighting system. ReplayEngine uses it only to weight ambient population
 * and dwell — never to invent financial facts.
 */

export type TimeOfDayPhase = "MORNING" | "DAY" | "EVENING" | "NIGHT";

const DAY_SECONDS = 86400;
const MORNING = 6 * 3600;
const DAY = 11 * 3600;
const EVENING = 17 * 3600;
const NIGHT = 21 * 3600;

export function timeOfDayPhase(clockSeconds: number): TimeOfDayPhase {
  const wrapped = ((clockSeconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  if (wrapped >= MORNING && wrapped < DAY) return "MORNING";
  if (wrapped >= DAY && wrapped < EVENING) return "DAY";
  if (wrapped >= EVENING && wrapped < NIGHT) return "EVENING";
  return "NIGHT";
}
