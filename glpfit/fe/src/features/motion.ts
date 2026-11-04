import { countPeaksAbove, round3 } from "./signal";
import type { MotionFeatures } from "./types";

export type MotionSample = { t: number; mag: number };

/** Detect sit-to-stand reps from acceleration magnitude (in G). */
export function detectMotionReps(
  samples: MotionSample[],
  durationSec: number,
): MotionFeatures {
  if (samples.length < 10 || durationSec <= 0) {
    return {
      durationSec: round3(Math.max(0, durationSec)),
      repCount: 0,
      meanRepSec: 0,
      peakAccelG: round3(
        samples.length ? Math.max(...samples.map((s) => s.mag)) : 0,
      ),
    };
  }
  const mags = samples.map((s) => s.mag);
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  const variance =
    mags.reduce((a, b) => a + (b - mean) * (b - mean), 0) / mags.length;
  const zero = {
    durationSec: round3(Math.max(0, durationSec)),
    repCount: 0,
    meanRepSec: 0,
    peakAccelG: round3(Math.max(...mags)),
  };
  if (variance < 1e-9) return zero;
  const threshold = mean + 0.5 * Math.sqrt(variance);
  // Smooth with a small moving average, then peak-pick.
  const span = 5;
  const smooth = mags.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (
      let k = Math.max(0, i - span);
      k <= Math.min(mags.length - 1, i + span);
      k++
    ) {
      sum += mags[k];
      count++;
    }
    return sum / count;
  });
  const times = samples.map((s) => s.t);
  const dt =
    (times[times.length - 1] - times[0]) / 1000 / Math.max(1, times.length - 1);
  const minGap = Math.max(1, Math.round(1.2 / Math.max(dt, 0.01)));
  const peaks = countPeaksAbove(smooth, threshold, minGap);
  const reps = peaks.length;
  return {
    durationSec: round3(durationSec),
    repCount: reps,
    meanRepSec: round3(reps > 0 ? durationSec / reps : 0),
    peakAccelG: round3(Math.max(...mags)),
  };
}

export type MotionRecorder = {
  stop: () => MotionFeatures;
};

/** Capture the phone accelerometer (e.g. fixed on the thigh) until stopped. */
export async function startMotionCapture(): Promise<MotionRecorder> {
  const requestPermission = (
    window as unknown as {
      DeviceMotionEvent?: typeof DeviceMotionEvent & {
        requestPermission?: () => Promise<string>;
      };
    }
  ).DeviceMotionEvent?.requestPermission;
  if (typeof requestPermission === "function") {
    const answer = await requestPermission();
    if (answer !== "granted")
      throw new Error("모션 센서 권한이 거부되었습니다.");
  }
  if (typeof window.DeviceMotionEvent === "undefined") {
    throw new Error("이 기기·브라우저는 모션 센서를 지원하지 않습니다.");
  }
  const samples: MotionSample[] = [];
  const startedAt = Date.now();
  const handler = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
    const g = 9.80665;
    const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z) / g;
    samples.push({ t: Date.now(), mag });
    if (samples.length > 7200) samples.splice(0, samples.length - 7200);
  };
  window.addEventListener("devicemotion", handler);
  return {
    stop: () => {
      window.removeEventListener("devicemotion", handler);
      return detectMotionReps(samples, (Date.now() - startedAt) / 1000);
    },
  };
}
