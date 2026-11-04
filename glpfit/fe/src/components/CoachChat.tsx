import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, Check, LoaderCircle, RotateCcw } from "lucide-react";
import { readAgentEvents } from "../api";
import { useTr } from "../i18n";
import type { CoachContext } from "../profile";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: string[];
  memory?: string;
  error?: boolean;
};

type CoachChatProps = {
  live: boolean;
  context: () => CoachContext;
  phaseName: string | null;
  cycleDay: number | null;
  nickname: string;
  onMemory: (text: string) => void;
};

const KEY = "glpfit.chat.v1";
const DEMO_PROMPT = "GLP-1 약을 쓰면서 식사할 때 무엇을 신경 쓰면 좋을까?";

function loadChat(): Message[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Message[]).slice(-30) : [];
  } catch {
    return [];
  }
}

function saveChat(messages: Message[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    // Keep the chat for this session only.
  }
}

export function CoachChat({
  live,
  context,
  phaseName,
  cycleDay,
  nickname,
  onMemory,
}: CoachChatProps) {
  const { lang, tr } = useTr();
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const TOOL_LABEL: Record<string, string> = {
    get_progress: tr("내 기록 추세 확인", "Checked your trends"),
    get_medication_schedule: tr("주사 일정 확인", "Checked your shot schedule"),
    get_coaching_tips: tr("코칭 팁 찾기", "Looked up coaching tips"),
    analyze_meal: tr("식사 분석", "Analyzed the meal"),
    remember: tr("기억하기", "Saved to memory"),
    get_current_time: tr("시간 확인", "Checked the time"),
  };

  const quick =
    cycleDay !== null && cycleDay <= 2
      ? [
          tr(
            "속이 메스꺼운데 뭘 먹으면 좋아?",
            "I feel nauseous. What should I eat?",
          ),
          tr(
            "입맛이 없어도 단백질 챙기는 법",
            "How to get protein with no appetite",
          ),
          tr("이번 주 나 어땠어?", "How did I do this week?"),
        ]
      : cycleDay !== null && cycleDay >= 6
        ? [
            tr(
              "요즘 간식이 당겨, 어떻게 하지?",
              "Snack cravings are back. Tips?",
            ),
            tr("오늘 저녁 뭐 먹을까?", "What should I have for dinner?"),
            tr("이번 주 나 어땠어?", "How did I do this week?"),
          ]
        : [
            tr("이번 주 나 어땠어?", "How did I do this week?"),
            tr("오늘 저녁 뭐 먹을까?", "What should I have for dinner?"),
            tr("단백질을 더 챙기려면?", "How can I get more protein?"),
          ];

  useEffect(() => saveChat(messages), [messages]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, working.length, busy]);

  async function send(text: string) {
    const question = (live ? text : DEMO_PROMPT).trim();
    if (!question || busy) return;
    const user: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: live ? question : text || question,
    };
    const history = messages
      .filter((m) => !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
    setMessages((prev) => [...prev, user]);
    setInput("");
    setBusy(true);
    setWorking([]);
    const tools: string[] = [];
    let memory: string | undefined;
    let answer = "";
    let failed = "";
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: live ? "live" : "demo",
          prompt: question,
          context: context(),
          lang,
          history,
        }),
      });
      await readAgentEvents(response, (event) => {
        if (event.type === "tool_call") {
          const label = TOOL_LABEL[event.name] ?? event.name;
          if (!tools.includes(label)) tools.push(label);
          setWorking([...tools]);
        } else if (event.type === "memory") {
          memory = event.text;
          onMemory(event.text);
        } else if (event.type === "final") {
          answer = event.text;
        } else if (event.type === "error") {
          failed = event.message;
        }
      });
    } catch (reason) {
      failed =
        reason instanceof Error
          ? reason.message
          : tr("답을 받지 못했어요.", "No answer came back.");
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `a-${Date.now()}`,
        role: "assistant",
        text:
          failed || answer || tr("답을 받지 못했어요.", "No answer came back."),
        tools,
        memory,
        error: !!failed || !answer,
      },
    ]);
    setBusy(false);
    setWorking([]);
  }

  return (
    <section className="coach" aria-labelledby="coach-title">
      <div className="page-head page-head-row">
        <div>
          <h1 id="coach-title">{tr("코치", "Coach")}</h1>
          <p>
            {phaseName
              ? tr(
                  `주사 후 ${cycleDay}일째, ${phaseName}에 맞춰 답해요`,
                  `Day ${cycleDay} after your shot: answers fit the ${phaseName.toLowerCase()} phase`,
                )
              : tr("내 기록을 보고 답해요", "Answers from your own records")}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            className="icon-button"
            aria-label={tr("대화 지우기", "Clear chat")}
            title={tr("대화 지우기", "Clear chat")}
            disabled={busy}
            onClick={() => setMessages([])}
          >
            <RotateCcw size={17} />
          </button>
        )}
      </div>

      {!live && (
        <p className="demo-banner">
          {tr(
            "샘플 모드예요. Meta API 키를 넣으면 실제 Muse Spark 코치가 답해요.",
            "Sample mode. Add a Meta API key for the real Muse Spark coach.",
          )}
        </p>
      )}

      <div className="chat">
        {messages.length === 0 && (
          <div className="bubble assistant intro">
            {tr(
              `${nickname ? `${nickname}님, ` : ""}안녕하세요. 체크인, 식사 사진, 주사 기록을 보고 오늘 할 일을 알려 드릴게요. 무엇이든 물어보세요.`,
              `Hi${nickname ? ` ${nickname}` : ""}! I read your check-ins, meal photos and shots to tell you what to do today. Ask me anything.`,
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble-row ${m.role}`}>
            {m.role === "assistant" && m.tools && m.tools.length > 0 && (
              <div className="tool-chips">
                {m.tools.map((t) => (
                  <span key={t}>
                    <Check size={11} strokeWidth={3} />
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className={`bubble ${m.role}${m.error ? " error" : ""}`}>
              {m.text}
            </div>
            {m.memory && (
              <div className="memory-note">
                <Brain size={13} />
                {tr(`기억했어요: ${m.memory}`, `Remembered: ${m.memory}`)}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="bubble-row assistant">
            <div className="tool-chips">
              {working.map((t) => (
                <span key={t}>
                  <Check size={11} strokeWidth={3} />
                  {t}
                </span>
              ))}
            </div>
            <div className="bubble assistant typing">
              <LoaderCircle className="spin" size={15} />
              {working.length
                ? tr(
                    "기록을 보고 답을 쓰는 중",
                    "Writing an answer from your records",
                  )
                : tr("생각하는 중", "Thinking")}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        <div className="chip-row quick-row">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => void send(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            rows={1}
            maxLength={2000}
            placeholder={tr("코치에게 물어보기", "Ask your coach")}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send(input);
              }
            }}
          />
          <button
            type="submit"
            className="send-button"
            disabled={busy || (!input.trim() && live)}
            aria-label={tr("보내기", "Send")}
          >
            <ArrowUp size={18} />
          </button>
        </form>
      </div>
    </section>
  );
}
