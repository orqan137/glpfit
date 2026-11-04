import { useState } from "react";
import { AlertTriangle, Check, FileText, Syringe, X } from "lucide-react";
import { useTr } from "../i18n";
import { LevelCurve } from "./CycleCard";
import {
  DRUG_INFO,
  DRUG_INGREDIENT_EN,
  DRUG_NAME_EN,
  SITE_LABEL,
  SITE_LABEL_EN,
  type Drug,
  type Injection,
  type Schedule,
  type Site,
} from "../medication";
import {
  SYMPTOM_LABEL,
  SYMPTOM_LABEL_EN,
  WEEKDAY_LABEL,
  WEEKDAY_LABEL_EN,
  dayKey,
  type Profile,
  type Symptom,
} from "../profile";

type MedicationPanelProps = {
  profile: Profile;
  shots: Injection[];
  schedule: Schedule;
  onProfileChange: (patch: Partial<Profile>) => void;
  onLog: (shot: Omit<Injection, "id">) => void;
  onDelete: (id: string) => void;
  symptoms: Symptom[];
  onSymptoms: (symptoms: Symptom[]) => void;
  onReport: () => void;
};

export function MedicationPanel({
  profile,
  shots,
  schedule,
  onProfileChange,
  onLog,
  onDelete,
  symptoms,
  onSymptoms,
  onReport,
}: MedicationPanelProps) {
  const { lang, tr } = useTr();
  const drug = profile.drug;
  const ladder = drug ? DRUG_INFO[drug].ladder : [];
  const [logging, setLogging] = useState(false);
  const [date, setDate] = useState(dayKey());
  const [site, setSite] = useState<Site | null>(schedule.nextSite);
  const [doseText, setDoseText] = useState("");
  const currentDose = profile.doseMg ?? schedule.last?.doseMg ?? null;
  const sites = lang === "ko" ? SITE_LABEL : SITE_LABEL_EN;
  const weekdays = lang === "ko" ? WEEKDAY_LABEL : WEEKDAY_LABEL_EN;
  const drugName = (d: Drug) =>
    lang === "ko"
      ? d === "other"
        ? "기타"
        : DRUG_INFO[d].name
      : DRUG_NAME_EN[d];

  const missedRule: Partial<Record<Drug, string>> = {
    mounjaro: tr(
      "제품 설명서: 놓친 뒤 4일(96시간) 이내면 바로 맞고, 지났으면 건너뛰고 다음 예정일에 맞아요.",
      "Label: if within 4 days (96 h) of the missed dose, take it now; otherwise skip and take the next one on schedule.",
    ),
    wegovy: tr(
      "제품 설명서: 다음 예정일까지 2일(48시간) 넘게 남았으면 바로 맞고, 아니면 건너뛰어요.",
      "Label: if the next dose is more than 2 days (48 h) away, take it now; otherwise skip it.",
    ),
  };

  function formatDay(at: number | string): string {
    const d =
      typeof at === "string" ? new Date(`${at}T00:00:00`) : new Date(at);
    return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
  }

  function openLog() {
    setDate(dayKey());
    setSite(schedule.nextSite ?? "abdomen_left");
    setDoseText(currentDose !== null ? String(currentDose) : "");
    setLogging(true);
  }

  function saveShot() {
    const dose = Number.parseFloat(doseText.replace(",", "."));
    if (!drug || !Number.isFinite(dose) || dose <= 0 || dose > 50) return;
    onLog({ date, drug, doseMg: dose, site });
    if (dose !== profile.doseMg) onProfileChange({ doseMg: dose });
    setLogging(false);
  }

  const dueText =
    schedule.daysUntil === null
      ? tr("첫 주사를 기록해 주세요", "Log your first shot")
      : schedule.overdue > 0
        ? tr(
            `예정일보다 ${schedule.overdue}일 지났어요`,
            `${schedule.overdue} days overdue`,
          )
        : schedule.daysUntil === 0
          ? tr("오늘 맞는 날이에요", "Shot day today")
          : `D-${schedule.daysUntil}`;

  return (
    <section className="medication" aria-labelledby="med-title">
      <div className="page-head">
        <h1 id="med-title">{tr("투약", "Shots")}</h1>
        <p>
          {tr(
            "주 1회 주사 일정과 용량을 기록해요.",
            "Track your weekly shot and dose.",
          )}
        </p>
      </div>

      <div className={`card shot-card${schedule.overdue ? " overdue" : ""}`}>
        <div className="shot-head">
          <span className="shot-icon">
            <Syringe size={20} />
          </span>
          <div>
            <span className="shot-label">{tr("다음 주사", "Next shot")}</span>
            <strong>{dueText}</strong>
            {schedule.nextDue !== null && (
              <span className="shot-date">{formatDay(schedule.nextDue)}</span>
            )}
          </div>
        </div>
        <LevelCurve
          shots={shots}
          drug={drug}
          nextIn={schedule.daysUntil}
          showDoses
        />
        <p className="cycle-note">
          {tr(
            "설명서 반감기로 계산한 추정 곡선이에요. 실제 혈중 농도가 아니에요.",
            "Estimated from the label half-life, not a measured blood level.",
          )}
        </p>
        {schedule.nextSite && (
          <p className="shot-site">
            {tr("추천 부위", "Suggested site")}{" "}
            <b>{sites[schedule.nextSite]}</b>
            <br />
            {tr(
              `지난번 ${schedule.last?.site ? SITE_LABEL[schedule.last.site] : "-"}에서 돌아가며 맞아요`,
              `Rotating from last time (${schedule.last?.site ? SITE_LABEL_EN[schedule.last.site] : "-"})`,
            )}
          </p>
        )}
        {schedule.overdue > 0 && drug && missedRule[drug] && (
          <p className="shot-warning">
            <AlertTriangle size={14} />
            {missedRule[drug]}{" "}
            {tr(
              "확실하지 않으면 의료진에게 확인하세요.",
              "If unsure, check with your clinician.",
            )}
          </p>
        )}

        {logging ? (
          <div className="shot-form">
            <label className="form-field">
              <span>{tr("날짜", "Date")}</span>
              <input
                type="date"
                value={date}
                max={dayKey()}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>{tr("용량 (mg)", "Dose (mg)")}</span>
              <input
                inputMode="decimal"
                value={doseText}
                onChange={(event) => setDoseText(event.target.value)}
              />
            </label>
            <div className="form-field">
              <span>{tr("부위", "Site")}</span>
              <div className="site-grid">
                {(Object.keys(SITE_LABEL) as Site[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip${site === key ? " on" : ""}`}
                    aria-pressed={site === key}
                    onClick={() => setSite(key)}
                  >
                    {sites[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="shot-actions">
              <button
                className="ghost-button"
                onClick={() => setLogging(false)}
              >
                {tr("취소", "Cancel")}
              </button>
              <button className="run-button" onClick={saveShot}>
                <Check size={18} />
                {tr("기록 저장", "Save")}
              </button>
            </div>
          </div>
        ) : (
          <button className="run-button" disabled={!drug} onClick={openLog}>
            <Syringe size={18} />
            {drug
              ? tr("주사 맞았어요", "I took my shot")
              : tr("아래에서 약을 먼저 고르세요", "Pick your medication below")}
          </button>
        )}
      </div>

      <div className="card form-card">
        <div className="form-field">
          <span>{tr("오늘 불편한 점", "Side effects today")}</span>
          <div className="chip-row">
            {(Object.keys(SYMPTOM_LABEL) as Symptom[]).map((symptom) => (
              <button
                key={symptom}
                type="button"
                className={`chip${symptoms.includes(symptom) ? " on" : ""}`}
                aria-pressed={symptoms.includes(symptom)}
                onClick={() =>
                  onSymptoms(
                    symptoms.includes(symptom)
                      ? symptoms.filter((s) => s !== symptom)
                      : [...symptoms, symptom],
                  )
                }
              >
                {(lang === "ko" ? SYMPTOM_LABEL : SYMPTOM_LABEL_EN)[symptom]}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {tr(
              "주사 후 며칠째에 불편했는지 모여서 병원 리포트에 표로 나와요.",
              "These add up into a by-day-after-shot table in your clinic report.",
            )}
          </p>
        </div>
      </div>

      <button className="card pdf-row" onClick={onReport}>
        <span className="data-icon">
          <FileText size={18} />
        </span>
        <span className="sample-text">
          <strong>
            {tr("병원 갈 때 기록 PDF", "PDF for your clinic visit")}
          </strong>
          <span>
            {tr(
              "최근 30일 체중, 투약, 식사, 운동, 부작용",
              "Last 30 days: weight, shots, meals, exercise, side effects",
            )}
          </span>
        </span>
      </button>

      <details className="card form-card fold">
        <summary className="memory-head">
          <span className="card-title">
            {tr("약 설정", "Medication settings")}
          </span>
          <span className="meal-optional">
            {drug
              ? `${drugName(drug)} ${currentDose ?? ""}mg`
              : tr("설정 필요", "Not set")}
          </span>
        </summary>
        <div className="form-field">
          <span>{tr("약", "Medication")}</span>
          <div className="segment">
            {(Object.keys(DRUG_INFO) as Drug[]).map((key) => (
              <button
                key={key}
                type="button"
                className={drug === key ? "selected" : ""}
                aria-pressed={drug === key}
                onClick={() =>
                  onProfileChange({
                    drug: key,
                    doseMg:
                      key === drug
                        ? profile.doseMg
                        : (DRUG_INFO[key].ladder[0] ?? null),
                  })
                }
              >
                {drugName(key)}
              </button>
            ))}
          </div>
          {drug && DRUG_INFO[drug].ingredient && (
            <p className="field-hint">
              {lang === "ko"
                ? DRUG_INFO[drug].ingredient
                : DRUG_INGREDIENT_EN[drug]}
            </p>
          )}
        </div>
        {drug && (
          <div className="form-field">
            <span>{tr("처방받은 현재 용량", "Current prescribed dose")}</span>
            {ladder.length ? (
              <div className="chip-row">
                {ladder.map((mg) => (
                  <button
                    key={mg}
                    type="button"
                    className={`chip${currentDose === mg ? " on" : ""}`}
                    aria-pressed={currentDose === mg}
                    onClick={() => onProfileChange({ doseMg: mg })}
                  >
                    {mg}mg
                  </button>
                ))}
              </div>
            ) : (
              <input
                inputMode="decimal"
                placeholder="mg"
                defaultValue={profile.doseMg ?? ""}
                onBlur={(event) => {
                  const mg = Number.parseFloat(event.target.value);
                  onProfileChange({
                    doseMg: Number.isFinite(mg) && mg > 0 ? mg : null,
                  });
                }}
              />
            )}
          </div>
        )}
        <div className="form-field">
          <span>{tr("주사 요일", "Shot day")}</span>
          <div className="weekday-row">
            {weekdays.map((label, day) => (
              <button
                key={label}
                type="button"
                className={profile.injectionWeekday === day ? "selected" : ""}
                aria-pressed={profile.injectionWeekday === day}
                onClick={() =>
                  onProfileChange({
                    injectionWeekday:
                      profile.injectionWeekday === day ? null : day,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </details>

      <details className="card memory-card fold">
        <summary className="memory-head">
          <span className="card-title">{tr("주사 기록", "Shot log")}</span>
          <span className="meal-optional">
            {tr(`${shots.length}회`, `${shots.length}`)}
          </span>
        </summary>
        {shots.length ? (
          <ul className="memory-list shot-list">
            {shots.slice(0, 12).map((shot) => (
              <li key={shot.id}>
                <span>
                  <b>{formatDay(shot.date)}</b> {drugName(shot.drug)}{" "}
                  {shot.doseMg}mg
                  {shot.site ? `, ${sites[shot.site]}` : ""}
                </span>
                <button
                  className="history-delete"
                  aria-label={tr("이 주사 기록 지우기", "Delete this shot")}
                  onClick={() => onDelete(shot.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">
            {tr(
              "맞은 날을 기록하면 다음 주사일과 주사 후 며칠째인지에 맞춘 코칭이 시작돼요.",
              "Log a shot to get your next date and coaching for each day after it.",
            )}
          </p>
        )}
      </details>
    </section>
  );
}
