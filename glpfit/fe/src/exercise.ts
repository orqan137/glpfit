/**
 * Bodyweight exercise to keep muscle while losing weight. The routine follows the
 * shot cycle: gentle right after the shot, strength on steady days.
 */
import type { RunStore } from "./history";
import { dayKey } from "./profile";

export type Move =
  | "walk"
  | "calf_raise"
  | "wall_sit"
  | "squat"
  | "knee_pushup"
  | "plank"
  | "lunge"
  | "glute_bridge";

export type MoveInfo = {
  ko: string;
  en: string;
  unit: "reps" | "sec" | "min";
  howKo: string;
  howEn: string;
};

export const MOVES: Record<Move, MoveInfo> = {
  walk: {
    ko: "걷기",
    en: "Walk",
    unit: "min",
    howKo: "식후 천천히, 대화할 수 있는 속도로",
    howEn: "After a meal, at a talking pace",
  },
  calf_raise: {
    ko: "까치발 들기",
    en: "Calf raises",
    unit: "reps",
    howKo: "벽을 잡고 천천히 올라갔다 내려오기",
    howEn: "Hold a wall, rise and lower slowly",
  },
  wall_sit: {
    ko: "벽 앉기",
    en: "Wall sit",
    unit: "sec",
    howKo: "등을 벽에 대고 무릎 90도로 버티기",
    howEn: "Back on the wall, knees at 90 degrees",
  },
  squat: {
    ko: "스쿼트",
    en: "Squats",
    unit: "reps",
    howKo: "의자에 앉듯 엉덩이를 뒤로, 무릎은 발끝 방향",
    howEn: "Sit back as if into a chair, knees over toes",
  },
  knee_pushup: {
    ko: "무릎 푸시업",
    en: "Knee push-ups",
    unit: "reps",
    howKo: "무릎을 대고 가슴을 바닥 가까이",
    howEn: "Knees down, chest toward the floor",
  },
  plank: {
    ko: "플랭크",
    en: "Plank",
    unit: "sec",
    howKo: "팔꿈치와 발끝으로 몸을 일직선으로",
    howEn: "Elbows and toes, body in a straight line",
  },
  lunge: {
    ko: "런지",
    en: "Lunges",
    unit: "reps",
    howKo: "한 발 앞으로, 뒷무릎을 바닥 가까이 (양쪽)",
    howEn: "Step forward, back knee toward the floor (each side)",
  },
  glute_bridge: {
    ko: "브릿지",
    en: "Glute bridge",
    unit: "reps",
    howKo: "누워서 무릎 세우고 엉덩이 들기",
    howEn: "On your back, knees bent, lift your hips",
  },
};

export type RoutineItem = { move: Move; sets: number; amount: number };

/** Routine by phase index: 0 right after the shot, 1 steady, 2 before the next shot. */
export const ROUTINES: { ko: string; en: string; items: RoutineItem[] }[] = [
  {
    ko: "주사 직후라 가볍게. 속이 불편하면 걷기만 해도 충분해요.",
    en: "Right after the shot, keep it light. A walk alone is enough if you feel queasy.",
    items: [
      { move: "walk", sets: 1, amount: 10 },
      { move: "calf_raise", sets: 2, amount: 15 },
      { move: "wall_sit", sets: 2, amount: 20 },
    ],
  },
  {
    ko: "컨디션이 고른 날이라 근력 운동으로 근육을 지켜요.",
    en: "Steady days: strength work to keep your muscle.",
    items: [
      { move: "squat", sets: 3, amount: 10 },
      { move: "knee_pushup", sets: 3, amount: 8 },
      { move: "plank", sets: 3, amount: 30 },
    ],
  },
  {
    ko: "식욕이 돌아오는 시기라 큰 근육인 하체를 써요.",
    en: "Appetite returns: work the big leg muscles.",
    items: [
      { move: "lunge", sets: 3, amount: 10 },
      { move: "glute_bridge", sets: 3, amount: 12 },
      { move: "plank", sets: 3, amount: 30 },
    ],
  },
];

export type ExerciseDay = { date: string; done: Partial<Record<Move, number>> };

const KEY = "glpfit.exercise.v1";

function defaultStore(): RunStore | null {
  try {
    if (typeof globalThis.localStorage !== "undefined")
      return globalThis.localStorage;
  } catch {
    return null;
  }
  return null;
}

export function loadExercise(store = defaultStore()): ExerciseDay[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? (parsed as ExerciseDay[]).filter((d) => typeof d?.date === "string")
      : [];
  } catch {
    return [];
  }
}

export function setSets(
  date: string,
  move: Move,
  sets: number,
  store = defaultStore(),
): ExerciseDay[] {
  const days = loadExercise(store);
  const current = days.find((d) => d.date === date) ?? { date, done: {} };
  const next = [
    { date, done: { ...current.done, [move]: Math.max(0, sets) } },
    ...days.filter((d) => d.date !== date),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 120);
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Keep in memory only.
  }
  return next;
}

export function clearExercise(store = defaultStore()) {
  try {
    store?.removeItem(KEY);
  } catch {
    // Ignore storage errors on clear.
  }
}

export function setsOn(days: ExerciseDay[], date: string): number {
  const day = days.find((d) => d.date === date);
  return day
    ? Object.values(day.done).reduce((sum, n) => sum + (n ?? 0), 0)
    : 0;
}

/** Days with any exercise in the last 7 days, oldest first. */
export function weekActivity(days: ExerciseDay[], now = Date.now()) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = dayKey(now - (6 - i) * 86_400_000);
    return { date, sets: setsOn(days, date) };
  });
}

/** One line per day for the coach, e.g. "스쿼트 3세트, 플랭크 2세트". */
export function exerciseNote(day: ExerciseDay): string {
  return Object.entries(day.done)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([move, n]) => `${MOVES[move as Move].ko} ${n}세트`)
    .join(", ");
}
