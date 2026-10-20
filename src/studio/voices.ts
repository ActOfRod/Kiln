import type { Track, Wave } from "./types";
import { clamp, midiToFreq } from "./theory";
import { instrumentOf, noteBuffer, type InstrumentDef, type InstrumentId } from "./instruments";

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

export function makeImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const seconds = 1.7;
  const len = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, len, rate);
  const fade = Math.floor(rate * 0.012);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let s = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
      if (i < fade) s *= i / fade;
      data[i] = s;
    }
  }
  return impulse;
}

export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 512;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + amount * 52;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export interface TrackGraph {
  input: GainNode;
  drive: WaveShaperNode;
  filter: BiquadFilterNode;
  delay: DelayNode;
  delayFb: GainNode;
  delayMix: GainNode;
  reverbMix: GainNode;
  gain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  meter: Uint8Array<ArrayBuffer>;
}

export function buildGraph(
  ctx: BaseAudioContext,
  dest: AudioNode,
  impulse: AudioBuffer,
): TrackGraph {
  const input = ctx.createGain();
  const drive = ctx.createWaveShaper();
  drive.oversample = "2x";
  drive.curve = driveCurve(0);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 14000;
  const delay = ctx.createDelay(2);
  const delayFb = ctx.createGain();
  delayFb.gain.value = 0.34;
  const delayMix = ctx.createGain();
  delayMix.gain.value = 0;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  const reverbMix = ctx.createGain();
  reverbMix.gain.value = 0;
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;

  input.connect(drive);
  drive.connect(filter);
  filter.connect(gain);
  filter.connect(delay);
  delay.connect(delayFb);
  delayFb.connect(delay);
  delay.connect(delayMix);
  delayMix.connect(gain);
  filter.connect(reverb);
  reverb.connect(reverbMix);
  reverbMix.connect(gain);
  gain.connect(panner);
  panner.connect(analyser);
  analyser.connect(dest);

  return {
    input,
    drive,
    filter,
    delay,
    delayFb,
    delayMix,
    reverbMix,
    gain,
    panner,
    analyser,
    meter: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
  };
}

export function levelOf(graph: TrackGraph): number {
  graph.analyser.getByteTimeDomainData(graph.meter);
  let sum = 0;
  const data = graph.meter;
  for (let i = 0; i < data.length; i++) {
    const v = ((data[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 3.4);
}

function noiseHit(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  dur: number,
  vel: number,
  hp: number,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = hp;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.001, vel), time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  const offset = Math.random() * 0.45;
  src.start(time, offset);
  src.stop(time + dur + 0.02);
  return src;
}

export function triggerDrum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  pitch: number,
  time: number,
  vel: number,
  kit: InstrumentId = "drum-machine",
): AudioScheduledSourceNode[] {
  const v = clamp(vel, 0.05, 1);
  const custom =
    kit === "acoustic-kit"
      ? acousticDrum(ctx, dest, pitch, time, v)
      : kit === "808-kit"
        ? drum808(ctx, dest, pitch, time, v)
        : null;
  if (custom) return custom;
  if (pitch === 36) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(156, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.085);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(v, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.42);
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.value = 920;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(v * 0.16, time);
    cg.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
    click.connect(cg);
    cg.connect(dest);
    click.start(time);
    click.stop(time + 0.02);
    return [osc, click];
  }
  if (pitch === 38 || pitch === 39) {
    const clap = pitch === 39;
    const nodes: AudioScheduledSourceNode[] = [];
    const bursts = clap ? [0, 0.011, 0.022] : [0];
    for (const off of bursts) {
      nodes.push(
        noiseHit(
          ctx,
          dest,
          time + off,
          clap ? 0.16 : 0.18,
          v * (clap ? 0.42 : 0.5),
          clap ? 1200 : 800,
        ),
      );
    }
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(clap ? 220 : 174, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(v * 0.22, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.12);
    nodes.push(osc);
    return nodes;
  }
  if (pitch === 46) return [noiseHit(ctx, dest, time, 0.28, v * 0.36, 5800)];
  if (pitch === 37) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 410;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(v * 0.28, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.05);
    return [osc, noiseHit(ctx, dest, time, 0.04, v * 0.2, 2000)];
  }
  if (pitch === 45) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(168, time);
    osc.frequency.exponentialRampToValueAtTime(86, time + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(v * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.3);
    return [osc];
  }
  if (pitch === 49) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 4200;
    filter.Q.value = 3.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(v * 0.32, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(time, Math.random() * 0.4);
    src.stop(time + 0.48);
    return [src];
  }
  return [noiseHit(ctx, dest, time, 0.05, v * 0.32, 7000)];
}

export interface SustainVoice {
  nodes: AudioScheduledSourceNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  /** Seconds to fade out when the key is released. */
  release?: number;
}

function tonalChain(
  ctx: BaseAudioContext,
  dest: AudioNode,
  track: Track,
  pitch: number,
  time: number,
  peak: number,
): { nodes: AudioScheduledSourceNode[]; gain: GainNode; filter: BiquadFilterNode } {
  const freq = midiToFreq(pitch);
  const dev = track.device;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const wave: Wave = dev.waveform;
  osc1.type = wave;
  osc2.type = wave;
  osc1.frequency.setValueAtTime(freq, time);
  osc2.frequency.setValueAtTime(freq, time);
  osc2.detune.setValueAtTime(track.kind === "bass" ? 4 : 9, time);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  const floor = clamp(dev.cutoff, 70, 14000);
  const open = clamp(
    floor * (track.kind === "bass" ? 4.2 : track.kind === "lead" ? 2.8 : 2.1),
    floor,
    15000,
  );
  filter.Q.value = clamp(dev.resonance, 0.4, 16);
  filter.frequency.setValueAtTime(Math.max(open, 80), time);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(floor, 70),
    time + Math.max(0.06, dev.decay),
  );

  const gain = ctx.createGain();
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  const nodes: AudioScheduledSourceNode[] = [osc1, osc2];
  if (track.kind === "bass") {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(freq, time);
    const subGain = ctx.createGain();
    subGain.gain.value = peak * 0.85;
    sub.connect(subGain);
    subGain.connect(dest);
    nodes.push(sub);
  }
  return { nodes, gain, filter };
}

export function triggerTonal(
  ctx: BaseAudioContext,
  dest: AudioNode,
  track: Track,
  pitch: number,
  time: number,
  duration: number,
  velocity: number,
): AudioScheduledSourceNode[] {
  const def = instrumentOf(track.kind, track.device);
  if (def.engine !== "analog")
    return playInstrument(ctx, dest, track, def, pitch, time, duration, velocity);
  const peak =
    clamp(velocity, 0.05, 1) * (track.kind === "bass" ? 0.4 : track.kind === "lead" ? 0.2 : 0.17);
  const { nodes, gain } = tonalChain(ctx, dest, track, pitch, time, peak);
  const attack = clamp(track.device.attack, 0.003, 0.8);
  const dur = Math.max(0.06, duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  const end = Math.max(attack + 0.04, dur + 0.05);
  const mid = time + Math.max(attack + 0.02, end * 0.65);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.55), mid);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + end);
  const stop = time + end + 0.03;
  for (const node of nodes) {
    node.start(time);
    node.stop(stop);
  }
  return nodes;
}

export function startSustain(
  ctx: BaseAudioContext,
  dest: AudioNode,
  track: Track,
  pitch: number,
  time: number,
  velocity: number,
): SustainVoice {
  const def = instrumentOf(track.kind, track.device);
  if (def.engine !== "analog") {
    const voice = buildInstrument(ctx, dest, track, def, pitch, time, velocity);
    if (voice.sustained) {
      voice.gain.gain.setValueAtTime(0.0001, time);
      voice.gain.gain.linearRampToValueAtTime(voice.peak, time + voice.attack);
    }
    for (const node of voice.nodes) {
      node.start(time);
      if (!voice.sustained) node.stop(time + voice.length);
    }
    return { nodes: voice.nodes, gain: voice.gain, filter: voice.filter, release: voice.release };
  }
  const peak =
    clamp(velocity, 0.05, 1) * (track.kind === "bass" ? 0.4 : track.kind === "lead" ? 0.2 : 0.17);
  const { nodes, gain, filter } = tonalChain(ctx, dest, track, pitch, time, peak);
  const attack = clamp(track.device.attack, 0.003, 0.6);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  for (const node of nodes) node.start(time);
  return { nodes, gain, filter };
}

// ---------------------------------------------------------------------------
// Instrument voices beyond the analog synth.

interface InstrumentVoice extends SustainVoice {
  peak: number;
  attack: number;
  release: number;
  sustained: boolean;
  /** Natural length of a rendered note; Infinity for sustained voices. */
  length: number;
}

const organWaves = new WeakMap<BaseAudioContext, PeriodicWave>();

function organWave(ctx: BaseAudioContext): PeriodicWave {
  const cached = organWaves.get(ctx);
  if (cached) return cached;
  // Drawbars 16', 8', 5 1/3', 4', 2 2/3', 2' and 1' as harmonic amplitudes.
  const imag = new Float32Array([0, 1, 0.85, 0.55, 0.6, 0, 0.35, 0, 0.3]);
  const wave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  organWaves.set(ctx, wave);
  return wave;
}

/** Low-frequency oscillator; the caller starts and stops it with the voice. */
function lfo(ctx: BaseAudioContext, rate: number, depth: number, target: AudioParam) {
  const osc = ctx.createOscillator();
  osc.frequency.value = rate;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  osc.connect(amount);
  amount.connect(target);
  return osc;
}

function buildInstrument(
  ctx: BaseAudioContext,
  dest: AudioNode,
  track: Track,
  def: InstrumentDef,
  pitch: number,
  time: number,
  velocity: number,
): InstrumentVoice {
  const v = clamp(velocity, 0.05, 1);
  const freq = midiToFreq(pitch);
  const dev = track.device;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  filter.connect(gain);
  gain.connect(dest);
  const release = clamp(dev.decay, 0.02, 3);
  if (def.engine === "rendered") {
    const buffer = noteBuffer(def.id, pitch, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(filter);
    // Harder notes are brighter, as on an acoustic instrument.
    filter.frequency.value = clamp(
      dev.cutoff * (0.28 + 0.72 * v),
      Math.max(260, freq * 2.5),
      18000,
    );
    const peak = def.level * v ** 1.15;
    gain.gain.setValueAtTime(peak, time);
    return {
      nodes: [src],
      gain,
      filter,
      peak,
      attack: 0,
      release,
      sustained: false,
      length: buffer.duration,
    };
  }
  const nodes: AudioScheduledSourceNode[] = [];
  const osc = (type: OscillatorType, ratio: number, cents: number, level: number) => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.setValueAtTime(freq * ratio, time);
    node.detune.setValueAtTime(cents, time);
    const amp = ctx.createGain();
    amp.gain.value = level;
    node.connect(amp);
    amp.connect(filter);
    nodes.push(node);
    return node;
  };
  filter.frequency.value = clamp(dev.cutoff, 120, 16000);
  if (def.id === "organ") {
    const tone = ctx.createOscillator();
    tone.setPeriodicWave(organWave(ctx));
    tone.frequency.setValueAtTime(freq, time);
    const rotor = ctx.createGain();
    rotor.gain.value = 0.9;
    tone.connect(rotor);
    rotor.connect(filter);
    nodes.push(tone, lfo(ctx, 6.4, 0.1, rotor.gain));
    // Key click.
    const click = ctx.createBufferSource();
    click.buffer = noiseBuffer(ctx);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.25 * v, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
    click.connect(clickGain);
    clickGain.connect(filter);
    // A one-shot: started and stopped here, not with the held voice.
    click.start(time, Math.random() * 0.4);
    click.stop(time + 0.02);
  } else if (def.id === "strings") {
    const voices = [
      osc("sawtooth", 1, -8, 0.5),
      osc("sawtooth", 1, 7, 0.5),
      osc("sawtooth", 2, 3, 0.18),
    ];
    const vibrato = lfo(ctx, 5.3, 7, voices[0]!.detune);
    for (const voice of voices.slice(1)) {
      const depth = ctx.createGain();
      depth.gain.value = 7;
      vibrato.connect(depth);
      depth.connect(voice.detune);
    }
    nodes.push(vibrato);
    filter.Q.value = 0.5;
  } else if (def.id === "warm-pad") {
    osc("sawtooth", 1, -11, 0.45);
    osc("sawtooth", 1, 11, 0.45);
    osc("triangle", 0.5, 0, 0.5);
    nodes.push(lfo(ctx, 0.25, filter.frequency.value * 0.3, filter.frequency));
    filter.Q.value = clamp(dev.resonance, 0.5, 4);
  } else {
    // Sub bass: sine with a touch of second harmonic for small speakers.
    osc("sine", 1, 0, 1);
    osc("sine", 2, 0, 0.12);
  }
  const peak = def.level * (0.45 + 0.55 * v);
  const attack = clamp(dev.attack, 0.003, 2);
  return { nodes, gain, filter, peak, attack, release, sustained: true, length: Infinity };
}

function playInstrument(
  ctx: BaseAudioContext,
  dest: AudioNode,
  track: Track,
  def: InstrumentDef,
  pitch: number,
  time: number,
  duration: number,
  velocity: number,
): AudioScheduledSourceNode[] {
  const voice = buildInstrument(ctx, dest, track, def, pitch, time, velocity);
  const off = time + Math.max(0.04, duration);
  const level = voice.gain.gain;
  let stop: number;
  if (voice.sustained) {
    level.setValueAtTime(0.0001, time);
    level.linearRampToValueAtTime(voice.peak, Math.min(off, time + voice.attack));
    level.setValueAtTime(voice.peak, off);
    level.setTargetAtTime(0, off, voice.release / 4);
    stop = off + voice.release + 0.05;
  } else if (off < time + voice.length) {
    // Key released before the note died away: damp it.
    level.setValueAtTime(voice.peak, off);
    level.setTargetAtTime(0, off, voice.release / 4);
    stop = Math.min(time + voice.length, off + voice.release + 0.05);
  } else stop = time + voice.length;
  for (const node of voice.nodes) {
    node.start(time);
    node.stop(stop);
  }
  return voice.nodes;
}

// ---------------------------------------------------------------------------
// Drum kits. Each returns null for pieces it shares with the electronic kit.

function sweep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  type: OscillatorType,
  from: number,
  to: number,
  glide: number,
  time: number,
  decay: number,
  level: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(to, time + glide);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.02);
  return osc;
}

function bandNoise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  decay: number,
  level: number,
  type: BiquadFilterType,
  frequency: number,
  q = 0.8,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(time, Math.random() * 0.4);
  src.stop(time + decay + 0.02);
  return src;
}

/** Six detuned square waves through band- and high-pass filters: classic metal. */
function metallic(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  decay: number,
  level: number,
  scale = 1,
): AudioScheduledSourceNode[] {
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 10000;
  band.Q.value = 0.6;
  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 7000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  band.connect(high);
  high.connect(gain);
  gain.connect(dest);
  return [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = f * scale;
    osc.connect(band);
    osc.start(time);
    osc.stop(time + decay + 0.02);
    return osc;
  });
}

function acousticDrum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  pitch: number,
  time: number,
  v: number,
): AudioScheduledSourceNode[] | null {
  switch (pitch) {
    case 36:
      return [
        sweep(ctx, dest, "sine", 125, 52, 0.07, time, 0.5, v),
        sweep(ctx, dest, "triangle", 80, 60, 0.1, time, 0.25, v * 0.35),
        bandNoise(ctx, dest, time, 0.02, v * 0.35, "lowpass", 3200),
      ];
    case 38:
      return [
        sweep(ctx, dest, "sine", 200, 180, 0.05, time, 0.12, v * 0.45),
        sweep(ctx, dest, "sine", 340, 320, 0.05, time, 0.08, v * 0.25),
        bandNoise(ctx, dest, time, 0.24, v * 0.6, "bandpass", 3600, 0.7),
        bandNoise(ctx, dest, time, 0.12, v * 0.25, "highpass", 7000),
      ];
    case 42:
      return [
        ...metallic(ctx, dest, time, 0.07, v * 0.35, 1.3),
        bandNoise(ctx, dest, time, 0.05, v * 0.25, "highpass", 8500),
      ];
    case 46:
      return [
        ...metallic(ctx, dest, time, 0.5, v * 0.3, 1.3),
        bandNoise(ctx, dest, time, 0.4, v * 0.2, "highpass", 8000),
      ];
    case 45:
      return [
        sweep(ctx, dest, "sine", 150, 105, 0.15, time, 0.5, v * 0.75),
        bandNoise(ctx, dest, time, 0.05, v * 0.15, "lowpass", 2500),
      ];
    case 49:
      return [
        ...metallic(ctx, dest, time, 1.3, v * 0.22, 1.6),
        bandNoise(ctx, dest, time, 1.1, v * 0.12, "bandpass", 6500, 1.2),
      ];
    default:
      return null;
  }
}

function drum808(
  ctx: BaseAudioContext,
  dest: AudioNode,
  pitch: number,
  time: number,
  v: number,
): AudioScheduledSourceNode[] | null {
  switch (pitch) {
    case 36:
      return [
        sweep(ctx, dest, "sine", 160, 48, 0.12, time, 1.1, v * 0.7),
        bandNoise(ctx, dest, time, 0.008, v * 0.2, "highpass", 2500),
      ];
    case 38:
      return [
        sweep(ctx, dest, "sine", 238, 230, 0.05, time, 0.16, v * 0.4),
        sweep(ctx, dest, "sine", 476, 470, 0.05, time, 0.1, v * 0.22),
        bandNoise(ctx, dest, time, 0.2, v * 0.45, "highpass", 1800),
      ];
    case 42:
      return metallic(ctx, dest, time, 0.05, v * 0.4);
    case 46:
      return metallic(ctx, dest, time, 0.38, v * 0.32);
    case 45:
      return [sweep(ctx, dest, "sine", 180, 125, 0.2, time, 0.55, v * 0.7)];
    case 49:
      return metallic(ctx, dest, time, 1.0, v * 0.25, 1.15);
    default:
      return null;
  }
}
