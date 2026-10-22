import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, SlidersHorizontal, Trash2 } from "lucide-react";
import { engine } from "@/studio/engine";
import { PATTERNS } from "@/studio/factory";
import { useStudio } from "@/studio/store";
import { DRUMS, noteName } from "@/studio/theory";
import type { Track, TrackKind, Wave } from "@/studio/types";
import { Field, Sheet, cx } from "./ui";
import { InstrumentPicker } from "./InstrumentPicker";
import { instrumentOf } from "@/studio/instruments";

const MIN_F = Math.log(80);
const MAX_F = Math.log(14000);
const WAVES: Wave[] = ["sine", "triangle", "sawtooth", "square"];
const DIVS = [
  { value: 0.25, label: "1/16" },
  { value: 0.375, label: "1/8." },
  { value: 0.5, label: "1/8" },
  { value: 0.75, label: "1/4" },
];

/**
 * Per-track actions. The desktop inspector is hidden on phones and tablets, so this
 * sheet (opened from every track header) is where tracks are deleted, duplicated and
 * reordered on small screens.
 */
export function TrackSheet({
  trackId,
  onClose,
  onDevice,
}: {
  trackId: string;
  onClose: () => void;
  onDevice: (trackId: string) => void;
}) {
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === trackId));
  const tracks = useStudio((s) => s.project.tracks);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!track) return null;
  const act = useStudio.getState();
  const index = tracks.indexOf(track);
  const regions = track.arrangement.length;
  const clips = track.clips.filter(Boolean).length;
  const empty = regions === 0 && clips === 0;
  const last = tracks.length <= 1;
  const remove = () => {
    act.removeTrack(track.id);
    onClose();
  };
  return (
    <Sheet title={`${track.name} track`} onClose={onClose}>
      <label className="mb-3 flex flex-col gap-1 text-sm">
        <span className="text-muted">Track name</span>
        <input
          value={track.name}
          aria-label="Track name"
          className="h-11 rounded-md bg-surface-2 px-3 text-fg"
          onChange={(event) => act.renameTrack(track.id, event.target.value)}
        />
      </label>
      <p className="mb-3 text-sm text-muted">
        {empty
          ? "This track is empty."
          : `${regions} ${regions === 1 ? "region" : "regions"} in the arrangement · ${clips} session ${clips === 1 ? "clip" : "clips"}`}
      </p>
      <div className="grid gap-2">
        <button
          type="button"
          className="studio-button h-11 justify-start"
          onClick={() => {
            onClose();
            onDevice(track.id);
          }}
        >
          <SlidersHorizontal size={15} />
          Sound & effects
        </button>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className="studio-button h-11"
            disabled={index <= 0}
            onClick={() => act.reorderTrack(track.id, -1)}
          >
            <ArrowUp size={15} />
            Up
          </button>
          <button
            type="button"
            className="studio-button h-11"
            disabled={index >= tracks.length - 1}
            onClick={() => act.reorderTrack(track.id, 1)}
          >
            <ArrowDown size={15} />
            Down
          </button>
          <button
            type="button"
            className="studio-button h-11"
            disabled={tracks.length >= 32}
            onClick={() =>
              void act
                .duplicateTrack(track.id)
                .then(onClose)
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            }
          >
            <Copy size={15} />
            Copy
          </button>
        </div>
        {confirm ? (
          <div className="rounded-md bg-surface-2 p-3">
            <p className="mb-3 text-sm">
              Delete <strong>{track.name}</strong> and everything on it? You can undo this.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="studio-button h-11"
                onClick={() => setConfirm(false)}
              >
                Keep track
              </button>
              <button type="button" className="studio-button h-11 text-record" onClick={remove}>
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="studio-button h-11 justify-start text-record"
            disabled={last}
            onClick={() => (empty ? remove() : setConfirm(true))}
          >
            <Trash2 size={15} />
            Delete track
          </button>
        )}
        {last && (
          <p className="text-xs text-faint">A song needs at least one track.</p>
        )}
        {error && (
          <p className="text-sm text-record" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

export function DeviceSheet({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === trackId));
  const updateDevice = useStudio((s) => s.updateDevice);
  const renameTrack = useStudio((s) => s.renameTrack);
  const removeTrack = useStudio((s) => s.removeTrack);
  const rev = useStudio((s) => s.sampleRev);
  if (!track) return null;
  const instrument = instrumentOf(track.kind, track.device);
  const analog = instrument.engine === "analog";
  const tonal = track.kind !== "drums" && track.kind !== "sample";
  return (
    <Sheet title={`${track.name} sound`} onClose={onClose}>
      <label className="mb-3 flex flex-col gap-1 text-sm">
        <span className="text-muted">Track name</span>
        <input
          value={track.name}
          aria-label="Track name"
          className="h-11 rounded-md bg-surface-2 px-3 text-fg"
          onChange={(event) => renameTrack(track.id, event.target.value)}
        />
      </label>
      {track.kind !== "sample" && <InstrumentPicker track={track} compact />}
      <p className="mb-2 text-xs uppercase tracking-wide text-muted">
        {track.kind === "sample" ? labelKind(track.kind) : `${instrument.name} controls`}
      </p>
      {tonal && analog && (
        <div className="mb-3 grid grid-cols-4 gap-1">
          {WAVES.map((wave) => (
            <button
              key={wave}
              type="button"
              className={cx(
                "press h-11 rounded-md text-sm font-medium capitalize",
                track.device.waveform === wave ? "bg-accent text-accent-ink" : "bg-surface-2",
              )}
              onClick={() => updateDevice(track.id, { waveform: wave })}
            >
              {wave === "sawtooth" ? "Saw" : wave}
            </button>
          ))}
        </div>
      )}
      {tonal && (
        <>
          {(analog || instrument.engine === "sustained") && (
            <Field
              label="Attack"
              min={0.003}
              max={0.8}
              step={0.001}
              value={track.device.attack}
              display={`${Math.round(track.device.attack * 1000)} ms`}
              onChange={(attack) => updateDevice(track.id, { attack })}
            />
          )}
          <Field
            label={analog ? "Decay" : "Release"}
            min={analog ? 0.05 : 0.02}
            max={analog ? 1.4 : 3}
            step={0.01}
            value={track.device.decay}
            display={`${track.device.decay.toFixed(2)} s`}
            onChange={(decay) => updateDevice(track.id, { decay })}
          />
        </>
      )}
      <Field
        label={tonal && !analog ? "Tone" : "Cutoff"}
        min={0}
        max={1}
        step={0.001}
        value={
          (Math.log(Math.min(14000, Math.max(80, track.device.cutoff))) - MIN_F) / (MAX_F - MIN_F)
        }
        display={`${Math.round(track.device.cutoff)} Hz`}
        onChange={(pos) =>
          updateDevice(track.id, { cutoff: Math.exp(MIN_F + pos * (MAX_F - MIN_F)) })
        }
      />
      {(!tonal || analog || instrument.id === "warm-pad") && (
        <Field
          label="Resonance"
          min={0.4}
          max={14}
          step={0.1}
          value={track.device.resonance}
          display={track.device.resonance.toFixed(1)}
          onChange={(resonance) => updateDevice(track.id, { resonance })}
        />
      )}
      <Field
        label="Drive"
        min={0}
        max={1}
        step={0.01}
        value={track.device.drive}
        display={`${Math.round(track.device.drive * 100)}%`}
        onChange={(drive) => updateDevice(track.id, { drive })}
      />
      <p className="mt-3 text-xs uppercase tracking-wide text-muted">Delay</p>
      <div className="my-2 grid grid-cols-4 gap-1">
        {DIVS.map((div) => (
          <button
            key={div.label}
            type="button"
            className={cx(
              "press h-11 rounded-md font-mono text-sm",
              track.device.delayDivision === div.value
                ? "bg-accent text-accent-ink"
                : "bg-surface-2",
            )}
            onClick={() => updateDevice(track.id, { delayDivision: div.value })}
          >
            {div.label}
          </button>
        ))}
      </div>
      <Field
        label="Delay mix"
        min={0}
        max={0.7}
        step={0.01}
        value={track.device.delayMix}
        display={`${Math.round(track.device.delayMix * 100)}%`}
        onChange={(delayMix) => updateDevice(track.id, { delayMix })}
      />
      <Field
        label="Reverb"
        min={0}
        max={0.7}
        step={0.01}
        value={track.device.reverb}
        display={`${Math.round(track.device.reverb * 100)}%`}
        onChange={(reverb) => updateDevice(track.id, { reverb })}
      />
      {track.kind === "sample" && <SampleTools track={track} rev={rev} />}
      <button
        type="button"
        className="press mt-4 h-11 w-full rounded-md bg-surface-3 text-sm text-record"
        onClick={() => {
          removeTrack(track.id);
          onClose();
        }}
      >
        Remove track
      </button>
    </Sheet>
  );
}

function SampleTools({ track, rev }: { track: Track; rev: number }) {
  const updateDevice = useStudio((s) => s.updateDevice);
  const ensureClip = useStudio((s) => s.ensureClip);
  const scene = useStudio((s) => s.selectedScene);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => Promise<ArrayBuffer> } | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const peaks = engine.peaks(track.id);
  const duration = engine.duration(track.id);
  void rev;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const recorder = recRef.current;
      recRef.current = null;
      if (recorder)
        void recorder
          .stop()
          .catch((error: unknown) => console.error("Microphone cleanup failed", error));
    };
  }, []);

  const take = async (data: ArrayBuffer, name: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await engine.loadSample(track.id, data);
      ensureClip(track.id, scene, name);
      setMessage("Audio is on this track. Launch its clip in Session.");
    } catch {
      setMessage("Couldn't read that audio. Try a wav, mp3, or a phone recording.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-muted">Audio</p>
      <Waveform peaks={peaks} />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="press h-11 rounded-md bg-accent text-sm font-semibold text-accent-ink disabled:opacity-50"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Import file
        </button>
        <button
          type="button"
          className={cx(
            "press h-11 rounded-md text-sm font-semibold",
            live ? "bg-record text-accent-ink" : "bg-surface-2",
          )}
          disabled={busy}
          onClick={() => {
            if (live && recRef.current) {
              const handle = recRef.current;
              recRef.current = null;
              setLive(false);
              void handle
                .stop()
                .then((data) => take(data, "Mic take"))
                .catch(() => setMessage("Recording failed."));
              return;
            }
            setBusy(true);
            void navigator.mediaDevices
              .getUserMedia({ audio: true })
              .then((stream) => {
                if (!mounted.current) {
                  stream.getTracks().forEach((item) => item.stop());
                  return;
                }
                let rec: MediaRecorder;
                try {
                  rec = new MediaRecorder(stream);
                  rec.start();
                } catch (error) {
                  stream.getTracks().forEach((item) => item.stop());
                  throw error;
                }
                const chunks: Blob[] = [];
                rec.ondataavailable = (event) => {
                  if (event.data.size) chunks.push(event.data);
                };
                const stopped = new Promise<ArrayBuffer>((resolve, reject) => {
                  rec.onstop = () => {
                    stream.getTracks().forEach((item) => item.stop());
                    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
                    blob.arrayBuffer().then(resolve).catch(reject);
                  };
                });
                recRef.current = {
                  stop: async () => {
                    rec.stop();
                    return stopped;
                  },
                };
                setLive(true);
                setMessage("Recording… tap again to stop.");
              })
              .catch(() => {
                if (mounted.current)
                  setMessage("Microphone isn't available. Import a file instead.");
              })
              .finally(() => {
                if (mounted.current) setBusy(false);
              });
          }}
        >
          {live ? "Stop mic" : "Record mic"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > 15_000_000) {
            setMessage("Keep audio under 15 MB.");
            return;
          }
          void file
            .arrayBuffer()
            .then((data) => take(data, file.name.replace(/\.[^.]+$/, "") || "Audio"));
        }}
      />
      {duration > 0 && (
        <>
          <Field
            label="Trim start"
            min={0}
            max={Math.max(0.05, duration - 0.05)}
            step={0.01}
            value={Math.min(track.device.sampleOffset, duration)}
            display={`${track.device.sampleOffset.toFixed(2)} s`}
            onChange={(sampleOffset) => updateDevice(track.id, { sampleOffset })}
          />
          <Field
            label="Trim end"
            min={0.1}
            max={duration}
            step={0.01}
            value={track.device.sampleEnd > 0 ? track.device.sampleEnd : duration}
            display={`${(track.device.sampleEnd > 0 ? track.device.sampleEnd : duration).toFixed(2)} s`}
            onChange={(sampleEnd) => updateDevice(track.id, { sampleEnd })}
          />
          <button
            type="button"
            className={cx(
              "press h-11 rounded-md text-sm font-semibold",
              track.device.sampleLoop ? "bg-accent text-accent-ink" : "bg-surface-2",
            )}
            onClick={() => updateDevice(track.id, { sampleLoop: !track.device.sampleLoop })}
          >
            {track.device.sampleLoop ? "Looping inside the clip" : "Play once"}
          </button>
          <button
            type="button"
            className="press h-11 rounded-md bg-surface-3 text-sm"
            onClick={() => void engine.clearSample(track.id)}
          >
            Remove audio
          </button>
        </>
      )}
      {message && <p className="text-sm text-pretty text-muted">{message}</p>}
    </div>
  );
}

function Waveform({ peaks }: { peaks: number[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(canvas).color;
    const data = peaks && peaks.length > 0 ? peaks : Array.from({ length: 48 }, () => 0.08);
    const bar = width / data.length;
    data.forEach((peak, i) => {
      const h = Math.max(2, peak * height);
      ctx.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - 1), h);
    });
  }, [peaks]);
  return <canvas ref={ref} className="h-16 w-full text-accent" />;
}

export function PatternSheet({ onClose }: { onClose: () => void }) {
  const slot = useStudio((s) => s.selectedSlot);
  const track = useStudio((s) =>
    s.project.tracks.find((t) => t.id === (slot?.trackId ?? s.selectedTrackId)),
  );
  const insertPattern = useStudio((s) => s.insertPattern);
  if (!track || !slot) {
    return (
      <Sheet title="Patterns" onClose={onClose}>
        <p className="text-sm text-muted">Select a clip slot first.</p>
      </Sheet>
    );
  }
  const patterns = PATTERNS.filter((pattern) => pattern.kind === track.kind);
  return (
    <Sheet title={`Patterns for ${track.name}`} onClose={onClose}>
      {track.kind === "sample" || patterns.length === 0 ? (
        <p className="text-sm text-pretty text-muted">
          Audio tracks don't use note patterns. Open Sound and import a recording.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {patterns.map((pattern) => (
            <button
              key={pattern.id}
              type="button"
              className="press flex h-14 items-center justify-between rounded-md bg-surface-2 px-3 text-left"
              onClick={() => {
                insertPattern(track.id, slot.scene, pattern.id);
                onClose();
              }}
            >
              <span className="font-semibold">{pattern.name}</span>
              <span className="text-sm text-muted">{pattern.notes.length} notes</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function EditorSheet({ onClose }: { onClose: () => void }) {
  const slot = useStudio((s) => s.selectedSlot);
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === slot?.trackId));
  const clip = track && slot ? track.clips[slot.scene] : null;
  const toggleStep = useStudio((s) => s.toggleStep);
  const setClipLength = useStudio((s) => s.setClipLength);
  const playStep = useStudio((s) => {
    if (!slot || !clip) return -1;
    const launch = s.launched[slot.trackId];
    if (!launch) return -1;
    const idx = s.beat < launch.launchBeat - 0.001 ? launch.previous?.clipIndex : launch.clipIndex;
    if (idx !== slot.scene) return -1;
    const origin =
      s.beat < launch.launchBeat && launch.previous
        ? launch.previous.launchBeat
        : launch.launchBeat;
    const rel = (((s.beat - origin) % clip.length) + clip.length) % clip.length;
    return Math.floor(rel * 4);
  });

  if (!track || !slot || !clip) {
    return (
      <Sheet title="Editor" onClose={onClose}>
        <p className="text-sm text-muted">Load a pattern into the slot before editing notes.</p>
      </Sheet>
    );
  }

  const rows =
    track.kind === "drums"
      ? DRUMS.map((drum) => ({ pitch: drum.pitch, label: drum.name }))
      : rangeFor(track.kind).map((pitch) => ({ pitch, label: noteName(pitch) }));
  const steps = Math.round(clip.length * 4);

  return (
    <Sheet title={clip.name} onClose={onClose} wide>
      <div className="mb-3 flex gap-2">
        {[4, 8, 16].map((beats) => (
          <button
            key={beats}
            type="button"
            className={cx(
              "press h-11 flex-1 rounded-md text-sm font-semibold",
              clip.length === beats ? "bg-accent text-accent-ink" : "bg-surface-2",
            )}
            onClick={() => setClipLength(track.id, slot.scene, beats)}
          >
            {beats / 4} {beats === 4 ? "bar" : "bars"}
          </button>
        ))}
      </div>
      <p className="mb-2 text-sm text-muted">Tap a cell to paint or erase a note.</p>
      <div className="overflow-auto rounded-md border border-line">
        <div className="inline-flex min-w-full flex-col">
          {rows.map((row) => (
            <div key={row.pitch} className="flex">
              <div className="sticky left-0 z-10 flex h-11 w-16 shrink-0 items-center border-b border-r border-line bg-surface px-2 text-xs text-muted">
                {row.label}
              </div>
              {Array.from({ length: steps }, (_, step) => {
                const start = step * 0.25;
                const on = clip.notes.some(
                  (note) => note.pitch === row.pitch && Math.abs(note.start - start) < 0.02,
                );
                const beat = step % 4 === 0;
                return (
                  <button
                    key={step}
                    type="button"
                    aria-label={`${row.label} step ${step + 1}`}
                    aria-pressed={on}
                    className={cx(
                      "h-11 w-11 shrink-0 border-b border-r border-line",
                      on ? "bg-accent" : beat ? "bg-surface-3" : "bg-surface-2",
                      playStep === step && "ring-2 ring-fg ring-inset",
                    )}
                    onClick={() => toggleStep(track.id, slot.scene, row.pitch, step)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function rangeFor(kind: TrackKind): number[] {
  const [lo, hi] = kind === "bass" ? [36, 59] : kind === "lead" ? [60, 84] : [48, 72];
  const list: number[] = [];
  for (let pitch = hi; pitch >= lo; pitch--) list.push(pitch);
  return list;
}

export function TempoSheet({ onClose }: { onClose: () => void }) {
  const bpm = useStudio((s) => s.project.bpm);
  const swing = useStudio((s) => s.project.swing);
  const setBpm = useStudio((s) => s.setBpm);
  const setSwing = useStudio((s) => s.setSwing);
  const metronome = useStudio((s) => s.metronome);
  const toggle = useStudio((s) => s.toggleMetronome);
  return (
    <Sheet title="Tempo" onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="press h-11 w-11 rounded-md bg-surface-2 text-lg"
          onClick={() => setBpm(bpm - 1)}
        >
          −
        </button>
        <span className="font-mono text-3xl font-medium tabular-nums">{bpm}</span>
        <button
          type="button"
          className="press h-11 w-11 rounded-md bg-surface-2 text-lg"
          onClick={() => setBpm(bpm + 1)}
        >
          +
        </button>
      </div>
      <Field
        label="BPM"
        min={70}
        max={180}
        step={1}
        value={bpm}
        display={`${bpm}`}
        onChange={setBpm}
      />
      <Field
        label="Swing"
        min={0}
        max={0.55}
        step={0.01}
        value={swing}
        display={swing < 0.02 ? "Straight" : `${Math.round(swing * 100)}%`}
        onChange={setSwing}
      />
      <button
        type="button"
        aria-pressed={metronome}
        className={cx(
          "press mt-3 h-11 w-full rounded-md text-sm font-semibold",
          metronome ? "bg-accent text-accent-ink" : "bg-surface-2",
        )}
        onClick={toggle}
      >
        {metronome ? "Metronome on" : "Metronome off"}
      </button>
    </Sheet>
  );
}

export function MenuSheet({ onClose }: { onClose: () => void }) {
  const project = useStudio((s) => s.project);
  const renameProject = useStudio((s) => s.renameProject);
  const addTrack = useStudio((s) => s.addTrack);
  const setBars = useStudio((s) => s.setBars);
  const newSet = useStudio((s) => s.newSet);
  const resetDemo = useStudio((s) => s.resetDemo);
  const exportSong = useStudio((s) => s.exportSong);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="Set" onClose={onClose}>
      <label className="mb-4 flex flex-col gap-1 text-sm">
        <span className="text-muted">Name</span>
        <input
          value={project.name}
          aria-label="Set name"
          className="h-11 rounded-md bg-surface-2 px-3 text-fg"
          onChange={(event) => renameProject(event.target.value)}
        />
      </label>
      <p className="mb-2 text-xs uppercase tracking-wide text-muted">Song length</p>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[8, 16, 32].map((bars) => (
          <button
            key={bars}
            type="button"
            className={cx(
              "press h-11 rounded-md text-sm font-semibold",
              project.bars === bars ? "bg-accent text-accent-ink" : "bg-surface-2",
            )}
            onClick={() => setBars(bars)}
          >
            {bars} bars
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs uppercase tracking-wide text-muted">Add track</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["drums", "bass", "keys", "lead", "sample"] as TrackKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="press h-11 rounded-md bg-surface-2 text-sm font-semibold capitalize disabled:opacity-40"
            disabled={project.tracks.length >= 32}
            onClick={() => addTrack(kind)}
          >
            {kind === "sample" ? "Audio" : kind}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="press mb-2 h-11 w-full rounded-md bg-accent text-sm font-semibold text-accent-ink disabled:opacity-60"
        disabled={rendering}
        onClick={() => {
          setRendering(true);
          setError(null);
          void exportSong()
            .catch(() => setError("Export didn't finish. Try again."))
            .finally(() => setRendering(false));
        }}
      >
        {rendering ? "Rendering mix…" : "Export song as WAV"}
      </button>
      <button
        type="button"
        className="press mb-2 h-11 w-full rounded-md bg-surface-2 text-sm font-semibold"
        onClick={() => {
          resetDemo();
          onClose();
        }}
      >
        Restore Night Drive
      </button>
      <button
        type="button"
        className="press h-11 w-full rounded-md bg-surface-3 text-sm font-semibold"
        onClick={() => {
          newSet();
          onClose();
        }}
      >
        New empty set
      </button>
      {error && <p className="mt-3 text-sm text-record">{error}</p>}
      <p className="mt-4 text-sm text-pretty text-muted">
        Saved automatically in this browser. Download a project backup to preserve your audio.
      </p>
    </Sheet>
  );
}

function labelKind(kind: TrackKind): string {
  if (kind === "sample") return "Audio track";
  if (kind === "drums") return "Drum kit";
  if (kind === "bass") return "Bass synth";
  if (kind === "keys") return "Keys synth";
  return "Lead synth";
}
