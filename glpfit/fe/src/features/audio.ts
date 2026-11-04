import {
  countPeaksAbove,
  extractEnvelope,
  round3,
  segmentStats,
} from "./signal";
import type { AudioFeatures, BowelFeatures } from "./types";

/** Ambient floor estimated from the quietest 10% of windows. */
export function estimateNoiseFloor(envelope: number[]): number {
  if (!envelope.length) return 0;
  const sorted = [...envelope].sort((a, b) => a - b);
  const quiet = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.1)));
  return quiet.reduce((a, b) => a + b, 0) / quiet.length;
}

/** Adaptive threshold: at least twice the ambient floor, never below 0.015. */
export function adaptiveThreshold(
  envelope: number[],
  ratio: number,
  floor = 0.015,
): number {
  const mean =
    envelope.reduce((a, b) => a + b, 0) / Math.max(1, envelope.length);
  return Math.max(mean * ratio, estimateNoiseFloor(envelope) * 2, floor);
}

async function decodeMono(blob: Blob): Promise<{
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
}> {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }
    return {
      channels,
      sampleRate: buffer.sampleRate,
      durationSec: buffer.duration,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Decode any browser-supported audio and estimate activity rhythm. */
export async function analyzeAudio(
  blob: Blob,
  filename: string,
): Promise<AudioFeatures> {
  const { channels, sampleRate, durationSec } = await decodeMono(blob);
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.1));
  const envelope = extractEnvelope(channels, windowSize);
  const meanRms = Math.sqrt(
    envelope.reduce((a, b) => a + b * b, 0) / Math.max(1, envelope.length),
  );
  const threshold = adaptiveThreshold(envelope, 1.5, 0.02);
  const { activeRatio, segments } = segmentStats(envelope, threshold);
  // Chew peaks: local maxima above threshold, at least 0.35s apart.
  const peaks = countPeaksAbove(
    envelope,
    threshold,
    Math.max(1, Math.round(0.35 / 0.1)),
  );
  return {
    filename: filename.slice(0, 200),
    durationSec: round3(durationSec),
    activeRatio: round3(activeRatio),
    chewRatePerMin: round3(
      durationSec > 0 ? (peaks.length / durationSec) * 60 : 0,
    ),
    pauseCount: segments > 0 ? segments - 1 : 0,
    meanRms: round3(meanRms),
  };
}

/** Bowel sounds: sparse loud bursts, so peaks need a long refractory gap. */
export async function analyzeBowel(
  blob: Blob,
  filename: string,
): Promise<BowelFeatures> {
  const { channels, sampleRate, durationSec } = await decodeMono(blob);
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.1));
  const envelope = extractEnvelope(channels, windowSize);
  const threshold = adaptiveThreshold(envelope, 2, 0.015);
  const peaks = countPeaksAbove(envelope, threshold, Math.round(2 / 0.1));
  const times = peaks.map((w) => (w * windowSize) / sampleRate);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const meanGap = gaps.length
    ? gaps.reduce((a, b) => a + b, 0) / gaps.length
    : null;
  return {
    filename: filename.slice(0, 200),
    durationSec: round3(durationSec),
    eventCount: peaks.length,
    meanIntervalSec: meanGap === null ? null : round3(meanGap),
    eventsPerMin: round3(
      durationSec > 0 ? (peaks.length / durationSec) * 60 : 0,
    ),
  };
}

export type Recorder = {
  stop: () => Promise<Blob>;
  startedAt: number;
  /** Live input level 0..1 for the recording meter. */
  level: () => number;
};

/** Record with MediaRecorder and hand back the raw blob for analysis. */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });
  let analyser: AnalyserNode | null = null;
  let meterData: Uint8Array<ArrayBuffer> | null = null;
  let meterContext: AudioContext | null = null;
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    meterContext = new AudioContextClass();
    const source = meterContext.createMediaStreamSource(stream);
    analyser = meterContext.createAnalyser();
    analyser.fftSize = 512;
    meterData = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
  } catch {
    analyser = null;
  }
  recorder.start();
  return {
    startedAt: Date.now(),
    stop: () => {
      recorder.stop();
      void meterContext?.close().catch(() => undefined);
      return done;
    },
    level: () => {
      if (!analyser || !meterData) return 0;
      analyser.getByteTimeDomainData(meterData);
      let sum = 0;
      for (let i = 0; i < meterData.length; i++) {
        const v = (meterData[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / meterData.length) * 4);
    },
  };
}
