"""Voice check-in: Muse Voice Transcribe turns speech into text, Muse Spark turns the text
into a structured daily log (weight, water, protein, symptoms) with a strict JSON schema."""

import json
from datetime import date
from typing import Any

import httpx
from openai import OpenAI

from glpfit_agent.config import Settings

ASR_MODEL = "muse-voice-transcribe-1.0"
SYMPTOMS = [
    "nausea",
    "constipation",
    "diarrhea",
    "low_appetite",
    "cravings",
    "fatigue",
    "heartburn",
]

CHECKIN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "weight_kg": {"type": ["number", "null"]},
        "water_cups": {"type": ["integer", "null"]},
        "protein_servings": {"type": ["integer", "null"]},
        "symptoms": {"type": "array", "items": {"type": "string", "enum": SYMPTOMS}},
        "injection_today": {"type": "boolean"},
        "note": {"type": "string"},
    },
    "required": [
        "weight_kg",
        "water_cups",
        "protein_servings",
        "symptoms",
        "injection_today",
        "note",
    ],
    "additionalProperties": False,
}

EXTRACT_PROMPT = """\
Today is {today}. Turn this spoken daily check-in from a person using weekly GLP-1 \
injections into a structured log. Use null for anything not mentioned; never guess numbers.
- weight_kg: body weight in kg (e.g. "79점2" → 79.2)
- water_cups: cups/glasses of water (1 bottle 500ml ≈ 2 cups)
- protein_servings: meals or snacks with a clear protein food (meat, fish, egg, tofu, \
protein shake)
- symptoms: only from {symptoms}
- injection_today: true only if they say they injected today
- note: one short {language} sentence with anything else useful (mood, sleep, exercise), or ""

Transcript: \"\"\"{text}\"\"\""""


def transcript_text(data: Any) -> str:
    """The ASR response shape is not documented in detail; collect any text fields."""
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        for key in ("text", "transcript", "transcription"):
            if isinstance(data.get(key), str) and data[key].strip():
                return data[key]
        parts = [transcript_text(value) for key, value in data.items() if key != "sessionId"]
        return " ".join(part for part in parts if part).strip()
    if isinstance(data, list):
        return " ".join(part for part in (transcript_text(item) for item in data) if part)
    return ""


def transcribe(settings: Settings, wav: bytes) -> str:
    response = httpx.post(
        f"{settings.meta_base_url.rstrip('/')}/asr/transcribe",
        headers={"Authorization": f"Bearer {settings.api_key}", "Accept": "application/json"},
        files={
            "request": (
                None,
                json.dumps({"model": ASR_MODEL, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"}),
                "application/json",
            ),
            "audio": ("checkin.wav", wav, "audio/wav"),
        },
        timeout=settings.meta_timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"음성 인식 실패 (HTTP {response.status_code})")
    try:
        return transcript_text(response.json()).strip()
    except ValueError:
        return response.text.strip()


def extract_checkin(
    client: OpenAI, settings: Settings, text: str, today: date, lang: str = "ko"
) -> dict:
    response = client.responses.create(
        model=settings.meta_model,
        store=False,
        max_output_tokens=settings.meta_max_output_tokens,
        input=EXTRACT_PROMPT.format(
            today=today.isoformat(),
            symptoms=", ".join(SYMPTOMS),
            text=text,
            language="English" if lang == "en" else "Korean",
        ),
        text={
            "format": {
                "type": "json_schema",
                "name": "checkin",
                "schema": CHECKIN_SCHEMA,
                "strict": True,
            }
        },
    )
    if response.status != "completed" or not response.output_text.strip():
        raise RuntimeError("체크인 내용을 정리하지 못했습니다.")
    data = json.loads(response.output_text)
    weight = data.get("weight_kg")
    if weight is not None and not 25 <= weight <= 350:
        data["weight_kg"] = None
    for key, high in (("water_cups", 30), ("protein_servings", 10)):
        if data.get(key) is not None and not 0 <= data[key] <= high:
            data[key] = None
    data["symptoms"] = [s for s in dict.fromkeys(data.get("symptoms", [])) if s in SYMPTOMS]
    data["note"] = str(data.get("note", ""))[:200]
    return data
