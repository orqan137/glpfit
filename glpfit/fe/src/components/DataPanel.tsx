import { useState } from "react";
import { Building2, Download, FileText, ShieldCheck } from "lucide-react";
import { deidentify, download, personalExport } from "../dataExport";
import { useTr } from "../i18n";
import type { Injection } from "../medication";
import type { CoachContext, DailyLog, Profile } from "../profile";
import { ClinicReport } from "./ClinicReport";

type DataPanelProps = {
  context: CoachContext;
  profile: Profile | null;
  logs: DailyLog[];
  shots: Injection[];
  memories: string[];
};

const CONSENT_KEY = "glpfit.research-consent.v1";

export function DataPanel({
  context,
  profile,
  logs,
  shots,
  memories,
}: DataPanelProps) {
  const { tr } = useTr();
  const [consent, setConsent] = useState(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      return false;
    }
  });

  function toggleConsent(next: boolean) {
    setConsent(next);
    try {
      localStorage.setItem(CONSENT_KEY, next ? "yes" : "no");
    } catch {
      // Consent stays for this session only.
    }
  }

  const anonymous = consent ? deidentify(profile, logs, shots) : null;

  return (
    <section className="data-panel" aria-labelledby="data-title">
      <h2 id="data-title" className="section-title">
        {tr("내 데이터 활용", "Use my data")}
      </h2>

      <div className="card data-card">
        <div className="data-head">
          <span className="data-icon">
            <FileText size={18} />
          </span>
          <div>
            <strong>{tr("진료용 리포트", "Clinician report")}</strong>
            <span>
              {tr(
                "최근 30일 체중, 용량, 섭취, 부작용을 한 장으로",
                "Weight, dose, intake and side effects of the last 30 days on one page",
              )}
            </span>
          </div>
        </div>
        <ClinicReport context={context} nickname={profile?.nickname ?? ""} />
      </div>

      <div className="card data-card">
        <div className="data-head">
          <span className="data-icon">
            <Download size={18} />
          </span>
          <div>
            <strong>{tr("내 데이터 내려받기", "Download my data")}</strong>
            <span>
              {tr(
                "프로필, 체크인, 주사 기록, 코치 기억 전체 (JSON)",
                "Profile, check-ins, injections and coach memories (JSON)",
              )}
            </span>
          </div>
        </div>
        <button
          className="ghost-button wide"
          onClick={() =>
            download(
              `glpfit-my-data-${new Date().toISOString().slice(0, 10)}.json`,
              personalExport({ profile, logs, shots, memories }),
            )
          }
        >
          <Download size={16} />
          {tr("JSON 내려받기", "Download JSON")}
        </button>
      </div>

      <div className="card data-card">
        <div className="data-head">
          <span className="data-icon research">
            <Building2 size={18} />
          </span>
          <div>
            <strong>
              {tr(
                "익명 연구 데이터 기여",
                "Contribute anonymous research data",
              )}
            </strong>
            <span>
              {tr(
                "병원과 제약사가 실제 사용 데이터를 모으면 주사 후 며칠째 부작용이 몰리는지, 용량별로 단백질을 얼마나 먹는지 같은 근거가 쌓여요.",
                "Pooled real-world data shows clinics and drug makers which days after a shot side effects cluster and how protein intake changes by dose.",
              )}
            </span>
          </div>
        </div>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => toggleConsent(event.target.checked)}
          />
          <span>
            {tr(
              "이름, 메모, 날짜, 실제 체중을 뺀 익명 데이터를 연구 목적으로 제공하는 데 동의해요. 언제든 끌 수 있어요.",
              "I agree to share anonymous data (no name, notes, dates or actual weight) for research. I can turn this off anytime.",
            )}
          </span>
        </label>
        {anonymous && (
          <>
            <p className="field-hint">
              <ShieldCheck size={14} />{" "}
              {tr(
                `제공되는 것: 상대 날짜, 약과 용량, 체중 변화율, 물과 단백질, 증상 코드 (주사 ${anonymous.shots.length}회, 기록 ${anonymous.days.length}일)`,
                `Shared: relative days, drug and dose, weight change %, water and protein, symptom codes (${anonymous.shots.length} shots, ${anonymous.days.length} days)`,
              )}
            </p>
            <button
              className="ghost-button wide"
              onClick={() =>
                download(
                  `glpfit-anonymous-${anonymous.participant}.json`,
                  anonymous,
                )
              }
            >
              <Download size={16} />
              {tr(
                "익명 데이터 미리보기 (JSON)",
                "Preview anonymous data (JSON)",
              )}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
