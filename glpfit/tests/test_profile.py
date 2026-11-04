import json
from datetime import date

import httpx
from fastapi.testclient import TestClient
from glpfit_agent.agent import agent_events, build_instructions, demo_events
from glpfit_agent.config import Settings
from glpfit_agent.profile import (
    CoachContext,
    injection_line,
    medication_schedule,
    personal_instructions,
    progress,
)
from glpfit_agent.tools import execute_tool
from glpfit_be.api import app, get_settings
from openai import OpenAI

TODAY = date(2026, 11, 4)  # Wednesday


def context(**overrides):
    data = {
        "profile": {
            "nickname": "민지",
            "goal": "lose",
            "startWeightKg": 82.0,
            "targetWeightKg": 70.0,
            "medication": "마운자로 5mg",
            "injectionWeekday": 1,  # Monday
            "concerns": ["nausea"],
            "tone": "direct",
        },
        "logs": [
            {"date": "2026-10-29", "weightKg": 80.0, "waterCups": 4, "symptoms": ["nausea"]},
            {"date": "2026-11-02", "weightKg": 79.4, "waterCups": 5, "proteinServings": 2},
            {"date": "2026-11-03", "waterCups": 6, "symptoms": ["nausea"]},
            {"date": "2026-11-04", "weightKg": 79.0, "waterCups": 7, "proteinServings": 3},
        ],
        "memories": ["기름진 음식 먹으면 메스꺼움"],
    }
    data.update(overrides)
    return CoachContext.model_validate(data)


def test_env_txt_meta_api_key_is_accepted(tmp_path, monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_API_KEY", raising=False)
    (tmp_path / ".env").write_text("MODEL_API_KEY=\n", encoding="utf-8")
    (tmp_path / "env.txt").write_text("META_API_KEY=from-env-txt", encoding="utf-8")
    settings = Settings(_env_file=(tmp_path / ".env", tmp_path / "env.txt"))
    assert settings.has_key
    assert settings.api_key == "from-env-txt"


def test_progress_computes_trends_from_logs():
    stats = progress(context(), 7, today=TODAY)
    assert stats["logged_days"] == 4
    assert stats["weight"]["change_kg"] == -1.0
    assert stats["weight"]["since_start_kg"] == -3.0
    assert stats["weight"]["to_target_kg"] == 9.0
    assert stats["avg_water_cups"] == 5.5
    assert stats["symptom_days"] == {"메스꺼움": 2}
    assert stats["streak_days"] == 3


def test_progress_without_logs_is_honest():
    assert progress(None, 7, today=TODAY)["logged_days"] == 0


def test_injection_day_counts_from_js_weekday():
    profile = context().profile
    assert "주사 후 2일째" in injection_line(profile, TODAY)
    assert "오늘은 주사하는 날" in injection_line(profile, date(2026, 11, 2))


def test_personal_instructions_include_profile_memory_and_tone():
    text = personal_instructions(context(), today=TODAY)
    for expected in ("민지님", "82.0kg → 목표 70.0kg", "핵심만"):
        assert expected in text
    full = build_instructions(None, context(), "en")
    for section in ("# SOUL", "# AGENTS", "# TODAY\nReply in English", "# USER", "# MEMORY"):
        assert section in full
    assert "- 기름진 음식 먹으면 메스꺼움" in full
    assert "get_progress" in text
    assert personal_instructions(None) == ""


def test_remember_tool_validates_fact():
    assert json.loads(execute_tool("remember", '{"fact":"아침을 자주 거름"}'))["saved"]
    assert "error" in json.loads(execute_tool("remember", '{"fact":"x"}'))


def test_agent_emits_memory_event_and_sends_personal_prompt():
    calls = {"n": 0}

    def handler(request):
        body = json.loads(request.content)
        calls["n"] += 1
        if calls["n"] == 1:
            assert "민지님" in body["instructions"]
            assert {tool["name"] for tool in body["tools"]} >= {"get_progress", "remember"}
            output = [
                {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "remember",
                    "arguments": '{"fact":"저녁 늦게 먹으면 속이 불편함"}',
                    "status": "completed",
                }
            ]
        else:
            output = [
                {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [{"type": "output_text", "text": "기억할게요.", "annotations": []}],
                }
            ]
        return httpx.Response(
            200,
            json={
                "id": "resp",
                "object": "response",
                "created_at": 1,
                "model": "muse-spark-1.3",
                "status": "completed",
                "output": output,
            },
        )

    client = OpenAI(
        api_key="k",
        base_url="https://api.meta.ai/v1",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with client:
        stream = list(
            agent_events(
                client, Settings(_env_file=None, model_api_key="k"), "안녕", context=context()
            )
        )
    assert {"type": "memory", "text": "저녁 늦게 먹으면 속이 불편함"} in stream
    assert stream[-1] == {"type": "final", "text": "기억할게요."}


def test_build_instructions_without_context_is_generic():
    assert "About this user" not in build_instructions(None, None)


def test_demo_uses_profile_and_logs():
    stream = list(demo_events(context=context()))
    names = [e["name"] for e in stream if e["type"] == "tool_call"]
    assert names == ["get_progress", "get_coaching_tips"]
    tips_call = [e for e in stream if e["type"] == "tool_call"][1]
    assert tips_call["arguments"]["topics"][0] == "nausea"
    final = stream[-1]["text"]
    assert final.startswith("민지님")
    assert "목표까지" in final


def test_api_accepts_context_payload():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/runs",
                json={
                    "mode": "demo",
                    "prompt": "오늘 어때?",
                    "context": context().model_dump(by_alias=True),
                },
            )
            assert response.status_code == 200
            assert "get_progress" in response.text
            bad = client.post(
                "/api/runs",
                json={"mode": "demo", "prompt": "x", "context": {"profile": {"goal": "bulk"}}},
            )
            assert bad.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_medication_schedule_tracks_cycle_ladder_and_sites():
    ctx = context(
        injections=[
            {"date": "2026-10-19", "drug": "mounjaro", "doseMg": 2.5, "site": "abdomen_left"},
            {"date": "2026-10-26", "drug": "mounjaro", "doseMg": 5.0, "site": "abdomen_right"},
            {"date": "2026-11-02", "drug": "mounjaro", "doseMg": 5.0, "site": "thigh_left"},
        ]
    )
    sched = json.loads(execute_tool("get_medication_schedule", "{}", None, ctx))
    sched = medication_schedule(ctx, TODAY)
    assert sched["drug"]["name"] == "마운자로"
    assert "GIP/GLP-1" in sched["drug"]["ingredient"]
    assert sched["current_dose_mg"] == 5.0
    assert sched["days_since_last"] == 2
    assert sched["cycle"]["day"] == 3
    assert sched["cycle"]["phase"] == "안정기"
    assert sched["next_due"] == "2026-11-09"
    assert sched["next_site"] == "오른쪽 허벅지"
    assert sched["ladder"]["step_index"] == 1
    assert sched["ladder"]["weeks_on_current_dose"] == 2
    text = personal_instructions(ctx, today=TODAY)
    assert "주사 후 3일째" in text and "never recommend a dose change" in text


def test_overdue_shot_gives_label_missed_dose_rule():
    ctx = context(injections=[{"date": "2026-10-25", "drug": "wegovy", "doseMg": 0.5}])
    sched = medication_schedule(ctx, TODAY)
    assert sched["overdue_days"] == 3
    assert "48시간" in sched["missed_dose_rule"]


def test_report_facts_find_symptom_pattern_by_injection_day():
    from glpfit_agent.report import dose_history, report_facts, symptoms_by_cycle

    ctx = context(
        injections=[
            {"date": "2026-10-26", "drug": "mounjaro", "doseMg": 2.5},
            {"date": "2026-11-02", "drug": "mounjaro", "doseMg": 5.0},
        ],
        logs=[
            {"date": "2026-10-27", "symptoms": ["nausea"]},
            {"date": "2026-10-30", "symptoms": []},
            {"date": "2026-11-03", "symptoms": ["nausea", "fatigue"]},
        ],
    )
    pattern = symptoms_by_cycle(ctx)
    assert pattern[0] == {
        "cycle_day": 2,
        "phase": "주사 직후",
        "logged_days": 2,
        "symptoms": {"메스꺼움": 2, "피로": 1},
    }
    assert pattern[1]["cycle_day"] == 5 and pattern[1]["symptoms"] == {}
    assert [step["dose_mg"] for step in dose_history(ctx)] == [2.5, 5.0]
    assert [step["drug"] for step in dose_history(ctx, "en")] == ["Mounjaro", "Mounjaro"]
    facts = report_facts(ctx, TODAY)
    assert facts["period"]["to"] == "2026-11-04"
    assert "recent" not in facts["progress"]


def test_report_endpoint_returns_facts_without_key():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/report", json={"context": context().model_dump(by_alias=True)}
            )
            assert response.status_code == 200
            assert response.json()["report"] is None
            assert response.json()["facts"]["progress"]["logged_days"] >= 1
    finally:
        app.dependency_overrides.clear()


def test_today_snapshot_and_memory_dedupe():
    text = personal_instructions(context(), today=TODAY)
    assert "Today so far: weight 79.0kg" in text
    again = json.loads(
        execute_tool("remember", '{"fact":"기름진 음식 먹으면 메스꺼움"}', None, context())
    )
    assert again == {"saved": False, "reason": "already in MEMORY"}
