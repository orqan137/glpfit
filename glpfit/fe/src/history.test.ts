import { describe, expect, it } from "vitest";
import {
  clearRuns,
  countsByDay,
  deleteRun,
  historyDigest,
  loadRuns,
  saveRun,
  todayTrackCounts,
  trackWeekCounts,
  type RunStore,
  type StoredRun,
} from "./history";

function memoryStore(): RunStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function run(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    id: `run-${Math.random()}`,
    at: Date.now(),
    mode: "demo",
    prompt: "샘플 실행",
    attachments: [],
    status: "success",
    result: "완료",
    ...overrides,
  };
}

describe("run history", () => {
  it("saves newest first and caps the list", () => {
    const store = memoryStore();
    for (let i = 0; i < 35; i++) {
      saveRun(run({ id: `run-${i}`, result: `결과 ${i}` }), store);
    }
    const runs = loadRuns(store);
    expect(runs).toHaveLength(30);
    expect(runs[0].id).toBe("run-34");
  });

  it("returns empty on corrupt storage", () => {
    const store = memoryStore();
    store.data.set("glpfit.runs.v1", "not-json{{{");
    expect(loadRuns(store)).toEqual([]);
  });

  it("clears everything", () => {
    const store = memoryStore();
    saveRun(run(), store);
    expect(clearRuns(store)).toEqual([]);
    expect(loadRuns(store)).toEqual([]);
  });

  it("deletes one entry and keeps the rest", () => {
    const store = memoryStore();
    const first = run({ id: "keep" });
    const second = run({ id: "drop" });
    saveRun(first, store);
    saveRun(second, store);
    const kept = deleteRun("drop", store);
    expect(kept.map((r) => r.id)).toEqual(["keep"]);
    expect(loadRuns(store).map((r) => r.id)).toEqual(["keep"]);
  });

  it("builds a compact digest, newest last", () => {
    const first = run({
      at: new Date(2026, 10, 2, 9, 5).getTime(),
      result: "첫째줄\n둘째줄",
    });
    const second = run({
      at: new Date(2026, 10, 2, 9, 6).getTime(),
      attachments: ["식전 사진"],
      result: "변화율 50%",
    });
    const digest = historyDigest([second, first]);
    expect(digest).toContain("11/2 09:05");
    expect(digest).toContain("[식전 사진]");
    expect(digest.indexOf("첫째줄")).toBeLessThan(digest.indexOf("변화율"));
  });

  it("counts runs per day over the last week", () => {
    const noon = new Date(2026, 10, 4, 12, 0).getTime();
    const day = 86_400_000;
    const stored = [
      run({ at: noon, attachments: ["식전 사진"] }),
      run({ at: noon - day, attachments: ["식사 소리"] }),
      run({ at: noon - day, attachments: ["일어서기"] }),
      run({ at: noon - 9 * day, attachments: ["식전 사진"] }),
    ];
    const counts = countsByDay(stored, 7, noon);
    expect(counts).toHaveLength(7);
    expect(counts[6]).toMatchObject({ count: 1, isToday: true });
    expect(counts[5].count).toBe(2);
    expect(counts[0].count).toBe(0);
    expect(trackWeekCounts(stored, 7, noon)).toEqual({
      food: 1,
      sound: 1,
      motion: 1,
    });
    expect(todayTrackCounts(stored, noon)).toEqual({
      food: 1,
      sound: 0,
      motion: 0,
    });
  });

  it("returns runs for a given day", async () => {
    const { runsOnDay } = await import("./history");
    const noon = new Date(2026, 10, 4, 12, 0).getTime();
    const day = 86_400_000;
    const stored = [
      run({ at: noon, attachments: ["식전 사진"] }),
      run({ at: noon - day, attachments: ["식사 소리"] }),
    ];
    const todayStart = new Date(2026, 10, 4, 0, 0).getTime();
    expect(runsOnDay(stored, todayStart)).toHaveLength(1);
    expect(runsOnDay(stored, todayStart - 9 * day)).toHaveLength(0);
  });
});
