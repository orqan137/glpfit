/** Client side of the Meta multimodal features: Plate Lens and voice check-in. */

export type PlateItem = {
  name: string;
  prompt: string;
  countable: boolean;
  protein_g: number;
  kcal: number;
  vision_left_pct: number;
  sam_left_pct: number | null;
  count_before: number;
  count_after: number | null;
  left_pct: number;
  eaten_pct: number | null;
  protein_eaten_g: number | null;
  kcal_eaten: number | null;
  boxes_before: number[][];
  boxes_after: number[][];
};

export type PlateResult = {
  items: PlateItem[];
  totals: {
    protein_g: number;
    kcal: number;
    protein_eaten_g?: number;
    kcal_eaten?: number;
  };
  image_size: [number, number] | null;
  models: string[];
  note: string;
  log_note: string;
};

export type VoiceCheckin = {
  transcript: string;
  log: {
    weight_kg: number | null;
    water_cups: number | null;
    protein_servings: number | null;
    symptoms: string[];
    injection_today: boolean;
    note: string;
  };
};

async function postJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `요청 실패 (HTTP ${response.status})`,
    );
  }
  return body as T;
}

/** Downscale on the device so uploads are small and SAM runs fast. */
export async function imageToDataUrl(
  source: Blob,
  maxSide = 1280,
): Promise<{ url: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { url: canvas.toDataURL("image/jpeg", 0.86), width, height };
}

export function analyzePlate(
  before: string,
  after: string | null,
  lang: "ko" | "en" = "ko",
) {
  return postJson<PlateResult>("/api/plate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(after ? { before, after, lang } : { before, lang }),
  });
}

export function sendVoiceCheckin(wav: Blob, lang: "ko" | "en" = "ko") {
  return postJson<VoiceCheckin>(`/api/voice-checkin?lang=${lang}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
}

/** Any recording → 16 kHz mono 16-bit PCM WAV, the format Muse Voice Transcribe takes. */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(decoded.duration * rate)),
      rate,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) =>
      [...value].forEach((ch, i) =>
        view.setUint8(offset + i, ch.charCodeAt(0)),
      );
    text(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    void context.close().catch(() => undefined);
  }
}
