import type { InstrumentId } from "./instruments";

export type ClipColor = "ember" | "clay" | "gold" | "sage";
export type TrackKind = "drums" | "bass" | "keys" | "lead" | "sample";
export type Wave = "sine" | "triangle" | "sawtooth" | "square";
export type Follow = "session" | "arrange";
export type StudioView = "session" | "arrange" | "mix" | "play";

export interface Note {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface Clip {
  id: string;
  name: string;
  color: ClipColor;
  length: number;
  notes: Note[];
}

export interface ArrangeClip {
  id: string;
  name: string;
  color: ClipColor;
  start: number;
  length: number;
  patternLength: number;
  offset?: number;
  notes: Note[];
  /** Audio regions: immutable source ID. Legacy regions use their track ID. */
  assetId?: string;
  /** Audio clip gain in dB. */
  gain?: number;
  /** Re-pitch in semitones / cents; like a sampler, this also changes speed. */
  transpose?: number;
  detune?: number;
  reverse?: boolean;
  /** Source window in seconds. Undefined falls back to the track's sample trim. */
  sampleStart?: number;
  sampleEnd?: number;
  loop?: boolean;
  /** Re-Pitch warp: playback rate follows project BPM / sourceBpm. */
  warp?: boolean;
  sourceBpm?: number;
  /** Fades in seconds at the region's arrangement boundaries. */
  fadeIn?: number;
  fadeOut?: number;
}

export interface Device {
  waveform: Wave;
  attack: number;
  decay: number;
  cutoff: number;
  resonance: number;
  drive: number;
  delayMix: number;
  delayDivision: number;
  reverb: number;
  sampleOffset: number;
  sampleEnd: number;
  sampleLoop: boolean;
  /** Instrument voice; absent means the original analog synth / electronic kit. */
  instrument?: InstrumentId;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: ClipColor;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  clips: (Clip | null)[];
  arrangement: ArrangeClip[];
  device: Device;
}

export interface Scene {
  id: string;
  name: string;
}

export interface Project {
  name: string;
  bpm: number;
  swing: number;
  bars: number;
  master: number;
  scenes: Scene[];
  tracks: Track[];
}

export interface LaunchState {
  clipIndex: number;
  launchBeat: number;
  previous?: { clipIndex: number; launchBeat: number };
}

export interface Pattern {
  id: string;
  name: string;
  kind: TrackKind;
  length: number;
  color: ClipColor;
  notes: Note[];
}
