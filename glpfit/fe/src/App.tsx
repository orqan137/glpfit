import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  ChevronRight,
  Dumbbell,
  FileText,
  Home,
  MessageCircle,
  RefreshCw,
  Syringe,
  UserRound,
  Utensils,
  X,
} from "lucide-react";
import type { Health } from "./api";
import { CheckinCard } from "./components/CheckinCard";
import { ClinicReport } from "./components/ClinicReport";
import { CoachChat } from "./components/CoachChat";
import { CycleCard } from "./components/CycleCard";
import { DataPanel } from "./components/DataPanel";
import { ExercisePanel } from "./components/ExercisePanel";
import { Logo } from "./components/Logo";
import { MealsPanel, ProteinBar } from "./components/MealsPanel";
import { MedicationPanel } from "./components/MedicationPanel";
import { ProfilePanel } from "./components/ProfilePanel";
import { WeightChart } from "./components/WeightChart";
import {
  ROUTINES,
  clearExercise,
  loadExercise,
  setSets,
  setsOn,
  type ExerciseDay,
} from "./exercise";
import { loadRuns } from "./history";
import { LangContext, loadLang, makeTr, saveLang, type Lang } from "./i18n";
import {
  clearMeals,
  deleteMeal,
  intakeOn,
  loadMeals,
  proteinGoal,
  saveMeal,
  type Meal,
} from "./meals";
import {
  addInjection,
  clearInjections,
  computeSchedule,
  deleteInjection,
  loadInjections,
  phaseText,
  type Injection,
} from "./medication";
import {
  EMPTY_PROFILE,
  addMemory,
  buildContext,
  clearPersonalData,
  dayKey,
  hasProfile,
  loadLogs,
  loadMemories,
  loadProfile,
  removeMemory,
  saveProfile,
  upsertLog,
  weightSummary,
  type DailyLog,
  type Profile,
} from "./profile";

type Tab = "home" | "dose" | "meals" | "exercise" | "coach" | "me";

export default function App() {
  const [lang, setLang] = useState<Lang>(loadLang);
  const tr = useMemo(() => makeTr(lang), [lang]);
  const [tab, setTab] = useState<Tab>("home");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [healthRevision, setHealthRevision] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [logs, setLogs] = useState<DailyLog[]>(() => loadLogs());
  const [memories, setMemories] = useState<string[]>(() => loadMemories());
  const [shots, setShots] = useState<Injection[]>(() => loadInjections());
  const [meals, setMeals] = useState<Meal[]>(() => loadMeals());
  const [exercise, setExercise] = useState<ExerciseDay[]>(() => loadExercise());
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const abort = new AbortController();
    setHealthError(false);
    fetch("/api/health", { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error("health");
        return response.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setHealth(null);
          setHealthError(true);
        }
      });
    return () => abort.abort();
  }, [healthRevision]);

  const live = !!health?.live_configured;
  const today = dayKey();
  const schedule = computeSchedule(shots, {
    drug: profile?.drug ?? null,
    doseMg: profile?.doseMg ?? null,
    weekday: profile?.injectionWeekday ?? null,
  });
  const phase = schedule.phase ? phaseText(schedule.phase, lang) : null;
  // 0 right after the shot, 1 steady, 2 before the next shot; steady when unknown.
  const phaseIndex =
    schedule.daysSince === null
      ? 1
      : schedule.daysSince <= 1
        ? 0
        : schedule.daysSince <= 4
          ? 1
          : 2;
  const routine = ROUTINES[phaseIndex];
  const routineSets = routine.items.reduce((sum, item) => sum + item.sets, 0);
  const setsToday = setsOn(exercise, today);
  const weight = weightSummary(profile, logs);
  const intake = intakeOn(meals, today);
  const goal = proteinGoal(weight.latest ?? profile?.startWeightKg ?? null);
  const context = () =>
    buildContext(profile, logs, memories, loadRuns(), shots, meals, exercise);

  function updateProfile(patch: Partial<Profile>) {
    setProfile((current) =>
      saveProfile({ ...(current ?? EMPTY_PROFILE), ...patch }),
    );
  }

  function switchLang() {
    const next: Lang = lang === "ko" ? "en" : "ko";
    saveLang(next);
    setLang(next);
  }

  function go(next: Tab) {
    setTab(next);
    window.scrollTo({ top: 0 });
  }

  const todayLabel = new Date().toLocaleDateString(
    lang === "ko" ? "ko-KR" : "en-US",
    { month: "long", day: "numeric", weekday: "long" },
  );

  return (
    <LangContext.Provider value={{ lang, tr }}>
      <div className="app-shell phone">
        <header className="topbar">
          <span className="brand">
            <Logo size={30} />
            <span>{tr("지엘피핏", "GLPfit")}</span>
          </span>
          <div className="topbar-right">
            {schedule.cycleDay !== null && (
              <button className="topbar-cycle" onClick={() => go("dose")}>
                <Syringe size={14} />
                {tr(
                  `주사 후 ${schedule.cycleDay}일째`,
                  `Day ${schedule.cycleDay}`,
                )}
              </button>
            )}
            <button
              className={`me-button${tab === "me" ? " on" : ""}`}
              onClick={() => go("me")}
              aria-label={tr("나", "Me")}
            >
              <UserRound size={18} />
            </button>
            <button
              className="lang-toggle"
              onClick={switchLang}
              aria-label={tr("Switch to English", "한국어로 바꾸기")}
            >
              {lang === "ko" ? "EN" : "한"}
            </button>
          </div>
        </header>

        {healthError && (
          <div className="connection-error" role="alert">
            {tr("서버에 연결할 수 없어요.", "Can't reach the server.")}
            <button onClick={() => setHealthRevision((n) => n + 1)}>
              <RefreshCw size={14} />
              {tr("다시 연결", "Retry")}
            </button>
          </div>
        )}

        <main>
          <div key={`${tab}-${lang}`} className="tab-enter">
            {tab === "home" && (
              <section className="home">
                <div className="page-head home-head">
                  <p>{todayLabel}</p>
                  <h1>
                    {profile?.nickname
                      ? tr(
                          `${profile.nickname}님, 오늘도 가볍게`,
                          `Hi ${profile.nickname}, keep it light today`,
                        )
                      : tr("오늘의 요약", "Today")}
                  </h1>
                </div>

                <CheckinCard
                  date={today}
                  log={logs.find((log) => log.date === today)}
                  weight={weight}
                  voiceEnabled={live}
                  onChange={(patch) => setLogs(upsertLog(today, patch))}
                  onInjectionMentioned={() => go("dose")}
                />

                <CycleCard
                  schedule={schedule}
                  shots={shots}
                  drug={profile?.drug ?? null}
                  onOpen={() => go("dose")}
                />

                <div className="core-pair">
                  <button
                    className="card protein-card"
                    onClick={() => go("meals")}
                  >
                    <ProteinBar
                      protein={intake.proteinG}
                      goal={goal}
                      provisional={false}
                    />
                    <span className="protein-cta">
                      <Camera size={16} />
                      {intake.meals
                        ? tr(
                            `${intake.meals}끼, 사진 추가`,
                            `${intake.meals} meals, add photo`,
                          )
                        : tr("식사 사진 찍기", "Snap a meal")}
                    </span>
                  </button>
                  <button
                    className="card move-card"
                    onClick={() => go("exercise")}
                  >
                    <span className="move-top">
                      <span>{tr("맨몸운동", "Bodyweight")}</span>
                      <strong>
                        {Math.min(setsToday, routineSets)}
                        <small>/ {routineSets}</small>
                      </strong>
                    </span>
                    <span
                      className="move-track"
                      role="img"
                      aria-label={`${setsToday}/${routineSets}`}
                    >
                      <span
                        style={{
                          width: `${Math.min(100, (setsToday / routineSets) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="move-cta">
                      <Dumbbell size={16} />
                      {setsToday
                        ? tr("이어서 하기", "Keep going")
                        : tr("오늘 루틴 보기", "Today's routine")}
                    </span>
                  </button>
                </div>

                <WeightChart
                  profile={profile}
                  logs={logs}
                  shots={shots}
                  tr={tr}
                />

                <button
                  className="card pdf-row"
                  onClick={() => setReportOpen(true)}
                >
                  <span className="data-icon">
                    <FileText size={18} />
                  </span>
                  <span className="sample-text">
                    <strong>
                      {tr("병원 갈 때 기록 PDF", "PDF for your clinic visit")}
                    </strong>
                    <span>
                      {tr(
                        "최근 30일 체중, 투약, 식사, 운동을 한 장으로",
                        "Last 30 days of weight, shots, meals and exercise on one page",
                      )}
                    </span>
                  </span>
                  <ChevronRight size={18} className="track-chevron" />
                </button>

                {!hasProfile(profile) && (
                  <button className="card setup-card" onClick={() => go("me")}>
                    <span className="sample-text">
                      <strong>
                        {tr(
                          "나에게 맞춘 코칭 받기",
                          "Get coaching made for you",
                        )}
                      </strong>
                      <span>
                        {tr(
                          "목표 체중과 걱정, 말투를 알려 주세요",
                          "Tell us your goal, worries and preferred tone",
                        )}
                      </span>
                    </span>
                    <ChevronRight size={18} className="track-chevron" />
                  </button>
                )}
              </section>
            )}

            {tab === "meals" && (
              <MealsPanel
                meals={meals}
                live={live}
                proteinGoal={goal}
                onSave={(meal) => setMeals(saveMeal(meal))}
                onDelete={(id) => setMeals(deleteMeal(id))}
              />
            )}

            {tab === "exercise" && (
              <ExercisePanel
                days={exercise}
                date={today}
                phaseIndex={phaseIndex}
                phaseName={phase?.name ?? null}
                proteinG={intake.proteinG}
                proteinGoal={goal}
                onSets={(move, sets) => setExercise(setSets(today, move, sets))}
              />
            )}

            {tab === "coach" && (
              <CoachChat
                live={live}
                context={context}
                phaseName={phase?.name ?? null}
                cycleDay={schedule.cycleDay}
                nickname={profile?.nickname ?? ""}
                onMemory={(text) => setMemories(addMemory(text))}
              />
            )}

            {tab === "dose" && (
              <MedicationPanel
                profile={profile ?? EMPTY_PROFILE}
                shots={shots}
                schedule={schedule}
                onProfileChange={updateProfile}
                onLog={(shot) => setShots(addInjection(shot))}
                onDelete={(id) => setShots(deleteInjection(id))}
              />
            )}

            {tab === "me" && (
              <>
                <ProfilePanel
                  profile={profile}
                  memories={memories}
                  onSave={(next) => setProfile(saveProfile(next))}
                  onRemoveMemory={(index) => setMemories(removeMemory(index))}
                  onClearAll={() => {
                    clearPersonalData();
                    clearInjections();
                    clearMeals();
                    clearExercise();
                    setExercise([]);
                    setProfile(null);
                    setLogs([]);
                    setMemories([]);
                    setShots([]);
                    setMeals([]);
                  }}
                />
                <DataPanel
                  context={context()}
                  profile={profile}
                  logs={logs}
                  shots={shots}
                  memories={memories}
                />
              </>
            )}
          </div>
        </main>

        {reportOpen && (
          <div
            className="report-modal"
            role="dialog"
            aria-modal="true"
            aria-label={tr("진료용 리포트", "Clinician report")}
          >
            <div className="report-sheet">
              <div className="report-sheet-head">
                <strong>{tr("진료용 리포트", "Clinician report")}</strong>
                <button
                  className="icon-button"
                  aria-label={tr("닫기", "Close")}
                  onClick={() => setReportOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <ClinicReport
                context={context()}
                nickname={profile?.nickname ?? ""}
                autoPrint
              />
            </div>
          </div>
        )}

        <nav className="tabbar" aria-label={tr("주요 화면", "Main")}>
          {(
            [
              { id: "home", label: tr("홈", "Home"), icon: <Home size={22} /> },
              {
                id: "dose",
                label: tr("투약", "Shots"),
                icon: <Syringe size={22} />,
              },
              {
                id: "meals",
                label: tr("식사", "Meals"),
                icon: <Utensils size={22} />,
              },
              {
                id: "exercise",
                label: tr("운동", "Move"),
                icon: <Dumbbell size={22} />,
              },
              {
                id: "coach",
                label: tr("코치", "Coach"),
                icon: <MessageCircle size={22} />,
              },
            ] as const
          ).map(({ id, label, icon }) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </LangContext.Provider>
  );
}
