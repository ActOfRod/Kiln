import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoProject, createEmptyProject } from "./factory.ts";
import { fitRegion, growBars, splitRegion, transformMidi } from "./regions.ts";
import { folderOf, folderTree, groupSounds, inFolder, type LibrarySound } from "./library.ts";
import {
  assetOf,
  clipWindow,
  fadeLevel,
  playbackRate,
  requiredAssets,
  reverseWindow,
  sourcePosition,
} from "./audio-clip.ts";
import { pcm16, encodeMp3 } from "./export.ts";
import { projectFileSchema, projectSchema } from "./project-file.ts";
import { instrumentOf, instrumentsFor, renderNote } from "./instruments.ts";

describe("desktop project contracts", () => {
  it("accepts the existing demo and empty project without migration", () => {
    assert.equal(projectSchema.safeParse(createDemoProject()).success, true);
    assert.equal(projectSchema.safeParse(createEmptyProject()).success, true);
  });
  it("rejects nonfinite controls, missing slots and duplicate track identities", () => {
    for (const change of [
      (p: ReturnType<typeof createDemoProject>) => {
        p.bpm = Infinity;
      },
      (p: ReturnType<typeof createDemoProject>) => {
        p.tracks[1]!.id = p.tracks[0]!.id;
      },
      (p: ReturnType<typeof createDemoProject>) => {
        p.tracks[0]!.clips.pop();
      },
      (p: ReturnType<typeof createDemoProject>) => {
        p.tracks[0]!.device.drive = 2;
      },
      (p: ReturnType<typeof createDemoProject>) => {
        p.bars = 1;
      },
    ]) {
      const project = createDemoProject();
      change(project);
      assert.equal(projectSchema.safeParse(project).success, false);
    }
  });
  it("requires a versioned portable project envelope", () => {
    assert.equal(projectFileSchema.safeParse(createDemoProject()).success, false);
    assert.equal(
      projectFileSchema.safeParse({
        format: "kiln-project",
        version: 1,
        project: createDemoProject(),
        samples: {},
      }).success,
      true,
    );
  });
});

describe("region editing", () => {
  it("splits without restarting the pattern on the right", () => {
    const clip = createDemoProject().tracks[0]!.arrangement[0]!;
    const parts = splitRegion(clip, 5, "right");
    assert.equal(parts.length, 2);
    assert.equal(parts[0]!.length, 5);
    assert.equal(parts[1]!.offset, 1);
    assert.equal(parts[1]!.start, 5);
    assert.equal(parts[1]!.length, clip.length - 5);
    assert.notEqual(parts[1]!.notes, clip.notes);
    const again = splitRegion(parts[1]!, 7, "right-again");
    assert.equal(again[1]!.offset, 3);
  });
  it("ignores boundary splits and constrains movement and resizing to song bounds", () => {
    const clip = createDemoProject().tracks[0]!.arrangement[0]!;
    assert.deepEqual(splitRegion(clip, 0, "right"), [clip]);
    assert.deepEqual(splitRegion(clip, clip.length, "right"), [clip]);
    const fit = fitRegion({ ...clip, start: 100, length: 40 }, 16);
    assert.equal(fit.start + fit.length, 64);
    assert.ok(fit.length > 0);
    assert.equal(fitRegion({ ...clip, start: -3 }, 16).start, 0);
  });
});

describe("song length", () => {
  it("grows to fit regions placed past the end, never shrinks, and caps at 128 bars", () => {
    assert.equal(growBars(16, 64), 16);
    assert.equal(growBars(16, 65), 17);
    assert.equal(growBars(16, 72), 18);
    assert.equal(growBars(32, 8), 32);
    assert.equal(growBars(16, 9999), 128);
  });
  it("ships a demo whose regions fit inside the song", () => {
    const project = createDemoProject();
    const end = Math.max(
      ...project.tracks.flatMap((t) => t.arrangement.map((c) => c.start + c.length)),
    );
    assert.equal(project.bars, end / 4);
    assert.ok(project.tracks.length >= 6);
  });
});

describe("sample folders", () => {
  const sound = (name: string, folder?: string, addedAt = 0): LibrarySound => ({
    id: `${folder ?? "loose"}-${name}`,
    name,
    tags: [],
    favorite: false,
    duration: 1,
    addedAt,
    ...(folder && { folder }),
  });
  it("derives the folder from a picked file's relative path", () => {
    assert.equal(folderOf("Drum Kit/kick.wav"), "Drum Kit");
    assert.equal(folderOf("Drum Kit/Snares/snare 1.wav"), "Drum Kit / Snares");
    assert.equal(folderOf("kick.wav"), undefined);
    assert.equal(folderOf(""), undefined);
  });
  it("keeps loose sounds in My samples and groups folders in natural order", () => {
    const { loose, folders } = groupSounds([
      sound("vox", undefined, 2),
      sound("kick 10", "Kit"),
      sound("kick 2", "Kit"),
      sound("pad", "Ambient"),
    ]);
    assert.deepEqual(
      loose.map((s) => s.name),
      ["vox"],
    );
    assert.deepEqual(
      folders.map((f) => f.name),
      ["Ambient", "Kit"],
    );
    assert.deepEqual(
      folders[1]!.sounds.map((s) => s.name),
      ["kick 2", "kick 10"],
    );
  });
  it("nests sub-folders into a tree with recursive counts", () => {
    const tree = folderTree(
      groupSounds([
        sound("kick", "Pack / Kicks"),
        sound("snare", "Pack / Snares"),
        sound("loop", "Pack"),
        sound("pad", "Ambient"),
      ]).folders,
    );
    assert.deepEqual(
      tree.map((node) => [node.name, node.count]),
      [
        ["Ambient", 1],
        ["Pack", 3],
      ],
    );
    const pack = tree[1]!;
    assert.deepEqual(
      pack.children.map((node) => [node.name, node.path, node.count]),
      [
        ["Kicks", "Pack / Kicks", 1],
        ["Snares", "Pack / Snares", 1],
      ],
    );
    assert.deepEqual(
      pack.sounds.map((s) => s.name),
      ["loop"],
    );
    assert.ok(inFolder("Pack / Kicks", "Pack"));
    assert.ok(!inFolder("Package", "Pack"));
  });
});

describe("MP3 encoding", () => {
  it("clamps float samples into signed 16-bit PCM", () => {
    assert.deepEqual(
      [...pcm16(new Float32Array([-2, -1, 0, 1, 2]))],
      [-32768, -32768, 0, 32767, 32767],
    );
  });
  for (const bitrate of [128, 192, 320] as const) {
    it(`produces MPEG-1 Layer III stereo at ${bitrate} kbps, not a renamed WAV`, async () => {
      const data = Float32Array.from(
        { length: 44100 },
        (_, i) => Math.sin((i / 44100) * Math.PI * 2 * 440) * 0.3,
      );
      const blob = await encodeMp3({ sampleRate: 44100, getChannelData: () => data }, bitrate);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assert.equal(blob.type, "audio/mpeg");
      assert.equal(bytes[0], 0xff);
      assert.equal(bytes[1]! & 0xfe, 0xfa);
      assert.equal(bytes[2]! >> 4, { 128: 9, 192: 11, 320: 14 }[bitrate]);
      assert.equal(bytes[3]! >> 6, 0); // Stereo, not dual-mono or mono.
      assert.ok(bytes.length > bitrate * 100);
      assert.ok(bytes.length < bitrate * 160);
    });
  }
});

describe("audio clips", () => {
  const project = createDemoProject();
  const track = {
    ...project.tracks[0]!,
    id: "trk-audio",
    kind: "sample" as const,
    clips: project.scenes.map(() => null),
  };
  const base = { ...track.arrangement[0]!, notes: [] };
  it("resolves sources, keeping legacy regions on their track's audio", () => {
    assert.equal(assetOf(track, base), "trk-audio");
    assert.equal(assetOf(track, { ...base, assetId: "asset-1" }), "asset-1");
    const assets = requiredAssets({
      ...project,
      tracks: [{ ...track, arrangement: [{ ...base, assetId: "asset-1" }] }],
    });
    assert.deepEqual([...assets.keys()], ["asset-1"]);
  });
  it("re-pitches with transpose, detune and warp", () => {
    assert.equal(playbackRate({ transpose: 12 }, 120), 2);
    assert.ok(Math.abs(playbackRate({ detune: 50, transpose: -1 }, 120) - 2 ** (-0.5 / 12)) < 1e-9);
    assert.equal(playbackRate({ warp: true, sourceBpm: 100 }, 150), 1.5);
    assert.equal(playbackRate({ warp: false, sourceBpm: 100 }, 150), 1);
  });
  it("loops or ends inside the start/end window, including reversed playback", () => {
    const window = clipWindow(track, { ...base, sampleStart: 1, sampleEnd: 3, loop: false }, 10);
    assert.deepEqual(window, { start: 1, end: 3, loop: false });
    assert.equal(sourcePosition(window, 0.5), 1.5);
    assert.equal(sourcePosition(window, 2), null);
    assert.equal(sourcePosition({ ...window, loop: true }, 5), 2);
    assert.deepEqual(reverseWindow(window, 10), { start: 7, end: 9, loop: false });
    assert.deepEqual(clipWindow(track, { ...base, sampleEnd: 50 }, 4).end, 4);
  });
  it("computes linear fades at region boundaries", () => {
    assert.equal(fadeLevel(0, 0, 4, 1, 1), 0);
    assert.equal(fadeLevel(0.5, 0, 4, 1, 1), 0.5);
    assert.equal(fadeLevel(2, 0, 4, 1, 1), 1);
    assert.equal(fadeLevel(3.75, 0, 4, 1, 1), 0.25);
  });
  it("keeps the full elapsed source offset when splitting audio", () => {
    const clip = { ...base, start: 0, length: 12, patternLength: 4, fadeIn: 0.2, fadeOut: 0.3 };
    const [left, right] = splitRegion(clip, 10, "r", true);
    assert.equal(right!.offset, 10);
    assert.equal(left!.fadeOut, undefined);
    assert.equal(right!.fadeIn, undefined);
    assert.equal(right!.fadeOut, 0.3);
    assert.equal(splitRegion(clip, 10, "r")[1]!.offset, 2);
  });
});

describe("MIDI clip tools", () => {
  const notes = [
    { id: "a", pitch: 60, start: 0, duration: 1, velocity: 0.5 },
    { id: "b", pitch: 67, start: 2, duration: 1, velocity: 0.9 },
  ];
  const clip = { notes, patternLength: 4 };
  let n = 0;
  const id = () => `new-${n++}`;
  it("transposes, scales velocity, reverses and inverts", () => {
    assert.deepEqual(
      transformMidi(clip, { kind: "transpose", semitones: 12 }, id).notes.map((x) => x.pitch),
      [72, 79],
    );
    assert.deepEqual(
      transformMidi(clip, { kind: "velocity", amount: 0.2 }, id).notes.map((x) => x.velocity),
      [0.7, 1],
    );
    assert.deepEqual(
      transformMidi(clip, { kind: "reverse" }, id).notes.map((x) => x.start),
      [3, 1],
    );
    assert.deepEqual(
      transformMidi(clip, { kind: "invert" }, id).notes.map((x) => x.pitch),
      [67, 60],
    );
  });
  it("stretches and duplicates the loop", () => {
    const slow = transformMidi(clip, { kind: "stretch", factor: 2 }, id);
    assert.equal(slow.patternLength, 8);
    assert.deepEqual(
      slow.notes.map((x) => x.start),
      [0, 4],
    );
    const twice = transformMidi(clip, { kind: "duplicate-loop" }, id);
    assert.equal(twice.patternLength, 8);
    assert.equal(twice.notes.length, 4);
    assert.equal(twice.notes[2]!.start, 4);
    assert.notEqual(twice.notes[2]!.id, "a");
  });
});

describe("instruments", () => {
  const sr = 44100;
  // Autocorrelation pitch estimate with parabolic peak interpolation.
  const pitchOf = (data: Float32Array, start: number) => {
    const n = 4096;
    let best = 0;
    let bestLag = 0;
    const corr: number[] = [];
    for (let lag = Math.floor(sr / 2000); lag < sr / 35; lag++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += data[start + i]! * data[start + i + lag]!;
      corr[lag] = sum;
      if (sum > best) {
        best = sum;
        bestLag = lag;
      }
    }
    // Prefer the shortest lag with a near-maximal peak (avoids octave errors).
    for (let lag = Math.floor(sr / 2000) + 1; lag < bestLag; lag++)
      if (corr[lag]! > 0.9 * best && corr[lag]! >= corr[lag - 1]! && corr[lag]! >= corr[lag + 1]!) {
        bestLag = lag;
        break;
      }
    const [a, b, c] = [corr[bestLag - 1]!, corr[bestLag]!, corr[bestLag + 1]!];
    return sr / (bestLag + (0.5 * (a - c)) / (a - 2 * b + c));
  };
  const rms = (data: Float32Array, from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i]! ** 2;
    return Math.sqrt(sum / (to - from));
  };
  for (const [id, pitch] of [
    ["grand-piano", 57],
    ["grand-piano", 69],
    ["electric-piano", 60],
    ["pluck", 64],
    ["electric-bass", 40],
  ] as const) {
    it(`${id} plays MIDI ${pitch} in tune and decays naturally`, () => {
      const data = renderNote(id, pitch, sr);
      assert.ok(data.every(Number.isFinite));
      assert.ok(data.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0) <= 1.0001);
      const hz = pitchOf(data, Math.floor(sr * 0.12));
      const cents = 1200 * Math.log2(hz / (440 * 2 ** ((pitch - 69) / 12)));
      assert.ok(Math.abs(cents) < 25, `${hz.toFixed(1)} Hz is ${cents.toFixed(1)} cents off`);
      const early = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.25));
      const late = rms(data, data.length - Math.floor(sr * 0.2), data.length);
      assert.ok(late < early / 5, "note should die away");
    });
  }
  it("keeps existing songs on their original sound and only lists valid instruments", () => {
    assert.equal(instrumentOf("keys", {}).id, "analog");
    assert.equal(instrumentOf("drums", {}).id, "drum-machine");
    assert.equal(instrumentOf("keys", { instrument: "808-kit" }).id, "analog");
    assert.equal(instrumentOf("drums", { instrument: "grand-piano" }).id, "drum-machine");
    assert.equal(instrumentsFor("keys")[0]!.id, "grand-piano");
    assert.equal(instrumentsFor("bass")[0]!.family, "Bass");
    assert.ok(instrumentsFor("drums").every((item) => item.engine === "drums"));
    assert.deepEqual(instrumentsFor("sample"), []);
    assert.equal(
      createDemoProject().tracks.find((t) => t.kind === "keys")!.device.instrument,
      "grand-piano",
    );
  });
  it("validates the instrument field in saved projects", () => {
    const project = createDemoProject();
    project.tracks[1]!.device.instrument = "electric-bass";
    assert.equal(projectSchema.parse(project).tracks[1]!.device.instrument, "electric-bass");
    (project.tracks[1]!.device as { instrument: string }).instrument = "theremin";
    assert.equal(projectSchema.safeParse(project).success, false);
  });
});
