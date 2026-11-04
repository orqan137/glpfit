import type { RunStore, StoredRun } from "./history";
import { exerciseNote, setsOn, type ExerciseDay } from "./exercise";
import { mealNote, mealProtein, type Meal } from "./meals";
import { injectionsForContext, type Drug, type Injection } from "./medication";

export type Goal = "lose" | "maintain" | "muscle";
export type Tone = "gentle" | "direct" | "cheerful";
export type Concern =
  | "nausea"
  | "constipation"
  | "low_appetite"
  | "cravings"
  | "fatigue"
  | "muscle_loss";
export type Symptom =
  | "nausea"
  | "constipation"
  | "diarrhea"
  | "low_appetite"
  | "cravings"
  | "fatigue"
  | "heartburn";

export type Profile = {
  nickname: string;
  goal: Goal;
  heightCm: number | null;
  startWeightKg: number | null;
  targetWeightKg: number | null;
  drug: Drug | null;
  doseMg: number | null;
  medication: string;
  /** 0 = Sunday (Date.getDay()). */
  injectionWeekday: number | null;
  concerns: Concern[];
  dietNotes: string;
  tone: Tone;
};

export type DailyLog = {
  date: string;
  weightKg: number | null;
  waterCups: number | null;
  proteinServings: number | null;
  /** Grams eaten, summed from Plate Lens results. */
  proteinG?: number | null;
  /** Plate Lens one-line summaries for the day. */
  meals?: string[];
  symptoms: Symptom[];
  note: string;
};

export type ContextLog = Omit<DailyLog, "meals" | "proteinG"> & {
  proteinG: number | null;
  mealNotes: string[];
  exerciseSets: number | null;
  exerciseNotes: string[];
};

export type CoachContext = {
  profile: Profile | null;
  logs: ContextLog[];
  memories: string[];
  injections: ReturnType<typeof injectionsForContext>;
};

export const EMPTY_PROFILE: Profile = {
  nickname: "",
  goal: "lose",
  heightCm: null,
  startWeightKg: null,
  targetWeightKg: null,
  drug: null,
  doseMg: null,
  medication: "",
  injectionWeekday: null,
  concerns: [],
  dietNotes: "",
  tone: "gentle",
};

export const GOAL_LABEL: Record<Goal, string> = {
  lose: "체중 감량",
  maintain: "체중 유지",
  muscle: "근육 지키며 감량",
};
export const TONE_LABEL: Record<Tone, string> = {
  gentle: "다정하게",
  direct: "핵심만",
  cheerful: "밝게 응원",
};
export const CONCERN_LABEL: Record<Concern, string> = {
  nausea: "메스꺼움",
  constipation: "변비",
  low_appetite: "식욕 저하",
  cravings: "야식·단 것",
  fatigue: "피로",
  muscle_loss: "근손실",
};
export const SYMPTOM_LABEL: Record<Symptom, string> = {
  nausea: "메스꺼움",
  constipation: "변비",
  diarrhea: "설사",
  low_appetite: "식욕 없음",
  cravings: "음식 당김",
  fatigue: "피로",
  heartburn: "속쓰림",
};
export const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

const PROFILE_KEY = "glpfit.profile.v1";
const LOGS_KEY = "glpfit.logs.v1";
const MEMORY_KEY = "glpfit.memories.v1";
const MAX_LOGS = 90;
const MAX_MEMORIES = 30;

function defaultStore(): RunStore | null {
  try {
    if (typeof globalThis.localStorage !== "undefined")
      return globalThis.localStorage;
  } catch {
    return null;
  }
  return null;
}

function read<T>(store: RunStore | null, key: string, fallback: T): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(store: RunStore | null, key: string, value: unknown) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or quota exceeded: keep the value in memory only.
  }
}

export function dayKey(at: number | Date = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hasProfile(profile: Profile | null): profile is Profile {
  return (
    !!profile &&
    (!!profile.nickname ||
      profile.startWeightKg !== null ||
      profile.drug !== null)
  );
}

export function loadProfile(store = defaultStore()): Profile | null {
  const saved = read<Partial<Profile> | null>(store, PROFILE_KEY, null);
  return saved ? { ...EMPTY_PROFILE, ...saved } : null;
}

export function saveProfile(profile: Profile, store = defaultStore()): Profile {
  write(store, PROFILE_KEY, profile);
  return profile;
}

export function loadLogs(store = defaultStore()): DailyLog[] {
  const logs = read<DailyLog[]>(store, LOGS_KEY, []);
  return Array.isArray(logs)
    ? logs.filter((log) => typeof log?.date === "string")
    : [];
}

export function emptyLog(date: string): DailyLog {
  return {
    date,
    weightKg: null,
    waterCups: null,
    proteinServings: null,
    symptoms: [],
    note: "",
  };
}

/** Merge a change into one day's log; logs stay sorted newest first. */
export function upsertLog(
  date: string,
  patch: Partial<Omit<DailyLog, "date">>,
  store = defaultStore(),
): DailyLog[] {
  const logs = loadLogs(store);
  const current = logs.find((log) => log.date === date) ?? emptyLog(date);
  const next = [
    { ...current, ...patch, date },
    ...logs.filter((log) => log.date !== date),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_LOGS);
  write(store, LOGS_KEY, next);
  return next;
}

export function loadMemories(store = defaultStore()): string[] {
  const memories = read<string[]>(store, MEMORY_KEY, []);
  return Array.isArray(memories)
    ? memories.filter((m) => typeof m === "string")
    : [];
}

export function addMemory(text: string, store = defaultStore()): string[] {
  const clean = text.trim().slice(0, 120);
  const current = loadMemories(store);
  if (!clean || current.includes(clean)) return current;
  const next = [...current, clean].slice(-MAX_MEMORIES);
  write(store, MEMORY_KEY, next);
  return next;
}

export function removeMemory(index: number, store = defaultStore()): string[] {
  const next = loadMemories(store).filter((_, i) => i !== index);
  write(store, MEMORY_KEY, next);
  return next;
}

export function clearPersonalData(store = defaultStore()) {
  for (const key of [PROFILE_KEY, LOGS_KEY, MEMORY_KEY]) {
    try {
      store?.removeItem(key);
    } catch {
      // Ignore storage errors on clear.
    }
  }
}

/**
 * What the coach sees: profile, the last 30 days of check-ins merged with the
 * first line of each day's analysis runs, and remembered facts.
 */
export function buildContext(
  profile: Profile | null,
  logs: DailyLog[],
  memories: string[],
  runs: StoredRun[],
  injections: Injection[] = [],
  meals: Meal[] = [],
  exercise: ExerciseDay[] = [],
  days = 30,
  now = Date.now(),
): CoachContext {
  const since = dayKey(now - (days - 1) * 86_400_000);
  const byDay = new Map<string, CoachContext["logs"][number]>();
  // The server rejects unknown fields, so map to the wire shape explicitly.
  const toContext = (log: DailyLog): ContextLog => ({
    date: log.date,
    weightKg: log.weightKg,
    waterCups: log.waterCups,
    proteinServings: log.proteinServings,
    proteinG: log.proteinG ?? null,
    symptoms: log.symptoms,
    note: log.note,
    mealNotes: (log.meals ?? []).slice(0, 6).map((m) => m.slice(0, 160)),
    exerciseSets: null,
    exerciseNotes: [],
  });
  for (const log of logs) {
    if (log.date < since) continue;
    byDay.set(log.date, toContext(log));
  }
  // Meal photos are the source of protein: sum them per day and add a note per meal.
  for (const meal of meals) {
    if (meal.date < since) continue;
    const entry = byDay.get(meal.date) ?? toContext(emptyLog(meal.date));
    entry.proteinG =
      Math.round(((entry.proteinG ?? 0) + mealProtein(meal)) * 10) / 10;
    if (entry.mealNotes.length < 6)
      entry.mealNotes.push(mealNote(meal).slice(0, 160));
    byDay.set(meal.date, entry);
  }
  for (const day of exercise) {
    const sets = setsOn(exercise, day.date);
    if (day.date < since || !sets) continue;
    const entry = byDay.get(day.date) ?? toContext(emptyLog(day.date));
    entry.exerciseSets = sets;
    entry.exerciseNotes = [exerciseNote(day).slice(0, 160)];
    byDay.set(day.date, entry);
  }
  for (const run of runs) {
    if (run.status !== "success" || !run.attachments.length) continue;
    const date = dayKey(run.at);
    if (date < since) continue;
    const entry = byDay.get(date) ?? toContext(emptyLog(date));
    if (entry.mealNotes.length < 6) {
      const line = run.result
        .split("\n")
        .find((l) => /음식|식사 소리|장음|일어서기/.test(l));
      entry.mealNotes.push(
        `[${run.attachments.join("+")}] ${(line ?? run.result.split("\n")[0]).slice(0, 140)}`,
      );
    }
    byDay.set(date, entry);
  }
  return {
    profile: hasProfile(profile) ? profile : null,
    logs: [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-60),
    memories: memories.slice(-30),
    injections: injectionsForContext(injections),
  };
}

export type WeightSummary = {
  latest: number | null;
  sinceStart: number | null;
  toTarget: number | null;
  points: { date: string; kg: number }[];
};

export function weightSummary(
  profile: Profile | null,
  logs: DailyLog[],
): WeightSummary {
  const points = logs
    .filter((log) => log.weightKg !== null)
    .map((log) => ({ date: log.date, kg: log.weightKg as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.length ? points[points.length - 1].kg : null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    latest,
    sinceStart:
      latest !== null && profile?.startWeightKg
        ? round(latest - profile.startWeightKg)
        : null,
    toTarget:
      latest !== null && profile?.targetWeightKg
        ? round(latest - profile.targetWeightKg)
        : null,
    points: points.slice(-14),
  };
}

export const GOAL_LABEL_EN: Record<Goal, string> = {
  lose: "Lose weight",
  maintain: "Maintain",
  muscle: "Lose, keep muscle",
};
export const TONE_LABEL_EN: Record<Tone, string> = {
  gentle: "Gentle",
  direct: "Straight to the point",
  cheerful: "Cheerful",
};
export const CONCERN_LABEL_EN: Record<Concern, string> = {
  nausea: "Nausea",
  constipation: "Constipation",
  low_appetite: "Low appetite",
  cravings: "Late-night cravings",
  fatigue: "Fatigue",
  muscle_loss: "Muscle loss",
};
export const SYMPTOM_LABEL_EN: Record<Symptom, string> = {
  nausea: "Nausea",
  constipation: "Constipation",
  diarrhea: "Diarrhea",
  low_appetite: "No appetite",
  cravings: "Cravings",
  fatigue: "Tired",
  heartburn: "Heartburn",
};
export const WEEKDAY_LABEL_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
