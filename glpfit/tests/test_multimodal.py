import json
from datetime import date

import httpx
from fastapi.testclient import TestClient
from glpfit_agent.config import Settings
from glpfit_agent.plate import (
    VisionItem,
    analyze_plate,
    combine,
    geometric_left,
    parse_boxes,
    plate_note,
)
from glpfit_agent.profile import CoachContext, progress
from glpfit_agent.voice import extract_checkin, transcript_text
from glpfit_be.api import app, get_settings
from openai import OpenAI

SAM_TEXT = (
    "<0f>0<|box;x1=10;y1=10;x2=19;y2=19;w=100;h=100;c=0.9|><|mask;x=0;y=0;data=10,10,!abc|>,"
    "<0f>1<|box;x1=30;y1=30;x2=39;y2=49;w=100;h=100;c=0.8|><|mask;x=0;y=0;data=20,10,!def|>,"
    "<0f>2<|box;x1=50;y1=50;x2=59;y2=59;w=100;h=100;c=0.2|><|mask;x=0;y=0;data=10,10,!ghi|>"
)


def item(**overrides):
    data = {
        "name_ko": "닭가슴살",
        "sam_prompt": "chicken slice",
        "countable": True,
        "protein_g": 30.0,
        "kcal": 200,
        "left_pct": 40,
    }
    data.update(overrides)
    return VisionItem.model_validate(data)


def response(text):
    return {
        "id": "resp",
        "object": "response",
        "created_at": 1,
        "model": "m",
        "status": "completed",
        "output": [
            {
                "id": "msg",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        ],
    }


def test_parse_boxes_reads_sam_tokens():
    boxes = parse_boxes(SAM_TEXT)
    assert len(boxes) == 3
    assert boxes[0] == {"x1": 10, "y1": 10, "x2": 19, "y2": 19, "w": 100, "h": 100, "c": 0.9}
    assert parse_boxes("") == []


def test_countable_food_uses_instance_count_and_blends_with_vision():
    before = parse_boxes(SAM_TEXT)[:2] * 5  # 10 slices
    after = parse_boxes(SAM_TEXT)[:1] * 3  # 3 slices
    assert geometric_left(item(), before, after) == 0.3
    result = combine(item(), before, after)
    assert result["sam_left_pct"] == 30
    assert result["left_pct"] == 35  # (40 + 30) / 2
    assert result["eaten_pct"] == 65
    assert result["protein_eaten_g"] == 19.5
    assert result["count_before"] == 10 and result["count_after"] == 3


def test_heap_food_uses_box_area_and_survives_missing_sam():
    big = {"x1": 0, "y1": 0, "x2": 9, "y2": 9, "w": 100, "h": 100, "c": 1}
    small = {"x1": 0, "y1": 0, "x2": 4, "y2": 9, "w": 100, "h": 100, "c": 1}
    rice = item(name_ko="밥", countable=False, left_pct=60)
    assert geometric_left(rice, [big], [small]) == 0.5
    assert combine(rice, [], [])["left_pct"] == 60  # SAM saw nothing: vision only


def test_analyze_plate_calls_vision_then_sam_per_food():
    seen = {"vision": 0, "sam": 0}

    def handler(request):
        body = json.loads(request.content)
        if body["model"] == "sam-3.1":
            seen["sam"] += 1
            assert body["metadata"]["mask_encoding"] == "one_bit"
            return httpx.Response(200, json=response(SAM_TEXT))
        seen["vision"] += 1
        assert body["text"]["format"]["type"] == "json_schema"
        assert len(body["input"][0]["content"]) == 3  # prompt + before + after
        items = [
            item().model_dump(),
            item(name_ko="밥", sam_prompt="rice", countable=False).model_dump(),
        ]
        return httpx.Response(200, json=response(json.dumps({"items": items})))

    client = OpenAI(
        api_key="k",
        base_url="https://api.meta.ai/v1",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with client:
        result = analyze_plate(
            client, Settings(_env_file=None, model_api_key="k"), "data:a", "data:b"
        )
    assert seen == {"vision": 1, "sam": 4}
    assert [i["name"] for i in result["items"]] == ["닭가슴살", "밥"]
    assert result["image_size"] == [100, 100]
    assert result["totals"]["protein_eaten_g"] > 0
    assert plate_note(result).startswith("식판 렌즈: 닭가슴살")


def test_transcript_text_handles_response_shapes():
    assert transcript_text({"sessionId": "x", "transcript": "물 네 잔", "turns": []}) == "물 네 잔"
    assert transcript_text({"turns": [{"text": "체중"}, {"text": "79"}]}) == "체중 79"


def test_extract_checkin_clamps_bad_values():
    def handler(request):
        body = json.loads(request.content)
        assert body["text"]["format"]["schema"]["required"][0] == "weight_kg"
        data = {
            "weight_kg": 900,
            "water_cups": 4,
            "protein_servings": 99,
            "symptoms": ["nausea", "nausea", "headache"],
            "injection_today": False,
            "note": "",
        }
        return httpx.Response(200, json=response(json.dumps(data)))

    client = OpenAI(
        api_key="k",
        base_url="https://api.meta.ai/v1",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with client:
        log = extract_checkin(
            client, Settings(_env_file=None, model_api_key="k"), "말", date(2026, 11, 4)
        )
    assert log["weight_kg"] is None
    assert log["water_cups"] == 4
    assert log["protein_servings"] is None
    assert log["symptoms"] == ["nausea"]


def test_progress_reports_measured_protein():
    ctx = CoachContext.model_validate(
        {
            "profile": {"startWeightKg": 80},
            "logs": [
                {"date": "2026-11-03", "proteinG": 52.5},
                {"date": "2026-11-04", "proteinG": 61.5},
            ],
        }
    )
    stats = progress(ctx, 7, today=date(2026, 11, 4))
    assert stats["avg_protein_g_measured"] == 57.0
    assert stats["protein_g_reference"] == 80


def test_multimodal_endpoints_need_key_and_valid_input():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="")
    try:
        with TestClient(app) as client:
            assert (
                client.post("/api/plate", json={"before": "data:image/png;base64,AA"}).status_code
                == 503
            )
            assert client.post("/api/voice-checkin", content=b"RIFF").status_code == 503
        app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, model_api_key="k")
        with TestClient(app) as client:
            assert client.post("/api/plate", json={"before": "http://x/y.png"}).status_code == 422
            assert client.post("/api/voice-checkin", content=b"not a wav").status_code == 422
    finally:
        app.dependency_overrides.clear()
