import { describe, expect, it } from "vitest";
import { comparePhotoConditions } from "./features/photo";
import {
  adaptiveThreshold,
  countPeaksAbove,
  detectMotionReps,
  estimateNoiseFloor,
  extractEnvelope,
  segmentStats,
} from "./mealFeatures";

function sineBurst(
  length: number,
  bursts: Array<[number, number]>,
): Float32Array {
  const samples = new Float32Array(length);
  for (const [start, end] of bursts) {
    for (let i = start; i < Math.min(end, length); i++) {
      samples[i] = Math.sin(i / 4) * 0.5;
    }
  }
  return samples;
}

describe("envelope and peak helpers", () => {
  it("finds active windows above a threshold", () => {
    const envelope = extractEnvelope([sineBurst(1000, [[100, 300]])], 100);
    expect(envelope).toHaveLength(10);
    const loud = envelope.slice(1, 3);
    expect(Math.min(...loud)).toBeGreaterThan(
      Math.max(envelope[0], envelope[9]),
    );
  });

  it("counts spaced peaks and merges close ones", () => {
    expect(countPeaksAbove([0, 1, 0.2, 0.9, 0.1, 1, 0], 0.5, 2)).toEqual([
      1, 3, 5,
    ]);
    expect(countPeaksAbove([0, 1, 0.9, 1, 0], 0.5, 5)).toEqual([1]);
  });

  it("summarizes active share and runs", () => {
    expect(segmentStats([0.1, 0.9, 0.8, 0.1, 0.1, 0.9, 0.1], 0.5)).toEqual({
      activeRatio: 3 / 7,
      segments: 2,
    });
  });
});

describe("adaptive thresholds", () => {
  it("lifts the floor in noisy rooms", () => {
    const noisy = new Array(100).fill(0.05);
    expect(estimateNoiseFloor(noisy)).toBeCloseTo(0.05, 5);
    expect(adaptiveThreshold(noisy, 1.5, 0.02)).toBeGreaterThan(0.099);
  });

  it("never drops below the absolute floor", () => {
    expect(adaptiveThreshold([0, 0, 0], 1.5, 0.02)).toBe(0.02);
  });
});

describe("photo condition checks", () => {
  const base = {
    filename: "a.jpg",
    width: 800,
    height: 600,
    brightness: 120,
    colorfulness: 40,
    blur: 30,
    foodPixelRatio: 0.4,
  };
  it("accepts matching shots", () => {
    expect(comparePhotoConditions(base, { ...base })).toBeNull();
  });
  it("warns on different framing", () => {
    expect(
      comparePhotoConditions(base, { ...base, width: 600, height: 800 }),
    ).toMatch("구도");
  });
  it("warns on different lighting", () => {
    expect(comparePhotoConditions(base, { ...base, brightness: 40 })).toMatch(
      "밝기",
    );
  });
  it("warns on blurry shots", () => {
    expect(comparePhotoConditions(base, { ...base, blur: 0.1 })).toMatch(
      "흔들",
    );
  });
});

describe("chair-stand rep detection", () => {
  it("counts reps from acceleration magnitude", () => {
    const samples = Array.from({ length: 600 }, (_, i) => {
      const phase = (i % 120) / 120;
      const mag =
        1 + (phase < 0.2 ? Math.sin((phase / 0.2) * Math.PI) * 0.9 : 0);
      return { t: i * (1000 / 60), mag };
    });
    const result = detectMotionReps(samples, 10);
    expect(result.repCount).toBe(5);
    expect(result.meanRepSec).toBeCloseTo(2, 0);
    expect(result.peakAccelG).toBeGreaterThan(1.5);
  });

  it("reports zero reps for a still phone", () => {
    const samples = Array.from({ length: 300 }, (_, i) => ({
      t: i * 20,
      mag: 1,
    }));
    const result = detectMotionReps(samples, 6);
    expect(result.repCount).toBe(0);
    expect(result.meanRepSec).toBe(0);
  });
});
