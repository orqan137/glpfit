import json
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from openai.types.responses import ToolParam
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from glpfit_agent.profile import CoachContext, medication_schedule, progress
from glpfit_agent.wire import WIRE_CONFIG

TIP_TOPICS = (
    "eating_pace",
    "portion",
    "protein",
    "hydration",
    "nausea",
    "constipation",
    "activity",
    "logging",
)

TOOLS: list[ToolParam] = [
    {
        "type": "function",
        "name": "get_current_time",
        "description": "Get the actual current time in an IANA timezone, e.g. Asia/Seoul.",
        "parameters": {
            "type": "object",
            "properties": {"timezone": {"type": "string"}},
            "required": ["timezone"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "analyze_meal",
        "description": (
            "Analyze the attached meal data: before/after food photo features "
            "and/or meal recording features. Call only when the user attached meal data."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": ["photos", "audio", "bowel", "motion", "all"],
                }
            },
            "required": ["target"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_coaching_tips",
        "description": (
            "Get vetted, general lifestyle tips for people on GLP-1 medication "
            "(eating pace, portions, protein, hydration, nausea, constipation, activity, "
            "logging). Use these as the basis of coaching advice instead of inventing "
            "medical guidance."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "topics": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(TIP_TOPICS)},
                    "minItems": 1,
                    "maxItems": 4,
                }
            },
            "required": ["topics"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_progress",
        "description": (
            "Get the user's own logged progress for the last N days: weight change, "
            "distance to target, average water and protein, symptom frequency, logging "
            "streak and the latest daily logs. Use before commenting on any trend."
        ),
        "parameters": {
            "type": "object",
            "properties": {"days": {"type": "integer", "enum": [7, 14, 30]}},
            "required": ["days"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "remember",
        "description": (
            "Save one short, durable fact about the user for future coaching, e.g. "
            "'기름진 음식 먹으면 메스꺼움', '아침을 거름', '저녁 걷기 30분 선호'. "
            "Only for stable preferences or patterns the user told you or the logs show; "
            "never for one-off events. At most one call per answer."
        ),
        "parameters": {
            "type": "object",
            "properties": {"fact": {"type": "string"}},
            "required": ["fact"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_medication_schedule",
        "description": (
            "Get the user's weekly injection schedule from their own injection log: drug and "
            "ingredient, current dose, days since last shot, cycle day and phase with its "
            "coaching focus, next due date, overdue days with the label's missed-dose rule, "
            "next injection site to rotate to, and the label dose ladder for reference."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        "strict": True,
    },
]

# General wellness guidance only: no dosing, diagnosis or efficacy claims.
COACHING_TIPS: dict[str, dict[str, str | list[str]]] = {
    "eating_pace": {
        "title": "천천히 먹기",
        "tips": [
            "한 입마다 수저를 내려놓고 15~20회 씹어 보세요.",
            "식사 시간을 20분 이상으로 잡으면 포만감 신호를 알아차리기 쉽습니다.",
        ],
    },
    "portion": {
        "title": "적은 양 나눠 먹기",
        "tips": [
            "작은 그릇에 담고, 배부름이 느껴지면 남겨도 괜찮습니다.",
            "한 번에 많이 먹기보다 하루 식사를 작게 나누면 속이 편할 수 있습니다.",
        ],
    },
    "protein": {
        "title": "단백질 먼저",
        "tips": [
            "식사량이 줄 때는 달걀·두부·생선·살코기 같은 단백질을 먼저 드세요.",
            "근육 유지를 위해 매 끼니 손바닥 크기의 단백질을 목표로 해 보세요.",
        ],
    },
    "hydration": {
        "title": "수분 챙기기",
        "tips": [
            "하루 동안 물을 조금씩 자주 마시세요. "
            "식사 직전·직후 많은 양은 피하는 게 편할 수 있습니다.",
            "소변 색이 진하면 수분이 부족하다는 신호일 수 있습니다.",
        ],
    },
    "nausea": {
        "title": "메스꺼움 줄이기",
        "tips": [
            "기름지거나 매운 음식, 과식을 피하고 담백한 음식을 조금씩 드세요.",
            "식후 바로 눕지 말고 가볍게 움직이세요. 증상이 심하거나 계속되면 의료진과 상의하세요.",
        ],
    },
    "constipation": {
        "title": "장 건강",
        "tips": [
            "채소·통곡물 같은 식이섬유와 충분한 물을 함께 챙기세요.",
            "식후 가벼운 걷기가 장 움직임에 도움이 될 수 있습니다. "
            "불편이 지속되면 의료진과 상의하세요.",
        ],
    },
    "activity": {
        "title": "근력·활동",
        "tips": [
            "체중이 줄 때 근육도 함께 줄 수 있어, 주 2~3회 가벼운 근력 운동이 도움이 됩니다.",
            "앉았다 일어서기처럼 집에서 할 수 있는 동작을 꾸준히 기록해 변화를 보세요.",
        ],
    },
    "logging": {
        "title": "꾸준한 기록",
        "tips": [
            "같은 조명·각도로 식전·식후 사진을 찍으면 비교가 정확해집니다.",
            "기록을 진료 때 보여 주면 의료진과 대화하는 데 도움이 됩니다.",
        ],
    },
}


def coaching_tips(topics: list[str]) -> dict:
    return {
        "tips": [{"topic": topic, **COACHING_TIPS[topic]} for topic in dict.fromkeys(topics)],
        "note": "일반적인 생활 습관 정보이며 의학적 진단·처방이 아닙니다.",
    }


class ProgressArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    days: Literal[7, 14, 30]


class RememberArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    fact: str = Field(min_length=2, max_length=120)


class TipArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    topics: list[Literal[TIP_TOPICS]] = Field(min_length=1, max_length=4)  # type: ignore[valid-type]


class TimeArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    timezone: str


class PhotoFeatures(BaseModel):
    """Heuristic features computed in the browser from a meal photo."""

    model_config = WIRE_CONFIG
    filename: str = Field(min_length=1, max_length=200)
    width: int = Field(ge=1, le=8000)
    height: int = Field(ge=1, le=8000)
    brightness: float = Field(ge=0, le=255)
    colorfulness: float = Field(ge=0, le=300)
    blur: float = Field(ge=0)
    food_pixel_ratio: float = Field(ge=0, le=1)


class AudioFeatures(BaseModel):
    """Heuristic features computed in the browser from a meal recording."""

    model_config = WIRE_CONFIG
    filename: str = Field(min_length=1, max_length=200)
    duration_sec: float = Field(gt=0, le=3600)
    active_ratio: float = Field(ge=0, le=1)
    chew_rate_per_min: float = Field(ge=0, le=300)
    pause_count: int = Field(ge=0, le=10000)
    mean_rms: float = Field(ge=0, le=1)


class BowelFeatures(BaseModel):
    """Heuristic bowel-sound features computed in the browser."""

    model_config = WIRE_CONFIG
    filename: str = Field(min_length=1, max_length=200)
    duration_sec: float = Field(gt=0, le=3600)
    event_count: int = Field(ge=0, le=10000)
    mean_interval_sec: float | None = Field(default=None, ge=0)
    events_per_min: float = Field(ge=0)


class MotionFeatures(BaseModel):
    """Heuristic sit-to-stand features from the phone accelerometer."""

    model_config = WIRE_CONFIG
    duration_sec: float = Field(gt=0, le=300)
    rep_count: int = Field(ge=0, le=100)
    mean_rep_sec: float = Field(ge=0, le=300)
    peak_accel_g: float = Field(ge=0, le=20)


class MealPayload(BaseModel):
    model_config = WIRE_CONFIG
    before: PhotoFeatures | None = None
    after: PhotoFeatures | None = None
    audio: AudioFeatures | None = None
    bowel: BowelFeatures | None = None
    motion: MotionFeatures | None = None

    @property
    def has_data(self) -> bool:
        return (
            self.before is not None
            or self.after is not None
            or self.audio is not None
            or self.bowel is not None
            or self.motion is not None
        )


class MealTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    target: Literal["photos", "audio", "bowel", "motion", "all"]


def analyze_photos(before: PhotoFeatures, after: PhotoFeatures | None) -> dict:
    result: dict = {"before": before.model_dump(), "after": None}
    if after is None:
        result["summary"] = (
            "식전 사진 1장을 분석했습니다. 식후 사진을 함께 첨부하면 변화를 추정합니다."
        )
        return result
    result["after"] = after.model_dump()
    if before.food_pixel_ratio > 0:
        eaten = (before.food_pixel_ratio - after.food_pixel_ratio) / before.food_pixel_ratio
        result["food_change_ratio"] = round(min(1.0, max(0.0, eaten)), 3)
    else:
        result["food_change_ratio"] = None
    result["summary"] = (
        "식전·식후 사진의 음식 영역 상대 변화를 추정한 값입니다. "
        "조명·각도·거리가 달라지면 어긋날 수 있는 추정치이며 절대 섭취량이 아닙니다."
    )
    return result


def analyze_audio(audio: AudioFeatures) -> dict:
    active_min = audio.duration_sec * audio.active_ratio / 60
    rate = audio.chew_rate_per_min
    pace = "빠른 편" if rate >= 70 else ("보통" if rate >= 40 else "여유 있는 편")
    return {
        "audio": audio.model_dump(),
        "active_minutes": round(active_min, 1),
        "estimated_chews": round(rate * audio.duration_sec / 60),
        "pace": pace,
        "summary": (
            "소리 활동 구간과 리듬에서 추정한 값입니다. 주변 소음과 개인차에 민감하며 "
            "실제 섭취량을 재는 것이 아닙니다."
        ),
    }


def analyze_bowel(bowel: BowelFeatures) -> dict:
    return {
        "bowel": bowel.model_dump(),
        "summary": (
            "조용한 환경에서 녹음된 장음 이벤트 수 추정치입니다. "
            "장음 검출과 위 배출 지연·약효 판단은 다른 문제이며 이 수치로 판단하지 않습니다."
        ),
    }


def analyze_motion(motion: MotionFeatures) -> dict:
    return {
        "motion": motion.model_dump(),
        "summary": (
            "휴대폰 가속도계로 잰 앉았다 일어서기 반복 추정치입니다. "
            "신체 기능의 변화를 추적하는 용도이며 낙상·질환 판단이 아닙니다."
        ),
    }


def analyze_meal(target: str, meal: MealPayload | None) -> dict:
    if meal is None or not meal.has_data:
        return {
            "error": (
                "첨부된 식사 데이터가 없습니다. 식전·식후 사진이나 식사 소리를 먼저 첨부하세요."
            )
        }
    if target == "photos":
        if meal.before is None:
            return {"error": "식전 사진 데이터가 없습니다."}
        return {"photos": analyze_photos(meal.before, meal.after)}
    if target == "audio":
        if meal.audio is None:
            return {"error": "식사 소리 데이터가 없습니다."}
        return {"audio": analyze_audio(meal.audio)}
    if target == "bowel":
        if meal.bowel is None:
            return {"error": "장음 데이터가 없습니다."}
        return {"bowel": analyze_bowel(meal.bowel)}
    if target == "motion":
        if meal.motion is None:
            return {"error": "일어서기 기록 데이터가 없습니다."}
        return {"motion": analyze_motion(meal.motion)}
    out: dict = {}
    if meal.before is not None:
        out["photos"] = analyze_photos(meal.before, meal.after)
    if meal.audio is not None:
        out["audio"] = analyze_audio(meal.audio)
    if meal.bowel is not None:
        out["bowel"] = analyze_bowel(meal.bowel)
    if meal.motion is not None:
        out["motion"] = analyze_motion(meal.motion)
    return out or {"error": "첨부된 식사 데이터가 없습니다."}


def execute_tool(
    name: str,
    arguments: str,
    meal: MealPayload | None = None,
    context: CoachContext | None = None,
) -> str:
    if name == "get_current_time":
        try:
            args = TimeArguments.model_validate_json(arguments)
            now = datetime.now(ZoneInfo(args.timezone))
        except (ValidationError, ZoneInfoNotFoundError, ValueError):
            return json.dumps({"error": "Provide a valid IANA timezone, e.g. Asia/Seoul"})
        return json.dumps({"timezone": args.timezone, "datetime": now.isoformat()})
    if name == "analyze_meal":
        try:
            target = MealTarget.model_validate_json(arguments).target
        except ValidationError:
            return json.dumps(
                {"error": "target은 photos, audio, bowel, motion, all 중 하나여야 합니다."}
            )
        return json.dumps(analyze_meal(target, meal))
    if name == "get_coaching_tips":
        try:
            topics = TipArguments.model_validate_json(arguments).topics
        except ValidationError:
            return json.dumps(
                {"error": f"topics는 {', '.join(TIP_TOPICS)} 중 1~4개여야 합니다."},
                ensure_ascii=False,
            )
        return json.dumps(coaching_tips(topics), ensure_ascii=False)
    if name == "get_progress":
        try:
            days = ProgressArguments.model_validate_json(arguments).days
        except ValidationError:
            return json.dumps({"error": "days는 7, 14, 30 중 하나여야 합니다."}, ensure_ascii=False)
        return json.dumps(progress(context, days), ensure_ascii=False)
    if name == "remember":
        try:
            fact = RememberArguments.model_validate_json(arguments).fact
        except ValidationError:
            return json.dumps({"error": "fact는 2~120자 문장이어야 합니다."}, ensure_ascii=False)
        # Storage lives in the browser: the agent loop forwards this as a memory event.
        return json.dumps({"saved": True, "fact": fact}, ensure_ascii=False)
    if name == "get_medication_schedule":
        return json.dumps(medication_schedule(context), ensure_ascii=False)
    return json.dumps({"error": "Unknown tool"})
