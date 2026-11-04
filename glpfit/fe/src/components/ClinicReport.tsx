import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, Printer } from "lucide-react";
import { useTr } from "../i18n";
import type { CoachContext } from "../profile";

type ReportFacts = {
  period: { from: string; to: string };
  dose_history: {
    drug: string;
    dose_mg: number;
    from: string;
    shots: number;
  }[];
  symptoms_by_cycle_day: {
    cycle_day: number;
    phase: string;
    logged_days: number;
    symptoms: Record<string, number>;
  }[];
  progress: {
    logged_days: number;
    weight?: { change_kg: number; since_start_kg?: number };
    avg_protein_g_measured?: number;
  };
};

type Report = {
  headline: string;
  weight: string;
  medication: string;
  intake: string;
  side_effects: string;
  questions_for_clinician: string[];
};

type ClinicReportProps = {
  context: CoachContext;
  nickname: string;
  /** Build immediately and open the print dialog (Save as PDF) when ready. */
  autoPrint?: boolean;
};

export function ClinicReport({
  context,
  nickname,
  autoPrint = false,
}: ClinicReportProps) {
  const { lang, tr } = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [facts, setFacts] = useState<ReportFacts | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const started = useRef(false);

  async function build() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, lang }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body?.detail === "string"
            ? body.detail
            : tr("리포트를 만들지 못했어요.", "Could not build the report."),
        );
      setFacts(body.facts);
      setReport(body.report);
      if (autoPrint) setTimeout(() => window.print(), 400);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("리포트를 만들지 못했어요.", "Could not build the report."),
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoPrint && !started.current) {
      started.current = true;
      void build();
    }
    // Build once when opened in auto mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weight = facts?.progress.weight;
  const change = weight ? (weight.since_start_kg ?? weight.change_kg) : null;

  return (
    <div className="clinic-report">
      {!autoPrint && (
        <button
          className="run-button"
          disabled={busy}
          onClick={() => void build()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <FileText size={18} />
          )}
          {busy
            ? tr("리포트 작성 중", "Writing report")
            : facts
              ? tr("다시 만들기", "Rebuild")
              : tr("리포트 만들기", "Build report")}
        </button>
      )}
      {autoPrint && busy && (
        <p className="report-loading">
          <LoaderCircle className="spin" size={18} />
          {tr(
            "최근 30일 기록을 정리하고 있어요 (약 30초)",
            "Summarizing your last 30 days (about 30 s)",
          )}
        </p>
      )}
      {error && (
        <p className="meal-error" role="alert">
          {error}
        </p>
      )}
      {facts && (
        <article
          className="report"
          aria-label={tr("진료용 리포트", "Clinician report")}
        >
          <header>
            <span>
              {facts.period.from} ~ {facts.period.to}
            </span>
            <h3>
              {nickname
                ? tr(
                    `${nickname}님 GLP-1 치료 기록`,
                    `${nickname}'s GLP-1 treatment log`,
                  )
                : tr("GLP-1 치료 기록", "GLP-1 treatment log")}
            </h3>
            {report && <p>{report.headline}</p>}
          </header>
          <div className="report-stats">
            <div>
              <span>{tr("체중 변화", "Weight change")}</span>
              <strong>
                {change !== null ? `${change > 0 ? "+" : ""}${change}kg` : "-"}
              </strong>
            </div>
            <div>
              <span>{tr("기록한 날", "Days logged")}</span>
              <strong>
                {facts.progress.logged_days}
                {tr("일", " d")}
              </strong>
            </div>
            <div>
              <span>{tr("사진으로 잰 단백질", "Protein (photo)")}</span>
              <strong>
                {facts.progress.avg_protein_g_measured
                  ? `${facts.progress.avg_protein_g_measured}g`
                  : "-"}
              </strong>
            </div>
          </div>
          {report && (
            <dl>
              <dt>{tr("체중", "Weight")}</dt>
              <dd>{report.weight}</dd>
              <dt>{tr("투약", "Medication")}</dt>
              <dd>{report.medication}</dd>
              <dt>{tr("식사", "Intake")}</dt>
              <dd>{report.intake}</dd>
              <dt>{tr("부작용", "Side effects")}</dt>
              <dd>{report.side_effects}</dd>
            </dl>
          )}
          {facts.dose_history.length > 0 && (
            <table>
              <caption>{tr("용량 이력", "Dose history")}</caption>
              <thead>
                <tr>
                  <th>{tr("시작일", "From")}</th>
                  <th>{tr("약", "Drug")}</th>
                  <th>{tr("용량", "Dose")}</th>
                  <th>{tr("횟수", "Shots")}</th>
                </tr>
              </thead>
              <tbody>
                {facts.dose_history.map((step) => (
                  <tr key={`${step.from}-${step.dose_mg}`}>
                    <td>{step.from}</td>
                    <td>{step.drug}</td>
                    <td>{step.dose_mg}mg</td>
                    <td>{step.shots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {facts.symptoms_by_cycle_day.length > 0 && (
            <table>
              <caption>
                {tr(
                  "주사 후 며칠째 불편했나",
                  "Symptoms by day after injection",
                )}
              </caption>
              <thead>
                <tr>
                  <th>{tr("주사 후", "Day")}</th>
                  <th>{tr("기록", "Logged")}</th>
                  <th>{tr("증상", "Symptoms")}</th>
                </tr>
              </thead>
              <tbody>
                {facts.symptoms_by_cycle_day.map((row) => (
                  <tr key={row.cycle_day}>
                    <td>
                      {tr(`${row.cycle_day}일째`, `Day ${row.cycle_day}`)}
                      <small>{row.phase}</small>
                    </td>
                    <td>{row.logged_days}</td>
                    <td>
                      {Object.entries(row.symptoms)
                        .map(([name, n]) => `${name} ${n}`)
                        .join(", ") || tr("없음", "None")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report && report.questions_for_clinician.length > 0 && (
            <section>
              <h4>{tr("진료 때 물어볼 것", "Questions for my clinician")}</h4>
              <ul>
                {report.questions_for_clinician.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </section>
          )}
          <footer>
            {tr(
              "자가 기록과 사진 추정을 바탕으로 Meta Muse Spark가 정리했습니다. 진단이나 처방이 아닙니다.",
              "Summarized by Meta Muse Spark from self-logs and photo estimates. Not a diagnosis or prescription.",
            )}
          </footer>
          <button
            className="ghost-button print-button"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            {tr("PDF로 저장", "Save as PDF")}
          </button>
        </article>
      )}
    </div>
  );
}
