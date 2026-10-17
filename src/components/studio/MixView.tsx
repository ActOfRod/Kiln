import { useEffect, useRef } from "react";
import { engine } from "@/studio/engine";
import { useStudio } from "@/studio/store";
import { CLIP_BG, cx, Fader } from "./ui";

export function MixView({ onDevice }: { onDevice: (trackId: string) => void }) {
  const tracks = useStudio((s) => s.project.tracks);
  const master = useStudio((s) => s.project.master);
  const setMaster = useStudio((s) => s.setMaster);
  const setVolume = useStudio((s) => s.setVolume);
  const setPan = useStudio((s) => s.setPan);
  const toggleMute = useStudio((s) => s.toggleMute);
  const toggleSolo = useStudio((s) => s.toggleSolo);

  return (
    <div className="flex h-full snap-x snap-mandatory gap-2 overflow-x-auto px-3 py-3">
      {tracks.map((track) => (
        <section
          key={track.id}
          className="flex h-full w-24 shrink-0 snap-center flex-col gap-2 rounded-md bg-surface p-2"
        >
          <button type="button" className="press truncate text-left text-sm font-semibold" onClick={() => onDevice(track.id)}>
            <span className={cx("mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle", CLIP_BG[track.color])} />
            {track.name}
          </button>
          <div className="flex min-h-0 flex-1 gap-2">
            <Meter trackId={track.id} />
            <Fader label={`${track.name} volume`} value={track.volume} onChange={(value) => setVolume(track.id, value)} />
          </div>
          <label className="flex flex-col">
            <span className="text-xs text-muted">Pan</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={track.pan}
              aria-label={`${track.name} pan`}
              onChange={(event) => setPan(track.id, Number(event.target.value))}
            />
          </label>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              aria-pressed={track.mute}
              className={cx("press h-11 rounded-md text-sm font-semibold", track.mute ? "bg-fg text-bg" : "bg-surface-2")}
              onClick={() => toggleMute(track.id)}
            >
              M
            </button>
            <button
              type="button"
              aria-pressed={track.solo}
              className={cx(
                "press h-11 rounded-md text-sm font-semibold",
                track.solo ? "bg-accent text-accent-ink" : "bg-surface-2",
              )}
              onClick={() => toggleSolo(track.id)}
            >
              S
            </button>
          </div>
        </section>
      ))}
      <section className="flex h-full w-24 shrink-0 snap-center flex-col gap-2 rounded-md bg-surface-2 p-2">
        <p className="text-sm font-semibold">Master</p>
        <div className="flex min-h-0 flex-1 gap-2">
          <Meter trackId="__master" />
          <Fader label="Master volume" value={master} onChange={setMaster} />
        </div>
        <p className="text-center font-mono text-xs text-muted tabular-nums">{Math.round(master * 100)}</p>
      </section>
    </div>
  );
}

function Meter({ trackId }: { trackId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const el = ref.current;
      if (el) {
        const level = trackId === "__master" ? engine.masterLevel() : engine.level(trackId);
        el.style.transform = `scaleY(${Math.max(0.04, level)})`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [trackId]);

  return (
    <div className="relative w-2 overflow-hidden rounded-full bg-surface-3">
      <div ref={ref} className="absolute inset-x-0 bottom-0 h-full origin-bottom rounded-full bg-accent" />
    </div>
  );
}
