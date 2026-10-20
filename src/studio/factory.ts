import type { ArrangeClip, Clip, ClipColor, Device, Note, Pattern, Project, Track, TrackKind } from "./types";

function n(id: string, pitch: number, start: number, duration: number, velocity = 0.9): Note {
  return { id, pitch, start, duration, velocity };
}

function chord(id: string, pitches: number[], start: number, duration: number, velocity: number): Note[] {
  return pitches.map((pitch, i) => n(`${id}-${i}`, pitch, start, duration, velocity));
}

function hats(id: string, opens: number[]): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < 8; i++) {
    const start = i * 0.5;
    const open = opens.some((o) => Math.abs(o - start) < 0.01);
    notes.push(
      open
        ? n(`${id}-o${i}`, 46, start, 0.22, 0.72)
        : n(`${id}-h${i}`, 42, start, 0.08, 0.55),
    );
  }
  for (let i = 1; i < 16; i += 2) {
    const start = i * 0.25;
    notes.push(n(`${id}-g${i}`, 42, start, 0.05, 0.26));
  }
  return notes;
}

const introDrums: Note[] = [
  ...[0, 1, 2, 3].map((start, i) => n(`intro-k${i}`, 36, start, 0.2, 0.92)),
  ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((start, i) => n(`intro-h${i}`, 42, start, 0.06, 0.38)),
];

const grooveDrums: Note[] = [
  ...[0, 1, 2, 3].map((start, i) => n(`gr-k${i}`, 36, start, 0.2, 1)),
  ...[1, 3].map((start, i) => n(`gr-c${i}`, 39, start, 0.16, 0.86)),
  ...[1, 3].map((start, i) => n(`gr-s${i}`, 38, start, 0.12, 0.32)),
  ...hats("gr", [1.5, 3.5]),
];

const liftDrums: Note[] = [
  n("lf-k0", 36, 0, 0.2, 1),
  n("lf-k1", 36, 0.75, 0.12, 0.62),
  n("lf-k2", 36, 1.5, 0.16, 0.9),
  n("lf-k3", 36, 2, 0.2, 1),
  n("lf-k4", 36, 2.75, 0.12, 0.6),
  n("lf-k5", 36, 3.5, 0.14, 0.84),
  n("lf-c0", 39, 1, 0.16, 0.88),
  n("lf-c1", 39, 3, 0.16, 0.88),
  n("lf-r", 37, 3.75, 0.08, 0.55),
  ...hats("lf", [1.5, 3.5]),
];

const breakDrums: Note[] = [
  n("br-r0", 37, 1, 0.1, 0.7),
  n("br-r1", 37, 3, 0.1, 0.7),
  n("br-o", 46, 3.5, 0.24, 0.5),
  ...Array.from({ length: 16 }, (_, i) => n(`br-h${i}`, 42, i * 0.25, 0.05, i % 4 === 0 ? 0.42 : 0.24)),
];

const nightBass: Note[] = [
  n("bb0", 33, 0, 0.46, 0.96),
  n("bb1", 33, 0.75, 0.18, 0.55),
  n("bb2", 36, 1.5, 0.4, 0.9),
  n("bb3", 33, 2, 0.42, 0.96),
  n("bb4", 31, 2.75, 0.2, 0.7),
  n("bb5", 34, 3.25, 0.22, 0.76),
  n("bb6", 36, 3.5, 0.28, 0.82),
];

const riseBass: Note[] = [
  n("brb0", 33, 0, 0.4, 0.96),
  n("brb1", 36, 0.5, 0.2, 0.72),
  n("brb2", 40, 1, 0.36, 0.9),
  n("brb3", 43, 1.5, 0.2, 0.74),
  n("brb4", 33, 2, 0.36, 0.96),
  n("brb5", 38, 2.5, 0.24, 0.8),
  n("brb6", 40, 3, 0.3, 0.86),
  n("brb7", 31, 3.5, 0.3, 0.8),
];

const stabKeys = [
  ...chord("st0", [57, 60, 64], 0.5, 0.3, 0.64),
  ...chord("st1", [57, 60, 64], 2.5, 0.3, 0.64),
];

const liftKeys = [
  ...chord("lk0", [57, 60, 64, 67], 0, 1.45, 0.56),
  ...chord("lk1", [53, 57, 60, 64], 2, 1.45, 0.56),
];

const padKeys = chord("pad", [57, 60, 64, 67], 0, 3.7, 0.44);

const hookLead: Note[] = [
  n("ld0", 76, 0, 0.4, 0.82),
  n("ld1", 74, 0.5, 0.22, 0.68),
  n("ld2", 72, 1, 0.42, 0.82),
  n("ld3", 74, 1.5, 0.22, 0.64),
  n("ld4", 69, 2, 0.72, 0.86),
  n("ld5", 72, 3, 0.22, 0.7),
  n("ld6", 76, 3.5, 0.42, 0.82),
];

export const PATTERNS: Pattern[] = [
  { id: "drums-intro", name: "Soft hats", kind: "drums", length: 4, color: "ember", notes: introDrums },
  { id: "drums-groove", name: "Four on the floor", kind: "drums", length: 4, color: "ember", notes: grooveDrums },
  { id: "drums-lift", name: "Push", kind: "drums", length: 4, color: "ember", notes: liftDrums },
  { id: "drums-break", name: "Air hats", kind: "drums", length: 4, color: "ember", notes: breakDrums },
  { id: "bass-night", name: "Night bass", kind: "bass", length: 4, color: "clay", notes: nightBass },
  { id: "bass-rise", name: "Rise bass", kind: "bass", length: 4, color: "clay", notes: riseBass },
  { id: "keys-stab", name: "Offbeat stab", kind: "keys", length: 4, color: "gold", notes: stabKeys },
  { id: "keys-lift", name: "Lift chords", kind: "keys", length: 4, color: "gold", notes: liftKeys },
  { id: "keys-pad", name: "Held pad", kind: "keys", length: 4, color: "gold", notes: padKeys },
  { id: "lead-hook", name: "Hook", kind: "lead", length: 4, color: "sage", notes: hookLead },
];

/** The original analog-synth voice for a track kind (used when switching back to it). */
export function analogVoice(kind: TrackKind): Pick<Device, "waveform" | "attack" | "decay" | "cutoff" | "resonance"> {
  if (kind === "keys") return { waveform: "triangle", attack: 0.012, decay: 0.5, cutoff: 2200, resonance: 1.1 };
  const { waveform, attack, decay, cutoff, resonance } = defaultDevice(kind);
  return { waveform, attack, decay, cutoff, resonance };
}

export function defaultDevice(kind: TrackKind): Device {
  const base: Device = {
    waveform: "sawtooth",
    attack: 0.01,
    decay: 0.3,
    cutoff: 2400,
    resonance: 1,
    drive: 0.08,
    delayMix: 0.1,
    delayDivision: 0.375,
    reverb: 0.12,
    sampleOffset: 0,
    sampleEnd: 0,
    sampleLoop: true,
  };
  if (kind === "drums") {
    return { ...base, waveform: "sine", cutoff: 11000, resonance: 0.7, drive: 0.18, delayMix: 0, reverb: 0.05 };
  }
  if (kind === "bass") {
    return { ...base, waveform: "sawtooth", attack: 0.005, decay: 0.22, cutoff: 420, resonance: 6, drive: 0.22, delayMix: 0.04, reverb: 0.04 };
  }
  if (kind === "keys") {
    // New keys tracks start as a grand piano; the analog keys sound remains one click away.
    return { ...base, waveform: "triangle", attack: 0.003, decay: 0.28, cutoff: 9000, resonance: 0.7, drive: 0.02, delayMix: 0.06, reverb: 0.22, instrument: "grand-piano" };
  }
  if (kind === "lead") {
    return { ...base, waveform: "square", attack: 0.008, decay: 0.28, cutoff: 1700, resonance: 2.2, drive: 0.1, delayMix: 0.22, delayDivision: 0.5, reverb: 0.18 };
  }
  return { ...base, waveform: "sine", cutoff: 14000, drive: 0.04, delayMix: 0.08, reverb: 0.14 };
}

function clip(id: string, name: string, color: ClipColor, notes: Note[]): Clip {
  return { id, name, color, length: 4, notes };
}

function placed(
  id: string,
  name: string,
  color: ClipColor,
  start: number,
  bars: number,
  notes: Note[],
): ArrangeClip {
  return {
    id,
    name,
    color,
    start,
    length: bars * 4,
    patternLength: 4,
    notes: notes.map((note, i) => ({ ...note, id: `${id}-n${i}` })),
  };
}

function emptyClips(): null[] {
  return [null, null, null, null, null, null, null, null];
}

export function createDemoProject(): Project {
  const drums: Track = {
    id: "trk-drums",
    name: "Drums",
    kind: "drums",
    color: "ember",
    volume: 0.84,
    pan: 0,
    mute: false,
    solo: false,
    device: defaultDevice("drums"),
    clips: [
      clip("c-d0", "Soft hats", "ember", introDrums),
      clip("c-d1", "Floor", "ember", grooveDrums),
      clip("c-d2", "Push", "ember", liftDrums),
      clip("c-d3", "Air", "ember", breakDrums),
      null,
      null,
      null,
      null,
    ],
    arrangement: [
      placed("a-d0", "Soft hats", "ember", 0, 4, introDrums),
      placed("a-d1", "Floor", "ember", 16, 6, grooveDrums),
      placed("a-d2", "Push", "ember", 40, 4, liftDrums),
      placed("a-d3", "Air", "ember", 56, 2, breakDrums),
    ],
  };

  const bass: Track = {
    id: "trk-bass",
    name: "Bass",
    kind: "bass",
    color: "clay",
    volume: 0.78,
    pan: 0,
    mute: false,
    solo: false,
    device: defaultDevice("bass"),
    clips: [
      null,
      clip("c-b1", "Night bass", "clay", nightBass),
      clip("c-b2", "Rise", "clay", riseBass),
      null,
      null,
      null,
      null,
      null,
    ],
    arrangement: [
      placed("a-b1", "Night bass", "clay", 16, 6, nightBass),
      placed("a-b2", "Rise", "clay", 40, 4, riseBass),
    ],
  };

  const keys: Track = {
    id: "trk-keys",
    name: "Keys",
    kind: "keys",
    color: "gold",
    volume: 0.58,
    pan: -0.12,
    mute: false,
    solo: false,
    device: defaultDevice("keys"),
    clips: [
      null,
      clip("c-k1", "Stab", "gold", stabKeys),
      clip("c-k2", "Chords", "gold", liftKeys),
      clip("c-k3", "Pad", "gold", padKeys),
      null,
      null,
      null,
      null,
    ],
    arrangement: [
      placed("a-k1", "Stab", "gold", 16, 6, stabKeys),
      placed("a-k2", "Chords", "gold", 40, 4, liftKeys),
      placed("a-k3", "Pad", "gold", 56, 2, padKeys),
    ],
  };

  const lead: Track = {
    id: "trk-lead",
    name: "Lead",
    kind: "lead",
    color: "sage",
    volume: 0.5,
    pan: 0.16,
    mute: false,
    solo: false,
    device: defaultDevice("lead"),
    clips: [null, null, clip("c-l2", "Hook", "sage", hookLead), null, null, null, null, null],
    arrangement: [placed("a-l2", "Hook", "sage", 40, 4, hookLead)],
  };

  return {
    name: "Night Drive",
    bpm: 124,
    swing: 0.16,
    bars: 16,
    master: 0.86,
    scenes: [
      { id: "s0", name: "Intro" },
      { id: "s1", name: "Groove" },
      { id: "s2", name: "Lift" },
      { id: "s3", name: "Break" },
      { id: "s4", name: "Scene 5" },
      { id: "s5", name: "Scene 6" },
      { id: "s6", name: "Scene 7" },
      { id: "s7", name: "Scene 8" },
    ],
    tracks: [drums, bass, keys, lead],
  };
}

export function createEmptyProject(): Project {
  const kinds: TrackKind[] = ["drums", "bass", "keys"];
  const names = ["Drums", "Bass", "Keys"];
  const colors: ClipColor[] = ["ember", "clay", "gold"];
  const volumes = [0.84, 0.78, 0.6];
  return {
    name: "Untitled",
    bpm: 120,
    swing: 0,
    bars: 16,
    master: 0.86,
    scenes: [
      { id: "s0", name: "Scene 1" },
      { id: "s1", name: "Scene 2" },
      { id: "s2", name: "Scene 3" },
      { id: "s3", name: "Scene 4" },
      { id: "s4", name: "Scene 5" },
      { id: "s5", name: "Scene 6" },
      { id: "s6", name: "Scene 7" },
      { id: "s7", name: "Scene 8" },
    ],
    tracks: kinds.map((kind, i) => ({
      id: `trk-${kind}`,
      name: names[i] ?? kind,
      kind,
      color: colors[i] ?? "ember",
      volume: volumes[i] ?? 0.7,
      pan: 0,
      mute: false,
      solo: false,
      clips: emptyClips(),
      arrangement: [],
      device: defaultDevice(kind),
    })),
  };
}

export const CLIP_COLORS: ClipColor[] = ["ember", "clay", "gold", "sage"];
