import { useState } from "react";
import {
  Camera,
  Check,
  LoaderCircle,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import { useTr } from "../i18n";
import {
  SLOT_LABEL,
  intakeOn,
  mealProtein,
  newMealId,
  slotFor,
  todayKey,
  type Meal,
} from "../meals";
import { analyzePlate, imageToDataUrl, type PlateResult } from "../multimodal";

const COLORS = [
  "#18a957",
  "#f2780c",
  "#1a8fd6",
  "#7c4ddb",
  "#e5484d",
  "#c99a06",
];
const SAMPLE = {
  before: "samples/plate-before.webp",
  after: "samples/plate-after.webp",
  result: "samples/plate-result.json",
};

type MealsPanelProps = {
  meals: Meal[];
  live: boolean;
  proteinGoal: number;
  onSave: (meal: Meal) => void;
  onDelete: (id: string) => void;
};

function Boxes({
  result,
  which,
}: {
  result: PlateResult;
  which: "boxes_before" | "boxes_after";
}) {
  const [w, h] = result.image_size ?? [1, 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {result.items.flatMap((item, i) =>
        item[which].map(([x1, y1, x2, y2], j) => (
          <rect
            key={`${i}-${j}`}
            x={x1}
            y={y1}
            width={x2 - x1}
            height={y2 - y1}
            rx={Math.max(4, (x2 - x1) * 0.05)}
            stroke={COLORS[i % COLORS.length]}
            fill={COLORS[i % COLORS.length]}
          />
        )),
      )}
    </svg>
  );
}

export function ProteinBar({
  protein,
  goal,
  provisional,
}: {
  protein: number;
  goal: number;
  provisional: boolean;
}) {
  const { tr } = useTr();
  const pct = Math.min(100, Math.round((protein / Math.max(1, goal)) * 100));
  return (
    <div className="protein-bar">
      <div className="protein-top">
        <span>{tr("오늘 단백질", "Protein today")}</span>
        <strong>
          {Math.round(protein)}
          <small>/ {goal}g</small>
        </strong>
      </div>
      <div className="protein-track" role="img" aria-label={`${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {provisional && (
        <p className="field-hint">
          {tr(
            "식후 사진이 없는 끼니는 다 먹은 것으로 계산했어요.",
            "Meals without an after photo count as fully eaten.",
          )}
        </p>
      )}
    </div>
  );
}

export function MealsPanel({
  meals,
  live,
  proteinGoal,
  onSave,
  onDelete,
}: MealsPanelProps) {
  const { lang, tr } = useTr();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayKey();
  const todays = meals.filter((m) => m.date === today);
  const intake = intakeOn(meals, today);
  const pending = todays.find((m) => m.status === "served" && m.image);

  async function thumbOf(source: Blob | string) {
    const blob =
      typeof source === "string" ? await (await fetch(source)).blob() : source;
    return (await imageToDataUrl(blob, 240)).url;
  }

  async function addBefore(file: File | undefined) {
    if (!file) return;
    if (!live) {
      setError(
        tr(
          "내 사진 분석은 Meta API 키가 있을 때 동작해요. 샘플로 체험해 보세요.",
          "Analyzing your own photos needs a Meta API key. Try the sample.",
        ),
      );
      return;
    }
    setBusy("before");
    setError("");
    try {
      const shot = await imageToDataUrl(file, 768);
      const result = await analyzePlate(shot.url, null, lang);
      const at = Date.now();
      const meal: Meal = {
        id: newMealId(),
        date: today,
        at,
        slot: slotFor(at),
        thumb: await thumbOf(file),
        image: shot.url,
        afterThumb: null,
        result,
        status: "served",
      };
      onSave(meal);
      setOpenId(meal.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("분석에 실패했어요.", "Analysis failed."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function addAfter(meal: Meal, file: File | undefined) {
    if (!file || !meal.image) return;
    setBusy(meal.id);
    setError("");
    try {
      const shot = await imageToDataUrl(file, 768);
      const result = await analyzePlate(meal.image, shot.url, lang);
      onSave({
        ...meal,
        result,
        afterThumb: await thumbOf(file),
        status: "eaten",
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("분석에 실패했어요.", "Analysis failed."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function addSample() {
    setBusy("before");
    setError("");
    try {
      const at = Date.now();
      const [beforeThumb, afterThumb] = await Promise.all([
        thumbOf(SAMPLE.before),
        thumbOf(SAMPLE.after),
      ]);
      let result: PlateResult;
      if (live) {
        const [b, a] = await Promise.all(
          [SAMPLE.before, SAMPLE.after].map(async (path) =>
            imageToDataUrl(await (await fetch(path)).blob(), 768),
          ),
        );
        result = await analyzePlate(b.url, a.url, lang);
      } else {
        // Without a key: a real result computed earlier on these two photos.
        result = (await (await fetch(SAMPLE.result)).json()) as PlateResult;
      }
      const meal: Meal = {
        id: newMealId(),
        date: today,
        at,
        slot: slotFor(at),
        thumb: beforeThumb,
        image: null,
        afterThumb,
        result,
        status: "eaten",
      };
      onSave(meal);
      setOpenId(meal.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("샘플을 불러오지 못했어요.", "Could not load the sample."),
      );
    } finally {
      setBusy(null);
    }
  }

  const history = Object.entries(
    meals
      .filter((m) => m.date !== today)
      .reduce<Record<string, Meal[]>>((acc, m) => {
        (acc[m.date] ??= []).push(m);
        return acc;
      }, {}),
  ).slice(0, 7);

  return (
    <section className="meals" aria-labelledby="meals-title">
      <div className="page-head">
        <h1 id="meals-title">{tr("식사", "Meals")}</h1>
        <p>
          {tr(
            "사진만 찍으면 음식과 단백질이 자동으로 기록돼요.",
            "Just take a photo. Foods and protein are logged for you.",
          )}
        </p>
      </div>

      <div className="card meal-summary">
        <ProteinBar
          protein={intake.proteinG}
          goal={proteinGoal}
          provisional={intake.provisional}
        />
        <div className="meal-summary-row">
          <span>{tr(`${intake.meals}끼`, `${intake.meals} meals`)}</span>
          <span>{intake.kcal} kcal</span>
        </div>
      </div>

      <div className="capture-row">
        <label className={`capture-button${busy === "before" ? " busy" : ""}`}>
          {busy === "before" ? (
            <LoaderCircle className="spin" size={22} />
          ) : (
            <Camera size={22} />
          )}
          <span>
            <strong>
              {busy === "before"
                ? tr("음식을 찾는 중", "Finding foods")
                : tr("식사 사진 찍기", "Snap your meal")}
            </strong>
            <small>
              {busy === "before"
                ? tr("약 15초 걸려요", "About 15 seconds")
                : tr("먹기 전에 한 장", "One photo before eating")}
            </small>
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void addBefore(file);
            }}
          />
        </label>
        <button
          type="button"
          className="sample-button"
          disabled={busy !== null}
          onClick={() => void addSample()}
        >
          <Sparkles size={18} />
          {tr("샘플", "Sample")}
        </button>
      </div>
      <p className="lens-credit">
        <ScanSearch size={13} />
        {tr(
          "Meta SAM 3.1이 음식을 하나씩 찾고 Muse Spark가 양과 단백질을 추정해요",
          "Meta SAM 3.1 finds each food and Muse Spark estimates amount and protein",
        )}
      </p>
      {error && (
        <p className="meal-error" role="alert">
          {error}
        </p>
      )}

      {pending && openId !== pending.id && (
        <button
          className="card after-nudge"
          onClick={() => setOpenId(pending.id)}
        >
          <img src={pending.thumb} alt="" />
          <span>
            <strong>{tr("다 드셨나요?", "Finished eating?")}</strong>
            <small>
              {tr(
                "식후 사진을 올리면 실제로 먹은 양으로 바뀌어요",
                "Add an after photo to count what you actually ate",
              )}
            </small>
          </span>
        </button>
      )}

      <ul className="meal-cards">
        {todays.map((meal) => {
          const open = openId === meal.id;
          return (
            <li
              key={meal.id}
              className={`card meal-card${open ? " open" : ""}`}
            >
              <button
                type="button"
                className="meal-card-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : meal.id)}
              >
                <img src={meal.thumb} alt="" />
                <span className="meal-card-text">
                  <strong>
                    {SLOT_LABEL[meal.slot][lang]}
                    <small>
                      {new Date(meal.at).toLocaleTimeString(
                        lang === "ko" ? "ko-KR" : "en-US",
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                    </small>
                  </strong>
                  <span>{meal.result.items.map((i) => i.name).join(", ")}</span>
                </span>
                <span className="meal-card-protein">
                  {Math.round(mealProtein(meal))}g
                  <small>
                    {meal.status === "eaten"
                      ? tr("먹음", "eaten")
                      : tr("차림", "served")}
                  </small>
                </span>
              </button>
              {open && (
                <div className="meal-card-body">
                  <div className="lens-pair">
                    <figure className="lens-shot">
                      <img
                        src={meal.image ?? meal.thumb}
                        alt={tr("식전", "Before")}
                      />
                      <Boxes result={meal.result} which="boxes_before" />
                      <figcaption>{tr("식전", "Before")}</figcaption>
                    </figure>
                    {meal.afterThumb ? (
                      <figure className="lens-shot">
                        <img src={meal.afterThumb} alt={tr("식후", "After")} />
                        <Boxes result={meal.result} which="boxes_after" />
                        <figcaption>{tr("식후", "After")}</figcaption>
                      </figure>
                    ) : (
                      <label
                        className={`lens-shot after-slot${busy === meal.id ? " busy" : ""}`}
                      >
                        {busy === meal.id ? (
                          <LoaderCircle className="spin" size={22} />
                        ) : (
                          <Camera size={22} />
                        )}
                        <span>
                          {busy === meal.id
                            ? tr("비교 중", "Comparing")
                            : tr("식후 사진 올리기", "Add after photo")}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          hidden
                          disabled={busy !== null || !meal.image || !live}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            void addAfter(meal, file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <ul className="lens-items">
                    {meal.result.items.map((item, i) => (
                      <li key={`${item.name}-${i}`}>
                        <span
                          className="legend-dot"
                          style={{ background: COLORS[i % COLORS.length] }}
                        />
                        <span className="lens-name">
                          {item.name}
                          <small>
                            {meal.status === "eaten" &&
                            item.countable &&
                            item.count_after !== null
                              ? tr(
                                  `${item.count_before}조각 → ${item.count_after}조각`,
                                  `${item.count_before} → ${item.count_after} pieces`,
                                )
                              : `${tr("단백질", "protein")} ${item.protein_g}g`}
                          </small>
                        </span>
                        <span className="lens-bar">
                          <span
                            style={{
                              width: `${meal.status === "eaten" ? (item.eaten_pct ?? 0) : 100}%`,
                              background: COLORS[i % COLORS.length],
                              opacity: meal.status === "eaten" ? 1 : 0.35,
                            }}
                          />
                        </span>
                        <span className="lens-num">
                          {meal.status === "eaten"
                            ? `${item.eaten_pct ?? 0}%`
                            : "-"}
                          {meal.status === "eaten" && item.protein_eaten_g ? (
                            <small>{item.protein_eaten_g}g</small>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="meal-card-foot">
                    <span>
                      <Check size={14} />
                      {meal.status === "eaten"
                        ? tr(
                            `먹은 단백질 ${meal.result.totals.protein_eaten_g}g, ${meal.result.totals.kcal_eaten}kcal`,
                            `Ate ${meal.result.totals.protein_eaten_g}g protein, ${meal.result.totals.kcal_eaten} kcal`,
                          )
                        : tr(
                            `차려진 단백질 ${meal.result.totals.protein_g}g, ${meal.result.totals.kcal}kcal`,
                            `Served ${meal.result.totals.protein_g}g protein, ${meal.result.totals.kcal} kcal`,
                          )}
                    </span>
                    <button
                      type="button"
                      className="history-delete"
                      aria-label={tr("이 식사 지우기", "Delete this meal")}
                      onClick={() => onDelete(meal.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="field-hint">
                    {tr(
                      "사진으로 추정한 값이에요. 실제와 다를 수 있어요.",
                      "Estimated from photos; actual values may differ.",
                    )}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {todays.length === 0 && (
        <p className="empty-line">
          {tr(
            "오늘 찍은 식사가 아직 없어요.",
            "No meals photographed today yet.",
          )}
        </p>
      )}

      {history.length > 0 && (
        <>
          <h2 className="section-title">{tr("지난 식사", "Earlier")}</h2>
          <ul className="card past-days">
            {history.map(([date, dayMeals]) => {
              const day = intakeOn(dayMeals, date);
              return (
                <li key={date}>
                  <span className="past-date">
                    {date.slice(5).replace("-", "/")}
                  </span>
                  <span className="past-thumbs">
                    {dayMeals.slice(0, 4).map((m) => (
                      <img key={m.id} src={m.thumb} alt="" />
                    ))}
                  </span>
                  <span className="past-protein">
                    {Math.round(day.proteinG)}g
                    <small>{tr(`${day.meals}끼`, `${day.meals} meals`)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
