import { z } from "zod";

const finite = z.number().finite();
const color = z.enum(["ember", "clay", "gold", "sage"]);
const note = z.object({
  id: z.string().max(100),
  pitch: finite.int().min(0).max(127),
  start: finite.min(0).max(2048),
  duration: finite.positive().max(2048),
  velocity: finite.min(0).max(1),
});
const clip = z.object({
  id: z.string().max(100),
  name: z.string().max(100),
  color,
  length: finite.min(0.25).max(2048),
  notes: z.array(note).max(10000),
});
const region = clip.extend({
  start: finite.min(0).max(2048),
  patternLength: finite.min(0.25).max(2048),
  offset: finite.min(0).max(2048).optional(),
});
const device = z.object({
  waveform: z.enum(["sine", "triangle", "sawtooth", "square"]),
  attack: finite.min(0.003).max(2),
  decay: finite.min(0.01).max(5),
  cutoff: finite.min(20).max(20000),
  resonance: finite.min(0).max(20),
  drive: finite.min(0).max(1),
  delayMix: finite.min(0).max(1),
  delayDivision: finite.min(0.01).max(4),
  reverb: finite.min(0).max(1),
  sampleOffset: finite.min(0),
  sampleEnd: finite.min(0),
  sampleLoop: z.boolean(),
});
export const projectSchema = z
  .object({
    name: z.string().min(1).max(100),
    bpm: finite.min(40).max(240),
    swing: finite.min(0).max(0.6),
    bars: finite.int().min(1).max(128),
    master: finite.min(0).max(1),
    scenes: z
      .array(z.object({ id: z.string(), name: z.string().max(100) }))
      .min(1)
      .max(32),
    tracks: z
      .array(
        z.object({
          id: z.string().max(100),
          name: z.string().max(100),
          kind: z.enum(["drums", "bass", "keys", "lead", "sample"]),
          color,
          volume: finite.min(0).max(1),
          pan: finite.min(-1).max(1),
          mute: z.boolean(),
          solo: z.boolean(),
          device,
          clips: z.array(clip.nullable()).max(32),
          arrangement: z.array(region).max(1000),
        }),
      )
      .min(1)
      .max(32),
  })
  .superRefine((project, ctx) => {
    const ids = new Set<string>();
    for (const track of project.tracks) {
      if (ids.has(track.id)) ctx.addIssue({ code: "custom", message: "Duplicate track ID" });
      ids.add(track.id);
      if (track.clips.length !== project.scenes.length) {
        ctx.addIssue({ code: "custom", message: "Clip slots must match scene count" });
      }
      for (const clip of track.arrangement) {
        if (clip.start + clip.length > project.bars * 4) {
          ctx.addIssue({ code: "custom", message: "Region extends beyond song end" });
        }
      }
    }
  });

export const projectFileSchema = z.object({
  format: z.literal("kiln-project"),
  version: z.literal(1),
  project: projectSchema,
  samples: z.record(z.string(), z.string().max(80_000_000)),
});

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
