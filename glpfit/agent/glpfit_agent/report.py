"""Clinician report: deterministic stats from the user's own records, written up by Muse
Spark with a strict schema so the user can bring one page to their appointment."""

import json
from datetime import date, timedelta
from typing import Any

from openai import OpenAI

from glpfit_agent.config import Settings
from glpfit_agent.medication import DRUGS, PHASES, phase_for
from glpfit_agent.profile import SYMPTOM_TEXT, CoachContext, medication_schedule, progress

REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "weight": {"type": "string"},
        "medication": {"type": "string"},
        "intake": {"type": "string"},
        "side_effects": {"type": "string"},
        "questions_for_clinician": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "headline",
        "weight",
        "medication",
        "intake",
        "side_effects",
        "questions_for_clinician",
    ],
    "additionalProperties": False,
}

REPORT_PROMPT = """\
Write a one-page {language} summary a person on weekly GLP-1 injections can show their \
clinician, using ONLY the JSON facts below. Neutral, factual tone, short sentences, \
numbers with units, say "self-logged / photo estimate" (in that language) where values \
come from self-logs or photos.
- headline: one sentence overview of the period
- weight, medication, intake, side_effects: 1-3 sentences each; mention the \
symptom-by-injection-day pattern if present
- questions_for_clinician: 2-4 concrete questions the person may want to ask \
(never recommend a dose change yourself)

Facts:
{facts}"""


SYMPTOM_EN = {
    "nausea": "nausea",
    "constipation": "constipation",
    "diarrhea": "diarrhea",
    "low_appetite": "low appetite",
    "cravings": "cravings",
    "fatigue": "fatigue",
    "heartburn": "heartburn",
}
PHASE_EN = {"주사 직후": "right after shot", "안정기": "steady", "다음 주사 전": "before next shot"}


def symptoms_by_cycle(ctx: CoachContext | None, lang: str = "ko") -> list[dict]:
    """Which days after an injection symptoms were logged: the cycle-day pattern."""
    if ctx is None or not ctx.injections:
        return []
    shots = sorted(date.fromisoformat(shot.date) for shot in ctx.injections)
    rows: dict[int, dict[str, int]] = {}
    for log in ctx.logs:
        day = date.fromisoformat(log.date)
        prior = [shot for shot in shots if shot <= day]
        if not prior or (day - prior[-1]).days > 7:
            continue
        cycle_day = (day - prior[-1]).days + 1
        counts = rows.setdefault(cycle_day, {"logged": 0})
        counts["logged"] += 1
        for symptom in log.symptoms:
            counts[symptom] = counts.get(symptom, 0) + 1
    return [
        {
            "cycle_day": cycle_day,
            "phase": (
                PHASE_EN[phase_for(cycle_day - 1)["name"]]
                if lang == "en"
                else phase_for(cycle_day - 1)["name"]
            ),
            "logged_days": counts.pop("logged"),
            "symptoms": {
                (SYMPTOM_EN if lang == "en" else SYMPTOM_TEXT)[s]: n for s, n in counts.items()
            },
        }
        for cycle_day, counts in sorted(rows.items())
    ]


def dose_history(ctx: CoachContext | None) -> list[dict]:
    """Dose steps with the date each one started."""
    if ctx is None:
        return []
    steps: list[dict] = []
    for shot in sorted(ctx.injections, key=lambda s: s.date):
        if not steps or steps[-1]["dose_mg"] != shot.dose_mg:
            name = DRUGS.get(shot.drug, {}).get("name", "기타")
            steps.append({"drug": name, "dose_mg": shot.dose_mg, "from": shot.date, "shots": 0})
        steps[-1]["shots"] += 1
    return steps


def report_facts(ctx: CoachContext | None, today: date, days: int = 30, lang: str = "ko") -> dict:
    stats = progress(ctx, days, today=today)
    stats.pop("recent", None)
    return {
        "period": {"from": (today - timedelta(days=days - 1)).isoformat(), "to": today.isoformat()},
        "progress": stats,
        "schedule": medication_schedule(ctx, today),
        "dose_history": dose_history(ctx),
        "symptoms_by_cycle_day": symptoms_by_cycle(ctx, lang),
        "phases": [{"days_after_shot": p["days"], "name": p["name"]} for p in PHASES],
        "plate_lens_meals": [note for log in (ctx.logs if ctx else []) for note in log.meal_notes][
            -10:
        ],
    }


def write_report(client: OpenAI, settings: Settings, facts: dict, lang: str = "ko") -> dict:
    response = client.responses.create(
        model=settings.meta_model,
        store=False,
        max_output_tokens=settings.meta_max_output_tokens,
        input=REPORT_PROMPT.format(
            language="English" if lang == "en" else "Korean",
            facts=json.dumps(facts, ensure_ascii=False),
        ),
        text={
            "format": {
                "type": "json_schema",
                "name": "clinician_report",
                "schema": REPORT_SCHEMA,
                "strict": True,
            }
        },
    )
    if response.status != "completed" or not response.output_text.strip():
        raise RuntimeError("리포트를 작성하지 못했습니다. 잠시 후 다시 시도하세요.")
    return json.loads(response.output_text)
