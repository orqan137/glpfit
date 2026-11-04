import { describe, expect, it } from "vitest";
import { computeSchedule, type Injection } from "./medication";
import { buildContext, EMPTY_PROFILE } from "./profile";

const NOW = new Date(2026, 10, 4, 12).getTime(); // Wed 2026-11-04
const shot = (date: string, doseMg: number, site: Injection["site"]) => ({
  id: date,
  date,
  drug: "mounjaro" as const,
  doseMg,
  site,
});

describe("computeSchedule", () => {
  it("tracks cycle day, phase, next due, site rotation and dose weeks", () => {
    const schedule = computeSchedule(
      [
        shot("2026-10-19", 2.5, "thigh_right"),
        shot("2026-10-26", 5, "abdomen_left"),
        shot("2026-11-02", 5, "abdomen_right"),
      ],
      { drug: null, doseMg: null, weekday: null },
      NOW,
    );
    expect(schedule.cycleDay).toBe(3);
    expect(schedule.phase?.name).toBe("안정기");
    expect(schedule.daysUntil).toBe(5);
    expect(schedule.overdue).toBe(0);
    expect(schedule.nextSite).toBe("thigh_left");
    expect(schedule.weeksOnDose).toBe(2);
    expect(schedule.stepIndex).toBe(1);
  });

  it("flags an overdue shot", () => {
    const schedule = computeSchedule(
      [shot("2026-10-25", 5, null)],
      { drug: null, doseMg: null, weekday: null },
      NOW,
    );
    expect(schedule.overdue).toBe(3);
    expect(schedule.phase?.name).toBe("다음 주사 전");
  });

  it("uses the injection weekday before the first shot", () => {
    const schedule = computeSchedule(
      [],
      { drug: "wegovy", doseMg: 0.25, weekday: 0 },
      NOW,
    );
    expect(schedule.cycleDay).toBeNull();
    expect(schedule.daysUntil).toBe(4); // Wed → Sun
    expect(schedule.ladder).toEqual([0.25, 0.5, 1, 1.7, 2.4]);
  });
});

describe("buildContext", () => {
  it("sends injections without UI ids and drops empty profiles", () => {
    const context = buildContext(
      EMPTY_PROFILE,
      [],
      ["기름진 음식 먹으면 메스꺼움"],
      [],
      [shot("2026-11-02", 5, "abdomen_right")],
      [],
      [],
      30,
      NOW,
    );
    expect(context.profile).toBeNull();
    expect(context.injections).toEqual([
      {
        date: "2026-11-02",
        drug: "mounjaro",
        doseMg: 5,
        site: "abdomen_right",
      },
    ]);
    expect(context.memories).toHaveLength(1);
  });
});
