import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoProject, createEmptyProject } from "./factory.ts";
import { fitRegion, splitRegion } from "./regions.ts";
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
