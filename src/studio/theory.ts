export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function quantize(beat: number, grid = 0.25): number {
  return Math.round(beat / grid) * grid;
}

export function formatPosition(beat: number): string {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / 4) + 1;
  const beatInBar = Math.floor(b % 4) + 1;
  const six = Math.floor((b % 1) * 4) + 1;
  return `${bar}.${beatInBar}.${six}`;
}

/** Next bar boundary. If stopped, stay on the current beat. */
export function nextBar(beat: number, playing: boolean): number {
  if (!playing) return Math.max(0, beat);
  const mod = ((beat % 4) + 4) % 4;
  if (mod < 0.03) return beat - mod;
  return beat + (4 - mod);
}

export const DRUMS = [
  { pitch: 36, name: "Kick", short: "KCK" },
  { pitch: 38, name: "Snare", short: "SNR" },
  { pitch: 39, name: "Clap", short: "CLP" },
  { pitch: 42, name: "Hat", short: "HAT" },
  { pitch: 46, name: "Open", short: "OPN" },
  { pitch: 37, name: "Rim", short: "RIM" },
  { pitch: 45, name: "Tom", short: "TOM" },
  { pitch: 49, name: "Ride", short: "RDE" },
] as const;

export function noteName(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const oct = Math.floor(pitch / 12) - 1;
  return `${names[((pitch % 12) + 12) % 12]}${oct}`;
}

export function uid(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 5)}`;
}
