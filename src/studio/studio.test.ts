import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoProject, createEmptyProject } from "./factory.ts";
import { fitRegion, splitRegion, transformMidi } from "./regions.ts";
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
