import argparse
import os
import sys

from openai import APIConnectionError, APIStatusError, APITimeoutError
from pydantic import ValidationError
from rich.console import Console

from glpfit_agent.agent import ask, run_agent
from glpfit_agent.config import Settings, create_client


def main() -> int:
    # Keep Korean output readable when PowerShell captures the CLI through UTF-8 pipes.
    if os.name == "nt":
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="지엘피핏 Meta Model API 에이전트")
    commands = parser.add_subparsers(dest="command", required=True)
    doctor = commands.add_parser("doctor", help="Check local config without an API request")
    doctor.add_argument(
        "--live", action="store_true", help="Also send a small billable API request"
    )
    for name in ("ask", "agent"):
        command = commands.add_parser(name)
        command.add_argument("prompt", help="Prompt text")
    args = parser.parse_args()
    console = Console()
    try:
        settings = Settings()
        if args.command == "doctor":
            console.print(f"Python: {sys.version.split()[0]}", markup=False)
            console.print(f"Endpoint: {settings.meta_base_url}", markup=False)
            console.print(f"Model: {settings.meta_model}", markup=False)
            console.print("MODEL_API_KEY: " + ("설정됨" if settings.has_key else "미설정"))
            if not args.live:
                console.print("로컬 환경 확인 완료. 실제 API 연결은 doctor --live로 확인하세요.")
                return 0
        with create_client(settings) as client:
            if args.command == "doctor":
                text = ask(client, settings, "Reply with only OK.")
            elif args.command == "ask":
                text = ask(client, settings, args.prompt)
            else:
                text = run_agent(client, settings, args.prompt)
        console.print(text, markup=False)
        return 0
    except ValidationError:
        console.print("설정 값이 잘못되었습니다. .env.example의 형식과 숫자 범위를 확인하세요.")
    except (ValueError, RuntimeError) as exc:
        console.print(str(exc), markup=False)
    except APITimeoutError:
        console.print("API 요청 시간이 초과되었습니다. 연결과 타임아웃 설정을 확인하세요.")
    except APIConnectionError:
        console.print("API에 연결할 수 없습니다. 네트워크와 META_BASE_URL을 확인하세요.")
    except APIStatusError as exc:
        console.print(
            f"API HTTP {exc.status_code}: 키, 모델 접근 권한, 크레딧, 호출 한도를 확인하세요."
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
