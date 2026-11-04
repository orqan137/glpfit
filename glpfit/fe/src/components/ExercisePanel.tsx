import { Check, Dumbbell } from "lucide-react";
import { useTr } from "../i18n";
import {
  MOVES,
  ROUTINES,
  weekActivity,
  type ExerciseDay,
  type Move,
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
  onSets: (move: Move, sets: number) => void;
};

export function ExercisePanel({
  days,
  date,
  phaseIndex,
  phaseName,
  proteinG,
  proteinGoal,
  onSets,
}: ExercisePanelProps) {
  const { lang, tr } = useTr();
  const routine = ROUTINES[phaseIndex] ?? ROUTINES[1];
  const done = days.find((d) => d.date === date)?.done ?? {};
  const total = routine.items.reduce((sum, item) => sum + item.sets, 0);
  const completed = routine.items.reduce(
    (sum, item) => sum + Math.min(item.sets, done[item.move] ?? 0),
    0,
  );
  const week = weekActivity(days);
  const activeDays = week.filter((d) => d.sets > 0).length;
  const weekdays = lang === "ko" ? WEEKDAY_LABEL : WEEKDAY_LABEL_EN;

  return (
    <section className="exercise" aria-labelledby="exercise-title">
      <div className="page-head">
        <h1 id="exercise-title">{tr("맨몸운동", "Bodyweight")}</h1>
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
              {tr("오늘의 루틴", "Today's routine")}
              {phaseName && <small>{phaseName}</small>}
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
          {routine.items.map((item) => {
            const info = MOVES[item.move];
            const count = done[item.move] ?? 0;
            const unit =
              info.unit === "reps"
                ? tr("회", " reps")
                : info.unit === "sec"
                  ? tr("초", "s")
                  : tr("분", " min");
            return (
              <li key={item.move}>
                <div className="move-text">
                  <strong>{lang === "ko" ? info.ko : info.en}</strong>
                  <span>
                    {item.sets > 1 ? `${item.sets} × ` : ""}
                    {item.amount}
                    {unit}
                  </span>
                  <small>{lang === "ko" ? info.howKo : info.howEn}</small>
                </div>
                <div
                  className="set-dots"
                  role="group"
                  aria-label={tr("완료한 세트", "Sets done")}
                >
                  {Array.from({ length: item.sets }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={i < count ? "on" : ""}
                      aria-pressed={i < count}
                      aria-label={tr(`${i + 1}세트`, `Set ${i + 1}`)}
                      onClick={() => onSets(item.move, i < count ? i : i + 1)}
                    >
                      {i < count ? <Check size={16} strokeWidth={3} /> : i + 1}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card week-activity">
        <div className="memory-head">
          <span className="card-title">{tr("이번 주", "This week")}</span>
          <span className="meal-optional">
            {tr(`${activeDays}일 운동`, `${activeDays} active days`)}
          </span>
        </div>
        <div className="activity-strip">
          {week.map((d) => (
            <div
              key={d.date}
              className={`activity-day${d.sets ? " on" : ""}${d.date === date ? " today" : ""}`}
            >
              <span>{d.sets || ""}</span>
              <small>{weekdays[new Date(`${d.date}T00:00:00`).getDay()]}</small>
            </div>
          ))}
        </div>
        <p className="field-hint">
          {tr(
            `오늘 단백질 ${Math.round(proteinG)}g / ${proteinGoal}g. 운동한 날은 단백질을 꼭 채워 주세요.`,
            `Protein today ${Math.round(proteinG)}g / ${proteinGoal}g. Hit your protein on workout days.`,
          )}
        </p>
      </div>
    </section>
  );
}
