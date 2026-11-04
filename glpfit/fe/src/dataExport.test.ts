import { describe, expect, it } from "vitest";
import { deidentify } from "./dataExport";
import { EMPTY_PROFILE, type DailyLog } from "./profile";

const log = (date: string, patch: Partial<DailyLog> = {}): DailyLog => ({
  date,
  weightKg: null,
  waterCups: null,
  proteinServings: null,
  symptoms: [],
  note: "",
  ...patch,
});

describe("deidentify", () => {
  it("keeps the signal but no name, notes, dates or absolute weight", () => {
    const record = deidentify(
      {
        ...EMPTY_PROFILE,
        nickname: "민지",
        startWeightKg: 80,
        dietNotes: "회사 근처 외식",
        drug: "mounjaro",
      },
      [
        log("2026-11-03", {
          weightKg: 78,
          symptoms: ["nausea"],
          note: "야근",
          meals: ["식판 렌즈: 닭가슴살 68%"],
          proteinG: 31.7,
        }),
      ],
      [
        {
          id: "a",
          date: "2026-10-26",
          drug: "mounjaro",
          doseMg: 2.5,
          site: null,
        },
        {
          id: "b",
          date: "2026-11-02",
          drug: "mounjaro",
          doseMg: 5,
          site: "thigh_left",
        },
      ],
      "test",
    );
    expect(record.shots).toEqual([
      { day: 0, doseMg: 2.5 },
      { day: 7, doseMg: 5 },
    ]);
    expect(record.days).toEqual([
      {
        day: 8,
        cycleDay: 2,
        weightChangePct: -2.5,
        waterCups: null,
        proteinG: 31.7,
        symptoms: ["nausea"],
      },
    ]);
    const text = JSON.stringify(record);
    for (const secret of ["민지", "외식", "야근", "2026", "닭가슴살", "78"]) {
      expect(text).not.toContain(secret);
    }
  });
});
