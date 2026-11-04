import { round3 } from "./signal";
import type { PhotoFeatures } from "./types";

/** Warn when before/after shots differ enough to skew the comparison. */
export function comparePhotoConditions(
  before: PhotoFeatures,
  after: PhotoFeatures,
): string | null {
  const aspectBefore = before.width / Math.max(1, before.height);
  const aspectAfter = after.width / Math.max(1, after.height);
  const aspectDrift = Math.abs(aspectBefore - aspectAfter) / aspectBefore;
  if (aspectDrift > 0.15) {
    return "두 사진의 구도가 달라 비교가 부정확할 수 있어요. 같은 자리에서 같은 각도로 찍어보세요.";
  }
  const brighter = Math.max(before.brightness, 1);
  const brightnessDrift =
    Math.abs(before.brightness - after.brightness) / brighter;
  if (brightnessDrift > 0.3) {
    return "두 사진의 밝기가 많이 달라요. 같은 조명에서 찍으면 비교가 정확해져요.";
  }
  if (before.blur < 0.5 || after.blur < 0.5) {
    return "사진이 흔들렸을 수 있어요. 휴대폰을 고정하고 다시 찍어보세요.";
  }
  return null;
}

/** Downscale to 160px wide and compute brightness, color, blur, warm-pixel ratio. */
export async function analyzePhoto(file: File): Promise<PhotoFeatures> {
  const bitmap = await createImageBitmap(file);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const targetWidth = 160;
  const targetHeight = Math.max(
    1,
    Math.round((targetWidth * sourceHeight) / sourceWidth),
  );
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("캔버스 2D 컨텍스트를 사용할 수 없습니다.");
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data;
  const count = targetWidth * targetHeight;

  let brightnessSum = 0;
  let rgSum = 0;
  let ybSum = 0;
  let rgSqSum = 0;
  let ybSqSum = 0;
  let warm = 0;
  const gray: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    const grayValue = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = grayValue;
    brightnessSum += grayValue;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg;
    ybSum += yb;
    rgSqSum += rg * rg;
    ybSqSum += yb * yb;
    if (r > 0.35 && r - b > 0.08 && r >= g) warm++;
  }
  const rgMean = rgSum / count;
  const ybMean = ybSum / count;
  const rgStd = Math.sqrt(Math.max(0, rgSqSum / count - rgMean * rgMean));
  const ybStd = Math.sqrt(Math.max(0, ybSqSum / count - ybMean * ybMean));
  const colorfulness =
    Math.sqrt(rgStd * rgStd + ybStd * ybStd) +
    0.3 * Math.sqrt(rgMean * rgMean + ybMean * ybMean);

  // Variance of the Laplacian on grayscale: higher means sharper.
  const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  for (let y = 1; y < targetHeight - 1; y++) {
    for (let x = 1; x < targetWidth - 1; x++) {
      let value = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          value +=
            gray[(y + ky) * targetWidth + (x + kx)] *
            kernel[(ky + 1) * 3 + (kx + 1)];
        }
      }
      lapSum += value;
      lapSqSum += value * value;
      lapCount++;
    }
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const blur = lapCount
    ? Math.max(0, lapSqSum / lapCount - lapMean * lapMean)
    : 0;

  return {
    filename: file.name.slice(0, 200),
    width: sourceWidth,
    height: sourceHeight,
    brightness: round3((brightnessSum / count) * 255),
    colorfulness: round3(colorfulness * 100),
    blur: round3(blur * 1000),
    foodPixelRatio: round3(warm / count),
  };
}
