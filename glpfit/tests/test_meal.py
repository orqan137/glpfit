import json

from fastapi.testclient import TestClient
from glpfit_agent.agent import demo_events
from glpfit_agent.config import Settings
from glpfit_agent.tools import MealPayload, analyze_meal, execute_tool
from glpfit_be.api import app, get_settings


def photo(name="before.jpg", food=0.6):
    return {
        "filename": name,
        "width": 800,
        "height": 600,
        "brightness": 120.0,
        "colorfulness": 40.0,
        "blur": 30.0,
        "food_pixel_ratio": food,
    }


def audio(name="meal.webm"):
    return {
        "filename": name,
        "duration_sec": 600.0,
        "active_ratio": 0.5,
        "chew_rate_per_min": 55.0,
        "pause_count": 12,
        "mean_rms": 0.08,
    }


def bowel():
    return {
        "filename": "bowel.webm",
        "duration_sec": 300.0,
        "event_count": 9,
        "mean_interval_sec": 30.0,
        "events_per_min": 1.8,
    }


def motion():
    return {"duration_sec": 30.0, "rep_count": 8, "mean_rep_sec": 3.75, "peak_accel_g": 1.6}


def meal(**kwargs):
    return MealPayload.model_validate(kwargs)


def test_analyze_photos_change_ratio():
    out = analyze_meal("photos", meal(before=photo(food=0.8), after=photo("after.jpg", 0.4)))
    assert out["photos"]["food_change_ratio"] == 0.5


def test_analyze_meal_all_collects_available():
    payload = meal(before=photo(), audio=audio(), bowel=bowel(), motion=motion())
    out = analyze_meal("all", payload)
    assert set(out) == {"photos", "audio", "bowel", "motion"}
    assert out["audio"]["pace"] == "보통"
    assert out["bowel"]["bowel"]["event_count"] == 9
    assert out["motion"]["motion"]["rep_count"] == 8


def test_analyze_meal_missing_data_is_honest_error():
    assert "error" in analyze_meal("photos", None)
    assert "error" in analyze_meal("audio", meal(before=photo()))
    assert "error" in analyze_meal("bowel", meal(before=photo()))
    assert "error" in analyze_meal("motion", meal(before=photo()))
    assert "error" in analyze_meal("all", MealPayload())


def test_execute_tool_rejects_bad_target():
    out = json.loads(execute_tool("analyze_meal", '{"target": "glucose"}'))
    assert "error" in out


def test_demo_meal_events_cover_three_tracks():
    payload = meal(
        before=photo(),
        after=photo("after.jpg", 0.3),
        audio=audio(),
        bowel=bowel(),
        motion=motion(),
    )
    stream = list(demo_events(payload))
    kinds = [event["type"] for event in stream]
    assert kinds[0] == "step"
    assert kinds.count("tool_call") == 5
    assert kinds.count("tool_result") == 5
    assert kinds[-1] == "final"
    calls = [event for event in stream if event["type"] == "tool_call"]
    assert [call["arguments"]["target"] for call in calls[:4]] == [
        "photos",
        "audio",
        "bowel",
        "motion",
    ]
    assert calls[4]["name"] == "get_coaching_tips"
    assert "추정치" in stream[-1]["text"]


def test_demo_without_meal_gives_coaching_tips():
    stream = list(demo_events())
    calls = [event for event in stream if event["type"] == "tool_call"]
    assert [call["name"] for call in calls] == ["get_coaching_tips"]
    assert "Meta 모델은 호출하지 않았습니다" in stream[-1]["text"]


def test_demo_meal_tips_follow_findings():
    fast = {**audio(), "chew_rate_per_min": 90.0}
    stream = list(demo_events(meal(audio=fast, motion=motion())))
    tips_call = next(
        e for e in stream if e["type"] == "tool_call" and e["name"] == "get_coaching_tips"
    )
    assert tips_call["arguments"]["topics"][:2] == ["eating_pace", "activity"]
    assert "다음 식사에서 해 볼 것" in stream[-1]["text"]


def test_coaching_tips_tool_validates_topics():
    ok = json.loads(execute_tool("get_coaching_tips", '{"topics":["protein","protein"]}'))
    assert [tip["topic"] for tip in ok["tips"]] == ["protein"]
    for bad in ('{"topics":[]}', '{"topics":["dose"]}', "nope"):
        assert "error" in json.loads(execute_tool("get_coaching_tips", bad))


def test_api_accepts_camelcase_payload_from_browser():
    camel = {
        "filename": "before.jpg",
        "width": 800,
        "height": 600,
        "brightness": 120.0,
        "colorfulness": 40.0,
        "blur": 30.0,
        "foodPixelRatio": 0.6,
    }
    sound = {
        "filename": "meal.webm",
        "durationSec": 30.0,
        "activeRatio": 0.5,
        "chewRatePerMin": 55.0,
        "pauseCount": 3,
        "meanRms": 0.08,
    }
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/runs",
                json={
                    "mode": "demo",
                    "prompt": "샘플 실행",
                    "meal": {"before": camel, "after": None, "audio": sound, "bowel": None},
                },
            )
            assert response.status_code == 200
            assert "식사 소리" in response.text
    finally:
        app.dependency_overrides.clear()


def test_api_demo_accepts_full_meal_payload():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/runs",
                json={
                    "mode": "demo",
                    "prompt": "샘플 실행",
                    "meal": {
                        "before": photo(),
                        "after": photo("after.jpg", 0.3),
                        "audio": audio(),
                        "bowel": bowel(),
                        "motion": motion(),
                    },
                },
            )
            assert response.status_code == 200
            frames = [
                json.loads(frame.removeprefix("data: "))
                for frame in response.text.strip().split("\n\n")
            ]
            assert frames[0]["type"] == "step"
            assert frames[-1]["type"] == "final"
            assert any(
                frame["type"] == "tool_call" and frame["name"] == "analyze_meal" for frame in frames
            )
    finally:
        app.dependency_overrides.clear()


def test_api_rejects_invalid_meal_features():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    try:
        with TestClient(app) as client:
            bad = photo()
            bad["food_pixel_ratio"] = 2.0
            response = client.post(
                "/api/runs", json={"mode": "demo", "prompt": "hi", "meal": {"before": bad}}
            )
            assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()
