import json
from collections.abc import Iterator
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from glpfit_agent.agent import AgentEvent, agent_events, demo_events
from glpfit_agent.config import Settings, create_client
from glpfit_agent.plate import analyze_plate, plate_note
from glpfit_agent.profile import CoachContext, today_kst
from glpfit_agent.report import report_facts, write_report
from glpfit_agent.tools import TOOLS, MealPayload
from glpfit_agent.voice import extract_checkin, transcribe
from openai import APIConnectionError, APIStatusError, APITimeoutError
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(
    title="지엘피핏 Agent API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


def get_settings() -> Settings:
    return Settings()


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class RunRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    mode: Literal["demo", "live"] = "demo"
    prompt: str = Field(min_length=1, max_length=12000)
    meal: MealPayload | None = None
    # Profile, daily logs and coach memories live in the browser and ride along per run.
    context: CoachContext | None = None
    lang: Literal["ko", "en"] = "ko"
    # Earlier chat turns (text only), oldest first.
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model: str
    live_configured: bool
    max_steps: int
    tools: list[str]


MAX_IMAGE_CHARS = 12_000_000  # ~9MB image as a data URL
MAX_AUDIO_BYTES = 25 * 1024 * 1024


class PlateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    before: str = Field(pattern=r"^data:image/(png|jpeg|webp);base64,", max_length=MAX_IMAGE_CHARS)
    after: str | None = Field(
        default=None, pattern=r"^data:image/(png|jpeg|webp);base64,", max_length=MAX_IMAGE_CHARS
    )
    lang: Literal["ko", "en"] = "ko"


def require_key(settings: Settings) -> None:
    if not settings.has_key:
        raise HTTPException(
            status_code=503,
            detail="MODEL_API_KEY가 설정되지 않았습니다. .env 또는 env.txt를 확인하세요.",
        )


def upstream_error(exc: Exception) -> HTTPException:
    if isinstance(exc, APIStatusError):
        return HTTPException(502, f"Meta API HTTP {exc.status_code}. 키·크레딧을 확인하세요.")
    if isinstance(exc, (APITimeoutError, APIConnectionError, httpx.HTTPError)):
        return HTTPException(504, "Meta API에 연결하지 못했습니다. 잠시 후 다시 시도하세요.")
    return HTTPException(502, str(exc) or "분석에 실패했습니다.")


@app.post("/api/plate")
def plate(payload: PlateRequest, settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    """Plate Lens: Muse Spark vision + SAM 3.1 estimate what was eaten from photos."""
    require_key(settings)
    try:
        with create_client(settings) as client:
            result = analyze_plate(client, settings, payload.before, payload.after, payload.lang)
    except (APIStatusError, APITimeoutError, APIConnectionError, RuntimeError, ValueError) as exc:
        raise upstream_error(exc) from exc
    result["log_note"] = plate_note(result)
    return result


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context: CoachContext
    lang: Literal["ko", "en"] = "ko"


@app.post("/api/report")
def report(payload: ReportRequest, settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    """Clinician report: computed facts always; Muse Spark write-up when a key is set."""
    facts = report_facts(payload.context, today_kst(), lang=payload.lang)
    if not settings.has_key:
        return {"facts": facts, "report": None}
    try:
        with create_client(settings) as client:
            written = write_report(client, settings, facts, payload.lang)
    except (APIStatusError, APITimeoutError, APIConnectionError, RuntimeError, ValueError) as exc:
        raise upstream_error(exc) from exc
    return {"facts": facts, "report": written}


@app.post("/api/voice-checkin")
async def voice_checkin(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> dict:
    """Voice check-in: WAV body → Muse Voice Transcribe → Muse Spark structured log."""
    require_key(settings)
    wav = await request.body()
    if not wav or len(wav) > MAX_AUDIO_BYTES or not wav.startswith(b"RIFF"):
        raise HTTPException(422, "WAV 녹음(25MB 이하)을 보내 주세요.")

    def work() -> dict:
        text = transcribe(settings, wav)
        if not text:
            raise RuntimeError("말소리를 알아듣지 못했어요. 조금 더 크게 다시 말해 주세요.")
        with create_client(settings) as client:
            lang = "en" if request.query_params.get("lang") == "en" else "ko"
            log = extract_checkin(client, settings, text, today_kst(), lang)
        return {"transcript": text, "log": log}

    try:
        return await run_in_threadpool(work)
    except (
        APIStatusError,
        APITimeoutError,
        APIConnectionError,
        httpx.HTTPError,
        RuntimeError,
        ValueError,
    ) as exc:
        raise upstream_error(exc) from exc


@app.get("/api/health", response_model=HealthResponse)
def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(
        model=settings.meta_model,
        live_configured=settings.has_key,
        max_steps=settings.meta_max_agent_steps,
        tools=[tool["name"] for tool in TOOLS],
    )


def sse(event: AgentEvent) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def stream_run(payload: RunRequest, settings: Settings) -> Iterator[str]:
    try:
        if payload.mode == "demo":
            for event in demo_events(meal=payload.meal, context=payload.context):
                yield sse(event)
        else:
            with create_client(settings) as client:
                for event in agent_events(
                    client,
                    settings,
                    payload.prompt,
                    payload.meal,
                    payload.context,
                    payload.lang,
                    [turn.model_dump() for turn in payload.history],
                ):
                    yield sse(event)
    except APITimeoutError:
        yield sse({"type": "error", "message": "모델 응답 시간이 초과되었습니다."})
    except APIConnectionError:
        yield sse({"type": "error", "message": "Meta API에 연결할 수 없습니다."})
    except APIStatusError as exc:
        yield sse(
            {
                "type": "error",
                "message": (
                    f"Meta API HTTP {exc.status_code}. "
                    "키, 모델 접근 권한, 크레딧 및 호출 한도를 확인하세요."
                ),
            }
        )
    except (RuntimeError, ValueError):
        yield sse(
            {
                "type": "error",
                "message": (
                    "에이전트 실행을 완료하지 못했습니다. 호출 한도와 모델 응답을 확인하세요."
                ),
            }
        )


@app.post("/api/runs")
def run(payload: RunRequest, settings: Annotated[Settings, Depends(get_settings)]):
    if payload.mode == "live" and not settings.has_key:
        raise HTTPException(
            status_code=503,
            detail="MODEL_API_KEY가 설정되지 않았습니다. .env 또는 env.txt를 확인하세요.",
        )
    # Sync SDK and generator run in Starlette's thread pool, not on the ASGI event loop.
    return StreamingResponse(
        stream_run(payload, settings),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
