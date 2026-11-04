"""User context the browser keeps (profile, daily logs, coach memories) and the
personalized coaching that is derived from it on the server."""

from datetime import date, datetime, timedelta
from statistics import mean
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from glpfit_agent.medication import Drug, Injection, schedule
from glpfit_agent.wire import WIRE_CONFIG

KST = ZoneInfo("Asia/Seoul")

Concern = Literal["nausea", "constipation", "low_appetite", "cravings", "fatigue", "muscle_loss"]
Symptom = Literal[
    "nausea", "constipation", "diarrhea", "low_appetite", "cravings", "fatigue", "heartburn"
]

GOAL_TEXT = {
    "lose": "체중 감량",
    "maintain": "체중 유지",
    "muscle": "근육 지키며 감량",
}
TONE_TEXT = {
    "gentle": "다정하고 부담 없는 말투, 잘한 점을 먼저 짚기",
    "direct": "핵심만 짧고 분명하게, 숫자와 행동 위주",
    "cheerful": "밝고 응원하는 말투, 가벼운 이모지 1개까지 허용",
}
CONCERN_TEXT = {
    "nausea": "메스꺼움",
    "constipation": "변비",
    "low_appetite": "식욕 저하로 너무 적게 먹음",
    "cravings": "야식·단 음식 당김",
    "fatigue": "피로",
    "muscle_loss": "근손실 걱정",
}
SYMPTOM_TEXT = {
    "nausea": "메스꺼움",
    "constipation": "변비",
    "fatigue": "피로",
    "diarrhea": "설사",
    "low_appetite": "식욕 저하",
    "cravings": "음식 당김",
    "heartburn": "속쓰림",
}
WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"]  # JS Date.getDay() order


class Profile(BaseModel):
    model_config = WIRE_CONFIG
    nickname: str = Field(default="", max_length=20)
    goal: Literal["lose", "maintain", "muscle"] = "lose"
    height_cm: float | None = Field(default=None, ge=100, le=250)
    start_weight_kg: float | None = Field(default=None, ge=25, le=350)
    target_weight_kg: float | None = Field(default=None, ge=25, le=350)
    drug: Drug | None = None
    dose_mg: float | None = Field(default=None, gt=0, le=50)
    medication: str = Field(default="", max_length=40)
    # 0 = Sunday, matching the browser's Date.getDay().
    injection_weekday: int | None = Field(default=None, ge=0, le=6)
    concerns: list[Concern] = Field(default_factory=list, max_length=6)
    diet_notes: str = Field(default="", max_length=200)
    tone: Literal["gentle", "direct", "cheerful"] = "gentle"


class DailyLog(BaseModel):
    model_config = WIRE_CONFIG
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    weight_kg: float | None = Field(default=None, ge=25, le=350)
    water_cups: int | None = Field(default=None, ge=0, le=30)
    protein_servings: int | None = Field(default=None, ge=0, le=10)
    # Grams eaten, measured by Plate Lens (Muse Spark vision + SAM 3.1).
    protein_g: float | None = Field(default=None, ge=0, le=500)
    symptoms: list[Symptom] = Field(default_factory=list, max_length=7)
    meal_notes: list[str] = Field(default_factory=list, max_length=6)
    # Bodyweight sets done that day and what they were.
    exercise_sets: int | None = Field(default=None, ge=0, le=100)
    exercise_notes: list[str] = Field(default_factory=list, max_length=4)
    note: str = Field(default="", max_length=200)


class CoachContext(BaseModel):
    model_config = WIRE_CONFIG
    profile: Profile | None = None
    logs: list[DailyLog] = Field(default_factory=list, max_length=60)
    memories: list[str] = Field(default_factory=list, max_length=30)
    injections: list[Injection] = Field(default_factory=list, max_length=60)


def today_kst() -> date:
    return datetime.now(KST).date()


def injection_line(profile: Profile, today: date) -> str | None:
    if profile.injection_weekday is None:
        return None
    js_today = (today.weekday() + 1) % 7  # Python Monday=0 → JS Sunday=0
    since = (js_today - profile.injection_weekday) % 7
    day = WEEKDAYS[profile.injection_weekday]
    if since == 0:
        return f"오늘은 주사하는 날({day}요일)입니다."
    return f"주사일은 {day}요일이고, 오늘은 주사 후 {since}일째입니다."


def progress(ctx: CoachContext | None, days: int, today: date | None = None) -> dict:
    """Deterministic stats so the model never has to do arithmetic on raw logs."""
    today = today or today_kst()
    since = today - timedelta(days=days - 1)
    logs = sorted(
        (log for log in (ctx.logs if ctx else []) if since.isoformat() <= log.date),
        key=lambda log: log.date,
    )
    profile = ctx.profile if ctx else None
    out: dict = {"days": days, "logged_days": len(logs), "from": since.isoformat()}
    if not logs:
        out["summary"] = "이 기간에 기록이 없습니다."
        return out
    weights = [(log.date, log.weight_kg) for log in logs if log.weight_kg is not None]
    if weights:
        out["weight"] = {
            "first": {"date": weights[0][0], "kg": weights[0][1]},
            "latest": {"date": weights[-1][0], "kg": weights[-1][1]},
            "change_kg": round(weights[-1][1] - weights[0][1], 1),
        }
        if profile and profile.start_weight_kg:
            out["weight"]["since_start_kg"] = round(weights[-1][1] - profile.start_weight_kg, 1)
        if profile and profile.target_weight_kg:
            out["weight"]["to_target_kg"] = round(weights[-1][1] - profile.target_weight_kg, 1)
    water = [log.water_cups for log in logs if log.water_cups is not None]
    if water:
        out["avg_water_cups"] = round(mean(water), 1)
    protein = [log.protein_servings for log in logs if log.protein_servings is not None]
    if protein:
        out["avg_protein_servings"] = round(mean(protein), 1)
    grams = [log.protein_g for log in logs if log.protein_g is not None]
    if grams:
        out["avg_protein_g_measured"] = round(mean(grams), 1)
        if profile and profile.start_weight_kg:
            # Common guidance during weight loss is roughly 1.0-1.2 g per kg body weight.
            out["protein_g_reference"] = round(profile.start_weight_kg * 1.0)
    workouts = [log.exercise_sets for log in logs if log.exercise_sets]
    out["exercise_days"] = len(workouts)
    if workouts:
        out["exercise_sets_total"] = sum(workouts)
    counts: dict[str, int] = {}
    for log in logs:
        for symptom in log.symptoms:
            counts[SYMPTOM_TEXT[symptom]] = counts.get(SYMPTOM_TEXT[symptom], 0) + 1
    out["symptom_days"] = dict(sorted(counts.items(), key=lambda kv: -kv[1]))
    out["recent"] = [
        log.model_dump(exclude_defaults=True) for log in logs[-7:]
    ]  # newest last, compact
    streak = 0
    dates = {log.date for log in logs}
    cursor = today
    while cursor.isoformat() in dates:
        streak += 1
        cursor -= timedelta(days=1)
    out["streak_days"] = streak
    return out


def medication_schedule(ctx: CoachContext | None, today: date | None = None) -> dict:
    profile = ctx.profile if ctx else None
    return schedule(
        ctx.injections if ctx else [],
        profile.drug if profile else None,
        profile.dose_mg if profile else None,
        profile.injection_weekday if profile else None,
        today or today_kst(),
    )


def cycle_line(ctx: CoachContext, today: date) -> str | None:
    """The shot-cycle part of the prompt: where in the weekly cycle the user is today."""
    profile = ctx.profile
    if not ctx.injections and not (profile and (profile.drug or profile.injection_weekday)):
        return None
    sched = medication_schedule(ctx, today)
    parts = []
    if drug := sched.get("drug"):
        parts.append(f"약: {drug['name']} {drug.get('ingredient', '')}".strip())
    if dose := sched.get("current_dose_mg"):
        parts.append(f"현재 용량 {dose:g}mg")
    if cycle := sched.get("cycle"):
        parts.append(
            f"오늘은 주사 후 {cycle['day']}일째 ({cycle['phase']}: {cycle['focus']}). "
            f"이 시기 코칭 초점: {cycle['coach']}"
        )
    elif profile and (line := injection_line(profile, today)):
        parts.append(line)
    if overdue := sched.get("overdue_days"):
        parts.append(f"예정 주사일이 {overdue}일 지났습니다")
    elif "days_until_next" in sched:
        parts.append(f"다음 주사까지 {sched['days_until_next']}일")
    return (
        "Weekly shot cycle — "
        + " / ".join(parts)
        + ". Tailor food advice to this cycle phase; call get_medication_schedule for "
        "dose, schedule or missed-dose questions, and never recommend a dose change."
    )


def personal_instructions(ctx: CoachContext | None, today: date | None = None) -> str:
    """The per-user part of the system prompt. Empty when nothing is known yet."""
    if ctx is None:
        return ""
    today = today or today_kst()
    lines = [f"Today is {today.isoformat()} ({WEEKDAYS[(today.weekday() + 1) % 7]}요일, KST)."]
    profile = ctx.profile
    if profile:
        about = []
        if profile.nickname:
            about.append(f"호칭: {profile.nickname}님")
        about.append(f"목표: {GOAL_TEXT[profile.goal]}")
        if profile.start_weight_kg and profile.target_weight_kg:
            about.append(f"시작 {profile.start_weight_kg}kg → 목표 {profile.target_weight_kg}kg")
        if profile.height_cm:
            about.append(f"키 {profile.height_cm:g}cm")
        if profile.medication:
            about.append(f"사용 중인 약: {profile.medication}")
        if profile.concerns:
            about.append("걱정: " + ", ".join(CONCERN_TEXT[c] for c in profile.concerns))
        if profile.diet_notes:
            about.append(f"식습관 메모: {profile.diet_notes}")
        lines.append("User profile — " + " / ".join(about) + ".")
        lines.append(f"Tone: {TONE_TEXT[profile.tone]}.")
    if line := cycle_line(ctx, today):
        lines.append(line)
    if ctx.logs:
        lines.append(
            f"The user has {len(ctx.logs)} days of logs. Call get_progress before commenting on "
            "weight, water, protein or symptom trends."
        )
    else:
        lines.append("No daily logs yet: encourage logging weight, the shot and a meal photo.")
    return " ".join(lines)
