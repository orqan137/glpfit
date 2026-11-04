import json

import httpx
import pytest
from glpfit_agent.agent import ask, execute_tool, run_agent
from glpfit_agent.config import Settings, create_client
from openai import OpenAI


def settings(**kwargs):
    return Settings(_env_file=None, model_api_key="test-key", **kwargs)


def response(output, *, status="completed"):
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1,
        "model": "muse-spark-1.3",
        "status": status,
        "output": output,
    }


def message(text):
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


def mock_client(handler):
    return OpenAI(
        api_key="test-key",
        base_url="https://api.meta.ai/v1",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_missing_key_fails_before_network(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    with pytest.raises(ValueError, match="MODEL_API_KEY"):
        create_client(Settings(_env_file=None))


def test_ask_uses_meta_endpoint_and_explicit_key():
    def handler(request):
        assert str(request.url) == "https://api.meta.ai/v1/responses"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["model"] == "muse-spark-1.3"
        assert body["store"] is False
        return httpx.Response(200, json=response([message("안녕하세요")]))

    with mock_client(handler) as client:
        assert ask(client, settings(), "안녕") == "안녕하세요"


def test_agent_replays_reasoning_and_tool_result():
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(
                200,
                json=response(
                    [
                        {
                            "type": "reasoning",
                            "id": "rs_test",
                            "summary": [],
                            "encrypted_content": "opaque-reasoning",
                        },
                        {
                            "type": "function_call",
                            "id": "fc_test",
                            "call_id": "call_test",
                            "name": "get_current_time",
                            "arguments": '{"timezone":"Asia/Seoul"}',
                            "status": "completed",
                        },
                    ]
                ),
            )
        history = body["input"]
        assert history[1]["encrypted_content"] == "opaque-reasoning"
        assert history[2]["call_id"] == history[3]["call_id"] == "call_test"
        result = json.loads(history[3]["output"])
        assert result["timezone"] == "Asia/Seoul"
        assert result["datetime"].endswith("+09:00")
        assert body["include"] == ["reasoning.encrypted_content"]
        assert body["store"] is False
        return httpx.Response(200, json=response([message("서울 시간 확인 완료")]))

    with mock_client(handler) as client:
        assert run_agent(client, settings(), "서울 현재 시간") == "서울 시간 확인 완료"
    assert len(requests) == 2


@pytest.mark.parametrize(
    "name,arguments",
    [
        ("unregistered", "{}"),
        ("get_current_time", "invalid json"),
        ("get_current_time", '{"timezone":"Not/AZone"}'),
        ("get_current_time", '{"timezone":"Asia/Seoul","extra":true}'),
    ],
)
def test_invalid_tool_requests_return_errors(name, arguments):
    assert "error" in json.loads(execute_tool(name, arguments))


def test_agent_stops_at_request_limit():
    count = 0

    def handler(request):
        nonlocal count
        count += 1
        return httpx.Response(
            200,
            json=response(
                [
                    {
                        "type": "function_call",
                        "call_id": f"call_{count}",
                        "name": "get_current_time",
                        "arguments": '{"timezone":"UTC"}',
                    }
                ]
            ),
        )

    with mock_client(handler) as client, pytest.raises(RuntimeError, match="호출 횟수"):
        run_agent(client, settings(meta_max_agent_steps=2), "time")
    assert count == 2


def test_incomplete_response_is_not_success():
    with (
        mock_client(
            lambda request: httpx.Response(
                200, json=response([message("partial")], status="incomplete")
            )
        ) as client,
        pytest.raises(RuntimeError, match="완료되지"),
    ):
        ask(client, settings(), "hello")
