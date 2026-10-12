/**
 * Presentation time-of-day phases. Clock is replay seconds, not the user's
 * real schedule — these tests lock the four boundaries and wrap-around.
 */

import { describe, expect, it } from "vitest";
import { timeOfDayPhase } from "../src/town/replay/timeOfDay";

describe("timeOfDayPhase", () => {
  it("classifies the four phases at interior times", () => {
    expect(timeOfDayPhase(8 * 3600)).toBe("MORNING");
    expect(timeOfDayPhase(13 * 3600)).toBe("DAY");
    expect(timeOfDayPhase(19 * 3600)).toBe("EVENING");
    expect(timeOfDayPhase(23 * 3600)).toBe("NIGHT");
    expect(timeOfDayPhase(3 * 3600)).toBe("NIGHT");
  });

  it("uses inclusive start / exclusive end at the published boundaries", () => {
    expect(timeOfDayPhase(6 * 3600)).toBe("MORNING");
    expect(timeOfDayPhase(11 * 3600 - 1)).toBe("MORNING");
    expect(timeOfDayPhase(11 * 3600)).toBe("DAY");
    expect(timeOfDayPhase(17 * 3600 - 1)).toBe("DAY");
    expect(timeOfDayPhase(17 * 3600)).toBe("EVENING");
    expect(timeOfDayPhase(21 * 3600 - 1)).toBe("EVENING");
    expect(timeOfDayPhase(21 * 3600)).toBe("NIGHT");
    expect(timeOfDayPhase(0)).toBe("NIGHT");
    expect(timeOfDayPhase(6 * 3600 - 1)).toBe("NIGHT");
  });

  it("wraps clock seconds into a single day", () => {
    expect(timeOfDayPhase(86400 + 8 * 3600)).toBe("MORNING");
    expect(timeOfDayPhase(-3600)).toBe("NIGHT");
  });
});
