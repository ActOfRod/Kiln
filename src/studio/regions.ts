import type { ArrangeClip } from "./types";

export function regionOffset(clip: ArrangeClip): number {
  return clip.offset ?? 0;
}

export function splitRegion(clip: ArrangeClip, beat: number, rightId: string): ArrangeClip[] {
  if (beat <= clip.start || beat >= clip.start + clip.length) return [clip];
  const leftLength = beat - clip.start;
  return [
    { ...clip, length: leftLength },
    {
      ...clip,
      id: rightId,
      start: beat,
      length: clip.length - leftLength,
      offset: (regionOffset(clip) + leftLength) % clip.patternLength,
      notes: clip.notes.map((note) => ({ ...note })),
    },
  ];
}

export function fitRegion(clip: ArrangeClip, bars: number): ArrangeClip {
  const start = Math.max(0, Math.min(bars * 4 - 0.25, clip.start));
  return { ...clip, start, length: Math.max(0.25, Math.min(clip.length, bars * 4 - start)) };
}
