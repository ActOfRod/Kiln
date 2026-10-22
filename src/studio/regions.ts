import type { ArrangeClip, Note } from "./types";
import { clamp } from "./theory.ts";

export function regionOffset(clip: ArrangeClip): number {
  return clip.offset ?? 0;
}

/**
 * Split at an absolute beat. MIDI phase wraps at the pattern length; audio clips
 * keep the full elapsed offset because their source plays continuously.
 */
export function splitRegion(
  clip: ArrangeClip,
  beat: number,
  rightId: string,
  audio = false,
): ArrangeClip[] {
  if (beat <= clip.start || beat >= clip.start + clip.length) return [clip];
  const leftLength = beat - clip.start;
  const elapsed = regionOffset(clip) + leftLength;
  return [
    { ...clip, length: leftLength, fadeOut: undefined },
    {
      ...clip,
      id: rightId,
      start: beat,
      length: clip.length - leftLength,
      fadeIn: undefined,
      offset: audio ? elapsed : elapsed % clip.patternLength,
      notes: clip.notes.map((note) => ({ ...note })),
    },
  ];
}

/** The longest song, in bars, and in beats. */
export const MAX_BARS = 128;
export const MAX_BEATS = MAX_BARS * 4;

/** Song length that also covers a region ending at `end` beats (never shrinks, capped). */
export function growBars(bars: number, end: number): number {
  return Math.min(MAX_BARS, Math.max(bars, Math.ceil(end / 4 - 1e-9)));
}

export function fitRegion(clip: ArrangeClip, bars: number): ArrangeClip {
  const start = Math.max(0, Math.min(bars * 4 - 0.25, clip.start));
  return { ...clip, start, length: Math.max(0.25, Math.min(clip.length, bars * 4 - start)) };
}

export type MidiTransform =
  | { kind: "transpose"; semitones: number }
  | { kind: "velocity"; amount: number }
  | { kind: "reverse" }
  | { kind: "invert" }
  | { kind: "stretch"; factor: number }
  | { kind: "duplicate-loop" };

/** Ableton-style MIDI clip operations. Returns new note IDs only for duplicated notes. */
export function transformMidi(
  clip: Pick<ArrangeClip, "notes" | "patternLength">,
  transform: MidiTransform,
  newId: () => string,
): { notes: Note[]; patternLength: number } {
  const { notes, patternLength } = clip;
  switch (transform.kind) {
    case "transpose":
      return {
        patternLength,
        notes: notes.map((n) => ({
          ...n,
          pitch: clamp(Math.round(n.pitch + transform.semitones), 0, 127),
        })),
      };
    case "velocity":
      return {
        patternLength,
        notes: notes.map((n) => ({
          ...n,
          velocity: clamp(n.velocity + transform.amount, 0.05, 1),
        })),
      };
    case "reverse":
      return {
        patternLength,
        notes: notes.map((n) => ({
          ...n,
          start: clamp(patternLength - n.start - n.duration, 0, patternLength - 0.01),
        })),
      };
    case "invert": {
      if (!notes.length) return { notes, patternLength };
      const pitches = notes.map((n) => n.pitch);
      const axis = Math.min(...pitches) + Math.max(...pitches);
      return { patternLength, notes: notes.map((n) => ({ ...n, pitch: axis - n.pitch })) };
    }
    case "stretch": {
      const next = clamp(patternLength * transform.factor, 0.25, 2048);
      const factor = next / patternLength;
      return {
        patternLength: next,
        notes: notes.map((n) => ({
          ...n,
          start: n.start * factor,
          duration: Math.max(0.03, n.duration * factor),
        })),
      };
    }
    case "duplicate-loop": {
      if (patternLength * 2 > 2048) return { notes, patternLength };
      return {
        patternLength: patternLength * 2,
        notes: [
          ...notes,
          ...notes.map((n) => ({ ...n, id: newId(), start: n.start + patternLength })),
        ],
      };
    }
  }
}
