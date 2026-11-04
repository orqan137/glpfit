import { useEffect, useRef, useState } from "react";
import {
  Droplet,
  LoaderCircle,
  Mic,
  Minus,
  Plus,
  Scale,
  Square,
} from "lucide-react";
import { useTr } from "../i18n";
import { startRecording, type Recorder } from "../mealFeatures";
import { sendVoiceCheckin, toWav16k, type VoiceCheckin } from "../multimodal";
import {
  SYMPTOM_LABEL,
  SYMPTOM_LABEL_EN,
  emptyLog,
  type DailyLog,
  type Symptom,
  type WeightSummary,
} from "../profile";

type Patch = Partial<Omit<DailyLog, "date">>;

type CheckinCardProps = {
  log: DailyLog | undefined;
  date: string;
  weight: WeightSummary;
  voiceEnabled: boolean;
  onChange: (patch: Patch) => void;
  onInjectionMentioned: () => void;
};

const WATER_GOAL = 8;

/** Merge what was heard into today's log without erasing what is already there. */
function voicePatch(today: DailyLog, heard: VoiceCheckin["log"]): Patch {
  const patch: Patch = {};
  if (heard.weight_kg !== null)
    patch.weightKg = Math.round(heard.weight_kg * 10) / 10;
  if (heard.water_cups !== null) patch.waterCups = heard.water_cups;
  const symptoms = heard.symptoms.filter(
    (s): s is Symptom => s in SYMPTOM_LABEL,
  );
  if (symptoms.length)
    patch.symptoms = [...new Set([...today.symptoms, ...symptoms])];
  if (heard.note) patch.note = heard.note;
  return patch;
}

function VoiceButton({
  today,
  onChange,
  onInjectionMentioned,
}: {
  today: DailyLog;
  onChange: (patch: Patch) => void;
  onInjectionMentioned: () => void;
}) {
  const { lang, tr } = useTr();
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [injection, setInjection] = useState(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(stopTimer.current), []);

  async function stop(active: Recorder) {
    clearTimeout(stopTimer.current);
    setRecorder(null);
    setBusy(true);
    try {
      const wav = await toWav16k(await active.stop());
      const result = await sendVoiceCheckin(wav, lang);
      setHeard(result.transcript);
      setInjection(result.log.injection_today);
      onChange(voicePatch(today, result.log));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("음성 체크인에 실패했어요.", "Voice check-in failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (recorder) return void stop(recorder);
    setError("");
    setHeard("");
    setInjection(false);
    try {
      const active = await startRecording();
      setRecorder(active);
      // One breath of check-in is plenty; keep requests small.
      stopTimer.current = setTimeout(() => void stop(active), 30_000);
    } catch {
      setError(
        tr(
          "마이크를 사용할 수 없어요. 권한을 확인해 주세요.",
          "Microphone unavailable. Check permissions.",
        ),
      );
    }
  }

  return (
    <>
      <button
        type="button"
        className={`voice-button${recorder ? " recording" : ""}`}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : recorder ? (
          <Square size={12} fill="currentColor" />
        ) : (
          <Mic size={15} />
        )}
        {busy
          ? tr("정리 중", "Working")
          : recorder
            ? tr("다 말했어요", "Done")
            : tr("말로 기록", "Say it")}
      </button>
      {(heard || error || recorder) && (
        <p className={`voice-note${error ? " error" : ""}`} role="status">
          {error ||
            (recorder
              ? tr(
                  "예) 오늘 79.2kg, 물 네 잔, 아침에 좀 메스꺼웠어",
                  'e.g. "79.2 kilos, four glasses of water, a bit nauseous this morning"',
                )
              : tr(`들은 내용: "${heard}"`, `Heard: "${heard}"`))}
          {injection && !error && (
            <button type="button" onClick={onInjectionMentioned}>
              {tr("주사 기록하기", "Log the shot")}
            </button>
          )}
        </p>
      )}
    </>
  );
}

export function CheckinCard({
  log,
  date,
  weight,
  voiceEnabled,
  onChange,
  onInjectionMentioned,
}: CheckinCardProps) {
  const { lang, tr } = useTr();
  const today = log ?? emptyLog(date);
  const [weightText, setWeightText] = useState(
    today.weightKg !== null ? String(today.weightKg) : "",
  );
  useEffect(() => {
    setWeightText(today.weightKg !== null ? String(today.weightKg) : "");
  }, [date, today.weightKg]);

  function commitWeight() {
    const value = Number.parseFloat(weightText.replace(",", "."));
    if (!weightText.trim()) {
      if (today.weightKg !== null) onChange({ weightKg: null });
      return;
    }
    if (Number.isFinite(value) && value >= 25 && value <= 350) {
      const rounded = Math.round(value * 10) / 10;
      if (rounded !== today.weightKg) onChange({ weightKg: rounded });
      setWeightText(String(rounded));
    } else {
      setWeightText(today.weightKg !== null ? String(today.weightKg) : "");
    }
  }

  function toggleSymptom(symptom: Symptom) {
    const has = today.symptoms.includes(symptom);
    onChange({
      symptoms: has
        ? today.symptoms.filter((s) => s !== symptom)
        : [...today.symptoms, symptom],
    });
  }

  const water = today.waterCups ?? 0;
  const labels = lang === "ko" ? SYMPTOM_LABEL : SYMPTOM_LABEL_EN;

  return (
    <section className="card checkin-card" aria-labelledby="checkin-title">
      <div className="checkin-head">
        <h2 id="checkin-title" className="card-title">
          {tr("오늘 체중", "Today's weight")}
        </h2>
        {voiceEnabled ? (
          <VoiceButton
            today={today}
            onChange={onChange}
            onInjectionMentioned={onInjectionMentioned}
          />
        ) : (
          <span className="checkin-saved">
            {tr("자동 저장", "Saved automatically")}
          </span>
        )}
      </div>

      <div className="checkin-grid single">
        <label className="weight-input">
          <Scale size={18} />
          <input
            inputMode="decimal"
            placeholder={tr("체중", "Weight")}
            value={weightText}
            onChange={(event) => setWeightText(event.target.value)}
            onBlur={commitWeight}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label={tr("오늘 체중 (kg)", "Today's weight (kg)")}
          />
          <span>kg</span>
        </label>
      </div>
      {weight.sinceStart !== null && (
        <p className="weight-meta-line">
          <span className={weight.sinceStart <= 0 ? "down" : "up"}>
            {tr("시작 대비", "Since start")} {weight.sinceStart > 0 ? "+" : ""}
            {weight.sinceStart}kg
          </span>
          {weight.toTarget !== null && weight.toTarget > 0 && (
            <span>
              {tr(
                `목표까지 ${weight.toTarget}kg`,
                `${weight.toTarget}kg to goal`,
              )}
            </span>
          )}
        </p>
      )}

      <details className="aux">
        <summary>
          {tr("보조지표", "Secondary")}
          <span>
            {tr(
              `물 ${water}잔, 몸 상태 ${today.symptoms.length}개`,
              `Water ${water}, symptoms ${today.symptoms.length}`,
            )}
          </span>
        </summary>
        <div className="water">
          <div className="water-top">
            <Droplet size={16} />
            <span>
              {tr("물", "Water")} <b>{water}</b>/{WATER_GOAL}
              {tr("잔", " cups")}
            </span>
            <div className="stepper-buttons">
              <button
                type="button"
                aria-label={tr("물 한 잔 빼기", "One cup less")}
                disabled={water <= 0}
                onClick={() => onChange({ waterCups: water - 1 })}
              >
                <Minus size={16} />
              </button>
              <button
                type="button"
                aria-label={tr("물 한 잔 추가", "One more cup")}
                disabled={water >= 30}
                onClick={() => onChange({ waterCups: water + 1 })}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div className="water-cups" aria-hidden="true">
            {Array.from({ length: WATER_GOAL }, (_, i) => (
              <span key={i} className={i < water ? "full" : ""} />
            ))}
          </div>
        </div>
        <div className="symptom-block">
          <span className="field-hint">
            {tr("오늘 몸 상태", "How do you feel today?")}
          </span>
          <div className="chip-row">
            {(Object.keys(SYMPTOM_LABEL) as Symptom[]).map((symptom) => (
              <button
                key={symptom}
                type="button"
                className={`chip${today.symptoms.includes(symptom) ? " on" : ""}`}
                aria-pressed={today.symptoms.includes(symptom)}
                onClick={() => toggleSymptom(symptom)}
              >
                {labels[symptom]}
              </button>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
