import { ChevronRight, Syringe } from "lucide-react";
import { useTr } from "../i18n";
import {
  DRUG_INFO,
  DRUG_NAME_EN,
  levelCurve,
  phaseText,
  type Drug,
  type Injection,
  type Schedule,
} from "../medication";

type CycleCardProps = {
  schedule: Schedule;
  shots: Injection[];
  drug: Drug | null;
  onOpen: () => void;
};

const W = 320;
const H = 92;
const PAST = 14;
const FUTURE = 7;

/** Estimated relative drug level: past solid, projection dashed, today marked. */
export function LevelCurve({
  shots,
  drug,
  nextIn,
  showDoses = false,
}: {
  shots: Injection[];
  drug: Drug | null;
  nextIn: number | null;
  /** Label each shot with its dose, so one chart also shows the dose history. */
  showDoses?: boolean;
}) {
  const points = levelCurve(shots, drug, PAST, FUTURE);
  const x = (day: number) => ((day + PAST) / (PAST + FUTURE)) * W;
  const y = (level: number) => H - 6 - (level / 100) * (H - 14);
  const line = (part: typeof points) =>
    part
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.level).toFixed(1)}`,
      )
      .join(" ");
  const past = points.filter((p) => p.day <= 0);
  const future = points.filter((p) => p.day >= 0);
  const nowLevel = past.at(-1)?.level ?? 0;
  const area = `${line(past)} L${x(0)},${H} L${x(-PAST)},${H} Z`;
  const today = new Date().setHours(0, 0, 0, 0);
  const marks = shots
    .map((s) => {
      const [yy, mm, dd] = s.date.split("-").map(Number);
      return {
        day: Math.round(
          (new Date(yy, mm - 1, dd).getTime() - today) / 86_400_000,
        ),
        dose: s.doseMg,
      };
    })
    .filter((m) => m.day >= -PAST && m.day <= 0);
  const shotDays = marks.map((m) => m.day);
  const chart = (
    <svg
      className="level-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="level-area" d={area} />
      <path className="level-line" d={line(past)} />
      <path className="level-line projected" d={line(future)} />
      {shotDays.map((d) => (
        <g key={d}>
          <line className="level-shot" x1={x(d)} x2={x(d)} y1={0} y2={H} />
          <circle className="level-shot-dot" cx={x(d)} cy={H - 3} r={3} />
        </g>
      ))}
      {nextIn !== null && nextIn > 0 && nextIn <= FUTURE && (
        <line
          className="level-next"
          x1={x(nextIn)}
          x2={x(nextIn)}
          y1={0}
          y2={H}
        />
      )}
      <line className="level-today" x1={x(0)} x2={x(0)} y1={0} y2={H} />
      <circle className="level-now" cx={x(0)} cy={y(nowLevel)} r={5} />
    </svg>
  );
  if (!showDoses) return chart;
  // Text stays outside the stretched SVG so it is never distorted.
  return (
    <div className="level-wrap">
      {chart}
      {marks.map((m) => (
        <span
          key={m.day}
          className="level-dose"
          style={{ left: `${(x(m.day) / W) * 100}%` }}
        >
          {m.dose}mg
        </span>
      ))}
    </div>
  );
}

/** The weekly shot: day after the injection, estimated level curve and today's focus. */
export function CycleCard({ schedule, shots, drug, onOpen }: CycleCardProps) {
  const { lang, tr } = useTr();
  if (schedule.cycleDay === null || !schedule.phase) {
    return (
      <button className="card cycle-card cycle-empty" onClick={onOpen}>
        <span className="cycle-empty-icon">
          <Syringe size={22} />
        </span>
        <span className="sample-text">
          <strong>
            {tr("첫 주사를 기록해 주세요", "Log your first shot")}
          </strong>
          <span>
            {tr(
              "마운자로나 위고비 맞은 날을 기록하면 주사 주기에 맞춰 식사와 운동을 코칭해요.",
              "Log your Mounjaro or Wegovy shot and meals and exercise adapt to your weekly cycle.",
            )}
          </span>
        </span>
        <ChevronRight size={18} className="track-chevron" />
      </button>
    );
  }
  const phase = phaseText(schedule.phase, lang);
  const drugName = drug
    ? lang === "ko"
      ? DRUG_INFO[drug].name
      : DRUG_NAME_EN[drug]
    : tr("주사", "Shot");
  const due =
    schedule.overdue > 0
      ? tr(`예정일 ${schedule.overdue}일 지남`, `${schedule.overdue}d overdue`)
      : schedule.daysUntil === 0
        ? tr("오늘 주사일", "Shot day")
        : tr(
            `다음 주사 D-${schedule.daysUntil}`,
            `Next shot in ${schedule.daysUntil}d`,
          );
  return (
    <button className="card cycle-card" onClick={onOpen}>
      <div className="cycle-top">
        <div>
          <span className="cycle-eyebrow">
            {drugName} {schedule.last ? `${schedule.last.doseMg}mg` : ""}
          </span>
          <strong className="cycle-day">
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
                <small> after shot</small>
              </>
            )}
          </strong>
        </div>
        <span className={`cycle-due${schedule.overdue ? " overdue" : ""}`}>
          {due}
        </span>
      </div>
      <LevelCurve shots={shots} drug={drug} nextIn={schedule.daysUntil} />
      <div className="cycle-phase">
        <span className="cycle-phase-name">{phase.name}</span>
        <p>
          {phase.focus}. <b>{phase.coach}</b>
        </p>
      </div>
      <span className="cycle-note">
        {tr(
          "곡선은 설명서의 반감기로 계산한 추정치예요. 실제 혈중 농도를 잰 값이 아니에요.",
          "Curve estimated from the label half-life, not a measured blood level.",
        )}
      </span>
    </button>
  );
}
