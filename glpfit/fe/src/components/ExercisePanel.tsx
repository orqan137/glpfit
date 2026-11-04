import { useState } from "react";
import { Check, Dumbbell, Plus, X } from "lucide-react";
import { useTr } from "../i18n";
import {
  MOVES,
  ROUTINES,
  weekActivity,
  type CustomMove,
  type ExerciseDay,
  type MoveInfo,
} from "../exercise";
import { WEEKDAY_LABEL, WEEKDAY_LABEL_EN } from "../profile";

type ExercisePanelProps = {
  days: ExerciseDay[];
  date: string;
  /** 0 right after the shot, 1 steady, 2 before the next shot. */
  phaseIndex: number;
  phaseName: string | null;
  proteinG: number;
  proteinGoal: number;
  customMoves: CustomMove[];
  onSets: (move: string, sets: number, name?: string) => void;
  onAddCustom: (move: Omit<CustomMove, "id">) => void;
  onRemoveCustom: (id: string) => void;
};

type Row = {
  key: string;
  name: string;
  how?: string;
  sets: number;
  amount: number;
  unit: MoveInfo["unit"];
  custom?: boolean;
};

export function ExercisePanel(props: ExercisePanelProps) {
  const { lang, tr } = useTr();
  const routine = ROUTINES[props.phaseIndex] ?? ROUTINES[1];
  const done = props.days.find((d) => d.date === props.date)?.done ?? {};
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("10");
  const [sets, setSets] = useState("3");
  const [unit, setUnit] = useState<MoveInfo["unit"]>("reps");

  const unitLabel = (u: MoveInfo["unit"]) =>
    u === "reps"
      ? tr("회", " reps")
      : u === "sec"
        ? tr("초", "s")
        : tr("분", " min");

  const rows: Row[] = [
    ...routine.items.map((item) => ({
      key: item.move,
      name: lang === "ko" ? MOVES[item.move].ko : MOVES[item.move].en,
      how: lang === "ko" ? MOVES[item.move].howKo : MOVES[item.move].howEn,
      sets: item.sets,
      amount: item.amount,
      unit: MOVES[item.move].unit,
    })),
    ...props.customMoves.map((m) => ({
      key: m.id,
      name: m.name,
      sets: m.sets,
      amount: m.amount,
      unit: m.unit,
      custom: true,
    })),
  ];
  const total = rows.reduce((sum, r) => sum + r.sets, 0);
  const completed = rows.reduce(
    (sum, r) => sum + Math.min(r.sets, done[r.key] ?? 0),
    0,
  );
  const week = weekActivity(props.days);
  const weekdays = lang === "ko" ? WEEKDAY_LABEL : WEEKDAY_LABEL_EN;

  function add() {
    const reps = Number.parseInt(amount, 10);
    const count = Number.parseInt(sets, 10);
    if (!name.trim() || !(reps > 0) || !(count > 0)) return;
    props.onAddCustom({ name, amount: reps, sets: count, unit });
    setName("");
  }

  return (
    <section className="exercise" aria-labelledby="exercise-title">
      <div className="page-head">
        <h1 id="exercise-title">{tr("운동", "Exercise")}</h1>
        <p>
          {tr(
            "체중이 빠질 때 근육도 함께 빠지기 쉬워요. 단백질과 근력 운동으로 지켜요.",
            "Weight loss can take muscle with it. Protein plus strength work keeps it.",
          )}
        </p>
      </div>

      <div className="card routine-card">
        <div className="routine-head">
          <span className="data-icon">
            <Dumbbell size={18} />
          </span>
          <div>
            <strong>
              {tr("오늘의 운동", "Today")}
              {props.phaseName && <small>{props.phaseName}</small>}
            </strong>
            <span>{lang === "ko" ? routine.ko : routine.en}</span>
          </div>
          <span
            className={`routine-progress${completed >= total ? " done" : ""}`}
          >
            {completed}/{total}
          </span>
        </div>
        <ul className="routine-list">
          {rows.map((row) => {
            const count = done[row.key] ?? 0;
            return (
              <li key={row.key}>
                <div className="move-text">
                  <strong>{row.name}</strong>
                  <span>
                    {row.sets > 1 ? `${row.sets} × ` : ""}
                    {row.amount}
                    {unitLabel(row.unit)}
                  </span>
                  {row.how && <small>{row.how}</small>}
                </div>
                <div
                  className="set-dots"
                  role="group"
                  aria-label={tr("완료한 세트", "Sets done")}
                >
                  {Array.from({ length: row.sets }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={i < count ? "on" : ""}
                      aria-pressed={i < count}
                      aria-label={tr(`${i + 1}세트`, `Set ${i + 1}`)}
                      onClick={() =>
                        props.onSets(
                          row.key,
                          i < count ? i : i + 1,
                          row.custom ? row.name : undefined,
                        )
                      }
                    >
                      {i < count ? <Check size={16} strokeWidth={3} /> : i + 1}
                    </button>
                  ))}
                </div>
                {row.custom && (
                  <button
                    type="button"
                    className="history-delete"
                    aria-label={tr("이 운동 지우기", "Remove this exercise")}
                    onClick={() => props.onRemoveCustom(row.key)}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <form
          className="custom-form"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            className="custom-name"
            value={name}
            maxLength={30}
            placeholder={tr(
              "내 운동 추가 (예: 계단 오르기)",
              "Add your own (e.g. stair climb)",
            )}
            aria-label={tr("운동 이름", "Exercise name")}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="custom-row">
            <input
              inputMode="numeric"
              value={amount}
              aria-label={tr("횟수 또는 시간", "Reps or time")}
              onChange={(event) => setAmount(event.target.value)}
            />
            <select
              value={unit}
              aria-label={tr("단위", "Unit")}
              onChange={(event) =>
                setUnit(event.target.value as MoveInfo["unit"])
              }
            >
              <option value="reps">{tr("회", "reps")}</option>
              <option value="sec">{tr("초", "sec")}</option>
              <option value="min">{tr("분", "min")}</option>
            </select>
            <span>×</span>
            <input
              inputMode="numeric"
              value={sets}
              aria-label={tr("세트", "Sets")}
              onChange={(event) => setSets(event.target.value)}
            />
            <span>{tr("세트", "sets")}</span>
            <button
              type="submit"
              className="custom-add"
              disabled={!name.trim()}
              aria-label={tr("추가", "Add")}
            >
              <Plus size={18} />
            </button>
          </div>
        </form>
      </div>

      <div className="card week-activity">
        <div className="memory-head">
          <span className="card-title">{tr("이번 주", "This week")}</span>
          <span className="meal-optional">
            {tr(
              `${week.filter((d) => d.sets > 0).length}일 운동`,
              `${week.filter((d) => d.sets > 0).length} active days`,
            )}
          </span>
        </div>
        <div className="activity-strip">
          {week.map((d) => (
            <div
              key={d.date}
              className={`activity-day${d.sets ? " on" : ""}${d.date === props.date ? " today" : ""}`}
            >
              <span>{d.sets || ""}</span>
              <small>{weekdays[new Date(`${d.date}T00:00:00`).getDay()]}</small>
            </div>
          ))}
        </div>
        <p className="field-hint">
          {tr(
            `오늘 단백질 ${Math.round(props.proteinG)}g / ${props.proteinGoal}g. 운동한 날은 단백질을 꼭 채워 주세요.`,
            `Protein today ${Math.round(props.proteinG)}g / ${props.proteinGoal}g. Hit your protein on workout days.`,
          )}
        </p>
      </div>
    </section>
  );
}
