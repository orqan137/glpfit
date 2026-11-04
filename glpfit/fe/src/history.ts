export type RunStatus = "success" | "error" | "stopped";

export type StoredRun = {
  id: string;
  at: number;
  mode: "demo" | "live";
  prompt: string;
  attachments: string[];
  status: RunStatus;
  result: string;
};

export type RunStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "glpfit.runs.v1";
const MAX_RUNS = 30;

function defaultStore(): RunStore | null {
  try {
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadRuns(store: RunStore | null = defaultStore()): StoredRun[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredRun =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StoredRun).at === "number" &&
        typeof (item as StoredRun).result === "string",
    );
  } catch {
    return [];
  }
}

export function saveRun(
  run: StoredRun,
  store: RunStore | null = defaultStore(),
): StoredRun[] {
  const runs = [run, ...loadRuns(store)].slice(0, MAX_RUNS);
  try {
    store?.setItem(KEY, JSON.stringify(runs));
  } catch {
    // Private mode or quota exceeded: keep runs in memory only.
  }
  return runs;
}

export function clearRuns(
  store: RunStore | null = defaultStore(),
): StoredRun[] {
  try {
    store?.removeItem(KEY);
  } catch {
    // Ignore storage errors on clear.
  }
  return [];
}

export function deleteRun(
  id: string,
  store: RunStore | null = defaultStore(),
): StoredRun[] {
  const kept = loadRuns(store).filter((run) => run.id !== id);
  try {
    store?.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Ignore storage errors; in-memory list is still returned.
  }
  return kept;
}

/** Compact digest of recent runs for the live prompt: newest last. */
export function historyDigest(runs: StoredRun[], limit = 5): string {
  return runs
    .slice(0, limit)
    .reverse()
    .map((run) => {
      const date = new Date(run.at);
      const stamp = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      const head = run.attachments.length
        ? ` [${run.attachments.join("+")}]`
        : "";
      const firstLine = run.result.split("\n")[0].slice(0, 120);
      return `- ${stamp}${head}: ${firstLine}`;
    })
    .join("\n");
}

const FOOD_LABELS = new Set(["식전 사진", "식후 사진"]);
const SOUND_LABELS = new Set(["식사 소리", "장음"]);
const MOTION_LABEL = "일어서기";

export type DayCount = {
  label: string;
  count: number;
  isToday: boolean;
  start: number;
};

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Run counts for the last `days` days, oldest first. */
export function countsByDay(
  runs: StoredRun[],
  days = 7,
  now = Date.now(),
): DayCount[] {
  const week = ["일", "월", "화", "수", "목", "금", "토"];
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  return Array.from({ length: days }, (_, i) => {
    const dayStart = today - (days - 1 - i) * dayMs;
    const count = runs.filter((run) => {
      const at = startOfDay(run.at);
      return at >= dayStart && at < dayStart + dayMs;
    }).length;
    return {
      label: week[new Date(dayStart).getDay()],
      count,
      isToday: i === days - 1,
      start: dayStart,
    };
  });
}

export type TrackWeek = { food: number; sound: number; motion: number };

function hasLabel(
  dayRuns: StoredRun[],
  match: (labels: string[]) => boolean,
): boolean {
  return dayRuns.some((run) => match(run.attachments));
}

export function runsOnDay(runs: StoredRun[], dayStart: number): StoredRun[] {
  const dayMs = 86_400_000;
  return runs.filter((run) => {
    const at = startOfDay(run.at);
    return at >= dayStart && at < dayStart + dayMs;
  });
}

/** Days in the last week with at least one log per track. */
export function trackWeekCounts(
  runs: StoredRun[],
  days = 7,
  now = Date.now(),
): TrackWeek {
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  let food = 0;
  let sound = 0;
  let motion = 0;
  for (let i = 0; i < days; i++) {
    const dayRuns = runsOnDay(runs, today - i * dayMs);
    if (hasLabel(dayRuns, (labels) => labels.some((l) => FOOD_LABELS.has(l))))
      food++;
    if (hasLabel(dayRuns, (labels) => labels.some((l) => SOUND_LABELS.has(l))))
      sound++;
    if (hasLabel(dayRuns, (labels) => labels.includes(MOTION_LABEL))) motion++;
  }
  return { food, sound, motion };
}

/** Today's log counts per track. */
export function todayTrackCounts(
  runs: StoredRun[],
  now = Date.now(),
): TrackWeek {
  const dayRuns = runsOnDay(runs, startOfDay(now));
  const count = (match: (labels: string[]) => boolean) =>
    dayRuns.filter((run) => match(run.attachments)).length;
  return {
    food: count((labels) => labels.some((l) => FOOD_LABELS.has(l))),
    sound: count((labels) => labels.some((l) => SOUND_LABELS.has(l))),
    motion: count((labels) => labels.includes(MOTION_LABEL)),
  };
}
