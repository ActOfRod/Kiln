import { ArrowDown, ArrowUp, Copy, SlidersHorizontal, Trash2 } from "lucide-react";
import { useStudio } from "@/studio/store";
import { instrumentOf } from "@/studio/instruments";
import { CLIP_BG, Field, cx } from "./ui";
import { ResizeHandle, sidePaneRoom, useLayout } from "./layout";

export function TrackInspector({ onDevice }: { onDevice: (id: string) => void }) {
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === s.selectedTrackId));
  const count = useStudio((s) => s.project.tracks.length);
  const master = useStudio((s) => s.project.master);
  const inspectorWidth = useLayout((s) => s.inspectorWidth);
  if (!track) return null;
  const act = useStudio.getState();
  const gain =
    track.volume > 0 ? `${(20 * Math.log10(track.volume ** 1.45)).toFixed(1)} dB` : "−∞ dB";
  return (
    <>
      <ResizeHandle
        axis="x"
        direction={-1}
        label="Resize inspector"
        className="inspector-resizer"
        value={inspectorWidth}
        measure={(handle) => handle.nextElementSibling?.getBoundingClientRect().width ?? 222}
        bounds={(handle) => [200, Math.min(480, sidePaneRoom(handle, handle.nextElementSibling))]}
        onChange={(size) => useLayout.getState().set({ inspectorWidth: size })}
        onReset={() => useLayout.getState().set({ inspectorWidth: null })}
      />
      <aside className="track-inspector" aria-label="Track inspector">
        <div className="panel-title">
          <SlidersHorizontal size={14} />
          <h2>Inspector</h2>
        </div>
        <div className="inspector-content">
          <div className="flex items-center gap-2 mb-1">
            <span className={cx("size-2.5 rounded-full", CLIP_BG[track.color])} />
            <span className="section-label !m-0">
              {track.kind === "sample" ? "Audio track" : `${track.kind} instrument`}
            </span>
          </div>
          <input
            aria-label="Selected track name"
            className="inspector-name"
            value={track.name}
            onChange={(event) => act.renameTrack(track.id, event.target.value)}
          />
          <div className="flex gap-2 my-3">
            <button
              aria-pressed={track.mute}
              className={cx("studio-button flex-1", track.mute && "active")}
              onClick={() => act.toggleMute(track.id)}
            >
              Mute
            </button>
            <button
              aria-pressed={track.solo}
              className={cx("studio-button flex-1", track.solo && "active")}
              onClick={() => act.toggleSolo(track.id)}
            >
              Solo
            </button>
          </div>
          <Field
            label="Volume"
            value={track.volume}
            min={0}
            max={1}
            step={0.01}
            display={gain}
            onChange={(value) => act.setVolume(track.id, value)}
          />
          <Field
            label="Pan"
            value={track.pan}
            min={-1}
            max={1}
            step={0.01}
            display={
              Math.abs(track.pan) < 0.01
                ? "Center"
                : `${Math.round(Math.abs(track.pan) * 100)} ${track.pan < 0 ? "L" : "R"}`
            }
            onChange={(value) => act.setPan(track.id, value)}
          />
          <p className="section-label">Sound & effects</p>
          <button className="device-card" onClick={() => onDevice(track.id)}>
            <SlidersHorizontal size={17} />
            <strong>
              {track.kind === "sample"
                ? "Audio sampler"
                : instrumentOf(track.kind, track.device).name}
            </strong>
            <span>Change instrument & effects →</span>
          </button>
          <Field
            label="Filter"
            min={80}
            max={14000}
            step={10}
            value={track.device.cutoff}
            display={`${Math.round(track.device.cutoff)} Hz`}
            onChange={(cutoff) => act.updateDevice(track.id, { cutoff })}
          />
          <Field
            label="Reverb"
            min={0}
            max={0.7}
            step={0.01}
            value={track.device.reverb}
            display={`${Math.round(track.device.reverb * 100)}%`}
            onChange={(reverb) => act.updateDevice(track.id, { reverb })}
          />
          <Field
            label="Delay"
            min={0}
            max={0.7}
            step={0.01}
            value={track.device.delayMix}
            display={`${Math.round(track.device.delayMix * 100)}%`}
            onChange={(delayMix) => act.updateDevice(track.id, { delayMix })}
          />
          <div className="track-tools">
            <button
              className="icon-button"
              aria-label="Move track up"
              onClick={() => act.reorderTrack(track.id, -1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Move track down"
              onClick={() => act.reorderTrack(track.id, 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Duplicate track"
              disabled={count >= 32}
              onClick={() =>
                void act
                  .duplicateTrack(track.id)
                  .catch((error: unknown) => useStudio.setState({ audioError: String(error) }))
              }
            >
              <Copy size={14} />
            </button>
            <button
              className="icon-button text-record"
              aria-label="Delete track"
              disabled={count <= 1}
              onClick={() => act.removeTrack(track.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="master-section">
          <p className="section-label">Master output</p>
          <Field
            label="Level"
            min={0}
            max={1}
            step={0.01}
            value={master}
            display={`${Math.round(master * 100)}%`}
            onChange={act.setMaster}
          />
          <p className="text-xs text-faint">Stereo · soft compressor</p>
        </div>
      </aside>
    </>
  );
}
