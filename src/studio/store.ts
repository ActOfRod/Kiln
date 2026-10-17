import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ArrangeClip, Clip, Device, Follow, LaunchState, Note, Project, StudioView, Track, TrackKind } from "./types";
import { CLIP_COLORS, createDemoProject, createEmptyProject, defaultDevice, PATTERNS } from "./factory";
import { engine, type Snapshot } from "./engine";
import { clamp, nextBar, quantize, uid } from "./theory";

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
  exportSong: () => Promise<void>;
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
  return { ...project, tracks: project.tracks.map((track) => (track.id === trackId ? fn(track) : track)) };
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

function soundingOf(launch: LaunchState | undefined, beat: number): { clipIndex: number; launchBeat: number } | null {
  if (!launch) return null;
  const idx = audibleIndex(launch, beat);
  if (idx == null) return null;
  if (beat < launch.launchBeat && launch.previous) return launch.previous;
  return { clipIndex: launch.clipIndex, launchBeat: launch.launchBeat };
}

function sceneLaunch(project: Project, scene: number, beat: number, playing: boolean): Record<string, LaunchState> {
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

const memoryStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      project: demo,
      launched: {},
      follow: "session",
      view: "session",
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
        set((s) => ({ project: { ...s.project, bpm: Math.round(clamp(bpm, 60, 190)) } })),

      setSwing: (swing) => set((s) => ({ project: { ...s.project, swing: clamp(swing, 0, 0.6) } })),

      setBars: (bars) => set((s) => ({ project: { ...s.project, bars } })),

      setMaster: (master) => set((s) => ({ project: { ...s.project, master: clamp(master, 0, 1) } })),

      toggleMetronome: () => set((s) => ({ metronome: !s.metronome })),

      togglePlay: async () => {
        const state = get();
        try {
          await engine.ensure();
        } catch {
          set({ audioError: "This browser blocked audio. Tap again to wake it." });
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
          if (!audible) launched = sceneLaunch(state.project, state.selectedScene, state.beat, false);
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
        const select = { selectedTrackId: trackId, selectedScene: scene, selectedSlot: { trackId, scene } };
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
        } catch {
          set({ audioError: "This browser blocked audio. Tap again to wake it." });
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
        } catch {
          set({ audioError: "This browser blocked audio. Tap again to wake it." });
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
        set((s) => ({ project: mapTracks(s.project, trackId, (t) => ({ ...t, volume: clamp(volume, 0, 1) })) })),

      setPan: (trackId, pan) =>
        set((s) => ({ project: mapTracks(s.project, trackId, (t) => ({ ...t, pan: clamp(pan, -1, 1) })) })),

      toggleMute: (trackId) =>
        set((s) => ({ project: mapTracks(s.project, trackId, (t) => ({ ...t, mute: !t.mute })) })),

      toggleSolo: (trackId) =>
        set((s) => ({ project: mapTracks(s.project, trackId, (t) => ({ ...t, solo: !t.solo })) })),

      updateDevice: (trackId, patch) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({ ...t, device: { ...t.device, ...patch } })),
        })),

      renameProject: (name) => set((s) => ({ project: { ...s.project, name: name.slice(0, 40) || "Untitled" } })),

      renameScene: (index, name) =>
        set((s) => ({
          project: {
            ...s.project,
            scenes: s.project.scenes.map((scene, i) => (i === index ? { ...scene, name: name.slice(0, 24) || scene.name } : scene)),
          },
        })),

      renameTrack: (trackId, name) =>
        set((s) => ({
          project: mapTracks(s.project, trackId, (t) => ({ ...t, name: name.slice(0, 24) || t.name })),
        })),

      addTrack: (kind) =>
        set((s) => {
          if (s.project.tracks.length >= 8) return s;
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
          const existing = clip.notes.find((note) => note.pitch === pitch && Math.abs(note.start - start) < 0.02);
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
        } catch {
          set({ audioError: "This browser blocked audio. Tap again to wake it." });
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
          launched = { ...launched, [live.id]: { clipIndex: state.selectedScene, launchBeat: bar } };
        }
        set({ project, launched, pending: { ...get().pending, [String(pitch)]: engine.currentBeat() } });
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
        const notes = clip.notes.filter((note) => !(note.pitch === pitch && Math.abs(note.start - start) < 0.02));
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
              clip.id === clipId ? { ...clip, start: Math.max(0, Math.round(start / 4) * 4) } : clip,
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
          follow: "session",
          view: "session",
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
          follow: "session",
          view: "session",
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

      exportSong: async () => {
        await engine.ensure();
        const blob = await engine.bounce(snap(get()));
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${get().project.name.replace(/\s+/g, "-").toLowerCase()}.wav`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
    }),
    {
      name: "kiln-studio-v1",
      skipHydration: true,
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : localStorage)),
      partialize: (s) => ({
        project: s.project,
        hintDismissed: s.hintDismissed,
        metronome: s.metronome,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<Pick<StudioState, "project" | "hintDismissed" | "metronome">> | undefined;
        if (!saved?.project?.tracks?.length || !saved.project.scenes?.length) return current;
        return {
          ...current,
          project: saved.project,
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

export function phaseFor(trackId: string, scene: number, beat: number, launched: Record<string, LaunchState>, project: Project): number {
  const launch = launched[trackId];
  const idx = audibleIndex(launch, beat);
  if (idx !== scene || !launch) return -1;
  const clip = project.tracks.find((t) => t.id === trackId)?.clips[scene];
  if (!clip || clip.length <= 0) return -1;
  const origin = beat < launch.launchBeat && launch.previous ? launch.previous.launchBeat : launch.launchBeat;
  const rel = (((beat - origin) % clip.length) + clip.length) % clip.length;
  return rel / clip.length;
}
