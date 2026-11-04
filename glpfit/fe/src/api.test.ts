import { describe, expect, it } from "vitest";
import { readAgentEvents, type AgentEvent } from "./api";

function streamed(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    }),
  );
}

describe("agent event stream", () => {
  it("handles events and Korean text split across UTF-8 byte boundaries", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"step","step":1,"message":"시작"}\n\n' +
        'data: {"type":"final","text":"서울 현재 시간"}\n\n',
    );
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
    const events: AgentEvent[] = [];
    await readAgentEvents(streamed(chunks), (event) => events.push(event));
    expect(events).toEqual([
      { type: "step", step: 1, message: "시작" },
      { type: "final", text: "서울 현재 시간" },
    ]);
  });

  it("propagates a missing-key error before parsing the stream", async () => {
    const response = new Response(
      JSON.stringify({ detail: "MODEL_API_KEY 미설정" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
    await expect(readAgentEvents(response, () => undefined)).rejects.toThrow(
      "MODEL_API_KEY 미설정",
    );
  });

  it("rejects a truncated frame instead of treating it as a successful run", async () => {
    const response = streamed([
      new TextEncoder().encode('data: {"type":"final","text":"부분'),
    ]);
    await expect(readAgentEvents(response, () => undefined)).rejects.toThrow(
      "중간에 끊겼습니다",
    );
  });

  it("handles CRLF framing split between chunks", async () => {
    const encoder = new TextEncoder();
    const response = streamed([
      encoder.encode('data: {"type":"error","message":"failed"}\r'),
      encoder.encode("\n\r\n"),
    ]);
    const events: AgentEvent[] = [];
    await readAgentEvents(response, (event) => events.push(event));
    expect(events).toEqual([{ type: "error", message: "failed" }]);
  });
});
