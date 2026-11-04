export type PhotoFeatures = {
  filename: string;
  width: number;
  height: number;
  brightness: number;
  colorfulness: number;
  blur: number;
  foodPixelRatio: number;
};

export type AudioFeatures = {
  filename: string;
  durationSec: number;
  activeRatio: number;
  chewRatePerMin: number;
  pauseCount: number;
  meanRms: number;
};

export type BowelFeatures = {
  filename: string;
  durationSec: number;
  eventCount: number;
  meanIntervalSec: number | null;
  eventsPerMin: number;
};

export type MotionFeatures = {
  durationSec: number;
  repCount: number;
  meanRepSec: number;
  peakAccelG: number;
};

export type MealPayload = {
  before?: PhotoFeatures | null;
  after?: PhotoFeatures | null;
  audio?: AudioFeatures | null;
  bowel?: BowelFeatures | null;
  motion?: MotionFeatures | null;
};
