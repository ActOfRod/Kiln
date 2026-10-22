import type {
  ArrangeClip,
  Clip,
  ClipColor,
  Device,
  Note,
  Pattern,
  Project,
  Track,
  TrackKind,
} from "./types";

function n(id: string, pitch: number, start: number, duration: number, velocity = 0.9): Note {
  return { id, pitch, start, duration, velocity };
}

function chord(
  id: string,
  pitches: number[],
  start: number,
  duration: number,
  velocity: number,
): Note[] {
  return pitches.map((pitch, i) => n(`${id}-${i}`, pitch, start, duration, velocity));
}

function hats(id: string, opens: number[]): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < 8; i++) {
    const start = i * 0.5;
    const open = opens.some((o) => Math.abs(o - start) < 0.01);
    notes.push(
      open ? n(`${id}-o${i}`, 46, start, 0.22, 0.72) : n(`${id}-h${i}`, 42, start, 0.08, 0.55),
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
  ...Array.from({ length: 16 }, (_, i) =>
    n(`br-h${i}`, 42, i * 0.25, 0.05, i % 4 === 0 ? 0.42 : 0.24),
  ),
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
  {
    id: "drums-intro",
    name: "Soft hats",
    kind: "drums",
    length: 4,
    color: "ember",
    notes: introDrums,
  },
  {
    id: "drums-groove",
    name: "Four on the floor",
    kind: "drums",
    length: 4,
    color: "ember",
    notes: grooveDrums,
  },
  { id: "drums-lift", name: "Push", kind: "drums", length: 4, color: "ember", notes: liftDrums },
  {
    id: "drums-break",
    name: "Air hats",
    kind: "drums",
    length: 4,
    color: "ember",
    notes: breakDrums,
  },
  {
    id: "bass-night",
    name: "Night bass",
    kind: "bass",
    length: 4,
    color: "clay",
    notes: nightBass,
  },
  { id: "bass-rise", name: "Rise bass", kind: "bass", length: 4, color: "clay", notes: riseBass },
  {
    id: "keys-stab",
    name: "Offbeat stab",
    kind: "keys",
    length: 4,
    color: "gold",
    notes: stabKeys,
  },
  { id: "keys-lift", name: "Lift chords", kind: "keys", length: 4, color: "gold", notes: liftKeys },
  { id: "keys-pad", name: "Held pad", kind: "keys", length: 4, color: "gold", notes: padKeys },
  { id: "lead-hook", name: "Hook", kind: "lead", length: 4, color: "sage", notes: hookLead },
];

/** The original analog-synth voice for a track kind (used when switching back to it). */
export function analogVoice(
  kind: TrackKind,
): Pick<Device, "waveform" | "attack" | "decay" | "cutoff" | "resonance"> {
  if (kind === "keys")
    return { waveform: "triangle", attack: 0.012, decay: 0.5, cutoff: 2200, resonance: 1.1 };
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
    return {
      ...base,
      waveform: "sine",
      cutoff: 11000,
      resonance: 0.7,
      drive: 0.18,
      delayMix: 0,
      reverb: 0.05,
    };
  }
  if (kind === "bass") {
    return {
      ...base,
      waveform: "sawtooth",
      attack: 0.005,
      decay: 0.22,
      cutoff: 420,
      resonance: 6,
      drive: 0.22,
      delayMix: 0.04,
      reverb: 0.04,
    };
  }
  if (kind === "keys") {
    // New keys tracks start as a grand piano; the analog keys sound remains one click away.
    return {
      ...base,
      waveform: "triangle",
      attack: 0.003,
      decay: 0.28,
      cutoff: 9000,
      resonance: 0.7,
      drive: 0.02,
      delayMix: 0.06,
      reverb: 0.22,
      instrument: "grand-piano",
    };
  }
  if (kind === "lead") {
    return {
      ...base,
      waveform: "square",
      attack: 0.008,
      decay: 0.28,
      cutoff: 1700,
      resonance: 2.2,
      drive: 0.1,
      delayMix: 0.22,
      delayDivision: 0.5,
      reverb: 0.18,
    };
  }
  return { ...base, waveform: "sine", cutoff: 14000, drive: 0.04, delayMix: 0.08, reverb: 0.14 };
}

function emptyClips(): null[] {
  return [null, null, null, null, null, null, null, null];
}

// ---------------------------------------------------------------------------
// Demo song: "Ember Queen", an original dark cinematic piece in D minor, written in
// the spirit of epic trailer music such as Rok Nardin's "The Mad Queen": war drums,
// driving spiccato strings, choir pads, brass and a soaring string theme.

interface Phrase {
  name: string;
  length: number;
  notes: Note[];
}

/** Four-bar progression: Dm – B♭ – Gm – A (i – VI – iv – V). */
const ROOTS = [50, 46, 43, 45];
const THIRDS = [3, 4, 3, 4];
/** Choir voicings with a low root for each bar of the progression. */
const VOICINGS = [
  [50, 62, 65, 69],
  [46, 62, 65, 70],
  [43, 62, 67, 70],
  [45, 61, 64, 69],
];

function phrase(name: string, length: number, notes: Array<Omit<Note, "id">>): Phrase {
  return { name, length, notes: notes.map((note, i) => ({ ...note, id: `${name}-${i}` })) };
}

function hit(pitch: number, start: number, velocity: number, duration = 0.2) {
  return { pitch, start, duration, velocity };
}

/** One bar of the taiko groove; `fill` swaps the last two beats for a rising tom run. */
function taikoBar(bar: number, fill: boolean) {
  const at = bar * 4;
  const groove = [
    hit(36, at, 1),
    hit(45, at + 0.75, 0.62),
    hit(36, at + 1.5, 0.9),
    hit(45, at + 2, 0.82),
    hit(45, at + 2.5, 0.7),
    hit(36, at + 3, 0.95),
    hit(45, at + 3.5, 0.74),
    hit(45, at + 3.75, 0.66),
  ];
  if (!fill) return groove;
  return [
    ...groove.filter((note) => note.start < at + 2),
    ...Array.from({ length: 8 }, (_, i) => hit(45, at + 2 + i * 0.25, 0.55 + i * 0.06)),
  ];
}

function tomRoll(at: number) {
  return [
    hit(36, at, 0.9),
    ...Array.from({ length: 16 }, (_, i) => hit(45, at + i * 0.25, 0.32 + i * 0.045)),
  ];
}

const taikoIntro = phrase("taiko-intro", 4, [hit(36, 0, 0.9, 0.5), hit(45, 3.5, 0.42)]);
const taikoRise = phrase("taiko-rise", 16, [
  ...[0, 1, 2].flatMap((bar) => [
    hit(36, bar * 4, 0.95),
    hit(45, bar * 4 + 1.5, 0.66),
    hit(36, bar * 4 + 2, 0.82),
    hit(45, bar * 4 + 3, 0.72),
    hit(45, bar * 4 + 3.5, 0.58),
  ]),
  ...tomRoll(12),
]);
const taikoBattle = phrase("taiko-battle", 16, [
  ...[0, 1, 2].flatMap((bar) => taikoBar(bar, false)),
  ...taikoBar(3, true),
]);
const taikoBreak = phrase("taiko-break", 16, [
  hit(36, 0, 0.7, 0.5),
  hit(36, 8, 0.62, 0.5),
  hit(45, 7.5, 0.4),
  ...tomRoll(12),
]);
const taikoEnd = phrase("taiko-end", 8, [
  hit(36, 0, 1, 0.6),
  hit(45, 0, 1, 0.5),
  hit(36, 0.5, 0.7),
]);

const snareRise = phrase("snare-rise", 16, [
  ...[0, 1, 2].flatMap((bar) => [hit(37, bar * 4 + 1, 0.45, 0.1), hit(37, bar * 4 + 3, 0.5, 0.1)]),
  ...Array.from({ length: 16 }, (_, i) => hit(38, 12 + i * 0.25, 0.2 + i * 0.05, 0.1)),
]);
const snareBattle = phrase("snare-battle", 16, [
  hit(49, 0, 0.95, 1.5),
  ...[0, 1, 2, 3].flatMap((bar) => [
    hit(38, bar * 4 + 1, 0.92, 0.15),
    hit(38, bar * 4 + 3, 0.92, 0.15),
    hit(38, bar * 4 + 2.75, 0.34, 0.08),
    ...Array.from({ length: 8 }, (_, i) => hit(42, bar * 4 + i * 0.5, i % 2 ? 0.26 : 0.4, 0.06)),
  ]),
  hit(38, 15.25, 0.6, 0.08),
  hit(38, 15.5, 0.75, 0.08),
  hit(38, 15.75, 0.88, 0.08),
]);
const crashHit = phrase("crash-hit", 8, [hit(49, 0, 1, 3), hit(38, 0, 0.9, 0.2)]);

const bassRoots = phrase(
  "bass-roots",
  16,
  ROOTS.map((root, bar) => ({ pitch: root - 12, start: bar * 4, duration: 3.9, velocity: 0.78 })),
);
const bassDrive = phrase(
  "bass-drive",
  16,
  ROOTS.flatMap((root, bar) => [
    { pitch: root - 12, start: bar * 4, duration: 1.4, velocity: 1 },
    { pitch: root - 12, start: bar * 4 + 1.5, duration: 0.4, velocity: 0.8 },
    { pitch: root - 12, start: bar * 4 + 2, duration: 1.4, velocity: 0.95 },
    { pitch: root, start: bar * 4 + 3.5, duration: 0.4, velocity: 0.75 },
  ]),
);
const bassEnd = phrase("bass-end", 8, [{ pitch: 38, start: 0, duration: 6, velocity: 1 }]);

/** Spiccato string ostinato in a 3-3-2 accent pattern. */
function ostinato(name: string, eighths: boolean, level: number): Phrase {
  const shape = [0, 0, 12, 0, 0, 7, 0, 12, 0, 0, 12, 0, 7, 0, -1, 7];
  const accents = new Set([0, 3, 6, 8, 11, 14]);
  return phrase(
    name,
    16,
    ROOTS.flatMap((root, bar) =>
      shape.flatMap((step, i) => {
        if (eighths && i % 2) return [];
        const interval = step < 0 ? THIRDS[bar]! + 12 : step;
        return [
          {
            pitch: root + interval,
            start: bar * 4 + i * 0.25,
            duration: eighths ? 0.3 : 0.18,
            velocity: (accents.has(i) ? 0.95 : 0.6) * level,
          },
        ];
      }),
    ),
  );
}

const ostinatoEighths = ostinato("ost-8", true, 0.8);
const ostinatoFull = ostinato("ost-16", false, 1);

function choir(name: string, velocity: number): Phrase {
  return phrase(
    name,
    16,
    VOICINGS.flatMap((voicing, bar) =>
      voicing.map((pitch) => ({ pitch, start: bar * 4, duration: 3.92, velocity })),
    ),
  );
}

const choirSoft = choir("choir-soft", 0.5);
const choirFull = choir("choir-full", 0.85);
const choirEnd = phrase(
  "choir-end",
  8,
  [50, 57, 62, 65, 69].map((pitch) => ({ pitch, start: 0, duration: 7, velocity: 0.9 })),
);

/** Haunting broken-chord piano figure in a high register. */
const pianoMotif = phrase(
  "piano-motif",
  16,
  VOICINGS.flatMap(([low, , third, fifth], bar) => {
    const top = low! + 24;
    const figure = [top, fifth!, third!, fifth!, top, fifth!, third! + 12, fifth!];
    return [
      { pitch: low! - 12, start: bar * 4, duration: 3.8, velocity: 0.55 },
      ...figure.map((pitch, i) => ({
        pitch,
        start: bar * 4 + i * 0.5,
        duration: 0.45,
        velocity: i === 0 ? 0.62 : 0.42,
      })),
    ];
  }),
);
const pianoEnd = phrase("piano-end", 8, [
  { pitch: 26, start: 0, duration: 6, velocity: 0.9 },
  { pitch: 38, start: 0, duration: 6, velocity: 0.8 },
]);

/** The eight-bar theme, over the progression twice. */
const THEME: Array<[number, number, number]> = [
  [74, 0, 1.5],
  [76, 1.5, 0.5],
  [77, 2, 1],
  [76, 3, 0.5],
  [74, 3.5, 0.5],
  [77, 4, 2],
  [74, 6, 1],
  [70, 7, 1],
  [70, 8, 1.5],
  [72, 9.5, 0.5],
  [74, 10, 1],
  [79, 11, 1],
  [76, 12, 2],
  [73, 14, 1],
  [69, 15, 1],
  [74, 16, 1.5],
  [76, 17.5, 0.5],
  [77, 18, 1],
  [81, 19, 1],
  [82, 20, 2],
  [81, 22, 1],
  [77, 23, 1],
  [79, 24, 1.5],
  [77, 25.5, 0.5],
  [74, 26, 1],
  [70, 27, 1],
  [69, 28, 0.5],
  [73, 28.5, 0.5],
  [76, 29, 1],
  [81, 30, 2],
];

function theme(name: string, transpose: number, velocity: number): Phrase {
  return phrase(
    name,
    32,
    THEME.map(([pitch, start, duration], i) => ({
      pitch: pitch + transpose,
      start,
      duration: duration - 0.04,
      velocity: velocity * (i % 2 ? 0.9 : 1),
    })),
  );
}

const stringsTheme = theme("strings-theme", 0, 0.92);
const brassTheme = theme("brass-theme", -12, 0.9);
const stringsLament = phrase(
  "strings-lament",
  16,
  [69, 70, 70, 69].map((pitch, bar) => ({ pitch, start: bar * 4, duration: 3.9, velocity: 0.7 })),
);

const brassStabs = phrase(
  "brass-stabs",
  16,
  ROOTS.flatMap((root, bar) =>
    [
      [0, 0.6, 1],
      [1.5, 0.4, 0.8],
      [2, 0.9, 0.95],
    ].flatMap(([at, duration, velocity]) =>
      [root, root + 7, root + 12].map((pitch) => ({
        pitch,
        start: bar * 4 + at!,
        duration: duration!,
        velocity: velocity!,
      })),
    ),
  ),
);
const brassEnd = phrase(
  "brass-end",
  8,
  [38, 50, 57, 62, 65].map((pitch) => ({ pitch, start: 0, duration: 6, velocity: 1 })),
);

const LABELS: Record<string, string> = {
  "taiko-intro": "Distant drums",
  "taiko-rise": "Drums gather",
  "taiko-battle": "War drums",
  "taiko-break": "Heartbeat",
  "taiko-end": "Final blow",
  "snare-rise": "Snare roll",
  "snare-battle": "March",
  "crash-hit": "Crash",
  "bass-roots": "Low roots",
  "bass-drive": "Drive",
  "bass-end": "Low D",
  "ost-8": "Ostinato 8ths",
  "ost-16": "Ostinato 16ths",
  "choir-soft": "Choir hush",
  "choir-full": "Choir",
  "choir-end": "Last chord",
  "piano-motif": "Motif",
  "piano-end": "Low octave",
  "strings-theme": "Theme",
  "strings-lament": "Lament",
  "brass-theme": "Horn theme",
  "brass-stabs": "Stabs",
  "brass-end": "Final chord",
};

/** A region looping `pattern` from beat `start` for `length` beats. */
function region(
  id: string,
  color: ClipColor,
  start: number,
  length: number,
  pattern: Phrase,
): ArrangeClip {
  return {
    id,
    name: LABELS[pattern.name] ?? pattern.name,
    color,
    start,
    length,
    patternLength: pattern.length,
    notes: pattern.notes.map((note, i) => ({ ...note, id: `${id}-n${i}` })),
  };
}

/** Session clips: one per scene (Intro, Rise, Theme, Break, Finale). */
function sessionClips(id: string, color: ClipColor, scenes: Array<Phrase | null>): (Clip | null)[] {
  return emptyClips().map((_, scene) => {
    const pattern = scenes[scene];
    if (!pattern) return null;
    return {
      id: `${id}-c${scene}`,
      name: region(id, color, 0, 4, pattern).name,
      color,
      length: pattern.length,
      notes: pattern.notes.map((note, i) => ({ ...note, id: `${id}-c${scene}-n${i}` })),
    };
  });
}

function demoTrack(
  id: string,
  name: string,
  kind: TrackKind,
  color: ClipColor,
  mix: { volume: number; pan: number },
  device: Partial<Device>,
  scenes: Array<Phrase | null>,
  arrangement: Array<[number, number, Phrase]>,
): Track {
  return {
    id,
    name,
    kind,
    color,
    volume: mix.volume,
    pan: mix.pan,
    mute: false,
    solo: false,
    device: { ...defaultDevice(kind), ...device },
    clips: sessionClips(id, color, scenes),
    arrangement: arrangement.map(([start, length, pattern], i) =>
      region(`${id}-a${i}`, color, start, length, pattern),
    ),
  };
}

// Song map in beats: Intro 0 · Rise 16 · Theme 48 · Break 80 · Finale 96 · Final hit 128.
export function createDemoProject(): Project {
  const kit: Partial<Device> = { instrument: "acoustic-kit" };
  const tracks: Track[] = [
    demoTrack(
      "trk-taiko",
      "War Drums",
      "drums",
      "ember",
      { volume: 0.6, pan: 0 },
      { ...kit, drive: 0.26, reverb: 0.3, cutoff: 9000 },
      [taikoIntro, taikoRise, taikoBattle, taikoBreak, taikoBattle],
      [
        [0, 16, taikoIntro],
        [16, 32, taikoRise],
        [48, 32, taikoBattle],
        [80, 16, taikoBreak],
        [96, 32, taikoBattle],
        [128, 8, taikoEnd],
      ],
    ),
    demoTrack(
      "trk-snares",
      "Snares & Crash",
      "drums",
      "ember",
      { volume: 0.5, pan: 0.08 },
      { ...kit, drive: 0.1, reverb: 0.34 },
      [null, snareRise, snareBattle, snareRise, snareBattle],
      [
        [16, 32, snareRise],
        [48, 32, snareBattle],
        [80, 16, snareRise],
        [96, 32, snareBattle],
        [128, 8, crashHit],
      ],
    ),
    demoTrack(
      "trk-bass",
      "Low End",
      "bass",
      "clay",
      { volume: 0.4, pan: 0 },
      {
        instrument: "sub-bass",
        cutoff: 1200,
        attack: 0.01,
        decay: 0.12,
        drive: 0.18,
        reverb: 0.06,
      },
      [bassRoots, bassRoots, bassDrive, bassRoots, bassDrive],
      [
        [0, 16, bassRoots],
        [16, 32, bassRoots],
        [48, 32, bassDrive],
        [80, 16, bassRoots],
        [96, 32, bassDrive],
        [128, 8, bassEnd],
      ],
    ),
    demoTrack(
      "trk-piano",
      "Piano",
      "keys",
      "gold",
      { volume: 0.62, pan: -0.18 },
      {
        instrument: "grand-piano",
        cutoff: 8000,
        decay: 0.5,
        delayMix: 0.16,
        delayDivision: 0.75,
        reverb: 0.42,
      },
      [pianoMotif, pianoMotif, null, pianoMotif, null],
      [
        [0, 16, pianoMotif],
        [16, 16, pianoMotif],
        [80, 16, pianoMotif],
        [128, 8, pianoEnd],
      ],
    ),
    demoTrack(
      "trk-ostinato",
      "Spiccato Strings",
      "keys",
      "clay",
      { volume: 0.66, pan: 0.22 },
      {
        instrument: "strings",
        attack: 0.008,
        decay: 0.1,
        cutoff: 5200,
        drive: 0.06,
        delayMix: 0,
        reverb: 0.24,
      },
      [null, ostinatoEighths, ostinatoFull, null, ostinatoFull],
      [
        [16, 16, ostinatoEighths],
        [32, 16, ostinatoFull],
        [48, 32, ostinatoFull],
        [96, 32, ostinatoFull],
      ],
    ),
    demoTrack(
      "trk-choir",
      "Choir",
      "keys",
      "sage",
      { volume: 0.55, pan: -0.06 },
      {
        instrument: "warm-pad",
        attack: 0.7,
        decay: 1.6,
        cutoff: 2400,
        resonance: 1,
        delayMix: 0,
        reverb: 0.55,
      },
      [choirSoft, choirSoft, choirFull, choirSoft, choirFull],
      [
        [0, 16, choirSoft],
        [16, 32, choirSoft],
        [48, 32, choirFull],
        [80, 16, choirSoft],
        [96, 32, choirFull],
        [128, 8, choirEnd],
      ],
    ),
    demoTrack(
      "trk-theme",
      "Theme Strings",
      "lead",
      "gold",
      { volume: 0.86, pan: 0.04 },
      {
        instrument: "strings",
        attack: 0.14,
        decay: 0.7,
        cutoff: 5600,
        drive: 0.04,
        delayMix: 0.1,
        delayDivision: 0.75,
        reverb: 0.46,
      },
      [null, null, stringsTheme, stringsLament, stringsTheme],
      [
        [48, 32, stringsTheme],
        [80, 16, stringsLament],
        [96, 32, stringsTheme],
      ],
    ),
    demoTrack(
      "trk-brass",
      "Horns",
      "lead",
      "sage",
      { volume: 0.4, pan: -0.14 },
      {
        waveform: "sawtooth",
        attack: 0.05,
        decay: 0.4,
        cutoff: 1500,
        resonance: 0.9,
        drive: 0.2,
        delayMix: 0,
        reverb: 0.38,
      },
      [null, brassStabs, brassStabs, null, brassTheme],
      [
        [32, 16, brassStabs],
        [48, 32, brassStabs],
        [96, 32, brassTheme],
        [128, 8, brassEnd],
      ],
    ),
  ];

  return {
    name: "Ember Queen",
    bpm: 120,
    swing: 0,
    bars: 34,
    master: 0.52,
    scenes: [
      { id: "s0", name: "Intro" },
      { id: "s1", name: "Rise" },
      { id: "s2", name: "Theme" },
      { id: "s3", name: "Break" },
      { id: "s4", name: "Finale" },
      { id: "s5", name: "Scene 6" },
      { id: "s6", name: "Scene 7" },
      { id: "s7", name: "Scene 8" },
    ],
    tracks,
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
