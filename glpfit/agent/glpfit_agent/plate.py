"""Plate Lens: how much of each food was actually eaten, from a before/after photo pair.

Two Meta models check each other:
- Muse Spark (vision) names each food, estimates its protein/kcal and how much is left.
- SAM 3.1 finds every instance of each food in both photos; instance counts and box
  areas give an independent geometric measure of what is left.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, Field

from glpfit_agent.config import Settings

SAM_MODEL = "sam-3.1"
MAX_ITEMS = 6

BOX_RE = re.compile(r"<\|box;([^|]*)\|>")

VISION_PROMPT = """\
You are a dietitian's vision assistant. The first image is a meal BEFORE eating{after}.
List up to 6 distinct foods (ignore plates, cutlery, table).
For each food give:
- name_ko: short food name, written only in {language} (e.g. {example})
- sam_prompt: a short English noun phrase naming ONE visible piece/region of it, used to \
segment it (e.g. "chicken slice", "rice", "broccoli floret", "fried egg", "kimchi")
- countable: true if it is served as separate pieces worth counting (slices, florets, \
dumplings), false for heaps/liquids/single items
- protein_g: protein in the whole BEFORE portion, grams (estimate)
- kcal: energy of the whole BEFORE portion (estimate)
- left_pct: percent of the BEFORE portion still on the plate in the AFTER image \
(100 if no after image)
Be realistic for Korean home portions. Respond with JSON only."""

VISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name_ko": {"type": "string"},
                    "sam_prompt": {"type": "string"},
                    "countable": {"type": "boolean"},
                    "protein_g": {"type": "number"},
                    "kcal": {"type": "number"},
                    "left_pct": {"type": "number"},
                },
                "required": ["name_ko", "sam_prompt", "countable", "protein_g", "kcal", "left_pct"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


class VisionItem(BaseModel):
    name_ko: str = Field(min_length=1, max_length=30)
    sam_prompt: str = Field(min_length=1, max_length=60)
    countable: bool
    protein_g: float = Field(ge=0, le=300)
    kcal: float = Field(ge=0, le=5000)
    left_pct: float = Field(ge=0, le=100)


def parse_boxes(text: str) -> list[dict]:
    """Boxes from SAM's token stream: <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..;c=..|>."""
    boxes = []
    for match in BOX_RE.finditer(text):
        fields = dict(part.split("=", 1) for part in match.group(1).split(";") if "=" in part)
        try:
            box = {key: float(fields[key]) for key in ("x1", "y1", "x2", "y2", "w", "h")}
        except (KeyError, ValueError):
            continue
        box["c"] = float(fields.get("c", 1))
        boxes.append(box)
    return boxes


def box_area(box: dict) -> float:
    return max(0.0, box["x2"] - box["x1"] + 1) * max(0.0, box["y2"] - box["y1"] + 1)


def segment(client: OpenAI, image_url: str, phrase: str, min_conf: float = 0.4) -> list[dict]:
    response = client.responses.create(
        model=SAM_MODEL,
        store=False,
        # one_bit keeps payloads small; we only read the boxes.
        metadata={"include_confidence": "true", "mask_encoding": "one_bit"},
        input=[
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": phrase},
                    {"type": "input_image", "image_url": image_url},
                ],
            }
        ],
    )
    return [box for box in parse_boxes(response.output_text) if box["c"] >= min_conf]


def identify(
    client: OpenAI,
    settings: Settings,
    before_url: str,
    after_url: str | None,
    lang: str = "ko",
) -> list[VisionItem]:
    content: list[dict] = [
        {
            "type": "input_text",
            "text": VISION_PROMPT.format(
                after=" and the second image is the same plate AFTER eating" if after_url else "",
                language="English" if lang == "en" else "Korean",
                example="chicken breast, white rice" if lang == "en" else "닭가슴살, 흰쌀밥",
            ),
        },
        {"type": "input_image", "image_url": before_url},
    ]
    if after_url:
        content.append({"type": "input_image", "image_url": after_url})
    response = client.responses.create(
        model=settings.meta_model,
        store=False,
        max_output_tokens=settings.meta_max_output_tokens,
        input=[{"role": "user", "content": content}],
        text={
            "format": {
                "type": "json_schema",
                "name": "plate",
                "schema": VISION_SCHEMA,
                "strict": True,
            }
        },
    )
    if response.status != "completed" or not response.output_text.strip():
        raise RuntimeError("음식 인식 응답을 받지 못했습니다. 사진을 다시 시도하세요.")
    data = json.loads(response.output_text)
    return [VisionItem.model_validate(item) for item in data.get("items", [])][:MAX_ITEMS]


def geometric_left(item: VisionItem, before: list[dict], after: list[dict]) -> float | None:
    """Share of the food left, from SAM alone: instance count or main-portion area."""
    if not before:
        return None
    if item.countable and len(before) >= 2:
        return min(1.0, len(after) / len(before))
    # Heaps scatter into crumbs after eating; compare the main portion, not every crumb.
    biggest_before = max(box_area(box) for box in before)
    biggest_after = max((box_area(box) for box in after), default=0.0)
    return min(1.0, biggest_after / biggest_before) if biggest_before else None


def combine(item: VisionItem, before: list[dict], after: list[dict] | None) -> dict:
    vision_left = item.left_pct / 100
    sam_left = geometric_left(item, before, after) if after is not None else None
    # SAM finding nothing while vision sees a real portion is a missed detection, not an
    # empty plate: trust vision there. Otherwise average the two views.
    if sam_left == 0 and vision_left >= 0.3:
        sam_left = None
    left = vision_left if sam_left is None else (vision_left + sam_left) / 2
    eaten = 1 - left if after is not None else None
    return {
        "name": item.name_ko,
        "prompt": item.sam_prompt,
        "countable": item.countable,
        "protein_g": round(item.protein_g, 1),
        "kcal": round(item.kcal),
        "vision_left_pct": round(vision_left * 100),
        "sam_left_pct": None if sam_left is None else round(sam_left * 100),
        "count_before": len(before),
        "count_after": None if after is None else len(after),
        "left_pct": round(left * 100),
        "eaten_pct": None if eaten is None else round(eaten * 100),
        "protein_eaten_g": None if eaten is None else round(item.protein_g * eaten, 1),
        "kcal_eaten": None if eaten is None else round(item.kcal * eaten),
        "boxes_before": [compact(box) for box in before],
        "boxes_after": [] if after is None else [compact(box) for box in after],
    }


def compact(box: dict) -> list[float]:
    return [round(box["x1"]), round(box["y1"]), round(box["x2"]), round(box["y2"])]


def analyze_plate(
    client: OpenAI,
    settings: Settings,
    before_url: str,
    after_url: str | None = None,
    lang: str = "ko",
) -> dict:
    items = identify(client, settings, before_url, after_url, lang)
    if not items:
        return {"items": [], "summary": "사진에서 음식을 찾지 못했습니다."}
    jobs = [(item.sam_prompt, url) for item in items for url in (before_url, after_url) if url]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda job: safe_segment(client, *job), jobs))
    size = next((box for boxes in results for box in boxes), None)
    out_items = []
    for index, item in enumerate(items):
        before = results[index * (2 if after_url else 1)]
        after = results[index * 2 + 1] if after_url else None
        out_items.append(combine(item, before, after))
    totals: dict[str, Any] = {
        "protein_g": round(sum(i["protein_g"] for i in out_items), 1),
        "kcal": sum(i["kcal"] for i in out_items),
    }
    if after_url:
        totals["protein_eaten_g"] = round(sum(i["protein_eaten_g"] for i in out_items), 1)
        totals["kcal_eaten"] = sum(i["kcal_eaten"] for i in out_items)
    return {
        "items": out_items,
        "totals": totals,
        "image_size": [size["w"], size["h"]] if size else None,
        "models": [settings.meta_model, SAM_MODEL],
        "note": "사진 기반 추정치입니다. 실제 섭취량·영양성분과 다를 수 있습니다.",
    }


def safe_segment(client: OpenAI, phrase: str, url: str) -> list[dict]:
    try:
        return segment(client, url, phrase)
    except Exception:  # noqa: BLE001 - one failed segmentation should not sink the plate
        return []


def plate_note(result: dict) -> str:
    """One line for the daily log the coach reads."""
    parts = [
        f"{i['name']} {i['eaten_pct']}%"
        for i in result.get("items", [])
        if i.get("eaten_pct") is not None
    ]
    totals = result.get("totals", {})
    if "protein_eaten_g" in totals:
        return (
            f"식판 렌즈: {', '.join(parts)} 섭취, 단백질 약 {totals['protein_eaten_g']}g, "
            f"약 {totals['kcal_eaten']}kcal"
        )
    names = ", ".join(i["name"] for i in result.get("items", []))
    return f"식판 렌즈(식전): {names}, 단백질 약 {totals.get('protein_g', 0)}g 제공"
