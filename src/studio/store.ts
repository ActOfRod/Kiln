import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ArrangeClip,
  Clip,
  Device,
  Follow,
  LaunchState,
  Note,
  Project,
  StudioView,
  Track,
  TrackKind,
} from "./types";
import {
  CLIP_COLORS,
  createDemoProject,
  createEmptyProject,
  defaultDevice,
  PATTERNS,
} from "./factory";
import { engine, type Snapshot } from "./engine";
import { clamp, nextBar, quantize, uid } from "./theory";
import { fitRegion, splitRegion } from "./regions";
import { downloadBlob, projectFileSchema, projectSchema } from "./project-file";
import { idbGet, idbPutMany } from "./samples";
import type { ExportOptions } from "./export";

export interface StudioState {
  project: Project;
  launched: Record<string, LaunchState>;
  follow: Follow;
  view: StudioView;
  playing: boolean;
  recording: boolean;
  metronome: boolean;
  beat: number;
  selectedTrackId: string;
  selectedScene: number;
  selectedSlot: { trackId: string; scene: number } | null;
  hintDismissed: boolean;
  sampleRev: number;
  pending: Record<string, number>;
  audioError: string | null;
  past: Project[];
  future: Project[];
  undo: () => void;
  redo: () => void;
  beginEdit: () => void;
  endEdit: () => void;
  seek: (beat: number) => void;
  duplicateTrack: (trackId: string) => Promise<void>;
  reorderTrack: (trackId: string, direction: -1 | 1) => void;
  addRegion: (trackId: string, patternId: string, start: number) => void;
  updateRegion: (
    trackId: string,
    clipId: string,
    patch: Partial<Pick<ArrangeClip, "name" | "length" | "notes" | "patternLength">>,
  ) => void;
  splitArrangeClip: (trackId: string, clipId: string, beat: number) => void;
  duplicateArrangeClip: (trackId: string, clipId: string) => void;
  saveProject: () => Promise<void>;
  openProject: (file: File) => Promise<void>;
  setView: (view: StudioView) => void;
  setBeat: (beat: number) => void;
  dismissHint: () => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setBars: (bars: number) => void;
  setMaster: (master: number) => void;
  toggleMetronome: () => void;
  togglePlay: () => Promise<void>;
  stop: () => void;
  toggleRecord: () => void;
  launchClip: (trackId: string, scene: number) => Promise<void>;
  launchScene: (scene: number) => Promise<void>;
  returnToSong: () => void;
  selectTrack: (trackId: string) => void;
  setVolume: (trackId: string, volume: number) => void;
  setPan: (trackId: string, pan: number) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  updateDevice: (trackId: string, patch: Partial<Device>) => void;
  renameProject: (name: string) => void;
  renameScene: (index: number, name: string) => void;
  renameTrack: (trackId: string, name: string) => void;
  addTrack: (kind: TrackKind) => void;
  addAudioTrack: (data: ArrayBuffer, name: string) => Promise<void>;
  removeTrack: (trackId: string) => void;
  insertPattern: (trackId: string, scene: number, patternId: string) => void;
  clearClip: (trackId: string, scene: number) => void;
  duplicateClip: (trackId: string, scene: number) => void;
  toggleStep: (trackId: string, scene: number, pitch: number, step: number) => void;
  setClipLength: (trackId: string, scene: number, beats: number) => void;
  noteOn: (pitch: number) => Promise<void>;
  noteOff: (pitch: number) => void;
  captureScene: () => void;
  moveArrangeClip: (trackId: string, clipId: string, start: number) => void;
  deleteArrangeClip: (trackId: string, clipId: string) => void;
  newSet: () => void;
  resetDemo: () => void;
  onArrangeLoop: () => void;
  bumpSamples: () => void;
  ensureClip: (trackId: string, scene: number, name: string) => void;
  exportSong: (options?: ExportOptions) => Promise<void>;
}

function audioFailure(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Audio could not start. Check browser audio permissions and try again.";
}

function snap(state: StudioState): Snapshot {
  return {
    project: state.project,
    launched: state.launched,
    follow: state.follow,
    metronome: state.metronome,
  };
}

function mapTracks(project: Project, trackId: string, fn: (track: Track) => Track): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => (track.id === trackId ? fn(track) : track)),
  };
}

function patchClip(project: Project, trackId: string, scene: number, clip: Clip | null): Project {
  return mapTracks(project, trackId, (track) => {
    const clips = track.clips.slice();
    clips[scene] = clip;
    return { ...track, clips };
  });
}

function audibleIndex(launch: LaunchState | undefined, beat: number): number | null {
  if (!launch) return null;
  if (beat < launch.launchBeat - 0.001) return launch.previous?.clipIndex ?? null;
  return launch.clipIndex >= 0 ? launch.clipIndex : null;
}

function soundingOf(
  launch: LaunchState | undefined,
  beat: number,
): { clipIndex: number; launchBeat: number } | null {
  if (!launch) return null;
  const idx = audibleIndex(launch, beat);
  if (idx == null) return null;
  if (beat < launch.launchBeat && launch.previous) return launch.previous;
  return { clipIndex: launch.clipIndex, launchBeat: launch.launchBeat };
}

function sceneLaunch(
  project: Project,
  scene: number,
  beat: number,
  playing: boolean,
): Record<string, LaunchState> {
  const q = nextBar(beat, playing);
  const launched: Record<string, LaunchState> = {};
  project.tracks.forEach((track) => {
    if (track.clips[scene]) launched[track.id] = { clipIndex: scene, launchBeat: q };
  });
  return launched;
}

function makeClip(track: Track, name: string): Clip {
  return {
    id: uid("clip"),
    name,
    color: track.color,
    length: 4,
    notes: [],
  };
}

const demo = createDemoProject();
let restoringHistory = false;
let groupingHistory = false;
let groupRecorded = false;

const memoryStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
let storageWarning = false;
let lastSavedValue: string | null = null;
const browserStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      queueMicrotask(() =>
        useStudio.setState({
          audioError: "Browser storage is unavailable. Download a project backup before closing.",
        }),
      );
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    if (value === lastSavedValue) return;
    try {
      localStorage.setItem(key, value);
      lastSavedValue = value;
      storageWarning = false;
    } catch {
      if (!storageWarning) {
        storageWarning = true;
        queueMicrotask(() =>
          useStudio.setState({
            audioError:
              "Auto-save failed: browser storage is full or unavailable. Download a project backup.",
          }),
        );
      }
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      queueMicrotask(() =>
        useStudio.setState({ audioError: "Browser storage could not be cleared." }),
      );
    }
  },
};

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      project: demo,
      launched: {},
      follow: "arrange",
      view: "arrange",
      playing: false,
      recording: false,
      metronome: false,
      beat: 0,
      selectedTrackId: demo.tracks[0]?.id ?? "trk-drums",
      selectedScene: 1,
      selectedSlot: { trackId: demo.tracks[0]?.id ?? "trk-drums", scene: 1 },
      hintDismissed: false,
      sampleRev: 0,
      pending: {},
      audioError: null,
      past: [],
      future: [],
      beginEdit: () => {
        groupingHistory = true;
        groupRecorded = false;
      },
      endEdit: () => {
        groupingHistory = false;
        groupRecorded = false;
      },
      undo: () => {
        const state = get();
        const previous = state.past.at(-1);
        if (!previous) return;
        restoringHistory = true;
        set({
          project: previous,
          past: state.past.slice(0, -1),
          future: [state.project, ...state.future],
          selectedTrackId: previous.tracks[0]!.id,
          selectedSlot: null,
        });
        restoringHistory = false;
        groupingHistory = false;
      },
      redo: () => {
        const state = get();
        const next = state.future[0];
        if (!next) return;
        restoringHistory = true;
        set({
          project: next,
          past: [...state.past, state.project],
          future: state.future.slice(1),
          selectedTrackId: next.tracks[0]!.id,
          selectedSlot: null,
        });
        restoringHistory = false;
        groupingHistory = false;
      },
      seek: (beat) => {
        const next = clamp(beat, 0, get().project.bars * 4 - 0.25);
        engine.pause();
        set({ beat: next, launched: {}, follow: "arrange" });
        engine.sync(snap(get()));
        if (get().playing) engine.start(next);
      },

      setView: (view) => set({ view }),

      setBeat: (beat) => {
        const launched = { ...get().launched };
        let changed = false;
        for (const [id, launch] of Object.entries(launched)) {
          if (launch.previous && beat >= launch.launchBeat - 0.001) {
            launched[id] = { clipIndex: launch.clipIndex, launchBeat: launch.launchBeat };
            changed = true;
          }
          const current = launched[id];
          if (current && current.clipIndex < 0 && beat >= current.launchBeat - 0.001) {
            delete launched[id];
            changed = true;
          }
        }
        set(changed ? { beat, launched } : { beat });
      },

      dismissHint: () => set({ hintDismissed: true }),

      setBpm: (bpm) =>
        set((s) => ({ project: { ...s.project, bpm: Math.round(clamp(bpm, 40, 240)) } })),

      setSwing: (swing) => set((s) => ({ project: { ...s.project, swing: clamp(swing, 0, 0.6) } })),

      setBars: (bars) =>
        set((s) => {
          const next = Math.round(clamp(bars, 1, 128));
          const last = Math.max(
            1,
            ...s.project.tracks.flatMap((track) =>
              track.arrangement.map((clip) => Math.ceil((clip.start + clip.length) / 4)),
            ),
          );
          return { project: { ...s.project, bars: Math.max(next, last) } };
        }),

      setMaster: (master) =>
        set((s) => ({ project: { ...s.project, master: clamp(master, 0, 1) } })),

      toggleMetronome: () => set((s) => ({ metronome: !s.metronome })),

      togglePlay: async () => {
        const state = get();
        try {
          await engine.ensure();
        } catch (error) {
          set({ audioError: audioFailure(error) });
          return;
        }
        if (state.playing) {
          const beat = engine.pause();
          set({ playing: false, beat, pending: {} });
          return;
        }
        let launched = state.launched;
        let follow = state.follow;
        if (state.view === "arrange") {
          follow = "arrange";
          if (state.beat < 0.05) launched = {};
        } else if (state.view === "session") {
          follow = "session";
          const audible = Object.values(launched).some((l) => l.clipIndex >= 0);
          if (!audible)
            launched = sceneLaunch(state.project, state.selectedScene, state.beat, false);
        }
        set({ playing: true, launched, audioError: null, follow });
        engine.sync(snap(get()));
        engine.start(get().beat);
      },

      stop: () => {
        engine.pause();
        const launched: Record<string, LaunchState> = {};
        for (const [id, launch] of Object.entries(get().launched)) {
          if (launch.clipIndex >= 0) launched[id] = { clipIndex: launch.clipIndex, launchBeat: 0 };
        }
        set({ playing: false, beat: 0, launched, recording: false, pending: {} });
      },

      toggleRecord: () => set((s) => ({ recording: !s.recording })),

      launchClip: async (trackId, scene) => {
        const state = get();
        const track = state.project.tracks.find((t) => t.id === trackId);
        if (!track) return;
        const clip = track.clips[scene];
        const select = {
          selectedTrackId: trackId,
          selectedScene: scene,
          selectedSlot: { trackId, scene },
        };
        if (!clip) {
          set(select);
          return;
        }
        const current = audibleIndex(state.launched[trackId], state.beat);
        if (state.playing && current === scene) {
          const q = nextBar(state.beat, true);
          const sounding = soundingOf(state.launched[trackId], state.beat);
          set({
            ...select,
            launched: {
              ...state.launched,
              [trackId]: { clipIndex: -1, launchBeat: q, previous: sounding ?? undefined },
            },
          });
          return;
        }
        try {
          await engine.ensure();
        } catch (error) {
          set({ audioError: audioFailure(error) });
          return;
        }
        const playing = state.playing;
        const q = nextBar(state.beat, playing);
        const sounding = playing ? soundingOf(state.launched[trackId], state.beat) : null;
        const previous = sounding && sounding.clipIndex !== scene ? sounding : undefined;
        const launched = {
          ...state.launched,
          [trackId]: { clipIndex: scene, launchBeat: q, previous },
        };
        set({ ...select, launched, playing: true, follow: "session", audioError: null });
        if (!playing) {
          engine.sync(snap(get()));
          engine.start(get().beat);
        }
      },

      launchScene: async (scene) => {
        const state = get();
        try {
          await engine.ensure();
        } catch (error) {
          set({ audioError: audioFailure(error) });
          return;
        }
        const playing = state.playing;
        const q = nextBar(state.beat, playing);
        const launched: Record<string, LaunchState> = { ...state.launched };
        for (const track of state.project.tracks) {
          const clip = track.clips[scene];
          if (clip) {
            const sounding = playing ? soundingOf(state.launched[track.id], state.beat) : null;
            launched[track.id] = {
              clipIndex: scene,
              launchBeat: q,
              previous: sounding && sounding.clipIndex !== scene ? sounding : undefined,
            };
          } else if (state.launched[track.id]) {
            const sounding = playing ? soundingOf(state.launched[track.id], state.beat) : null;
            if (sounding) launched[track.id] = { clipIndex: -1, launchBeat: q, previous: sounding };
            else delete launched[track.id];
          }
        }
        set({
          launched,
          selectedScene: scene,
          playing: true,
          follow: "session",
          audioError: null,
        });
        if (!playing) {
          engine.sync(snap(get()));
          engine.start(get().beat);
        }
      },

      returnToSong: () => set({ launched: {}, follow: "arrange" }),

      selectTrack: (trackId) => set({ selectedTrackId: trackId }),

      setVolume: (trackId, volume) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({ ...t, volume: clamp(volume, 0, 1) })),
        })),

      setPan: (trackId, pan) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({ ...t, pan: clamp(pan, -1, 1) })),
        })),

      toggleMute: (trackId) =>
        set((s) => ({ project: mapTracks(s.project, trackId, (t) => ({ ...t, mute: !t.mute })) })),

      toggleSolo: (trackId) =>
        set((s) => ({ project: mapTracks(s.project, trackId, (t) => ({ ...t, solo: !t.solo })) })),

      updateDevice: (trackId, patch) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({
            ...t,
            device: { ...t.device, ...patch },
          })),
        })),

      renameProject: (name) =>
        set((s) => ({ project: { ...s.project, name: name.slice(0, 40) || "Untitled" } })),

      renameScene: (index, name) =>
        set((s) => ({
          project: {
            ...s.project,
            scenes: s.project.scenes.map((scene, i) =>
              i === index ? { ...scene, name: name.slice(0, 24) || scene.name } : scene,
            ),
          },
        })),

      renameTrack: (trackId, name) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({
            ...t,
            name: name.slice(0, 24) || t.name,
          })),
        })),

      addTrack: (kind) =>
        set((s) => {
          if (s.project.tracks.length >= 32)
            return { audioError: "This studio supports up to 32 tracks." };
          const count = s.project.tracks.filter((t) => t.kind === kind).length + 1;
          const labels: Record<TrackKind, string> = {
            drums: "Drums",
            bass: "Bass",
            keys: "Keys",
            lead: "Lead",
            sample: "Audio",
          };
          const id = uid("trk");
          const track: Track = {
            id,
            name: count > 1 ? `${labels[kind]} ${count}` : labels[kind],
            kind,
            color: CLIP_COLORS[s.project.tracks.length % CLIP_COLORS.length] ?? "ember",
            volume: kind === "drums" ? 0.84 : kind === "sample" ? 0.8 : 0.65,
            pan: 0,
            mute: false,
            solo: false,
            clips: s.project.scenes.map(() => null),
            arrangement: [],
            device: defaultDevice(kind),
          };
          return {
            project: { ...s.project, tracks: [...s.project.tracks, track] },
            selectedTrackId: id,
          };
        }),

      addAudioTrack: async (data, name) => {
        if (get().project.tracks.length >= 32)
          throw new Error("This studio supports up to 32 tracks.");
        const id = uid("trk");
        await engine.loadSample(id, data);
        const state = get();
        const length = Math.min(
          512,
          Math.max(0.25, (engine.duration(id) * state.project.bpm) / 60),
        );
        const color = CLIP_COLORS[state.project.tracks.length % CLIP_COLORS.length] ?? "sage";
        const clip: Clip = { id: uid("clip"), name, color, length, notes: [] };
        const track: Track = {
          id,
          name: name.slice(0, 24),
          kind: "sample",
          color,
          volume: 0.8,
          pan: 0,
          mute: false,
          solo: false,
          device: { ...defaultDevice("sample"), sampleLoop: false },
          clips: state.project.scenes.map((_, index) => (index === 0 ? clip : null)),
          arrangement: [{ ...clip, id: uid("arr"), start: 0, patternLength: length }],
        };
        set((s) => ({
          project: {
            ...s.project,
            bars: Math.max(s.project.bars, Math.ceil(length / 4)),
            tracks: [...s.project.tracks, track],
          },
          selectedTrackId: id,
          selectedSlot: { trackId: id, scene: 0 },
        }));
      },

      removeTrack: (trackId) =>
        set((s) => {
          if (s.project.tracks.length <= 1) return s;
          const tracks = s.project.tracks.filter((t) => t.id !== trackId);
          const launched = { ...s.launched };
          delete launched[trackId];
          const selectedTrackId = s.selectedTrackId === trackId ? tracks[0]!.id : s.selectedTrackId;
          return {
            project: { ...s.project, tracks },
            launched,
            selectedTrackId,
            selectedSlot: s.selectedSlot?.trackId === trackId ? null : s.selectedSlot,
          };
        }),

      duplicateTrack: async (trackId) => {
        const state = get();
        const source = state.project.tracks.find((track) => track.id === trackId);
        if (!source) throw new Error("Select a track to duplicate.");
        if (state.project.tracks.length >= 32)
          throw new Error("This studio supports up to 32 tracks.");
        const id = uid("trk");
        if (source.kind === "sample") {
          const data = await idbGet(trackId);
          if (!data) throw new Error("The track's audio is missing.");
          await engine.loadSample(id, data);
        }
        const copy: Track = {
          ...source,
          id,
          name: `${source.name} copy`.slice(0, 24),
          device: { ...source.device },
          clips: source.clips.map((clip) =>
            clip
              ? { ...clip, id: uid("clip"), notes: clip.notes.map((n) => ({ ...n, id: uid("n") })) }
              : null,
          ),
          arrangement: source.arrangement.map((clip) => ({
            ...clip,
            id: uid("arr"),
            notes: clip.notes.map((n) => ({ ...n, id: uid("n") })),
          })),
        };
        set((s) => ({
          project: { ...s.project, tracks: [...s.project.tracks, copy] },
          selectedTrackId: id,
        }));
      },
      reorderTrack: (trackId, direction) =>
        set((s) => {
          const tracks = [...s.project.tracks];
          const index = tracks.findIndex((track) => track.id === trackId);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= tracks.length) return s;
          [tracks[index], tracks[target]] = [tracks[target]!, tracks[index]!];
          return { project: { ...s.project, tracks } };
        }),
      addRegion: (trackId, patternId, start) =>
        set((s) => {
          const pattern = PATTERNS.find((item) => item.id === patternId);
          const track = s.project.tracks.find((item) => item.id === trackId);
          if (!pattern || !track || pattern.kind !== track.kind)
            return { audioError: "Choose a pattern matching the track's instrument." };
          const region: ArrangeClip = fitRegion(
            {
              id: uid("arr"),
              name: pattern.name,
              color: track.color,
              start: quantize(start, 0.25),
              length: 16,
              patternLength: pattern.length,
              notes: pattern.notes.map((note) => ({ ...note, id: uid("n") })),
            },
            s.project.bars,
          );
          return {
            project: mapTracks(s.project, trackId, (t) => ({
              ...t,
              arrangement: [...t.arrangement, region],
            })),
          };
        }),
      updateRegion: (trackId, clipId, patch) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({
            ...t,
            arrangement: t.arrangement.map((clip) =>
              clip.id === clipId ? fitRegion({ ...clip, ...patch }, s.project.bars) : clip,
            ),
          })),
        })),
      splitArrangeClip: (trackId, clipId, beat) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({
            ...t,
            arrangement: t.arrangement.flatMap((clip) =>
              clip.id === clipId ? splitRegion(clip, quantize(beat, 0.25), uid("arr")) : [clip],
            ),
          })),
        })),
      duplicateArrangeClip: (trackId, clipId) =>
        set((s) => {
          const clip = s.project.tracks
            .find((t) => t.id === trackId)
            ?.arrangement.find((c) => c.id === clipId);
          if (!clip) return s;
          const end = clip.start + clip.length * 2;
          if (end > 512)
            return { audioError: "The duplicate would exceed the 128-bar song limit." };
          return {
            project: mapTracks(
              { ...s.project, bars: Math.max(s.project.bars, Math.ceil(end / 4)) },
              trackId,
              (t) => ({
                ...t,
                arrangement: [
                  ...t.arrangement,
                  {
                    ...clip,
                    id: uid("arr"),
                    start: clip.start + clip.length,
                    notes: clip.notes.map((n) => ({ ...n, id: uid("n") })),
                  },
                ],
              }),
            ),
          };
        }),

      insertPattern: (trackId, scene, patternId) => {
        const pattern = PATTERNS.find((p) => p.id === patternId);
        const track = get().project.tracks.find((t) => t.id === trackId);
        if (!pattern || !track) return;
        const notes = pattern.notes.map((note) => ({ ...note, id: uid("n") }));
        const next: Clip = {
          id: uid("clip"),
          name: pattern.name,
          color: track.color,
          length: pattern.length,
          notes,
        };
        set((s) => ({
          project: patchClip(s.project, trackId, scene, next),
          selectedSlot: { trackId, scene },
          selectedTrackId: trackId,
          selectedScene: scene,
        }));
      },

      clearClip: (trackId, scene) =>
        set((s) => {
          const launch = s.launched[trackId];
          const launched = { ...s.launched };
          if (launch && (launch.clipIndex === scene || launch.previous?.clipIndex === scene)) {
            delete launched[trackId];
          }
          return { project: patchClip(s.project, trackId, scene, null), launched };
        }),

      duplicateClip: (trackId, scene) =>
        set((s) => {
          const track = s.project.tracks.find((t) => t.id === trackId);
          const source = track?.clips[scene];
          const nextScene = scene + 1;
          if (!track || !source || nextScene >= s.project.scenes.length) return s;
          const copy: Clip = {
            ...source,
            id: uid("clip"),
            notes: source.notes.map((note) => ({ ...note, id: uid("n") })),
          };
          return { project: patchClip(s.project, trackId, nextScene, copy) };
        }),

      toggleStep: (trackId, scene, pitch, step) =>
        set((s) => {
          const track = s.project.tracks.find((t) => t.id === trackId);
          const clip = track?.clips[scene];
          if (!track || !clip) return s;
          const start = quantize(step * 0.25, 0.25);
          const existing = clip.notes.find(
            (note) => note.pitch === pitch && Math.abs(note.start - start) < 0.02,
          );
          const notes: Note[] = existing
            ? clip.notes.filter((note) => note !== existing)
            : [
                ...clip.notes,
                {
                  id: uid("n"),
                  pitch,
                  start,
                  duration: track.kind === "drums" ? 0.12 : 0.22,
                  velocity: 0.88,
                },
              ];
          const next: Clip = { ...clip, notes };
          return { project: patchClip(s.project, trackId, scene, next) };
        }),

      setClipLength: (trackId, scene, beats) =>
        set((s) => {
          const track = s.project.tracks.find((t) => t.id === trackId);
          const clip = track?.clips[scene];
          if (!clip) return s;
          const next: Clip = {
            ...clip,
            length: beats,
            notes: clip.notes.filter((note) => note.start < beats),
          };
          return { project: patchClip(s.project, trackId, scene, next) };
        }),

      noteOn: async (pitch) => {
        const state = get();
        try {
          await engine.ensure();
        } catch (error) {
          set({ audioError: audioFailure(error) });
          return;
        }
        engine.sync(snap(get()));
        const track = get().project.tracks.find((t) => t.id === state.selectedTrackId);
        if (!track || track.kind === "sample") return;
        engine.previewDown(track.id, pitch, 0.9);
        if (!state.recording) return;
        let playing = get().playing;
        if (!playing) {
          set({ playing: true, follow: "session" });
          engine.sync(snap(get()));
          engine.start(get().beat);
          playing = true;
        }
        let project = get().project;
        let launched = { ...get().launched };
        let live = project.tracks.find((t) => t.id === track.id)!;
        if (!live.clips[state.selectedScene]) {
          const created = makeClip(live, "Take");
          project = patchClip(project, live.id, state.selectedScene, created);
          live = project.tracks.find((t) => t.id === track.id)!;
        }
        const bar = Math.floor(engine.currentBeat() / 4) * 4;
        if (!launched[live.id] || launched[live.id]!.clipIndex < 0) {
          launched = {
            ...launched,
            [live.id]: { clipIndex: state.selectedScene, launchBeat: bar },
          };
        }
        set({
          project,
          launched,
          pending: { ...get().pending, [String(pitch)]: engine.currentBeat() },
        });
        if (live.kind === "drums") get().noteOff(pitch);
      },

      noteOff: (pitch) => {
        const state = get();
        const track = state.project.tracks.find((t) => t.id === state.selectedTrackId);
        if (!track) return;
        engine.previewUp(track.id, pitch);
        const startAbs = state.pending[String(pitch)];
        if (startAbs == null || !state.recording) {
          if (startAbs != null) {
            const pending = { ...state.pending };
            delete pending[String(pitch)];
            set({ pending });
          }
          return;
        }
        const launch = state.launched[track.id];
        const clip = launch && launch.clipIndex >= 0 ? track.clips[launch.clipIndex] : null;
        const pending = { ...state.pending };
        delete pending[String(pitch)];
        if (!clip || !launch) {
          set({ pending });
          return;
        }
        const endAbs = Math.max(startAbs + 0.12, engine.currentBeat());
        let rel = startAbs - launch.launchBeat;
        rel = ((rel % clip.length) + clip.length) % clip.length;
        const start = quantize(rel, 0.25) % clip.length;
        let duration = quantize(Math.max(0.12, endAbs - startAbs), 0.25);
        if (duration < 0.12) duration = track.kind === "drums" ? 0.12 : 0.25;
        if (start + duration > clip.length) duration = Math.max(0.12, clip.length - start);
        const notes = clip.notes.filter(
          (note) => !(note.pitch === pitch && Math.abs(note.start - start) < 0.02),
        );
        notes.push({ id: uid("n"), pitch, start, duration, velocity: 0.9 });
        const next: Clip = { ...clip, notes };
        set({ pending, project: patchClip(state.project, track.id, launch.clipIndex, next) });
      },

      captureScene: () =>
        set((s) => {
          const bar = Math.floor(s.beat / 4) * 4;
          const room = Math.max(4, s.project.bars * 4 - bar);
          const span = Math.min(16, room);
          const tracks = s.project.tracks.map((track) => {
            const clip = track.clips[s.selectedScene];
            if (!clip) return track;
            const placed: ArrangeClip = {
              id: uid("arr"),
              name: clip.name,
              color: clip.color,
              start: bar,
              length: span,
              patternLength: clip.length,
              notes: clip.notes.map((note) => ({ ...note, id: uid("n") })),
            };
            const arrangement = track.arrangement.filter(
              (item) => item.start + item.length <= bar || item.start >= bar + span,
            );
            arrangement.push(placed);
            arrangement.sort((a, b) => a.start - b.start);
            return { ...track, arrangement };
          });
          return { project: { ...s.project, tracks }, view: "arrange", follow: "arrange" };
        }),

      moveArrangeClip: (trackId, clipId, start) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (track) => ({
            ...track,
            arrangement: track.arrangement.map((clip) =>
              clip.id === clipId
                ? {
                    ...clip,
                    start: clamp(quantize(start, 0.25), 0, s.project.bars * 4 - clip.length),
                  }
                : clip,
            ),
          })),
        })),

      deleteArrangeClip: (trackId, clipId) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (track) => ({
            ...track,
            arrangement: track.arrangement.filter((clip) => clip.id !== clipId),
          })),
        })),

      newSet: () => {
        engine.pause();
        const project = createEmptyProject();
        set({
          project,
          launched: {},
          playing: false,
          recording: false,
          beat: 0,
          follow: "arrange",
          view: "arrange",
          selectedTrackId: project.tracks[0]!.id,
          selectedScene: 0,
          selectedSlot: null,
          pending: {},
        });
      },

      resetDemo: () => {
        engine.pause();
        const project = createDemoProject();
        set({
          project,
          launched: {},
          playing: false,
          recording: false,
          beat: 0,
          follow: "arrange",
          view: "arrange",
          selectedTrackId: project.tracks[0]!.id,
          selectedScene: 1,
          selectedSlot: { trackId: project.tracks[0]!.id, scene: 1 },
          pending: {},
          hintDismissed: false,
        });
      },

      onArrangeLoop: () => {
        const launched: Record<string, LaunchState> = {};
        for (const [id, launch] of Object.entries(get().launched)) {
          if (launch.clipIndex >= 0) launched[id] = { clipIndex: launch.clipIndex, launchBeat: 0 };
        }
        set({ launched, beat: 0 });
      },

      bumpSamples: () => set((s) => ({ sampleRev: s.sampleRev + 1 })),

      ensureClip: (trackId, scene, name) =>
        set((s) => {
          const track = s.project.tracks.find((t) => t.id === trackId);
          if (!track || track.clips[scene]) return s;
          return {
            project: patchClip(s.project, trackId, scene, makeClip(track, name)),
            selectedSlot: { trackId, scene },
            selectedTrackId: trackId,
            selectedScene: scene,
          };
        }),

      saveProject: async () => {
        const project = get().project;
        const samples: Record<string, string> = {};
        for (const track of project.tracks.filter((t) => t.kind === "sample")) {
          const data = await idbGet(track.id);
          if (!data) {
            if (track.arrangement.length || track.clips.some(Boolean))
              throw new Error(
                `Audio is missing for ${track.name}. Reimport it before saving a portable project.`,
              );
            continue;
          }
          const bytes = new Uint8Array(data);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          samples[track.id] = btoa(binary);
        }
        const blob = new Blob(
          [JSON.stringify({ format: "kiln-project", version: 1, project, samples })],
          { type: "application/json" },
        );
        if (blob.size > 200_000_000)
          throw new Error(
            "This portable project exceeds 200 MB. Use fewer or smaller audio sources before downloading.",
          );
        downloadBlob(blob, `${project.name}.kiln`);
      },
      openProject: async (file) => {
        if (file.size > 200_000_000) throw new Error("Project files must be smaller than 200 MB.");
        const parsed = projectFileSchema.safeParse(JSON.parse(await file.text()));
        if (!parsed.success)
          throw new Error(
            `Invalid KILN project: ${parsed.error.issues[0]?.message ?? "Unsupported format"}`,
          );
        const { project, samples } = parsed.data;
        const remapped: Track[] = [];
        const prepared: Array<[string, ArrayBuffer]> = [];
        const ctx = new AudioContext();
        try {
          for (const track of project.tracks) {
            const id = uid("trk");
            const data = samples[track.id];
            if (
              track.kind === "sample" &&
              !data &&
              (track.arrangement.length || track.clips.some(Boolean))
            )
              throw new Error(`Project is missing audio for ${track.name}.`);
            if (data && track.kind === "sample") {
              const binary = atob(data);
              const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
              await ctx.decodeAudioData(bytes.buffer.slice(0));
              prepared.push([id, bytes.buffer]);
            }
            remapped.push({ ...track, id });
          }
        } finally {
          await ctx.close();
        }
        if (prepared.length) await idbPutMany(prepared);
        engine.pause();
        set({
          project: { ...project, tracks: remapped },
          launched: {},
          playing: false,
          recording: false,
          beat: 0,
          follow: "arrange",
          view: "arrange",
          selectedTrackId: remapped[0]!.id,
          selectedSlot: null,
          pending: {},
        });
        engine.sync(snap(get()));
        await engine.restoreSamples();
      },
      exportSong: async (options) => {
        await engine.ensure();
        const settings: ExportOptions = options ?? {
          format: "wav",
          bitrate: 192,
          source: "arrange",
          startBar: 1,
          endBar: get().project.bars,
          tail: true,
        };
        const blob = await engine.bounce(snap(get()), settings);
        downloadBlob(
          blob,
          `${get().project.name.replace(/\s+/g, "-").toLowerCase()}.${settings.format}`,
        );
      },
    }),
    {
      name: "kiln-studio-v1",
      skipHydration: true,
      onRehydrateStorage: () => (_state, error) => {
        if (error)
          queueMicrotask(() =>
            useStudio.setState({
              audioError:
                "Auto-saved project could not be read. Open a portable project backup to recover your song.",
            }),
          );
      },
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : browserStorage,
      ),
      partialize: (s) => ({
        project: s.project,
        hintDismissed: s.hintDismissed,
        metronome: s.metronome,
      }),
      merge: (persisted, current) => {
        const saved = persisted as
          Partial<Pick<StudioState, "project" | "hintDismissed" | "metronome">> | undefined;
        if (!saved?.project) return current;
        const parsed = projectSchema.safeParse(saved.project);
        if (!parsed.success)
          return {
            ...current,
            audioError:
              "Auto-saved project is invalid. Open a portable project backup to recover your song.",
          };
        return {
          ...current,
          project: parsed.data,
          hintDismissed: !!saved.hintDismissed,
          metronome: !!saved.metronome,
          selectedTrackId: saved.project.tracks[0]!.id,
          selectedScene: Math.min(1, saved.project.scenes.length - 1),
          selectedSlot: null,
        };
      },
    },
  ),
);

if (typeof window !== "undefined") {
  engine.setHooks({
    onBeat: (beat) => useStudio.getState().setBeat(beat),
    onLoop: () => useStudio.getState().onArrangeLoop(),
    onSamples: () => useStudio.getState().bumpSamples(),
  });
  useStudio.subscribe((state, prev) => {
    if (state.project !== prev.project && !restoringHistory) {
      const past =
        groupingHistory && groupRecorded ? state.past : [...state.past.slice(-79), prev.project];
      groupRecorded = groupingHistory;
      useStudio.setState({ past, future: [] });
    }
    if (
      state.project !== prev.project ||
      state.launched !== prev.launched ||
      state.metronome !== prev.metronome ||
      state.follow !== prev.follow
    ) {
      engine.sync(snap(state));
    }
  });
  engine.sync(snap(useStudio.getState()));
}

export function phaseFor(
  trackId: string,
  scene: number,
  beat: number,
  launched: Record<string, LaunchState>,
  project: Project,
): number {
  const launch = launched[trackId];
  const idx = audibleIndex(launch, beat);
  if (idx !== scene || !launch) return -1;
  const clip = project.tracks.find((t) => t.id === trackId)?.clips[scene];
  if (!clip || clip.length <= 0) return -1;
  const origin =
    beat < launch.launchBeat && launch.previous ? launch.previous.launchBeat : launch.launchBeat;
  const rel = (((beat - origin) % clip.length) + clip.length) % clip.length;
  return rel / clip.length;
}
