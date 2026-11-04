import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from openai import OpenAI
from openai.types.responses import Response, ResponseInputParam

from glpfit_agent.config import Settings
from glpfit_agent.profile import (
    CoachContext,
    injection_line,
    medication_schedule,
    personal_instructions,
    progress,
    today_kst,
)
from glpfit_agent.tools import (
    TOOLS,
    MealPayload,
    analyze_meal,
    coaching_tips,
    execute_tool,
)

AgentEvent = dict[str, Any]
DEMO_PROMPT = "GLP-1 약을 쓰면서 식사할 때 무엇을 신경 쓰면 좋을까?"
DEMO_TOPICS = ["eating_pace", "protein", "hydration"]

# OpenClaw-style workspace files: who the coach is (SOUL) and how it works (AGENTS).
# USER, MEMORY and TODAY are added per request from the person's own data.
PROMPTS = Path(__file__).parent / "prompts"
INSTRUCTIONS = "\n".join(
    (PROMPTS / name).read_text(encoding="utf-8") for name in ("SOUL.md", "AGENTS.md")
)


LANG_NAME = {"ko": "Korean", "en": "English"}


def build_instructions(
    meal: MealPayload | None, context: CoachContext | None, lang: str = "ko"
) -> str:
    sections = [INSTRUCTIONS, f"# TODAY\nReply in {LANG_NAME.get(lang, 'Korean')}."]
    if user := personal_instructions(context):
        sections.append("# USER\n" + user)
    if context is not None and context.memories:
        sections.append(
            "# MEMORY\nFacts you saved earlier about this person (respect them):\n"
            + "\n".join(f"- {fact}" for fact in context.memories[-15:])
        )
    if meal is not None and meal.has_data:
        attached = [
            name
            for name, present in (
                ("식전 사진", meal.before is not None),
                ("식후 사진", meal.after is not None),
                ("식사 소리", meal.audio is not None),
                ("장음", meal.bowel is not None),
                ("일어서기 기록", meal.motion is not None),
            )
            if present
        ]
        sections.append(f"# ATTACHED\nMeal data this turn: {', '.join(attached)}.")
    return "\n\n".join(sections)


def response_text(response: Response) -> str:
    if response.status != "completed":
        raise RuntimeError(
            f"응답이 완료되지 않았습니다 (status={response.status}). "
            "출력 토큰 한도 또는 API 상태를 확인하세요."
        )
    if not response.output_text.strip():
        raise RuntimeError(
            "API가 텍스트를 반환하지 않았습니다. 모델과 출력 토큰 한도를 확인하세요."
        )
    return response.output_text


def ask(client: OpenAI, settings: Settings, prompt: str) -> str:
    response = client.responses.create(
        model=settings.meta_model,
        input=prompt,
        max_output_tokens=settings.meta_max_output_tokens,
        store=False,
    )
    return response_text(response)


def agent_events(
    client: OpenAI,
    settings: Settings,
    prompt: str,
    meal: MealPayload | None = None,
    context: CoachContext | None = None,
    lang: str = "ko",
    history_turns: list[dict] | None = None,
) -> Iterator[AgentEvent]:
    # Earlier turns of this chat (text only) give the coach conversational memory.
    history: ResponseInputParam = [
        {"role": turn["role"], "content": turn["text"]} for turn in (history_turns or [])
    ]
    history.append({"role": "user", "content": prompt})
    instructions = build_instructions(meal, context, lang)
    for step in range(1, settings.meta_max_agent_steps + 1):
        yield {"type": "step", "step": step, "message": "모델 응답 대기 중"}
        response = client.responses.create(
            model=settings.meta_model,
            instructions=instructions,
            input=history,
            tools=TOOLS,
            max_output_tokens=settings.meta_max_output_tokens,
            store=False,
            include=["reasoning.encrypted_content"],
        )
        if response.status != "completed":
            response_text(response)
        calls = [item for item in response.output if item.type == "function_call"]
        if not calls:
            yield {"type": "final", "text": response_text(response)}
            return
        # Preserve the complete output, including encrypted reasoning and commentary phase.
        history.extend(item.model_dump(exclude_none=True) for item in response.output)
        for call in calls:
            try:
                arguments = json.loads(call.arguments)
            except json.JSONDecodeError:
                arguments = {"invalid_arguments": True}
            yield {
                "type": "tool_call",
                "call_id": call.call_id,
                "name": call.name,
                "arguments": arguments,
            }
            result = execute_tool(call.name, call.arguments, meal, context)
            output = json.loads(result)
            yield {
                "type": "tool_result",
                "call_id": call.call_id,
                "name": call.name,
                "output": output,
            }
            if call.name == "remember" and output.get("saved"):
                yield {"type": "memory", "text": output["fact"]}
            history.append(
                {
                    "type": "function_call_output",
                    "call_id": call.call_id,
                    "output": result,
                }
            )
    raise RuntimeError("에이전트 호출 횟수 한도에 도달했습니다. 질문이나 도구 구성을 확인하세요.")


def run_agent(client: OpenAI, settings: Settings, prompt: str) -> str:
    for event in agent_events(client, settings, prompt):
        if event["type"] == "final":
            return event["text"]
    raise RuntimeError("에이전트가 최종 응답을 반환하지 않았습니다.")


def demo_meal_events(
    meal: MealPayload, context: CoachContext | None = None
) -> Iterator[AgentEvent]:
    """Local meal analysis: real computation on the user's files, no model calls."""
    yield {"type": "step", "step": 1, "message": "식사 기록 분석 중 · 모델 호출 없음"}
    personal_events, personal_lines, personal_topics = personal_demo(context)
    yield from personal_events
    parts: list[str] = []
    if meal.before is not None:
        yield {
            "type": "tool_call",
            "call_id": "demo_meal_photos",
            "name": "analyze_meal",
            "arguments": {"target": "photos"},
        }
        output = analyze_meal("photos", meal)
        yield {
            "type": "tool_result",
            "call_id": "demo_meal_photos",
            "name": "analyze_meal",
            "output": output,
        }
        change = output.get("photos", {}).get("food_change_ratio")
        if change is None:
            parts.append(
                "식전 사진 1장을 분석했습니다. 식후 사진을 함께 첨부하면 변화를 추정합니다."
            )
        else:
            parts.append(
                f"식전 대비 음식 영역 변화: {change * 100:.1f}% "
                "(상대적 추정치, 절대 섭취량이 아닙니다)."
            )
    if meal.audio is not None:
        yield {
            "type": "tool_call",
            "call_id": "demo_meal_audio",
            "name": "analyze_meal",
            "arguments": {"target": "audio"},
        }
        output = analyze_meal("audio", meal)
        yield {
            "type": "tool_result",
            "call_id": "demo_meal_audio",
            "name": "analyze_meal",
            "output": output,
        }
        parts.append(describe_audio(output.get("audio", {})))
    if meal.bowel is not None:
        yield {
            "type": "tool_call",
            "call_id": "demo_meal_bowel",
            "name": "analyze_meal",
            "arguments": {"target": "bowel"},
        }
        output = analyze_meal("bowel", meal)
        yield {
            "type": "tool_result",
            "call_id": "demo_meal_bowel",
            "name": "analyze_meal",
            "output": output,
        }
        parts.append(describe_bowel(output.get("bowel", {})))
    if meal.motion is not None:
        yield {
            "type": "tool_call",
            "call_id": "demo_meal_motion",
            "name": "analyze_meal",
            "arguments": {"target": "motion"},
        }
        output = analyze_meal("motion", meal)
        yield {
            "type": "tool_result",
            "call_id": "demo_meal_motion",
            "name": "analyze_meal",
            "output": output,
        }
        parts.append(describe_motion(output.get("motion", {})))
    found = tip_topics_for(meal)
    topics = list(dict.fromkeys(found[:2] + personal_topics + found[2:]))[:4]
    yield {
        "type": "tool_call",
        "call_id": "demo_meal_tips",
        "name": "get_coaching_tips",
        "arguments": {"topics": topics},
    }
    tips = coaching_tips(topics)
    yield {
        "type": "tool_result",
        "call_id": "demo_meal_tips",
        "name": "get_coaching_tips",
        "output": tips,
    }
    yield {
        "type": "final",
        "text": (
            ("\n".join(personal_lines) + "\n\n" if personal_lines else "")
            + "건강 기록 로컬 분석을 완료했습니다.\n\n"
            + "\n".join(parts)
            + "\n\n다음 식사에서 해 볼 것\n"
            + format_tips(tips)
            + "\n\n수치는 추정치이며 약효·혈당을 재는 것이 아닙니다. "
            "Meta 모델의 맞춤 해석은 AI 코치 모드에서 확인하세요."
        ),
    }


def tip_topics_for(meal: MealPayload) -> list[str]:
    """Pick tips that match what the local analysis found, most relevant first."""
    topics: list[str] = []
    if meal.audio is not None and meal.audio.chew_rate_per_min >= 70:
        topics.append("eating_pace")
    if meal.before is not None and meal.after is not None and meal.before.food_pixel_ratio > 0:
        eaten = 1 - meal.after.food_pixel_ratio / meal.before.food_pixel_ratio
        topics.append("protein" if eaten < 0.5 else "portion")
    if meal.bowel is not None and meal.bowel.events_per_min < 1:
        topics.append("constipation")
    if meal.motion is not None:
        topics.append("activity")
    for fallback in ("eating_pace", "hydration", "logging"):
        if len(topics) >= 3:
            break
        if fallback not in topics:
            topics.append(fallback)
    return topics[:4]


def format_tips(result: dict) -> str:
    return "\n".join(f"· {tip['title']}: {tip['tips'][0]}" for tip in result["tips"])


def describe_bowel(result: dict) -> str:
    bowel = result.get("bowel", {})
    interval = bowel.get("mean_interval_sec")
    interval_text = f", 평균 간격 {interval:.1f}초" if interval else ""
    return (
        f"장음: 약 {bowel.get('duration_sec', 0) / 60:.1f}분 기록, "
        f"이벤트 {bowel.get('event_count', 0)}회"
        f"(분당 {bowel.get('events_per_min', 0):.1f}회{interval_text})."
    )


def describe_motion(result: dict) -> str:
    motion = result.get("motion", {})
    reps = motion.get("rep_count", 0)
    if reps == 0:
        return "일어서기: 감지된 반복이 없습니다. 휴대폰을 허벅지에 고정하고 다시 측정하세요."
    return (
        f"일어서기: {motion.get('duration_sec', 0):.0f}초 동안 {reps}회, "
        f"평균 {motion.get('mean_rep_sec', 0):.1f}초/회, "
        f"최대 가속도 {motion.get('peak_accel_g', 0):.1f}G."
    )


def describe_audio(result: dict) -> str:
    audio = result.get("audio", {})
    minutes = audio.get("duration_sec", 0) / 60
    return (
        f"식사 소리: 약 {minutes:.1f}분 기록, 소리 활동 {audio.get('active_ratio', 0) * 100:.0f}%, "
        f"씹는 속도 추정 분당 {audio.get('chew_rate_per_min', 0):.0f}회"
        f"({result.get('pace', '측정 불가')}), 멈춤 {audio.get('pause_count', 0)}회."
    )


CONCERN_TOPIC = {
    "nausea": "nausea",
    "constipation": "constipation",
    "low_appetite": "protein",
    "cravings": "portion",
    "fatigue": "hydration",
    "muscle_loss": "activity",
}


def personal_demo(context: CoachContext | None) -> tuple[list[AgentEvent], list[str], list[str]]:
    """Rule-based stand-in for the model's personalization: events, lines, tip topics."""
    if context is None:
        return [], [], []
    events: list[AgentEvent] = []
    lines: list[str] = []
    topics: list[str] = []
    profile = context.profile
    if profile:
        if profile.nickname:
            lines.append(f"{profile.nickname}님, 오늘 기록을 바탕으로 정리했어요.")
        topics += [CONCERN_TOPIC[c] for c in profile.concerns]
    sched = medication_schedule(context)
    if cycle := sched.get("cycle"):
        lines.append(
            f"오늘은 주사 후 {cycle['day']}일째, '{cycle['phase']}'예요. "
            f"{cycle['focus']}라 {cycle['coach']}를 챙겨 보세요."
        )
        topics = cycle["topics"][:1] + topics + cycle["topics"][1:]
    elif profile and (injection := injection_line(profile, today_kst())):
        lines.append(injection)
    if context.logs:
        events.append(
            {
                "type": "tool_call",
                "call_id": "demo_progress",
                "name": "get_progress",
                "arguments": {"days": 7},
            }
        )
        stats = progress(context, 7)
        events.append(
            {
                "type": "tool_result",
                "call_id": "demo_progress",
                "name": "get_progress",
                "output": stats,
            }
        )
        if weight := stats.get("weight"):
            text = f"최근 7일 체중 변화 {weight['change_kg']:+.1f}kg"
            if "to_target_kg" in weight:
                text += f", 목표까지 {weight['to_target_kg']:.1f}kg"
            lines.append(text + ".")
        if (water := stats.get("avg_water_cups")) is not None:
            lines.append(f"하루 평균 물 {water}잔.")
            if water < 6:
                topics.append("hydration")
        if (protein := stats.get("avg_protein_servings")) is not None and protein < 3:
            topics.append("protein")
        if symptoms := stats.get("symptom_days"):
            top = next(iter(symptoms))
            lines.append(f"가장 잦은 불편: {top}({symptoms[top]}일).")
    return events, lines, list(dict.fromkeys(topics))


def demo_events(
    meal: MealPayload | None = None, context: CoachContext | None = None
) -> Iterator[AgentEvent]:
    """A fixed local scenario: real tool execution, no model or external API calls."""
    if meal is not None and meal.has_data:
        yield from demo_meal_events(meal, context)
        return
    yield {"type": "step", "step": 1, "message": "샘플 코칭 · 모델 호출 없음"}
    events, lines, personal_topics = personal_demo(context)
    yield from events
    topics = (personal_topics + [t for t in DEMO_TOPICS if t not in personal_topics])[:3]
    arguments = {"topics": topics}
    yield {
        "type": "tool_call",
        "call_id": "demo_tips",
        "name": "get_coaching_tips",
        "arguments": arguments,
    }
    output = json.loads(execute_tool("get_coaching_tips", json.dumps(arguments)))
    yield {
        "type": "tool_result",
        "call_id": "demo_tips",
        "name": "get_coaching_tips",
        "output": output,
    }
    yield {
        "type": "final",
        "text": (
            ("\n".join(lines) + "\n\n" if lines else "")
            + "오늘은 이 세 가지부터 챙겨 보세요.\n"
            + format_tips(output)
            + "\n\n사진·소리·움직임을 첨부하면 내 기록에 맞춘 분석을 볼 수 있습니다. "
            "이 응답은 정해진 샘플이며 Meta 모델은 호출하지 않았습니다."
        ),
    }
