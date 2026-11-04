import { useState } from "react";
import { Brain, Check, Trash2, X } from "lucide-react";
import { useTr } from "../i18n";
import {
  CONCERN_LABEL,
  CONCERN_LABEL_EN,
  EMPTY_PROFILE,
  GOAL_LABEL,
  GOAL_LABEL_EN,
  TONE_LABEL,
  TONE_LABEL_EN,
  type Concern,
  type Goal,
  type Profile,
  type Tone,
} from "../profile";

type ProfilePanelProps = {
  profile: Profile | null;
  memories: string[];
  onSave: (profile: Profile) => void;
  onRemoveMemory: (index: number) => void;
  onClearAll: () => void;
};

function numberOrNull(text: string, min: number, max: number): number | null {
  const value = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value * 10) / 10
    : null;
}

export function ProfilePanel({
  profile,
  memories,
  onSave,
  onRemoveMemory,
  onClearAll,
}: ProfilePanelProps) {
  const { lang, tr } = useTr();
  const initial = profile ?? EMPTY_PROFILE;
  const [draft, setDraft] = useState<Profile>(initial);
  const [height, setHeight] = useState(initial.heightCm?.toString() ?? "");
  const [start, setStart] = useState(initial.startWeightKg?.toString() ?? "");
  const [target, setTarget] = useState(
    initial.targetWeightKg?.toString() ?? "",
  );
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const goals = lang === "ko" ? GOAL_LABEL : GOAL_LABEL_EN;
  const tones = lang === "ko" ? TONE_LABEL : TONE_LABEL_EN;
  const concerns = lang === "ko" ? CONCERN_LABEL : CONCERN_LABEL_EN;

  function update(patch: Partial<Profile>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function toggleConcern(concern: Concern) {
    update({
      concerns: draft.concerns.includes(concern)
        ? draft.concerns.filter((c) => c !== concern)
        : [...draft.concerns, concern],
    });
  }

  function save() {
    onSave({
      ...draft,
      // Drug, dose and weekday are edited on the shots tab; keep the latest values.
      drug: profile?.drug ?? draft.drug,
      doseMg: profile?.doseMg ?? draft.doseMg,
      injectionWeekday: profile?.injectionWeekday ?? draft.injectionWeekday,
      nickname: draft.nickname.trim().slice(0, 20),
      medication: draft.medication.trim().slice(0, 40),
      dietNotes: draft.dietNotes.trim().slice(0, 200),
      heightCm: numberOrNull(height, 100, 250),
      startWeightKg: numberOrNull(start, 25, 350),
      targetWeightKg: numberOrNull(target, 25, 350),
    });
    setSaved(true);
  }

  const numberField = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
  ) => (
    <label className="form-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          set(event.target.value);
          setSaved(false);
        }}
      />
    </label>
  );

  return (
    <section className="profile" aria-labelledby="profile-title">
      <div className="page-head">
        <h1 id="profile-title">{tr("나", "Me")}</h1>
        <p>
          {tr(
            "코치가 나에게 맞춰 말하도록 알려 주세요.",
            "Tell the coach about you so it can tailor its advice.",
          )}
        </p>
      </div>

      <div className="card form-card">
        <label className="form-field">
          <span>{tr("호칭", "Name")}</span>
          <input
            value={draft.nickname}
            maxLength={20}
            placeholder={tr("예) 민지", "e.g. Alex")}
            onChange={(event) => update({ nickname: event.target.value })}
          />
        </label>
        <div className="form-field">
          <span>{tr("목표", "Goal")}</span>
          <div className="segment">
            {(Object.keys(GOAL_LABEL) as Goal[]).map((goal) => (
              <button
                key={goal}
                type="button"
                className={draft.goal === goal ? "selected" : ""}
                aria-pressed={draft.goal === goal}
                onClick={() => update({ goal })}
              >
                {goals[goal]}
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          {numberField(tr("키 (cm)", "Height (cm)"), height, setHeight, "165")}
          {numberField(tr("시작 체중", "Start (kg)"), start, setStart, "82")}
          {numberField(tr("목표 체중", "Goal (kg)"), target, setTarget, "70")}
        </div>
      </div>

      <div className="card form-card">
        <div className="form-field">
          <span>{tr("요즘 걱정되는 것", "What worries you lately")}</span>
          <div className="chip-row">
            {(Object.keys(CONCERN_LABEL) as Concern[]).map((concern) => (
              <button
                key={concern}
                type="button"
                className={`chip${draft.concerns.includes(concern) ? " on" : ""}`}
                aria-pressed={draft.concerns.includes(concern)}
                onClick={() => toggleConcern(concern)}
              >
                {concerns[concern]}
              </button>
            ))}
          </div>
        </div>
        <label className="form-field">
          <span>{tr("식습관 메모", "Eating habits")}</span>
          <textarea
            rows={2}
            maxLength={200}
            value={draft.dietNotes}
            placeholder={tr(
              "예) 아침을 자주 거르고, 회사에서 점심은 외식",
              "e.g. Often skip breakfast, lunch out near the office",
            )}
            onChange={(event) => update({ dietNotes: event.target.value })}
          />
        </label>
        <div className="form-field">
          <span>{tr("코치 말투", "Coach tone")}</span>
          <div className="segment">
            {(Object.keys(TONE_LABEL) as Tone[]).map((tone) => (
              <button
                key={tone}
                type="button"
                className={draft.tone === tone ? "selected" : ""}
                aria-pressed={draft.tone === tone}
                onClick={() => update({ tone })}
              >
                {tones[tone]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="run-button save-button" onClick={save}>
        {saved ? <Check size={18} /> : null}
        {saved ? tr("저장됨", "Saved") : tr("저장하기", "Save")}
      </button>

      <div className="card memory-card">
        <div className="memory-head">
          <span className="card-title">
            <Brain size={17} />
            {tr("코치가 기억하는 것", "What the coach remembers")}
          </span>
          <span className="meal-optional">{memories.length}</span>
        </div>
        {memories.length ? (
          <ul className="memory-list">
            {memories.map((memory, index) => (
              <li key={`${index}-${memory}`}>
                <span>{memory}</span>
                <button
                  className="history-delete"
                  aria-label={tr("이 기억 지우기", "Forget this")}
                  onClick={() => onRemoveMemory(index)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">
            {tr(
              "코치와 대화하면 반복되는 패턴이나 선호를 여기에 기억해요.",
              "As you chat, the coach keeps recurring patterns and preferences here.",
            )}
          </p>
        )}
      </div>

      <div className="danger-zone">
        {confirmClear ? (
          <>
            <span>{tr("모든 기록을 지울까요?", "Delete all your data?")}</span>
            <button
              className="danger"
              onClick={() => {
                onClearAll();
                setDraft(EMPTY_PROFILE);
                setHeight("");
                setStart("");
                setTarget("");
                setConfirmClear(false);
              }}
            >
              {tr("지우기", "Delete")}
            </button>
            <button onClick={() => setConfirmClear(false)}>
              {tr("취소", "Cancel")}
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} />
            {tr("내 데이터 모두 지우기", "Delete all my data")}
          </button>
        )}
      </div>
      <p className="field-hint privacy-note">
        {tr(
          "모든 데이터는 이 브라우저에만 저장되고, 코칭을 요청할 때만 서버로 전달됩니다.",
          "Everything stays in this browser and is sent to the server only when you ask for coaching.",
        )}
      </p>
    </section>
  );
}
