/**
 * The user's data, used two ways:
 * - personal: a full export they own (portability), and a clinician report.
 * - research: an opt-in, de-identified dataset a clinic or drug maker could pool into
 *   real-world evidence (e.g. side effects by day after injection, protein at each dose).
 */
import type { Injection } from "./medication";
import type { DailyLog, Profile } from "./profile";

export type AnonymousRecord = {
  schema: "glpfit.rwd.v1";
  participant: string;
  drug: string | null;
  goal: Profile["goal"] | null;
  /** Days since the first logged injection; no calendar dates leave the device. */
  shots: { day: number; doseMg: number }[];
  days: {
    day: number;
    cycleDay: number | null;
    weightChangePct: number | null;
    waterCups: number | null;
    proteinG: number | null;
    symptoms: string[];
  }[];
};

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Random, unlinkable id per export. */
function participantId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * No name, no free text, no dates, no absolute weight: only relative days, dose,
 * percent weight change, counts and symptom codes.
 */
export function deidentify(
  profile: Profile | null,
  logs: DailyLog[],
  shots: Injection[],
  id = participantId(),
): AnonymousRecord {
  const sortedShots = [...shots].sort((a, b) => a.date.localeCompare(b.date));
  const allDates = [
    ...sortedShots.map((s) => s.date),
    ...logs.map((l) => l.date),
  ].sort();
  const origin = allDates.length ? dayNumber(allDates[0]) : 0;
  const shotDays = sortedShots.map((s) => dayNumber(s.date));
  const firstWeight =
    profile?.startWeightKg ??
    [...logs]
      .sort((a, b) => a.date.localeCompare(b.date))
      .find((l) => l.weightKg !== null)?.weightKg ??
    null;
  return {
    schema: "glpfit.rwd.v1",
    participant: id,
    drug: sortedShots.at(-1)?.drug ?? profile?.drug ?? null,
    goal: profile?.goal ?? null,
    shots: sortedShots.map((s) => ({
      day: dayNumber(s.date) - origin,
      doseMg: s.doseMg,
    })),
    days: [...logs]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((log) => {
        const n = dayNumber(log.date);
        const prior = shotDays.filter((d) => d <= n);
        const since = prior.length ? n - prior[prior.length - 1] : null;
        return {
          day: n - origin,
          cycleDay: since !== null && since < 8 ? since + 1 : null,
          weightChangePct:
            log.weightKg !== null && firstWeight
              ? Math.round(
                  ((log.weightKg - firstWeight) / firstWeight) * 1000,
                ) / 10
              : null,
          waterCups: log.waterCups,
          proteinG: log.proteinG ?? null,
          symptoms: [...log.symptoms],
        };
      }),
  };
}

export function personalExport(data: {
  profile: Profile | null;
  logs: DailyLog[];
  shots: Injection[];
  memories: string[];
}) {
  return {
    schema: "glpfit.personal.v1",
    exportedAt: new Date().toISOString(),
    ...data,
  };
}

export function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
