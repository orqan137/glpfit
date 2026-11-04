<p align="center">
  <img src="glpfit/fe/public/icon.svg" width="88" alt="GLPfit logo" />
</p>

<h1 align="center">GLPfit 지엘피핏</h1>
<p align="center"><b>A weekly-shot companion for Mounjaro and Wegovy users.<br/>Weight, shots, meals and bodyweight exercise, coached by Meta AI around your injection cycle.</b></p>

> Meta Global AI Developer Hackathon · Build for Your World

## The problem

Mounjaro (tirzepatide, a dual GIP/GLP-1 agonist) and Wegovy (semaglutide, a GLP-1 agonist) are **once-a-week shots**. Most users feel the week: appetite is lowest and nausea is common in the first days after the shot, and appetite returns before the next one. Weight drops fast, and **muscle goes with it** unless people eat enough protein and do some strength work.

Diet apps treat every day the same and make you type in your food. GLPfit is built around one question: **what day after the shot is it, and what should I do today?**

## What it does

Four core things, everything else is secondary.

| Core | How |
| --- | --- |
| **Weight** | One number a day (or say it out loud). A trend chart marks every shot and dose step. |
| **Shots** | Log Mounjaro/Wegovy doses. See days since the shot, the next due date, a site to rotate to, the label's dose ladder, and an **estimated relative drug-level curve** from the label half-life. |
| **Meals** | **Just take a photo.** Plate Lens finds every food, estimates protein and calories, and with an after photo measures how much you actually ate. Daily protein fills itself in. |
| **Bodyweight exercise** | A 3-move routine that follows the cycle: gentle right after the shot, strength on steady days, legs when appetite returns. Tap sets as you go. |
| **Coach agent** | A chat coach that reads all of the above with tools, adapts to the cycle phase and remembers your patterns. |

Secondary indicators (water, how you feel) fold away. A one-tap **clinician PDF** summarizes the last 30 days for the monthly visit.

## How it uses Meta AI

| Meta model | Where | Beyond a basic call |
| --- | --- | --- |
| **SAM 3.1** | Plate Lens | Segmentation as a **measuring tool**: it counts and sizes every piece of each food in the before and after photos (e.g. chicken slices 9 → 3) to measure what was eaten. |
| **Muse Spark (vision + structured output)** | Plate Lens | Names foods and estimates protein, kcal and how much is left under a strict JSON schema. Its estimate and SAM's geometry **cross-check each other**. |
| **Muse Spark (agent)** | Coach | Picks tools on its own: `get_progress` (server-computed trends, so the model never does arithmetic), `get_medication_schedule`, `get_coaching_tips`, `remember` (persistent memory). Multi-turn chat in Korean or English. |
| **Muse Voice Transcribe + structured output** | Voice check-in | "79.2 kilos, four glasses of water, a bit nauseous" becomes a structured daily log. Hands-free when you feel queasy. |
| **Muse Spark (structured output)** | Clinician report | Computed facts (dose history, symptoms by day after the shot, measured protein) become a one-page report with questions to ask. |
| **Muse Image** | Demo data | Generated and edited the matching before/after meal photos used in the demo. |

## Where the data goes next

No community features. The records themselves become valuable, step by step:

1. **You**: your data is yours. Export everything as JSON; print the clinician PDF.
2. **Your clinic**: a standardized monthly report (dose history, symptoms by cycle day, measured protein) to support dose decisions made by the prescriber.
3. **Research and pharma (opt-in)**: a de-identified dataset (`glpfit.rwd.v1`: relative days, drug and dose, weight change %, protein, symptom codes; no names, notes, dates or actual weight). Pooled, it becomes real-world evidence such as *which days after a shot side effects cluster* and *protein intake by dose step*.

## Safety

- No diagnosis, no prescribing, never suggests a dose change. Dose steps are label reference only.
- The drug-level curve is a model from the label half-life, clearly marked as **not a measured blood level**.
- Every number is labeled as a self-log or photo estimate. Severe symptoms → contact a clinician.
- Data lives in the browser and goes to the server only when you ask for coaching (`store=False` on Meta calls).

## Run it

Requires Node.js 24+ and [uv](https://docs.astral.sh/uv/).

```bash
cd glpfit
uv sync --locked
npm install --no-package-lock
cp .env.example .env    # put your Meta key in MODEL_API_KEY (or META_API_KEY in env.txt)
npm run dev             # web http://127.0.0.1:5173, API docs /api/docs
```

On Windows PowerShell you can run `.\scripts\setup.ps1` instead of the first three steps.

Without a key, the app runs in **sample mode**: shots, weight, exercise and the clinician fact table work, and the Plate Lens sample shows a real result computed earlier. Your own photos, voice, the live coach and the written report need a key.

## Code map

- `glpfit/fe/` React + TypeScript + Vite mobile web app (PWA). Tabs: Home, Shots, Meals, Move, Coach; Me behind the top icon.
  - `medication.ts` shots, cycle, site rotation, dose ladder, drug-level curve · `meals.ts` photo meals and protein · `exercise.ts` cycle-aware routines · `profile.ts` profile, logs, coach context · `dataExport.ts` export and de-identification · `i18n.ts` Korean/English
- `glpfit/agent/glpfit_agent/` coach prompt and tool loop (`agent.py`), tools (`tools.py`), trends (`profile.py`), cycle phases (`medication.py`), Plate Lens (`plate.py`), voice (`voice.py`), clinician report (`report.py`)
- `glpfit/be/glpfit_be/api.py` FastAPI: `/api/runs` (SSE coach), `/api/plate`, `/api/voice-checkin`, `/api/report`, `/api/health`
- Tests: `glpfit/tests/` (51, Meta responses mocked) and `glpfit/fe/src/*.test.ts` (27)

```bash
cd glpfit
uv run --locked pytest && uv run --locked ruff check .
npm test && npm run build
```

## 한국어 요약

마운자로·위고비는 주 1회 주사라 주사 후 며칠째냐에 따라 식욕과 부작용이 달라집니다. 지엘피핏은 **체중, 투약, 식사(사진), 맨몸운동** 네 가지만 기록하고, Meta AI 코치가 주사 주기에 맞춰 오늘 할 일을 알려 줍니다. 식사는 사진만 찍으면 SAM 3.1과 Muse Spark가 음식과 단백질을 자동으로 기록하고, 한 달에 한 번 병원 갈 때 볼 기록을 PDF로 뽑을 수 있습니다. 물, 몸 상태 같은 보조지표는 접어 두었고, 한국어와 영어를 지원합니다.
