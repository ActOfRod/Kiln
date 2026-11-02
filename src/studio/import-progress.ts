export interface ImportSnapshot {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  name: string;
  startedAt: number;
  now: number;
  /** Previous smoothed estimate, so the displayed time does not jump every file. */
  previousEta?: number | null;
}

export interface ImportMeter {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  name: string;
  /** 0–100, for labels and the progressbar value. */
  percent: number;
  /** 0–1, for the bar width. */
  ratio: number;
  etaMs: number | null;
}

/** Progress for a library import. Time is estimated from bytes already saved. */
export function importMeter(input: ImportSnapshot): ImportMeter {
  const byBytes = input.bytesTotal > 0;
  const doneBasis = byBytes ? input.bytesDone : input.done;
  const totalBasis = byBytes ? input.bytesTotal : input.total;
  const ratio = totalBasis > 0 ? Math.min(1, Math.max(0, doneBasis / totalBasis)) : 0;
  const elapsed = input.now - input.startedAt;
  let raw: number | null = null;
  if (totalBasis > 0 && doneBasis >= totalBasis) raw = 0;
  else if (doneBasis > 0 && elapsed >= 500 && totalBasis > doneBasis)
    raw = ((totalBasis - doneBasis) / doneBasis) * elapsed;
  return {
    done: input.done,
    total: input.total,
    bytesDone: input.bytesDone,
    bytesTotal: input.bytesTotal,
    name: input.name,
    percent: Math.round(ratio * 100),
    ratio,
    etaMs: smoothEta(input.previousEta ?? null, raw),
  };
}

function smoothEta(previous: number | null, raw: number | null): number | null {
  if (raw == null) return null;
  if (previous == null || raw === 0) return raw;
  return previous * 0.65 + raw * 0.35;
}

/** Phrase for the remaining time. `null` means the pace is not known yet. */
export function formatImportEta(ms: number | null): string {
  if (ms == null) return "Estimating time left";
  if (ms < 10_000) return "A few seconds left";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    const rounded = Math.max(10, Math.round(seconds / 5) * 5);
    if (rounded >= 60) return "About 1 minute left";
    return `About ${rounded} seconds left`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  const hourLabel = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (rem === 0) return `About ${hourLabel} left`;
  return `About ${hourLabel} ${rem} ${rem === 1 ? "minute" : "minutes"} left`;
}
