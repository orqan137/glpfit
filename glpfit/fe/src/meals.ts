/**
 * Meals are photos. One photo before eating gives what was served; an optional
 * photo after eating turns it into what was actually eaten. Daily protein comes
 * from here, never from manual entry.
 */
import type { RunStore } from "./history";
import type { PlateResult } from "./multimodal";
import { dayKey } from "./profile";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type Meal = {
  id: string;
  date: string;
  at: number;
  slot: MealSlot;
  /** Small preview kept for the list. */
  thumb: string;
  /** The analyzed before photo, kept until the after photo arrives. */
  image: string | null;
  afterThumb: string | null;
  result: PlateResult;
  /** "served": only the before photo; "eaten": before and after compared. */
  status: "served" | "eaten";
};

export const SLOT_LABEL: Record<MealSlot, { ko: string; en: string }> = {
  breakfast: { ko: "아침", en: "Breakfast" },
  lunch: { ko: "점심", en: "Lunch" },
  dinner: { ko: "저녁", en: "Dinner" },
  snack: { ko: "간식", en: "Snack" },
};

const KEY = "glpfit.meals.v1";
const MAX_MEALS = 60;

function defaultStore(): RunStore | null {
  try {
    if (typeof globalThis.localStorage !== "undefined")
      return globalThis.localStorage;
  } catch {
    return null;
  }
  return null;
}

export function slotFor(at: number): MealSlot {
  const hour = new Date(at).getHours();
  if (hour >= 5 && hour < 10) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 21) return "dinner";
  return "snack";
}

export function loadMeals(store = defaultStore()): Meal[] {
  try {
    const raw = store?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as Meal[]).filter(
          (m) => typeof m?.date === "string" && !!m.result,
        )
      : [];
  } catch {
    return [];
  }
}

function write(meals: Meal[], store: RunStore | null): Meal[] {
  // Keep full images only while an after photo may still come (same day, not eaten).
  const today = dayKey();
  const trimmed = meals
    .slice(0, MAX_MEALS)
    .map((meal) =>
      meal.status === "eaten" || meal.date !== today
        ? { ...meal, image: null }
        : meal,
    );
  try {
    store?.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota: drop images first, keep the records.
    try {
      store?.setItem(
        KEY,
        JSON.stringify(trimmed.map((m) => ({ ...m, image: null }))),
      );
    } catch {
      // Keep in memory only.
    }
  }
  return meals;
}

export function saveMeal(meal: Meal, store = defaultStore()): Meal[] {
  const rest = loadMeals(store).filter((m) => m.id !== meal.id);
  return write(
    [meal, ...rest].sort((a, b) => b.at - a.at),
    store,
  );
}

export function deleteMeal(id: string, store = defaultStore()): Meal[] {
  return write(
    loadMeals(store).filter((m) => m.id !== id),
    store,
  );
}

export function clearMeals(store = defaultStore()) {
  try {
    store?.removeItem(KEY);
  } catch {
    // Ignore storage errors on clear.
  }
}

/** Protein credited for a meal: eaten if compared, otherwise what was served. */
export function mealProtein(meal: Meal): number {
  const totals = meal.result.totals;
  return meal.status === "eaten"
    ? (totals.protein_eaten_g ?? totals.protein_g)
    : totals.protein_g;
}

export function mealKcal(meal: Meal): number {
  const totals = meal.result.totals;
  return meal.status === "eaten"
    ? (totals.kcal_eaten ?? totals.kcal)
    : totals.kcal;
}

export type DayIntake = {
  proteinG: number;
  kcal: number;
  meals: number;
  provisional: boolean;
};

export function intakeOn(meals: Meal[], date: string): DayIntake {
  const day = meals.filter((m) => m.date === date);
  return {
    proteinG:
      Math.round(day.reduce((sum, m) => sum + mealProtein(m), 0) * 10) / 10,
    kcal: Math.round(day.reduce((sum, m) => sum + mealKcal(m), 0)),
    meals: day.length,
    provisional: day.some((m) => m.status === "served"),
  };
}

/** One line per meal for the coach, e.g. "점심: 닭가슴살 68%, 단백질 23g". */
export function mealNote(meal: Meal): string {
  const slot = SLOT_LABEL[meal.slot].ko;
  if (meal.status === "eaten" && meal.result.log_note)
    return `${slot} ${meal.result.log_note}`;
  const names = meal.result.items.map((i) => i.name).join(", ");
  return `${slot} 식판 렌즈(식전만): ${names}, 단백질 약 ${meal.result.totals.protein_g}g 제공`;
}

/** Common guidance while losing weight on GLP-1: about 1.0-1.2 g protein per kg. */
export function proteinGoal(weightKg: number | null): number {
  return weightKg ? Math.round(weightKg * 1.0) : 60;
}

export function newMealId(): string {
  return `meal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function todayKey(): string {
  return dayKey();
}
