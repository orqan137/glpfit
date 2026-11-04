import json

import httpx
import pytest
from fastapi.testclient import TestClient
from glpfit_agent.config import Settings
from glpfit_be.api import app, get_settings
from openai import APIStatusError


@pytest.fixture
def client():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def events(response):
    return [
        json.loads(frame.removeprefix("data: ")) for frame in response.text.strip().split("\n\n")
    ]


def test_health_exposes_readiness_but_no_key(client):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, model_api_key="secret-not-for-browser"
    )
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["live_configured"] is True
    assert response.json()["tools"] == [
        "get_coaching_tips",
        "get_progress",
        "remember",
        "get_medication_schedule",
    ]
    assert "secret-not-for-browser" not in response.text


def test_openapi_is_available_through_api_proxy(client):
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    assert "/api/runs" in response.json()["paths"]


def test_demo_runs_real_tools_without_creating_api_client(client, monkeypatch):
    def forbidden(*args):
        pytest.fail("Demo must never instantiate an API client")

    monkeypatch.setattr("glpfit_be.api.create_client", forbidden)
    response = client.post("/api/runs", json={"mode": "demo", "prompt": "샘플 실행"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    stream = events(response)
    assert [event["type"] for event in stream] == [
        "step",
        "tool_call",
        "tool_result",
        "final",
    ]
    assert stream[1]["name"] == "get_coaching_tips"
    tips = stream[2]["output"]["tips"]
    assert [tip["topic"] for tip in tips] == ["eating_pace", "protein", "hydration"]
    assert tips[0]["title"] in stream[-1]["text"]
    assert "Meta 모델은 호출하지 않았습니다" in stream[-1]["text"]


def test_live_requires_key_and_does_not_fallback_to_demo(client):
    response = client.post("/api/runs", json={"mode": "live", "prompt": "hello"})
    assert response.status_code == 503
    assert "MODEL_API_KEY" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "unknown", "prompt": "hi"},
        {"mode": "demo", "prompt": "   "},
        {"mode": "live", "prompt": "a" * 12001},
        {"mode": "demo", "prompt": "hi", "api_key": "reject-client-key"},
    ],
)
def test_invalid_requests_rejected(client, payload):
    assert client.post("/api/runs", json=payload).status_code == 422


def test_live_upstream_billing_error_is_an_error_event(client, monkeypatch):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, model_api_key="test-only"
    )

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def failed_events(*args):
        raise APIStatusError(
            "private-upstream-body",
            response=httpx.Response(402, request=httpx.Request("POST", "https://api.meta.ai")),
            body={"secret": "never-echo-this"},
        )
        yield  # Make this a generator, as the real runner is.

    monkeypatch.setattr("glpfit_be.api.create_client", lambda _: FakeClient())
    monkeypatch.setattr("glpfit_be.api.agent_events", failed_events)
    response = client.post("/api/runs", json={"mode": "live", "prompt": "hello"})
    stream = events(response)
    assert stream[-1]["type"] == "error"
    assert "402" in stream[-1]["message"]
    assert "never-echo-this" not in response.text
    assert "private-upstream-body" not in response.text


def test_report_preserves_record_tables_when_ai_summary_fails(client, monkeypatch):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, model_api_key="test-only"
    )

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def failed_report(*args):
        raise RuntimeError("private-upstream-body")

    monkeypatch.setattr("glpfit_be.api.create_client", lambda _: FakeClient())
    monkeypatch.setattr("glpfit_be.api.write_report", failed_report)
    response = client.post(
        "/api/report",
        json={"context": {"logs": [{"date": "2026-11-05", "weightKg": 79}]}, "lang": "en"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["report"] is None
    assert body["summary_unavailable"] is True
    assert "period" in body["facts"]
    assert "dose_history" in body["facts"]
    assert "private-upstream-body" not in response.text


def test_report_records_only_does_not_call_paid_api(client, monkeypatch):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, model_api_key="test-only"
    )

    def forbidden(*args):
        pytest.fail("Records-only report must not create a paid API client")

    monkeypatch.setattr("glpfit_be.api.create_client", forbidden)
    response = client.post(
        "/api/report", json={"context": {}, "lang": "en", "include_summary": False}
    )
    assert response.status_code == 200
    assert response.json()["report"] is None
    assert "dose_history" in response.json()["facts"]
