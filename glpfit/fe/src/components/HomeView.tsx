import { useEffect, useState, type ReactNode } from "react";
import {
  Camera,
  ChevronRight,
  Dumbbell,
  Scale,
  Syringe,
  Utensils,
} from "lucide-react";
import { useTr } from "../i18n";
import {
  DRUG_INFO,
  DRUG_NAME_EN,
  phaseText,
  type Injection,
  type Schedule,
} from "../medication";
import type { Profile, WeightSummary } from "../profile";
import { LevelCurve } from "./CycleCard";

type Tab = "dose" | "meals" | "exercise";

type HomeViewProps = {
  profile: Profile | null;
  weight: WeightSummary;
  todayWeight: number | null;
  schedule: Schedule;
  shots: Injection[];
  protein: number;
  proteinGoal: number;
  meals: number;
  sets: number;
  routineSets: number;
  routineName: string;
  pensLeft: number | null;
  onWeight: (kg: number | null) => void;
  onOpen: (tab: Tab) => void;
};

/** One shape for every core card: label, one big number, one line, one picture. */
function Core({
  kind,
  icon,
  label,
  onOpen,
  children,
}: {
  kind: string;
  icon: ReactNode;
  label: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`card core-card core-${kind}`}>
      <button
        type="button"
        className="core-head"
        onClick={onOpen}
        disabled={!onOpen}
      >
        <span className="core-icon">{icon}</span>
        <span className="core-label">{label}</span>
        {onOpen && <ChevronRight size={18} className="core-chevron" />}
      </button>
      {children}
    </section>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span
      className="core-bar"
      role="img"
      aria-label={`${Math.round(value)}/${max}`}
    >
      <span
        style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }}
      />
    </span>
  );
}

function Sparkline({ points }: { points: WeightSummary["points"] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.kg);
  const min = Math.min(...values);
  const span = Math.max(0.5, Math.max(...values) - min);
  const d = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${((i / (points.length - 1)) * 100).toFixed(1)},${(30 - ((p.kg - min) / span) * 26).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="core-spark"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function HomeView(props: HomeViewProps) {
  const { lang, tr } = useTr();
  const { profile, weight, schedule } = props;
  const [text, setText] = useState(props.todayWeight?.toString() ?? "");
  useEffect(
    () => setText(props.todayWeight?.toString() ?? ""),
    [props.todayWeight],
  );

  function commit() {
    const kg = Number.parseFloat(text.replace(",", "."));
    if (!text.trim()) return props.onWeight(null);
    if (Number.isFinite(kg) && kg >= 25 && kg <= 350) {
      const rounded = Math.round(kg * 10) / 10;
      setText(String(rounded));
      if (rounded !== props.todayWeight) props.onWeight(rounded);
    } else setText(props.todayWeight?.toString() ?? "");
  }

  const phase = schedule.phase ? phaseText(schedule.phase, lang) : null;
  const drug = profile?.drug;
  const drugName = drug
    ? lang === "ko"
      ? DRUG_INFO[drug].name
      : DRUG_NAME_EN[drug]
    : tr("투약", "Shot");
  const due =
    schedule.daysUntil === null
      ? ""
      : schedule.overdue > 0
        ? tr(
            `예정일 ${schedule.overdue}일 지남`,
            `${schedule.overdue}d overdue`,
          )
        : schedule.daysUntil === 0
          ? tr("오늘 주사일", "shot day")
          : tr(
              `다음 주사 D-${schedule.daysUntil}`,
              `next shot in ${schedule.daysUntil}d`,
            );

  return (
    <div className="core-list">
      <Core
        kind="weight"
        icon={<Scale size={18} />}
        label={tr("체중", "Weight")}
      >
        <label className="core-main core-input">
          <input
            inputMode="decimal"
            value={text}
            placeholder={weight.latest?.toString() ?? "--"}
            aria-label={tr("오늘 체중 (kg)", "Today's weight (kg)")}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) =>
              event.key === "Enter" && event.currentTarget.blur()
            }
          />
          <small>kg</small>
        </label>
        <p className="core-sub">
          {weight.sinceStart !== null
            ? tr(
                `시작 대비 ${weight.sinceStart > 0 ? "+" : ""}${weight.sinceStart}kg`,
                `${weight.sinceStart > 0 ? "+" : ""}${weight.sinceStart}kg since start`,
              )
            : tr("오늘 체중을 적어 주세요", "Enter today's weight")}
          {weight.toTarget !== null &&
            weight.toTarget > 0 &&
            tr(
              `, 목표까지 ${weight.toTarget}kg`,
              `, ${weight.toTarget}kg to goal`,
            )}
        </p>
        <Sparkline points={weight.points} />
      </Core>

      <Core
        kind="dose"
        icon={<Syringe size={18} />}
        label={`${drugName}${schedule.last ? ` ${schedule.last.doseMg}mg` : ""}`}
        onOpen={() => props.onOpen("dose")}
      >
        {schedule.cycleDay !== null ? (
          <>
            <p className="core-main">
              {lang === "ko" ? (
                <>
                  <small>주사 후 </small>
                  {schedule.cycleDay}
                  <small>일째</small>
                </>
              ) : (
                <>
                  <small>Day </small>
                  {schedule.cycleDay}
                </>
              )}
            </p>
            <p className="core-sub">
              {phase?.name}
              {due && `, ${due}`}
              {props.pensLeft !== null &&
                tr(
                  `, 펜 ${props.pensLeft}개 남음`,
                  `, ${props.pensLeft} pens left`,
                )}
            </p>
            <LevelCurve
              shots={props.shots}
              drug={drug ?? null}
              nextIn={schedule.daysUntil}
            />
            {phase && <p className="core-tip">{phase.coach}</p>}
          </>
        ) : (
          <p className="core-sub">
            {tr(
              "첫 주사를 기록하면 주기 코칭이 시작돼요",
              "Log your first shot to start cycle coaching",
            )}
          </p>
        )}
      </Core>

      <Core
        kind="meals"
        icon={<Utensils size={18} />}
        label={tr("식사", "Meals")}
        onOpen={() => props.onOpen("meals")}
      >
        <p className="core-main">
          {Math.round(props.protein)}
          <small>
            / {props.proteinGoal}g {tr("단백질", "protein")}
          </small>
        </p>
        <Bar value={props.protein} max={props.proteinGoal} />
        <p className="core-sub core-cta">
          <Camera size={15} />
          {props.meals
            ? tr(
                `${props.meals}끼 기록, 사진으로 추가`,
                `${props.meals} meals, add a photo`,
              )
            : tr(
                "식사 사진을 찍으면 자동으로 채워져요",
                "Snap a meal and it fills itself",
              )}
        </p>
      </Core>

      <Core
        kind="move"
        icon={<Dumbbell size={18} />}
        label={tr("운동", "Exercise")}
        onOpen={() => props.onOpen("exercise")}
      >
        <p className="core-main">
          {Math.min(props.sets, props.routineSets)}
          <small>
            / {props.routineSets} {tr("세트", "sets")}
          </small>
        </p>
        <Bar value={props.sets} max={props.routineSets} />
        <p className="core-sub">{props.routineName}</p>
      </Core>
    </div>
  );
}
