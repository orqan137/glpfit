export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Average channels and compute per-window RMS energy. */
export function extractEnvelope(
  channels: Float32Array[],
  windowSize: number,
): number[] {
  const length = channels[0]?.length ?? 0;
  const windows = Math.max(1, Math.floor(length / windowSize));
  const envelope: number[] = new Array(windows);
  for (let w = 0; w < windows; w++) {
    let sumSq = 0;
    const start = w * windowSize;
    const end = Math.min(length, start + windowSize);
    for (let i = start; i < end; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      sample /= channels.length;
      sumSq += sample * sample;
    }
    envelope[w] = Math.sqrt(sumSq / Math.max(1, end - start));
  }
  return envelope;
}

/** Indices of local maxima above threshold, spaced by at least minGap. */
export function countPeaksAbove(
  envelope: number[],
  threshold: number,
  minGap: number,
): number[] {
  const peaks: number[] = [];
  for (let w = 1; w < envelope.length - 1; w++) {
    if (
      envelope[w] > threshold &&
      envelope[w] >= envelope[w - 1] &&
      envelope[w] >= envelope[w + 1] &&
      (envelope[w] > envelope[w - 1] || envelope[w] > envelope[w + 1]) &&
      (peaks.length === 0 || w - peaks[peaks.length - 1] >= minGap)
    ) {
      peaks.push(w);
    }
  }
  return peaks;
}

/** Share of active windows and number of contiguous active runs. */
export function segmentStats(
  envelope: number[],
  threshold: number,
): { activeRatio: number; segments: number } {
  let active = 0;
  let segments = 0;
  let inActive = false;
  for (const value of envelope) {
    const on = value >= threshold;
    if (on) active++;
    if (on && !inActive) segments++;
    inActive = on;
  }
  return {
    activeRatio: envelope.length ? active / envelope.length : 0,
    segments,
  };
}
