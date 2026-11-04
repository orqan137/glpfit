/** Client side of Plate Lens (Muse Spark vision + SAM 3.1). */

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
