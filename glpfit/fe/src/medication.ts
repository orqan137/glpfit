import type { RunStore } from "./history";

export type Drug = "mounjaro" | "wegovy" | "other";
export type Site =
  | "abdomen_left"
  | "abdomen_right"
  | "thigh_left"
  | "thigh_right"
  | "arm_left"
  | "arm_right";

export type Injection = {
  id: string;
  date: string;
  drug: Drug;
  doseMg: number;
  site: Site | null;
};

/** Public label reference. The prescriber's plan always wins. */
export const DRUG_INFO: Record<
  Drug,
  { name: string; ingredient: string; ladder: number[] }
> = {
  mounjaro: {
    name: "마운자로",
    ingredient: "티르제파타이드 · GIP/GLP-1 이중 작용",
    ladder: [2.5, 5, 7.5, 10, 12.5, 15],
  },
  wegovy: {
    name: "위고비",
    ingredient: "세마글루타이드 · GLP-1 작용",
    ladder: [0.25, 0.5, 1, 1.7, 2.4],
  },
  other: { name: "기타 주 1회 주사", ingredient: "", ladder: [] },
};

export const SITE_LABEL: Record<Site, string> = {
  abdomen_left: "배 왼쪽",
  abdomen_right: "배 오른쪽",
  thigh_left: "왼 허벅지",
  thigh_right: "오른 허벅지",
  arm_left: "왼팔",
  arm_right: "오른팔",
};
const SITE_ORDER = Object.keys(SITE_LABEL) as Site[];

export type Phase = {
  name: string;
  focus: string;
  coach: string;
};

/** Patterns many people report across a weekly shot. Hints, not medical facts. */
export const PHASES: (Phase & { days: [number, number] })[] = [
  {
    days: [0, 1],
    name: "주사 직후",
    focus: "식욕이 가장 줄고 메스꺼움이 오기 쉬워요",
    coach: "소량·담백하게, 단백질 먼저, 물은 조금씩 자주",
  },
  {
    days: [2, 4],
    name: "안정기",
    focus: "몸이 적응해 컨디션이 고른 시기예요",
    coach: "규칙적인 세 끼와 가벼운 근력 운동으로 근육 지키기",
  },
  {
    days: [5, 7],
    name: "다음 주사 전",
    focus: "식욕이 돌아오고 간식이 당기기 쉬워요",
    coach: "간식을 미리 정해 두고 천천히 먹기",
  },
];

const KEY = "glpfit.injections.v1";
const DAY_MS = 86_400_000;

function defaultStore(): RunStore | null {
  try {
    if (typeof globalThis.localStorage !== "undefined")
      return globalThis.localStorage;
  } catch {
    return null;
  }
  return null;
}

export function loadInjections(store = defaultStore()): Injection[] {
  try {
    const raw = store?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as Injection[]).filter(
          (shot) => typeof shot?.date === "string" && shot.doseMg > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function writeInjections(shots: Injection[], store: RunStore | null) {
  try {
    store?.setItem(KEY, JSON.stringify(shots));
  } catch {
    // Keep in memory only when storage is unavailable.
  }
}

export function addInjection(
  shot: Omit<Injection, "id">,
  store = defaultStore(),
): Injection[] {
  const next = [
    { ...shot, id: `shot-${Date.now()}` },
    ...loadInjections(store),
  ].sort((a, b) => b.date.localeCompare(a.date));
  writeInjections(next.slice(0, 120), store);
  return next.slice(0, 120);
}

export function deleteInjection(
  id: string,
  store = defaultStore(),
): Injection[] {
  const next = loadInjections(store).filter((shot) => shot.id !== id);
  writeInjections(next, store);
  return next;
}

export function clearInjections(store = defaultStore()) {
  try {
    store?.removeItem(KEY);
  } catch {
    // Ignore storage errors on clear.
  }
}

function parseDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export type Schedule = {
  last: Injection | null;
  daysSince: number | null;
  /** 1 on shot day. */
  cycleDay: number | null;
  phase: Phase | null;
  nextDue: number | null;
  daysUntil: number | null;
  overdue: number;
  nextSite: Site | null;
  weeksOnDose: number;
  ladder: number[];
  stepIndex: number;
};

export function computeSchedule(
  shots: Injection[],
  fallback: {
    drug: Drug | null;
    doseMg: number | null;
    weekday: number | null;
  },
  now = Date.now(),
): Schedule {
  const sorted = [...shots].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const today = startOfDay(now);
  const drug = last?.drug ?? fallback.drug;
  const dose = last?.doseMg ?? fallback.doseMg;
  const ladder = drug ? DRUG_INFO[drug].ladder : [];
  let weeksOnDose = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].doseMg !== dose) break;
    weeksOnDose++;
  }
  const base = {
    last,
    weeksOnDose,
    ladder,
    stepIndex: dose !== null ? ladder.indexOf(dose) : -1,
  };
  if (!last) {
    let nextDue: number | null = null;
    if (fallback.weekday !== null) {
      const ahead = (fallback.weekday - new Date(today).getDay() + 7) % 7;
      nextDue = today + ahead * DAY_MS;
    }
    return {
      ...base,
      daysSince: null,
      cycleDay: null,
      phase: null,
      nextDue,
      daysUntil:
        nextDue === null ? null : Math.round((nextDue - today) / DAY_MS),
      overdue: 0,
      nextSite: null,
    };
  }
  const lastDay = parseDay(last.date);
  const daysSince = Math.round((today - lastDay) / DAY_MS);
  const nextDue = lastDay + 7 * DAY_MS;
  const phase =
    PHASES.find(
      ({ days }) =>
        Math.min(daysSince, 7) >= days[0] && Math.min(daysSince, 7) <= days[1],
    ) ?? PHASES[2];
  return {
    ...base,
    daysSince,
    cycleDay: daysSince + 1,
    phase,
    nextDue,
    daysUntil: Math.round((nextDue - today) / DAY_MS),
    overdue: Math.max(0, daysSince - 7),
    nextSite: last.site
      ? SITE_ORDER[(SITE_ORDER.indexOf(last.site) + 1) % SITE_ORDER.length]
      : null,
  };
}

/** For the coach: drop UI ids. */
export function injectionsForContext(shots: Injection[]) {
  return [...shots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60)
    .map(({ date, drug, doseMg, site }) => ({ date, drug, doseMg, site }));
}

export const DRUG_NAME_EN: Record<Drug, string> = {
  mounjaro: "Mounjaro",
  wegovy: "Wegovy",
  other: "Other weekly shot",
};
export const DRUG_INGREDIENT_EN: Record<Drug, string> = {
  mounjaro: "tirzepatide, dual GIP/GLP-1 agonist",
  wegovy: "semaglutide, GLP-1 agonist",
  other: "",
};
export const SITE_LABEL_EN: Record<Site, string> = {
  abdomen_left: "Left belly",
  abdomen_right: "Right belly",
  thigh_left: "Left thigh",
  thigh_right: "Right thigh",
  arm_left: "Left arm",
  arm_right: "Right arm",
};
export const PHASES_EN: Phase[] = [
  {
    name: "Right after the shot",
    focus: "Appetite is lowest and nausea is common",
    coach: "Small, plain meals, protein first, sip water often",
  },
  {
    name: "Steady days",
    focus: "Your body has adjusted and energy is even",
    coach: "Three regular meals and light strength work to keep muscle",
  },
  {
    name: "Before the next shot",
    focus: "Appetite returns and snacks get tempting",
    coach: "Plan snacks ahead and eat slowly",
  },
];

/** The phase text in the chosen language. */
export function phaseText(phase: Phase, lang: "ko" | "en"): Phase {
  if (lang === "ko") return phase;
  const index = PHASES.findIndex((p) => p.name === phase.name);
  return PHASES_EN[index] ?? phase;
}

/**
 * Relative drug level from the label half-life (one-compartment, first-order
 * absorption). A picture of the weekly cycle, not a measured blood level.
 */
export const PK: Record<Drug, { halfLifeDays: number; absorbPerDay: number }> =
  {
    mounjaro: { halfLifeDays: 5, absorbPerDay: 1.4 },
    wegovy: { halfLifeDays: 7, absorbPerDay: 0.9 },
    other: { halfLifeDays: 6, absorbPerDay: 1.0 },
  };

export type LevelPoint = { day: number; level: number; projected: boolean };

/** Level for each day from `pastDays` ago to `futureDays` ahead, 0..100 of the window peak. */
export function levelCurve(
  shots: Injection[],
  drug: Drug | null,
  pastDays = 21,
  futureDays = 7,
  now = Date.now(),
  stepsPerDay = 4,
): LevelPoint[] {
  const pk = PK[drug ?? shots.at(-1)?.drug ?? "mounjaro"];
  const ke = Math.LN2 / pk.halfLifeDays;
  const ka = pk.absorbPerDay;
  const today = startOfDay(now);
  const doses = shots.map((s) => ({
    t: (parseDay(s.date) - today) / DAY_MS,
    mg: s.doseMg,
  }));
  const raw: { day: number; value: number }[] = [];
  for (let i = -pastDays * stepsPerDay; i <= futureDays * stepsPerDay; i++) {
    const day = i / stepsPerDay;
    let value = 0;
    for (const dose of doses) {
      const dt = day - dose.t;
      if (dt > 0)
        value +=
          (dose.mg * ka * (Math.exp(-ke * dt) - Math.exp(-ka * dt))) /
          (ka - ke);
    }
    raw.push({ day, value });
  }
  const peak = Math.max(1e-9, ...raw.map((p) => p.value));
  return raw.map(({ day, value }) => ({
    day,
    level: Math.round((value / peak) * 1000) / 10,
    projected: day > 0,
  }));
}

/** A prescription supply, e.g. four weekly pens picked up at once (common in Korea). */
export type Supply = { date: string; pens: number };

const SUPPLY_KEY = "glpfit.supply.v1";

export function loadSupply(store = defaultStore()): Supply | null {
  try {
    const parsed = JSON.parse(
      store?.getItem(SUPPLY_KEY) ?? "null",
    ) as Supply | null;
    return parsed && typeof parsed.date === "string" && parsed.pens > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveSupply(
  supply: Supply | null,
  store = defaultStore(),
): Supply | null {
  try {
    if (supply) store?.setItem(SUPPLY_KEY, JSON.stringify(supply));
    else store?.removeItem(SUPPLY_KEY);
  } catch {
    // Keep in memory only.
  }
  return supply;
}

export type SupplyStatus = { left: number; lastShot: number; visitBy: number };

/** Pens left since the pickup, and the last shot day the supply covers. */
export function supplyStatus(
  supply: Supply,
  shots: Injection[],
  schedule: Schedule,
): SupplyStatus {
  const used = shots.filter((s) => s.date >= supply.date).length;
  const left = Math.max(0, supply.pens - used);
  const next = schedule.nextDue ?? parseDay(supply.date);
  const lastShot =
    left > 0 ? next + (left - 1) * 7 * DAY_MS : next - 7 * DAY_MS;
  // Get the next prescription a few days before the last pen is used.
  return { left, lastShot, visitBy: lastShot - 3 * DAY_MS };
}
