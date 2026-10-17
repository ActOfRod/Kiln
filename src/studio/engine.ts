import type { Follow, LaunchState, Note, Project, Track } from "./types";
import { clamp } from "./theory";
import { computePeaks, idbDel, idbGet, idbPut, sampleBank, samplePeaks } from "./samples";
import {
  buildGraph,
  driveCurve,
  levelOf,
  makeImpulse,
  startSustain,
  triggerDrum,
  triggerTonal,
  type SustainVoice,
  type TrackGraph,
} from "./voices";

export interface Snapshot {
  project: Project;
  launched: Record<string, LaunchState>;
  follow: Follow;
  metronome: boolean;
}

interface Hooks {
  onBeat?: (beat: number) => void;
  onLoop?: () => void;
  onSamples?: () => void;
}

class Performer {
  ctx: BaseAudioContext;
  snap: Snapshot;
  bpm = 120;
  metronome = false;
  offline: boolean;
  running = false;
  frozenBeat = 0;
  originTime = 0;
  originBeat = 0;
  scheduledUntil = 0;
  impulse: AudioBuffer;
  master: GainNode;
  graphs = new Map<string, TrackGraph>();
  builtIds = "";
  voices: AudioScheduledSourceNode[] = [];
  previews = new Map<string, SustainVoice | { nodes: AudioScheduledSourceNode[] }>();
  frame = 0;
  hooks: Hooks = {};
  masterMeter: AnalyserNode;
  masterBuf: Uint8Array<ArrayBuffer>;

  constructor(ctx: BaseAudioContext, dest: AudioNode, snap: Snapshot, offline: boolean) {
    this.ctx = ctx;
    this.snap = snap;
    this.offline = offline;
    this.bpm = snap.project.bpm;
    this.metronome = snap.metronome;
    this.impulse = makeImpulse(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 16;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.masterMeter = ctx.createAnalyser();
    this.masterMeter.fftSize = 256;
    this.masterBuf = new Uint8Array(new ArrayBuffer(this.masterMeter.fftSize));
    this.master.connect(comp);
    comp.connect(this.masterMeter);
    this.masterMeter.connect(dest);
    this.rebuild();
    this.apply(true);
  }

  currentBeat(): number {
    if (!this.running || !(this.ctx instanceof AudioContext)) return this.frozenBeat;
    return (this.ctx.currentTime - this.originTime) * (this.bpm / 60) + this.originBeat;
  }

  beatToTime(beat: number): number {
    return this.originTime + (beat - this.originBeat) * (60 / this.bpm);
  }

  update(snap: Snapshot) {
    const nextBpm = snap.project.bpm;
    if (!this.offline && this.running && nextBpm !== this.bpm && this.ctx instanceof AudioContext) {
      const beat = this.currentBeat();
      this.bpm = nextBpm;
      this.originBeat = beat;
      this.originTime = this.ctx.currentTime;
    } else {
      this.bpm = nextBpm;
    }
    this.snap = snap;
    this.metronome = snap.metronome;
    this.rebuild();
    this.apply(false);
  }

  rebuild() {
    const ids = this.snap.project.tracks.map((t) => t.id).join("|");
    if (ids === this.builtIds) return;
    this.stopVoices();
    for (const graph of this.graphs.values()) graph.input.disconnect();
    this.graphs.clear();
    for (const track of this.snap.project.tracks) {
      this.graphs.set(track.id, buildGraph(this.ctx, this.master, this.impulse));
    }
    this.builtIds = ids;
  }

  apply(immediate: boolean) {
    const now = this.ctx.currentTime;
    const anySolo = this.snap.project.tracks.some((t) => t.solo);
    const master = clamp(this.snap.project.master, 0, 1);
    this.master.gain.value = master;
    for (const track of this.snap.project.tracks) {
      const graph = this.graphs.get(track.id);
      if (!graph) continue;
      const audible = !track.mute && (!anySolo || track.solo);
      const vol = audible ? track.volume ** 1.45 : 0;
      const cutoff =
        track.kind === "drums" || track.kind === "sample" ? clamp(track.device.cutoff, 80, 16000) : 15000;
      if (immediate || this.offline) {
        graph.gain.gain.value = vol;
        graph.panner.pan.value = track.pan;
        graph.filter.frequency.value = cutoff;
        graph.filter.Q.value = track.kind === "drums" ? track.device.resonance : 0.7;
        graph.delay.delayTime.value = Math.min(1.5, (60 / this.bpm) * track.device.delayDivision);
        graph.delayMix.gain.value = track.device.delayMix;
        graph.reverbMix.gain.value = track.device.reverb;
      } else {
        graph.gain.gain.setTargetAtTime(vol, now, 0.02);
        graph.panner.pan.setTargetAtTime(track.pan, now, 0.02);
        graph.filter.frequency.setTargetAtTime(cutoff, now, 0.02);
        graph.filter.Q.setTargetAtTime(track.kind === "drums" ? track.device.resonance : 0.7, now, 0.02);
        graph.delay.delayTime.setTargetAtTime(Math.min(1.5, (60 / this.bpm) * track.device.delayDivision), now, 0.03);
        graph.delayMix.gain.setTargetAtTime(track.device.delayMix, now, 0.02);
        graph.reverbMix.gain.setTargetAtTime(track.device.reverb, now, 0.02);
      }
      graph.drive.curve = driveCurve(track.device.drive);
    }
  }

  audible(track: Track): boolean {
    if (track.mute) return false;
    const anySolo = this.snap.project.tracks.some((t) => t.solo);
    return !anySolo || track.solo;
  }

  start(fromBeat: number) {
    if (!(this.ctx instanceof AudioContext)) return;
    this.running = true;
    this.originBeat = fromBeat;
    this.originTime = this.ctx.currentTime + 0.06;
    this.scheduledUntil = fromBeat;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.loop);
  }

  pause(): number {
    if (this.running) this.frozenBeat = this.currentBeat();
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.stopVoices();
    return this.frozenBeat;
  }

  loop = () => {
    if (!this.running) return;
    const end = this.snap.project.bars * 4;
    if (this.snap.follow === "arrange" && this.currentBeat() >= end) {
      this.stopVoices();
      this.originBeat = 0;
      this.originTime = this.ctx instanceof AudioContext ? this.ctx.currentTime + 0.02 : 0;
      this.scheduledUntil = 0;
      this.hooks.onLoop?.();
    }
    const horizon = this.currentBeat() + (this.bpm / 60) * 0.22;
    if (horizon > this.scheduledUntil) {
      this.schedule(this.scheduledUntil, horizon);
      this.scheduledUntil = horizon;
    }
    this.hooks.onBeat?.(this.currentBeat());
    this.frame = requestAnimationFrame(this.loop);
  };

  scheduleAll(from: number, to: number) {
    this.originBeat = 0;
    this.originTime = 0;
    this.schedule(from, to);
  }

  schedule(from: number, to: number) {
    if (!this.offline && this.metronome) this.scheduleClicks(from, to);
    for (const track of this.snap.project.tracks) {
      this.scheduleTrack(track, from, to);
    }
  }

  scheduleClicks(from: number, to: number) {
    const first = Math.ceil(from - 1e-8);
    for (let beat = first; beat < to; beat++) {
      const t = this.beatToTime(beat);
      if (t < this.ctx.currentTime - 0.02) continue;
      this.click(t, beat % 4 === 0);
    }
  }

  click(time: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1760 : 1180;
    gain.gain.setValueAtTime(accent ? 0.12 : 0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.04);
    this.keep(osc);
  }

  scheduleTrack(track: Track, from: number, to: number) {
    const launch = this.snap.launched[track.id];
    if (this.snap.follow === "session") {
      this.scheduleSession(track, launch, from, to);
      return;
    }
    if (!launch) {
      this.scheduleArrangement(track, from, to);
      return;
    }
    const q = launch.launchBeat;
    if (from < q) {
      if (launch.previous) this.scheduleSession(track, launch, from, Math.min(to, q));
      else this.scheduleArrangement(track, from, Math.min(to, q));
    }
    if (to > q) {
      if (launch.clipIndex >= 0) this.scheduleSession(track, launch, Math.max(from, q), to);
      else this.scheduleArrangement(track, Math.max(from, q), to);
    }
  }

  scheduleSession(track: Track, launch: LaunchState | undefined, from: number, to: number) {
    if (!launch || to <= from) return;
    const q = launch.launchBeat;
    if (launch.previous && from < q) {
      this.playClip(track, launch.previous.clipIndex, launch.previous.launchBeat, from, Math.min(to, q));
    }
    if (launch.clipIndex >= 0 && to > q) {
      this.playClip(track, launch.clipIndex, q, Math.max(from, q), to);
    }
  }

  playClip(track: Track, clipIndex: number, origin: number, from: number, to: number) {
    if (clipIndex < 0 || to <= from) return;
    const clip = track.clips[clipIndex];
    if (!clip) return;
    const windowFrom = Math.max(from, origin);
    if (to <= windowFrom) return;
    this.schedulePattern(track, clip.notes, clip.length, origin, windowFrom, to);
  }

  scheduleArrangement(track: Track, from: number, to: number) {
    for (const clip of track.arrangement) {
      const end = clip.start + clip.length;
      const a = Math.max(from, clip.start);
      const b = Math.min(to, end);
      if (b <= a) continue;
      this.schedulePattern(track, clip.notes, clip.patternLength, clip.start, a, b);
    }
  }

  schedulePattern(track: Track, notes: Note[], patternLength: number, origin: number, from: number, to: number) {
    const len = Math.max(0.25, patternLength);
    let i = Math.floor((from - origin) / len) - 1;
    const last = Math.floor((to - origin) / len) + 1;
    if (last - i > 128) return;
    for (; i <= last; i++) {
      const base = origin + i * len;
      if (base + len <= from || base >= to) continue;
      if (track.kind === "sample") {
        if (base >= from && base < to && base >= origin - 1e-6) this.playSample(track, base, len);
        continue;
      }
      for (const note of notes) {
        if (note.start < 0 || note.start >= len) continue;
        const beat = base + note.start;
        if (beat < from || beat >= to || beat < origin - 1e-6) continue;
        const t = this.beatToTime(beat) + this.swingSec(note.start);
        if (!this.offline && t < this.ctx.currentTime - 0.03) continue;
        this.fire(track, note, t);
      }
    }
  }

  swingSec(start: number): number {
    const swing = this.snap.project.swing;
    if (swing <= 0) return 0;
    const six = start * 4;
    const nearest = Math.round(six);
    if (Math.abs(six - nearest) > 0.04) return 0;
    if (nearest % 2 === 0) return 0;
    return swing * (60 / this.bpm / 4) * 0.9;
  }

  fire(track: Track, note: Note, time: number) {
    if (!this.audible(track)) return;
    const graph = this.graphs.get(track.id);
    if (!graph) return;
    try {
      const nodes =
        track.kind === "drums"
          ? triggerDrum(this.ctx, graph.input, note.pitch, time, note.velocity)
          : triggerTonal(this.ctx, graph.input, track, note.pitch, time, note.duration, note.velocity);
      for (const node of nodes) this.keep(node);
    } catch {
      /* skip a bad voice rather than halt the clock */
    }
  }

  playSample(track: Track, beat: number, patternBeats: number) {
    const buffer = sampleBank.get(track.id);
    const graph = this.graphs.get(track.id);
    if (!buffer || !graph || !this.audible(track)) return;
    const t = this.beatToTime(beat);
    if (!this.offline && t < this.ctx.currentTime - 0.03) return;
    const offset = clamp(track.device.sampleOffset, 0, Math.max(0, buffer.duration - 0.05));
    const end =
      track.device.sampleEnd > 0.05
        ? clamp(track.device.sampleEnd, offset + 0.05, buffer.duration)
        : buffer.duration;
    const playDur = Math.max(0.05, patternBeats * (60 / this.bpm));
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = track.device.sampleLoop;
    src.loopStart = offset;
    src.loopEnd = end;
    const gain = this.ctx.createGain();
    const fade = Math.min(0.02, playDur / 3);
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.setValueAtTime(0.9, t + Math.max(0, playDur - fade));
    gain.gain.linearRampToValueAtTime(0, t + playDur);
    src.connect(gain);
    gain.connect(graph.input);
    try {
      src.start(t, offset, playDur);
      this.keep(src);
    } catch {
      /* invalid sample window */
    }
  }

  keep(node: AudioScheduledSourceNode) {
    this.voices.push(node);
    node.onended = () => {
      const i = this.voices.indexOf(node);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }

  stopVoices() {
    const t = this.ctx.currentTime;
    for (const node of this.voices) {
      try {
        node.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this.voices = [];
    for (const [key, voice] of this.previews) {
      this.releasePreview(key, voice, t);
    }
    this.previews.clear();
  }

  previewDown(trackId: string, pitch: number, velocity: number) {
    if (!(this.ctx instanceof AudioContext)) return;
    const track = this.snap.project.tracks.find((t) => t.id === trackId);
    const graph = this.graphs.get(trackId);
    if (!track || !graph) return;
    const key = `${trackId}:${pitch}`;
    this.previewUp(trackId, pitch);
    const now = this.ctx.currentTime;
    if (track.kind === "drums") {
      const nodes = triggerDrum(this.ctx, graph.input, pitch, now, velocity);
      this.previews.set(key, { nodes });
      for (const node of nodes) this.keep(node);
      return;
    }
    if (track.kind === "sample") return;
    const voice = startSustain(this.ctx, graph.input, track, pitch, now, velocity);
    this.previews.set(key, voice);
    for (const node of voice.nodes) this.keep(node);
  }

  previewUp(trackId: string, pitch: number) {
    const key = `${trackId}:${pitch}`;
    const voice = this.previews.get(key);
    if (!voice || !(this.ctx instanceof AudioContext)) return;
    this.previews.delete(key);
    if (!("gain" in voice)) return;
    this.releasePreview(key, voice, this.ctx.currentTime);
  }

  releasePreview(_key: string, voice: SustainVoice | { nodes: AudioScheduledSourceNode[] }, time: number) {
    if (!("gain" in voice)) return;
    const value = Math.max(0.0001, voice.gain.gain.value || 0.0001);
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(value, time);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    for (const node of voice.nodes) {
      try {
        node.stop(time + 0.1);
      } catch {
        /* already stopped */
      }
    }
  }

  level(trackId: string): number {
    const graph = this.graphs.get(trackId);
    if (!graph) return 0;
    return levelOf(graph);
  }

  masterLevel(): number {
    this.masterMeter.getByteTimeDomainData(this.masterBuf);
    let sum = 0;
    for (let i = 0; i < this.masterBuf.length; i++) {
      const v = ((this.masterBuf[i] ?? 128) - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.masterBuf.length) * 3.2);
  }
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const len = buffer.length;
  const block = channels * 2;
  const dataSize = len * block;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = clamp(chans[c]?.[i] ?? 0, -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

class Engine {
  performer: Performer | null = null;
  snap: Snapshot | null = null;
  hooks: Hooks = {};
  lastBeatEmit = 0;

  setHooks(hooks: Hooks) {
    this.hooks = hooks;
    if (this.performer) this.performer.hooks = this.wrapHooks();
  }

  wrapHooks(): Hooks {
    return {
      onBeat: (beat) => {
        const now = performance.now();
        if (now - this.lastBeatEmit < 80) return;
        this.lastBeatEmit = now;
        this.hooks.onBeat?.(beat);
      },
      onLoop: () => this.hooks.onLoop?.(),
      onSamples: () => this.hooks.onSamples?.(),
    };
  }

  sync(snap: Snapshot) {
    this.snap = snap;
    this.performer?.update(snap);
  }

  async ensure() {
    if (!this.snap) return;
    if (!this.performer) {
      const ctx = new AudioContext();
      this.performer = new Performer(ctx, ctx.destination, this.snap, false);
      this.performer.hooks = this.wrapHooks();
      await this.restoreSamples();
    }
    if (this.performer.ctx instanceof AudioContext && this.performer.ctx.state === "suspended") {
      await this.performer.ctx.resume();
    }
    this.performer.update(this.snap);
  }

  start(fromBeat: number) {
    this.performer?.start(fromBeat);
  }

  pause(): number {
    return this.performer?.pause() ?? 0;
  }

  currentBeat(): number {
    return this.performer?.currentBeat() ?? 0;
  }

  previewDown(trackId: string, pitch: number, velocity: number) {
    this.performer?.previewDown(trackId, pitch, velocity);
  }

  previewUp(trackId: string, pitch: number) {
    this.performer?.previewUp(trackId, pitch);
  }

  level(trackId: string): number {
    return this.performer?.level(trackId) ?? 0;
  }

  masterLevel(): number {
    return this.performer?.masterLevel() ?? 0;
  }

  peaks(trackId: string): number[] | null {
    return samplePeaks.get(trackId) ?? null;
  }

  duration(trackId: string): number {
    return sampleBank.get(trackId)?.duration ?? 0;
  }

  async loadSample(trackId: string, data: ArrayBuffer) {
    await this.ensure();
    const ctx = this.performer?.ctx;
    if (!(ctx instanceof AudioContext)) throw new Error("Audio isn't ready");
    await idbPut(trackId, data);
    const audio = await ctx.decodeAudioData(data.slice(0));
    sampleBank.set(trackId, audio);
    samplePeaks.set(trackId, computePeaks(audio));
    this.hooks.onSamples?.();
  }

  async clearSample(trackId: string) {
    sampleBank.delete(trackId);
    samplePeaks.delete(trackId);
    try {
      await idbDel(trackId);
    } catch {
      /* storage may be unavailable */
    }
    this.hooks.onSamples?.();
  }

  async restoreSamples() {
    const ctx = this.performer?.ctx;
    if (!(ctx instanceof AudioContext) || !this.snap) return;
    const ids = this.snap.project.tracks.filter((t) => t.kind === "sample").map((t) => t.id);
    for (const id of ids) {
      if (sampleBank.has(id)) continue;
      try {
        const data = await idbGet(id);
        if (!data) continue;
        const audio = await ctx.decodeAudioData(data.slice(0));
        sampleBank.set(id, audio);
        samplePeaks.set(id, computePeaks(audio));
      } catch {
        /* skip a corrupt sample */
      }
    }
    this.hooks.onSamples?.();
  }

  async bounce(snap: Snapshot): Promise<Blob> {
    const hasArrange = snap.project.tracks.some((t) => t.arrangement.length > 0);
    const launched: Record<string, LaunchState> = {};
    if (!hasArrange) {
      for (const [id, launch] of Object.entries(snap.launched)) {
        if (launch.clipIndex >= 0) launched[id] = { clipIndex: launch.clipIndex, launchBeat: 0 };
      }
    }
    const renderSnap: Snapshot = hasArrange
      ? { project: snap.project, follow: "arrange", launched: {}, metronome: false }
      : { project: snap.project, follow: "session", launched, metronome: false };
    const beats = hasArrange ? snap.project.bars * 4 : 32;
    const seconds = beats * (60 / snap.project.bpm) + 1.1;
    const offline = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
    const performer = new Performer(offline, offline.destination, renderSnap, true);
    performer.scheduleAll(0, beats);
    const audio = await offline.startRendering();
    return encodeWav(audio);
  }
}

export const engine = new Engine();
