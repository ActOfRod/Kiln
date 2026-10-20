import type { ArrangeClip, Project, Track } from "./types";
import { clamp } from "./theory.ts";

export const CLIP_GAIN_RANGE = { min: -36, max: 24 } as const;

export interface SourceWindow {
  start: number;
  end: number;
  loop: boolean;
}

/** Audio source used by a region. Legacy regions and session clips use the track ID. */
export function assetOf(track: Track, clip?: Pick<ArrangeClip, "assetId"> | null): string {
  return clip?.assetId ?? track.id;
}

/** Audio sources the project needs, with a human-readable owner for error messages. */
export function requiredAssets(project: Project): Map<string, string> {
  const assets = new Map<string, string>();
  for (const track of project.tracks) {
    if (track.kind !== "sample") continue;
    if (track.clips.some(Boolean) || track.arrangement.some((clip) => !clip.assetId))
      assets.set(track.id, track.name);
    for (const clip of track.arrangement)
      if (clip.assetId && !assets.has(clip.assetId))
        assets.set(clip.assetId, `${clip.name} on ${track.name}`);
  }
  return assets;
}

/** Sampler-style playback rate: transposition and Re-Pitch warp both change speed. */
export function playbackRate(
  clip: Pick<ArrangeClip, "transpose" | "detune" | "warp" | "sourceBpm">,
  bpm: number,
): number {
  const semitones = clamp(clip.transpose ?? 0, -48, 48) + clamp(clip.detune ?? 0, -50, 50) / 100;
  const warp = clip.warp && clip.sourceBpm && clip.sourceBpm > 0 ? bpm / clip.sourceBpm : 1;
  return clamp(2 ** (semitones / 12) * warp, 1 / 64, 64);
}

/** The played portion of the source, falling back to the track's legacy trim. */
export function clipWindow(track: Track, clip: ArrangeClip, duration: number): SourceWindow {
  const start = clamp(
    clip.sampleStart ?? track.device.sampleOffset,
    0,
    Math.max(0, duration - 0.01),
  );
  const requestedEnd = clip.sampleEnd ?? track.device.sampleEnd;
  const end =
    requestedEnd > start + 0.01 ? Math.min(requestedEnd, duration) : Math.max(duration, start);
  return { start, end: Math.max(end, start), loop: clip.loop ?? track.device.sampleLoop };
}

/** Reversed playback reads the same window from a reversed copy of the source. */
export function reverseWindow(window: SourceWindow, duration: number): SourceWindow {
  return { ...window, start: duration - window.end, end: duration - window.start };
}

/** Source position after `elapsed` seconds of source time, or null after a one-shot ends. */
export function sourcePosition(window: SourceWindow, elapsed: number): number | null {
  const length = window.end - window.start;
  if (length <= 0) return null;
  if (window.loop) return window.start + (((elapsed % length) + length) % length);
  return elapsed >= 0 && elapsed < length ? window.start + elapsed : null;
}

export function clipGain(clip: Pick<ArrangeClip, "gain">): number {
  return 10 ** (clamp(clip.gain ?? 0, CLIP_GAIN_RANGE.min, CLIP_GAIN_RANGE.max) / 20);
}

/** Linear fade level (0–1) at `time`, with region boundaries and fades in seconds. */
export function fadeLevel(
  time: number,
  regionStart: number,
  regionEnd: number,
  fadeIn: number,
  fadeOut: number,
): number {
  let level = 1;
  if (fadeIn > 0) level = Math.min(level, (time - regionStart) / fadeIn);
  if (fadeOut > 0) level = Math.min(level, (regionEnd - time) / fadeOut);
  return clamp(level, 0, 1);
}

/** Length in beats of one pass through the window at the clip's playback rate. */
export function naturalBeats(window: SourceWindow, rate: number, bpm: number): number {
  return ((window.end - window.start) / rate) * (bpm / 60);
}
