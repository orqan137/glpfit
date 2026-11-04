import { useState } from "react";
import type { Injection } from "../medication";
import type { DailyLog, Profile } from "../profile";

type Range = 30 | 90;

type WeightChartProps = {
  profile: Profile | null;
  logs: DailyLog[];
  shots: Injection[];
  tr: (ko: string, en: string) => string;
  now?: number;
};

const W = 340;
const H = 170;
const PAD = { top: 14, right: 12, bottom: 24, left: 34 };
const DAY = 86_400_000;

function toTime(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Weight over time with the target line and a marker for each injection (dose labeled). */
export function WeightChart({
  profile,
  logs,
  shots,
  tr,
  now = Date.now(),
}: WeightChartProps) {
  const [range, setRange] = useState<Range>(30);
  const end = new Date(now).setHours(0, 0, 0, 0);
  const start = end - (range - 1) * DAY;
  const points = logs
    .filter((log) => log.weightKg !== null)
    .map((log) => ({
      t: toTime(log.date),
      kg: log.weightKg as number,
      date: log.date,
    }))
    .filter((p) => p.t >= start && p.t <= end)
    .sort((a, b) => a.t - b.t);
  const marks = shots
    .map((s) => ({ t: toTime(s.date), dose: s.doseMg }))
    .filter((s) => s.t >= start && s.t <= end);

  const target = profile?.targetWeightKg ?? null;
  const values = [...points.map((p) => p.kg), ...(target ? [target] : [])];
  const min = values.length ? Math.floor(Math.min(...values) - 1) : 60;
  const max = values.length ? Math.ceil(Math.max(...values) + 1) : 80;
  const x = (t: number) =>
    PAD.left +
    ((t - start) / Math.max(DAY, end - start)) * (W - PAD.left - PAD.right);
  const y = (kg: number) =>
    PAD.top +
    (1 - (kg - min) / Math.max(1, max - min)) * (H - PAD.top - PAD.bottom);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.kg).toFixed(1)}`)
    .join(" ");
  const area =
    points.length > 1
      ? `${path} L${x(points[points.length - 1].t).toFixed(1)},${H - PAD.bottom} L${x(points[0].t).toFixed(1)},${H - PAD.bottom} Z`
      : "";
  const ticks = [min, Math.round((min + max) / 2), max];
  const first = points[0];
  const last = points[points.length - 1];
  const change =
    first && last && first !== last
      ? Math.round((last.kg - first.kg) * 10) / 10
      : null;
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover !== null ? points[hover] : last;

  return (
    <section className="card chart-card" aria-labelledby="chart-title">
      <div className="chart-head">
        <div>
          <h2 id="chart-title" className="card-title">
            {tr("체중 변화", "Weight trend")}
          </h2>
          <span className="chart-sub">
            {shown
              ? `${shown.kg}kg${hover !== null ? ` (${shown.date.slice(5).replace("-", "/")})` : ""}`
              : tr(
                  "체크인에서 체중을 기록해 보세요",
                  "Log your weight in today's check-in",
                )}
            {change !== null && hover === null && (
              <b className={change <= 0 ? "down" : "up"}>
                {" "}
                {change > 0 ? "+" : ""}
                {change}kg
              </b>
            )}
          </span>
        </div>
        <div className="segment small">
          {([30, 90] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={range === r ? "selected" : ""}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r === 30 ? tr("1개월", "1M") : tr("3개월", "3M")}
            </button>
          ))}
        </div>
      </div>
      <svg
        className="weight-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={tr(
          `최근 ${range}일 체중 그래프, 기록 ${points.length}회`,
          `Weight over the last ${range} days, ${points.length} entries`,
        )}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="grid"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className="axis"
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        ))}
        {target && (
          <g>
            <line
              className="target"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(target)}
              y2={y(target)}
            />
            <text
              className="target-label"
              x={W - PAD.right}
              y={y(target) - 4}
              textAnchor="end"
            >
              {tr("목표", "Goal")} {target}kg
            </text>
          </g>
        )}
        {marks.map((m) => (
          <g key={m.t}>
            <line
              className="shot"
              x1={x(m.t)}
              x2={x(m.t)}
              y1={PAD.top}
              y2={H - PAD.bottom}
            />
            <text
              className="shot-label"
              x={x(m.t)}
              y={H - PAD.bottom + 14}
              textAnchor="middle"
            >
              {m.dose}
            </text>
          </g>
        ))}
        {area && <path className="area" d={area} />}
        {path && <path className="line" d={path} />}
        {points.map((p, i) => (
          <circle
            key={p.date}
            className={
              i === hover || (hover === null && p === last) ? "dot on" : "dot"
            }
            cx={x(p.t)}
            cy={y(p.kg)}
            r={i === hover || (hover === null && p === last) ? 4.5 : 2.5}
            onPointerEnter={() => setHover(i)}
          />
        ))}
      </svg>
      <p className="chart-legend">
        <span className="legend-shot" />
        {tr("주사한 날 (숫자는 mg)", "Injection days (mg)")}
        {target && (
          <>
            <span className="legend-target" />
            {tr("목표 체중", "Goal weight")}
          </>
        )}
      </p>
    </section>
  );
}
