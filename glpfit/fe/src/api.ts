export type Health = {
  status: "ok";
  model: string;
  live_configured: boolean;
  max_steps: number;
  tools: string[];
};

export type AgentEvent =
  | { type: "step"; step: number; message: string }
  | {
      type: "tool_call";
      call_id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      call_id: string;
      name: string;
      output: Record<string, unknown>;
    }
  | { type: "final"; text: string }
  | { type: "error"; message: string }
  | { type: "memory"; text: string };

export async function readAgentEvents(
  response: Response,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `서버 요청 실패 (HTTP ${response.status})`,
    );
  }
  if (!response.body)
    throw new Error("서버에서 실행 스트림을 받지 못했습니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) onEvent(JSON.parse(data) as AgentEvent);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        parse(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) {
        if (buffer.trim()) throw new Error("실행 스트림이 중간에 끊겼습니다.");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
