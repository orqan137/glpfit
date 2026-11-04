"""Weekly GLP-1 class injections: label dose ladders, injection cycle and site rotation.

Reference data only (from the products' public labels); the prescriber's plan always wins.
"""

from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from glpfit_agent.wire import WIRE_CONFIG

Drug = Literal["mounjaro", "wegovy", "other"]
Site = Literal[
    "abdomen_left", "abdomen_right", "thigh_left", "thigh_right", "arm_left", "arm_right"
]


class Injection(BaseModel):
    model_config = WIRE_CONFIG
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    drug: Drug
    dose_mg: float = Field(gt=0, le=50)
    site: Site | None = None


DRUGS: dict[str, dict] = {
    "mounjaro": {
        "name": "마운자로",
        "ingredient": "티르제파타이드 (GIP/GLP-1 이중 작용)",
        "ladder_mg": [2.5, 5.0, 7.5, 10.0, 12.5, 15.0],
        "step_weeks": 4,
        "missed_dose": "놓친 뒤 4일(96시간) 이내면 바로 맞고, 지났으면 건너뛰고 다음 예정일에 맞음",
    },
    "wegovy": {
        "name": "위고비",
        "ingredient": "세마글루타이드 (GLP-1 작용)",
        "ladder_mg": [0.25, 0.5, 1.0, 1.7, 2.4],
        "step_weeks": 4,
        "missed_dose": "다음 예정일까지 2일(48시간) 넘게 남았으면 바로 맞고, 아니면 건너뜀",
    },
}
SITE_TEXT = {
    "abdomen_left": "배 왼쪽",
    "abdomen_right": "배 오른쪽",
    "thigh_left": "왼쪽 허벅지",
    "thigh_right": "오른쪽 허벅지",
    "arm_left": "왼팔 뒤쪽",
    "arm_right": "오른팔 뒤쪽",
}
SITE_ORDER = list(SITE_TEXT)

# Patterns many users report across a weekly shot cycle. Coaching hints, not medical facts.
PHASES = [
    {
        "days": (0, 1),
        "name": "주사 직후",
        "focus": "식욕이 가장 줄고 메스꺼움이 오기 쉬운 시기",
        "coach": "소량·담백하게, 단백질 먼저, 물은 조금씩 자주",
        "topics": ["nausea", "protein", "hydration"],
    },
    {
        "days": (2, 4),
        "name": "안정기",
        "focus": "몸이 적응해 컨디션이 고른 시기",
        "coach": "규칙적인 세 끼와 가벼운 근력 운동으로 근육 지키기",
        "topics": ["protein", "activity", "portion"],
    },
    {
        "days": (5, 7),
        "name": "다음 주사 전",
        "focus": "식욕이 돌아오고 간식·야식이 당기기 쉬운 시기",
        "coach": "간식을 미리 정해 두고 천천히 먹기, 단 음료 줄이기",
        "topics": ["eating_pace", "portion", "logging"],
    },
]


def phase_for(days_since: int) -> dict:
    for phase in PHASES:
        low, high = phase["days"]
        if low <= days_since <= high:
            return phase
    return PHASES[-1]


def schedule(
    injections: list[Injection],
    drug: str | None,
    dose_mg: float | None,
    injection_weekday: int | None,
    today: date,
) -> dict:
    """Everything about the shot cycle the coach and the UI need, computed once."""
    shots = sorted(injections, key=lambda shot: shot.date)
    last = shots[-1] if shots else None
    drug = (last.drug if last else None) or drug
    dose_mg = (last.dose_mg if last else None) or dose_mg
    out: dict = {"today": today.isoformat(), "injection_count": len(shots)}
    info = DRUGS.get(drug or "")
    if info:
        out["drug"] = {"name": info["name"], "ingredient": info["ingredient"]}
    elif drug:
        out["drug"] = {"name": "기타 주 1회 주사"}
    if dose_mg:
        out["current_dose_mg"] = dose_mg
    if last is None:
        if injection_weekday is not None:
            ahead = (injection_weekday - (today.weekday() + 1) % 7) % 7
            out["next_due"] = (today + timedelta(days=ahead)).isoformat()
        out["summary"] = "아직 주사 기록이 없습니다. 첫 주사를 기록하면 주기 코칭이 시작됩니다."
    else:
        last_day = date.fromisoformat(last.date)
        since = (today - last_day).days
        due = last_day + timedelta(days=7)
        out["last_injection"] = last.model_dump(exclude_none=True)
        out["days_since_last"] = since
        out["next_due"] = due.isoformat()
        out["days_until_next"] = (due - today).days
        if since > 7:
            out["overdue_days"] = since - 7
            if info:
                out["missed_dose_rule"] = info["missed_dose"]
        phase = phase_for(min(since, 7))
        out["cycle"] = {
            "day": since + 1,
            "phase": phase["name"],
            "focus": phase["focus"],
            "coach": phase["coach"],
            "topics": phase["topics"],
        }
        # Rotate sites: next one after the last used site.
        if last.site:
            out["next_site"] = SITE_TEXT[SITE_ORDER[(SITE_ORDER.index(last.site) + 1) % 6]]
    if info and dose_mg:
        ladder = info["ladder_mg"]
        weeks_on_dose = 0
        for shot in reversed(shots):
            if shot.dose_mg != dose_mg:
                break
            weeks_on_dose += 1
        out["ladder"] = {
            "steps_mg": ladder,
            "step_index": ladder.index(dose_mg) if dose_mg in ladder else None,
            "weeks_on_current_dose": weeks_on_dose,
            "label_step_weeks": info["step_weeks"],
            "note": (
                "제품 설명서 기준 참고용 증량 단계입니다. "
                "용량 변경은 반드시 처방 의료진이 결정합니다."
            ),
        }
    return out
