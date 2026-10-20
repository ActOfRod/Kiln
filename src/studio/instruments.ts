import type { Device, TrackKind } from "./types";
import { clamp, midiToFreq } from "./theory.ts";

export type InstrumentId =
  | "analog"
  | "grand-piano"
  | "electric-piano"
  | "organ"
  | "strings"
  | "warm-pad"
  | "pluck"
  | "bell"
  | "electric-bass"
  | "sub-bass"
  | "drum-machine"
  | "acoustic-kit"
  | "808-kit";

export const INSTRUMENT_IDS = [
  "analog",
  "grand-piano",
  "electric-piano",
  "organ",
  "strings",
  "warm-pad",
  "pluck",
  "bell",
  "electric-bass",
  "sub-bass",
  "drum-machine",
  "acoustic-kit",
  "808-kit",
] as const satisfies readonly InstrumentId[];

/** How the voice is produced. */
export type InstrumentEngine = "analog" | "rendered" | "sustained" | "drums";

export interface InstrumentDef {
  id: InstrumentId;
  name: string;
  family: "Keys" | "Strings & pads" | "Plucked & mallets" | "Bass" | "Synth" | "Drums";
  description: string;
  engine: InstrumentEngine;
  /** Track kinds the instrument is listed first for. */
  suits: TrackKind[];
  /** Device settings applied when switching to this instrument. */
  preset: Partial<Device>;
  /** Relative output level, matched by ear against the analog synth. */
  level: number;
}

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: "grand-piano",
    name: "Grand Piano",
    family: "Keys",
    description: "Acoustic piano: hammered strings, natural decay, velocity brightness.",
    engine: "rendered",
    suits: ["keys"],
    preset: { cutoff: 9000, decay: 0.28, attack: 0.003, resonance: 0.7 },
    level: 0.58,
  },
  {
    id: "electric-piano",
    name: "Electric Piano",
    family: "Keys",
    description: "Warm tine piano that turns bell-like when played hard.",
    engine: "rendered",
    suits: ["keys"],
    preset: { cutoff: 7000, decay: 0.3, attack: 0.003, resonance: 0.7 },
    level: 0.27,
  },
  {
    id: "organ",
    name: "Organ",
    family: "Keys",
    description: "Drawbar organ with key click and a gentle rotary shimmer.",
    engine: "sustained",
    suits: ["keys"],
    preset: { cutoff: 9000, decay: 0.06, attack: 0.004, resonance: 0.7 },
    level: 0.2,
  },
  {
    id: "strings",
    name: "String Ensemble",
    family: "Strings & pads",
    description: "Bowed section with slow swell and vibrato.",
    engine: "sustained",
    suits: ["keys", "lead"],
    preset: { cutoff: 4200, decay: 0.6, attack: 0.22, resonance: 0.7 },
    level: 0.22,
  },
  {
    id: "warm-pad",
    name: "Warm Pad",
    family: "Strings & pads",
    description: "Soft, wide pad for chords and atmosphere.",
    engine: "sustained",
    suits: ["keys"],
    preset: { cutoff: 1800, decay: 1.4, attack: 0.6, resonance: 0.8 },
    level: 0.16,
  },
  {
    id: "pluck",
    name: "Nylon Pluck",
    family: "Plucked & mallets",
    description: "Plucked string, guitar-like attack and ring.",
    engine: "rendered",
    suits: ["lead", "keys"],
    preset: { cutoff: 7000, decay: 0.45, attack: 0.003, resonance: 0.7 },
    level: 0.5,
  },
  {
    id: "bell",
    name: "Bell",
    family: "Plucked & mallets",
    description: "Glassy FM bell with a long shimmer.",
    engine: "rendered",
    suits: ["lead"],
    preset: { cutoff: 11000, decay: 1.6, attack: 0.003, resonance: 0.7 },
    level: 0.17,
  },
  {
    id: "electric-bass",
    name: "Electric Bass",
    family: "Bass",
    description: "Fingered bass guitar with a round, punchy note.",
    engine: "rendered",
    suits: ["bass"],
    preset: { cutoff: 2600, decay: 0.12, attack: 0.003, resonance: 0.7 },
    level: 0.88,
  },
  {
    id: "sub-bass",
    name: "Sub Bass",
    family: "Bass",
    description: "Clean, deep sine bass for modern low end.",
    engine: "sustained",
    suits: ["bass"],
    preset: { cutoff: 1200, decay: 0.08, attack: 0.006, resonance: 0.7 },
    level: 0.5,
  },
  {
    id: "analog",
    name: "Analog Synth",
    family: "Synth",
    description: "The original KILN synth: waveform, filter and envelope controls.",
    engine: "analog",
    suits: ["bass", "keys", "lead"],
    preset: {},
    level: 1,
  },
  {
    id: "drum-machine",
    name: "Electronic Kit",
    family: "Drums",
    description: "The original KILN drum machine: tight and punchy.",
    engine: "drums",
    suits: ["drums"],
    preset: {},
    level: 1,
  },
  {
    id: "acoustic-kit",
    name: "Acoustic Kit",
    family: "Drums",
    description: "Wooden kick, snappy snare and metallic cymbals.",
    engine: "drums",
    suits: ["drums"],
    preset: {},
    level: 1,
  },
  {
    id: "808-kit",
    name: "808 Kit",
    family: "Drums",
    description: "Booming kick, crisp snare and classic metallic hats.",
    engine: "drums",
    suits: ["drums"],
    preset: {},
    level: 1,
  },
];

const byId = new Map(INSTRUMENTS.map((item) => [item.id, item]));

export function instrumentOf(kind: TrackKind, device: Pick<Device, "instrument">): InstrumentDef {
  const fallback = kind === "drums" ? "drum-machine" : "analog";
  const found = byId.get(device.instrument ?? fallback);
  // A drum kit on a tonal track (or the reverse) is never valid; use the default.
  if (!found || (found.engine === "drums") !== (kind === "drums")) return byId.get(fallback)!;
  return found;
}

/** Instruments offered for a track, the best-suited first. */
export function instrumentsFor(kind: TrackKind): InstrumentDef[] {
  if (kind === "sample") return [];
  const list = INSTRUMENTS.filter((item) => (item.engine === "drums") === (kind === "drums"));
  return [
    ...list.filter((i) => i.suits.includes(kind)),
    ...list.filter((i) => !i.suits.includes(kind)),
  ];
}

// ---------------------------------------------------------------------------
// Rendered (pre-computed) notes. Pure functions so they can be unit tested.

function epDecay(pitch: number): number {
  return 1.6 * 2 ** (-(pitch - 48) / 26);
}

/** Natural length of a rendered note in seconds. */
export function renderedLength(id: InstrumentId, pitch: number): number {
  const p = clamp(pitch, 12, 120);
  switch (id) {
    case "grand-piano":
      return clamp(7 * 2 ** (-(p - 33) / 20), 1.2, 7);
    case "electric-piano":
      return clamp(epDecay(p) * 4.5, 1, 6);
    case "bell":
      return clamp(5 * 2 ** (-(p - 60) / 30), 1.5, 5);
    case "pluck":
      return clamp(3.5 * 2 ** (-(p - 40) / 24), 0.8, 3.5);
    case "electric-bass":
      return 2.6;
    default:
      return 1;
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(data: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i]! /= peak;
  // 3 ms fade-in removes clicks. A long, smooth fade over the last 30% of the
  // buffer (at most ~1.5 s) lets long notes die away instead of stopping.
  const fadeIn = Math.min(data.length, 132);
  for (let i = 0; i < fadeIn; i++) data[i]! *= i / fadeIn;
  const fadeOut = Math.min(Math.floor(data.length * 0.3), 66150);
  for (let i = 0; i < fadeOut; i++)
    data[data.length - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  return data;
}

/** Hammered strings: inharmonic partials, unison detune, two-stage decay, hammer thump. */
function renderPiano(pitch: number, sr: number): Float32Array {
  const f = midiToFreq(pitch);
  const out = new Float32Array(Math.ceil(renderedLength("grand-piano", pitch) * sr));
  const strings = pitch < 32 ? 1 : pitch < 46 ? 2 : 3;
  const B = 0.00012 * 2 ** ((pitch - 60) / 16);
  const fundamentalDecay = 5.5 * 2 ** (-(pitch - 36) / 17);
  const strike = 1 / 7.3;
  const maxPartials = Math.max(1, Math.min(18, Math.floor(Math.min(sr * 0.45, 9000) / f)));
  for (let n = 1; n <= maxPartials; n++) {
    const fn = n * f * Math.sqrt(1 + B * n * n);
    if (fn >= sr * 0.45) break;
    const amp = (Math.abs(Math.sin(Math.PI * n * strike)) + 0.08) / n ** 0.85;
    const slow = fundamentalDecay / (1 + fn / 900);
    const fast = slow / 7;
    const d1 = Math.exp(-1 / (fast * sr));
    const d2 = Math.exp(-1 / (slow * sr));
    for (let s = 0; s < strings; s++) {
      const cents = strings === 1 ? 0 : (s - (strings - 1) / 2) * (pitch < 60 ? 1.1 : 0.7);
      const w = (2 * Math.PI * fn * 2 ** (cents / 1200)) / sr;
      const c = Math.cos(w);
      const sn = Math.sin(w);
      let x = Math.sin(s * 1.3 + n);
      let y = Math.cos(s * 1.3 + n);
      let e1 = 0.55 * (amp / strings);
      let e2 = 0.45 * (amp / strings);
      for (let i = 0; i < out.length; i++) {
        out[i]! += x * (e1 + e2);
        const nx = x * c + y * sn;
        y = y * c - x * sn;
        x = nx;
        e1 *= d1;
        e2 *= d2;
        if (e1 + e2 < 1e-5) break;
      }
    }
  }
  // Felt hammer thump: short low-passed noise burst.
  const rand = mulberry(pitch * 7919);
  const thump = Math.floor(sr * 0.03);
  let lp = 0;
  const k = 1 - Math.exp((-2 * Math.PI * Math.min(4000, f * 6)) / sr);
  for (let i = 0; i < thump && i < out.length; i++) {
    lp += k * (rand() * 2 - 1 - lp);
    out[i]! += lp * 0.25 * Math.exp(-i / (sr * 0.006));
  }
  return normalize(out);
}

/** Tine electric piano: FM with a decaying index plus a short metallic tine. */
function renderElectricPiano(pitch: number, sr: number): Float32Array {
  const f = midiToFreq(pitch);
  const out = new Float32Array(Math.ceil(renderedLength("electric-piano", pitch) * sr));
  const decay = epDecay(pitch);
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const index = 2.4 * Math.exp(-t / 0.18) + 0.35;
    const body = Math.sin(twoPi * f * t + index * Math.sin(twoPi * f * t)) * Math.exp(-t / decay);
    const tine = Math.sin(twoPi * f * 14.1 * t) * 0.18 * Math.exp(-t / 0.025);
    out[i] = body + (f * 14.1 < sr * 0.45 ? tine : 0);
  }
  return normalize(out);
}

/** Bell: inharmonic FM (ratio 3.5) with a long, shimmering decay. */
function renderBell(pitch: number, sr: number): Float32Array {
  const f = midiToFreq(pitch);
  const out = new Float32Array(Math.ceil(renderedLength("bell", pitch) * sr));
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const index = 3.2 * Math.exp(-t / 0.9) + 0.4;
    const main = Math.sin(twoPi * f * t + index * Math.sin(twoPi * f * 3.5 * t));
    const hum = 0.25 * Math.sin(twoPi * f * 0.5 * t) * Math.exp(-t / 2.5);
    out[i] = main * Math.exp(-t / 1.6) + hum;
  }
  return normalize(out);
}

/**
 * Karplus–Strong plucked string with a fractional (linearly interpolated)
 * delay so high notes stay in tune.
 */
function renderString(pitch: number, sr: number, bass: boolean): Float32Array {
  const id: InstrumentId = bass ? "electric-bass" : "pluck";
  const f = midiToFreq(pitch);
  const out = new Float32Array(Math.ceil(renderedLength(id, pitch) * sr));
  const period = sr / f;
  // The two-point average adds half a sample of delay.
  const delay = period - 0.5;
  const t60 = bass ? 2.2 : clamp(2.6 * 2 ** (-(pitch - 45) / 24), 0.6, 2.8);
  const loss = 0.001 ** (1 / (t60 * f));
  const rand = mulberry(pitch * 104729 + (bass ? 1 : 0));
  const burst = Math.ceil(period);
  let lp = 0;
  const pick = bass ? 0.25 : 0.6;
  for (let i = 0; i < burst && i < out.length; i++) {
    lp += pick * (rand() * 2 - 1 - lp);
    out[i] = lp;
  }
  for (let i = burst; i < out.length; i++) {
    const pos = i - delay;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = (out[j] ?? 0) * (1 - frac) + (out[j + 1] ?? 0) * frac;
    const b = (out[j - 1] ?? 0) * (1 - frac) + (out[j] ?? 0) * frac;
    out[i] = loss * (bass ? 0.5 * (a + b) : 0.55 * a + 0.45 * b);
  }
  if (bass) {
    // Round off the top so it sounds fingered rather than picked.
    let y = 0;
    const k = 1 - Math.exp((-2 * Math.PI * Math.min(2200, f * 10)) / sr);
    for (let i = 0; i < out.length; i++) {
      y += k * (out[i]! - y);
      out[i] = y;
    }
  }
  return normalize(out);
}

export function renderNote(id: InstrumentId, pitch: number, sampleRate: number): Float32Array {
  const p = clamp(Math.round(pitch), 12, 120);
  switch (id) {
    case "grand-piano":
      return renderPiano(p, sampleRate);
    case "electric-piano":
      return renderElectricPiano(p, sampleRate);
    case "bell":
      return renderBell(p, sampleRate);
    case "pluck":
      return renderString(p, sampleRate, false);
    case "electric-bass":
      return renderString(p, sampleRate, true);
    default:
      throw new Error(`${id} is not a rendered instrument.`);
  }
}

const noteCache = new Map<string, AudioBuffer>();
const MAX_CACHED = 160;

/** Rendered note as an AudioBuffer (usable in any context), cached per sample rate. */
export function noteBuffer(id: InstrumentId, pitch: number, sampleRate: number): AudioBuffer {
  const key = `${id}:${Math.round(pitch)}:${sampleRate}`;
  const cached = noteCache.get(key);
  if (cached) {
    noteCache.delete(key);
    noteCache.set(key, cached);
    return cached;
  }
  const data = renderNote(id, pitch, sampleRate);
  const buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
  buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  noteCache.set(key, buffer);
  if (noteCache.size > MAX_CACHED) noteCache.delete(noteCache.keys().next().value!);
  return buffer;
}

const warmQueue: Array<[InstrumentId, number, number]> = [];
const queued = new Set<string>();
let warming = false;

/** Render notes ahead of time in idle slices so the first hit never stutters. */
export function warmNotes(entries: Array<[InstrumentId, number]>, sampleRate: number) {
  if (typeof window === "undefined") return;
  for (const [id, pitch] of entries) {
    if (byId.get(id)?.engine !== "rendered") continue;
    const key = `${id}:${Math.round(pitch)}:${sampleRate}`;
    if (noteCache.has(key) || queued.has(key)) continue;
    queued.add(key);
    warmQueue.push([id, pitch, sampleRate]);
  }
  if (warming || !warmQueue.length) return;
  warming = true;
  const idle =
    window.requestIdleCallback ??
    ((cb: IdleRequestCallback) =>
      window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 30));
  const step: IdleRequestCallback = (deadline) => {
    while (warmQueue.length && deadline.timeRemaining() > 4) {
      const [id, pitch, rate] = warmQueue.shift()!;
      queued.delete(`${id}:${Math.round(pitch)}:${rate}`);
      noteBuffer(id, pitch, rate);
    }
    if (warmQueue.length) idle(step);
    else warming = false;
  };
  idle(step);
}
