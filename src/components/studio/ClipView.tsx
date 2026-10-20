import { useEffect, useMemo, useRef } from "react";
import { FlipHorizontal2, Repeat, RotateCcw, Ruler, Timer, X } from "lucide-react";
import { engine } from "@/studio/engine";
import { useStudio } from "@/studio/store";
import { computePeaks, sampleBank } from "@/studio/samples";
import { assetOf, clipWindow, naturalBeats, playbackRate } from "@/studio/audio-clip";
import { clamp } from "@/studio/theory";
import type { ArrangeClip, ClipColor, Track } from "@/studio/types";
import { cx } from "./ui";

const CLIP_SWATCHES: Record<ClipColor, string> = {
  ember: "#e8893a",
  clay: "#d4785a",
  gold: "#e0c06a",
  sage: "#9fb58a",
};

const RESET: Partial<ArrangeClip> = {
  gain: undefined,
  transpose: undefined,
  detune: undefined,
  reverse: undefined,
  sampleStart: undefined,
  sampleEnd: undefined,
  loop: undefined,
  warp: undefined,
  sourceBpm: undefined,
  fadeIn: undefined,
  fadeOut: undefined,
};

function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="clip-number">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next)) onChange(clamp(next, min, max));
        }}
      />
      <small>{unit}</small>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="clip-slider">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(0)}
      />
    </label>
  );
}

/** Ableton-style Clip View for an audio region. */
export function AudioClipView({
  track,
  clip,
  onClose,
}: {
  track: Track;
  clip: ArrangeClip;
  onClose: () => void;
}) {
  const bpm = useStudio((s) => s.project.bpm);
  const rev = useStudio((s) => s.sampleRev);
  const asset = assetOf(track, clip);
  const buffer = sampleBank.get(asset);
  const duration = buffer?.duration ?? 0;
  const act = useStudio.getState();
  const change = (patch: Partial<ArrangeClip>) => act.updateRegion(track.id, clip.id, patch);
  const wave = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!engine.hasAsset(asset))
      void engine.ensure(true, false).catch((error: unknown) =>
        useStudio.setState({
          audioError: error instanceof Error ? error.message : String(error),
        }),
      );
  }, [asset]);

  const peaks = useMemo(
    () => (buffer ? computePeaks(buffer, 360) : []),
    // sampleRev changes when audio for this asset finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buffer, rev],
  );
  const win = duration ? clipWindow(track, clip, duration) : { start: 0, end: 0, loop: false };
  const rate = playbackRate(clip, bpm);
  const beats = duration ? naturalBeats(win, rate, bpm) : 0;
  const markerDrag = (which: "start" | "end") => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = wave.current;
    if (!svg || !duration) return;
    act.beginEdit();
    const move = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const seconds = clamp(((e.clientX - rect.left) / rect.width) * duration, 0, duration);
      if (which === "start")
        change({ sampleStart: Math.min(seconds, win.end - 0.01), sampleEnd: win.end });
      else change({ sampleEnd: Math.max(seconds, win.start + 0.01), sampleStart: win.start });
    };
    const up = () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
      act.endEdit();
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
  };
  const x = (seconds: number) => (duration ? (seconds / duration) * 1000 : 0);

  return (
    <section className="clip-view" aria-label="Audio clip editor">
      <header className="editor-title">
        <input
          aria-label="Region name"
          value={clip.name}
          onChange={(event) => change({ name: event.target.value.slice(0, 60) })}
        />
        <span className="text-xs text-muted">AUDIO CLIP</span>
        <div className="clip-swatches" role="radiogroup" aria-label="Clip color">
          {(Object.keys(CLIP_SWATCHES) as ClipColor[]).map((color) => (
            <button
              key={color}
              role="radio"
              aria-checked={clip.color === color}
              aria-label={`${color} clip color`}
              className={cx(clip.color === color && "active")}
              style={{ background: CLIP_SWATCHES[color] }}
              onClick={() => change({ color })}
            />
          ))}
        </div>
        <button className="icon-button ml-auto" aria-label="Close clip editor" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="clip-body">
        <div className="clip-column">
          <p className="section-label">Clip</p>
          <div className="clip-toggles">
            <button
              aria-pressed={win.loop}
              className={cx("studio-button", win.loop && "active")}
              onClick={() =>
                change({ loop: !win.loop, sampleStart: win.start, sampleEnd: win.end })
              }
            >
              <Repeat size={13} /> Loop
            </button>
            <button
              aria-pressed={!!clip.reverse}
              className={cx("studio-button", clip.reverse && "active")}
              onClick={() => change({ reverse: !clip.reverse })}
            >
              <FlipHorizontal2 size={13} /> Reverse
            </button>
            <button
              aria-pressed={!!clip.warp}
              title="Re-Pitch warp: speed and pitch follow the song tempo"
              className={cx("studio-button", clip.warp && "active")}
              onClick={() => change({ warp: !clip.warp, sourceBpm: clip.sourceBpm ?? bpm })}
            >
              <Timer size={13} /> Warp
            </button>
          </div>
          <NumberField
            label="Seg. BPM"
            value={clip.sourceBpm ?? bpm}
            min={20}
            max={999}
            step={0.01}
            unit="bpm"
            disabled={!clip.warp}
            onChange={(sourceBpm) => change({ sourceBpm })}
          />
          <div className="clip-actions">
            <button
              className="studio-button"
              disabled={!duration}
              onClick={() => act.fitAudioRegion(track.id, clip.id)}
            >
              <Ruler size={13} /> Fit region to clip
            </button>
            <button className="studio-button" onClick={() => change(RESET)}>
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>
        <div className="clip-sample">
          <div className="clip-wave-wrap">
            {duration ? (
              <svg
                ref={wave}
                className="clip-wave"
                viewBox="0 0 1000 120"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Waveform, ${duration.toFixed(2)} seconds`}
              >
                <rect
                  className={cx("clip-window", win.loop && "looping")}
                  x={x(win.start)}
                  width={x(win.end) - x(win.start)}
                  y={0}
                  height={120}
                />
                {peaks.map((peak, i) => {
                  const px = ((i + 0.5) / peaks.length) * 1000;
                  return (
                    <line
                      key={i}
                      x1={px}
                      x2={px}
                      y1={60 - peak * 56}
                      y2={60 + peak * 56}
                      className="clip-peak"
                    />
                  );
                })}
                <g className="clip-marker" onPointerDown={markerDrag("start")}>
                  <rect x={x(win.start) - 8} width={16} y={0} height={120} fill="transparent" />
                  <line x1={x(win.start)} x2={x(win.start)} y1={0} y2={120} />
                  <path d={`M${x(win.start)} 0 l12 0 l-12 12 z`} />
                </g>
                <g className="clip-marker end" onPointerDown={markerDrag("end")}>
                  <rect x={x(win.end) - 8} width={16} y={0} height={120} fill="transparent" />
                  <line x1={x(win.end)} x2={x(win.end)} y1={0} y2={120} />
                  <path d={`M${x(win.end)} 0 l-12 0 l12 12 z`} />
                </g>
              </svg>
            ) : (
              <p className="empty-note">Loading this clip’s audio…</p>
            )}
          </div>
          <div className="clip-fields">
            <NumberField
              label="Start"
              value={win.start}
              min={0}
              max={Math.max(0, win.end - 0.01)}
              step={0.01}
              unit="s"
              disabled={!duration}
              onChange={(sampleStart) => change({ sampleStart, sampleEnd: win.end })}
            />
            <NumberField
              label="End"
              value={win.end}
              min={win.start + 0.01}
              max={duration || 0.01}
              step={0.01}
              unit="s"
              disabled={!duration}
              onChange={(sampleEnd) => change({ sampleEnd, sampleStart: win.start })}
            />
            <span className="clip-meta">
              {buffer
                ? `${duration.toFixed(2)} s · ${buffer.sampleRate / 1000} kHz · ${
                    buffer.numberOfChannels === 1 ? "mono" : "stereo"
                  } · one pass ${beats.toFixed(2)} beats at ${rate.toFixed(3)}×`
                : "Source unavailable"}
            </span>
          </div>
        </div>
        <div className="clip-column">
          <p className="section-label">Sample</p>
          <Slider
            label="Gain"
            value={clip.gain ?? 0}
            min={-36}
            max={24}
            step={0.1}
            display={`${(clip.gain ?? 0) > 0 ? "+" : ""}${(clip.gain ?? 0).toFixed(1)} dB`}
            onChange={(gain) => change({ gain })}
          />
          <Slider
            label="Transpose"
            value={clip.transpose ?? 0}
            min={-48}
            max={48}
            step={1}
            display={`${(clip.transpose ?? 0) > 0 ? "+" : ""}${clip.transpose ?? 0} st`}
            onChange={(transpose) => change({ transpose })}
          />
          <Slider
            label="Detune"
            value={clip.detune ?? 0}
            min={-50}
            max={50}
            step={1}
            display={`${(clip.detune ?? 0) > 0 ? "+" : ""}${clip.detune ?? 0} ct`}
            onChange={(detune) => change({ detune })}
          />
          <div className="clip-fade-row">
            <NumberField
              label="Fade in"
              value={Math.round((clip.fadeIn ?? 0) * 1000)}
              min={0}
              max={30000}
              step={10}
              unit="ms"
              onChange={(ms) => change({ fadeIn: ms / 1000 })}
            />
            <NumberField
              label="Fade out"
              value={Math.round((clip.fadeOut ?? 0) * 1000)}
              min={0}
              max={30000}
              step={10}
              unit="ms"
              onChange={(ms) => change({ fadeOut: ms / 1000 })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Ableton-style MIDI clip operations shown above the piano roll. */
export function MidiClipTools({ track, clip }: { track: Track; clip: ArrangeClip }) {
  const act = useStudio.getState();
  const run = (transform: Parameters<typeof act.transformRegion>[2]) =>
    act.transformRegion(track.id, clip.id, transform);
  const drums = track.kind === "drums";
  const empty = !clip.notes.length;
  return (
    <div className="midi-tools" role="toolbar" aria-label="MIDI clip tools">
      <span className="section-label">Notes</span>
      {[-12, -1, 1, 12].map((semitones) => (
        <button
          key={semitones}
          className="studio-button"
          disabled={drums || empty}
          title={drums ? "Drum notes map to kit pieces" : undefined}
          aria-label={`Transpose ${semitones > 0 ? "up" : "down"} ${Math.abs(semitones)}`}
          onClick={() => run({ kind: "transpose", semitones })}
        >
          {semitones > 0 ? "+" : "−"}
          {Math.abs(semitones) === 12 ? "Oct" : "1"}
        </button>
      ))}
      <button
        className="studio-button"
        disabled={empty}
        aria-label="Softer velocity"
        onClick={() => run({ kind: "velocity", amount: -0.1 })}
      >
        Vel −
      </button>
      <button
        className="studio-button"
        disabled={empty}
        aria-label="Louder velocity"
        onClick={() => run({ kind: "velocity", amount: 0.1 })}
      >
        Vel +
      </button>
      <button className="studio-button" disabled={empty} onClick={() => run({ kind: "reverse" })}>
        Reverse
      </button>
      <button
        className="studio-button"
        disabled={drums || empty}
        onClick={() => run({ kind: "invert" })}
      >
        Invert
      </button>
      <button
        className="studio-button"
        title="Stretch notes to twice the length"
        onClick={() => run({ kind: "stretch", factor: 2 })}
      >
        Half speed
      </button>
      <button
        className="studio-button"
        title="Compress notes to half the length"
        onClick={() => run({ kind: "stretch", factor: 0.5 })}
      >
        Double speed
      </button>
      <button className="studio-button" onClick={() => run({ kind: "duplicate-loop" })}>
        Duplicate loop
      </button>
    </div>
  );
}
