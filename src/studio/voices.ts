import type { Track, Wave } from "./types";
import { clamp, midiToFreq } from "./theory";

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
): AudioScheduledSourceNode[] {
  const v = clamp(vel, 0.05, 1);
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
  const peak =
    clamp(velocity, 0.05, 1) * (track.kind === "bass" ? 0.4 : track.kind === "lead" ? 0.2 : 0.17);
  const { nodes, gain, filter } = tonalChain(ctx, dest, track, pitch, time, peak);
  const attack = clamp(track.device.attack, 0.003, 0.6);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  for (const node of nodes) node.start(time);
  return { nodes, gain, filter };
}
