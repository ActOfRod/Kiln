import { useEffect, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { engine } from "@/studio/engine";
import { useStudio } from "@/studio/store";
import { CLIP_BG, cx } from "./ui";

const PX = 18;

export function ArrangeView() {
  const project = useStudio((s) => s.project);
  const playing = useStudio((s) => s.playing);
  const follow = useStudio((s) => s.follow);
  const launched = useStudio((s) => s.launched);
  const captureScene = useStudio((s) => s.captureScene);
  const returnToSong = useStudio((s) => s.returnToSong);
  const moveArrangeClip = useStudio((s) => s.moveArrangeClip);
  const deleteArrangeClip = useStudio((s) => s.deleteArrangeClip);
  const sceneName = useStudio((s) => s.project.scenes[s.selectedScene]?.name ?? "Scene");
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ trackId: string; clipId: string } | null>(null);
  const override = follow === "arrange" && Object.values(launched).some((l) => l.clipIndex >= 0);

  useEffect(() => {
    const node = head.current;
    if (!node) return;
    let frame = 0;
    const loop = () => {
      node.style.transform = `translateX(${engine.currentBeat() * PX}px)`;
      if (playing && scroller.current) {
        const x = engine.currentBeat() * PX;
        const view = scroller.current;
        const local = x - view.scrollLeft;
        if (local > view.clientWidth * 0.75 || local < 24) {
          view.scrollLeft = Math.max(0, x - 48);
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const width = project.bars * 4 * PX;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-3 py-2">
        <p className="min-w-0 flex-1 text-sm text-pretty text-muted">
          {project.bars} bars · loops · drop <span className="text-fg">{sceneName}</span> onto the song
        </p>
        <button
          type="button"
          className="press flex h-11 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-accent-ink"
          onClick={captureScene}
        >
          <Download className="size-4" />
          Drop scene
        </button>
        {selected && (
          <button
            type="button"
            className="press flex h-11 shrink-0 items-center gap-1.5 rounded-md bg-surface-2 px-3 text-sm"
            onClick={() => {
              deleteArrangeClip(selected.trackId, selected.clipId);
              setSelected(null);
            }}
          >
            <Trash2 className="size-4" />
            Remove
          </button>
        )}
      </div>
      {follow === "session" && playing && (
        <p className="shrink-0 bg-surface-2 px-3 py-2 text-sm text-pretty text-muted">
          You're hearing the session. Stop, then press play on this screen to run the song.
        </p>
      )}
      {override && (
        <button
          type="button"
          className="press h-11 shrink-0 bg-accent text-sm font-semibold text-accent-ink"
          onClick={returnToSong}
        >
          Clips are overriding the song. Back to song
        </button>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: width + 112 }}>
          <div className="sticky top-0 z-20 ml-28 flex h-8 border-b border-line bg-bg" style={{ width }}>
            {Array.from({ length: project.bars }, (_, bar) => (
              <div key={bar} className="shrink-0 border-l border-line pl-1 text-xs text-muted" style={{ width: PX * 4 }}>
                {bar + 1}
              </div>
            ))}
          </div>
          {project.tracks.map((track) => (
            <div key={track.id} className="flex h-16 border-b border-line">
              <div className="sticky left-0 z-10 flex w-28 shrink-0 items-center gap-2 border-r border-line bg-bg px-2">
                <span className={cx("h-3 w-3 rounded-full", CLIP_BG[track.color])} />
                <span className="truncate text-sm font-medium">{track.name}</span>
              </div>
              <div className="relative h-full" style={{ width }}>
                {track.arrangement.map((clip) => (
                  <ArrangeBlock
                    key={clip.id}
                    name={clip.name}
                    colorClass={CLIP_BG[clip.color]}
                    start={clip.start}
                    length={clip.length}
                    active={selected?.clipId === clip.id}
                    onSelect={() => setSelected({ trackId: track.id, clipId: clip.id })}
                    onMove={(start) => moveArrangeClip(track.id, clip.id, start)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div
            ref={head}
            className="pointer-events-none absolute top-8 bottom-0 z-30 w-0.5 bg-fg"
            style={{ left: 112 }}
          />
        </div>
      </div>
    </div>
  );
}

function ArrangeBlock({
  name,
  colorClass,
  start,
  length,
  active,
  onSelect,
  onMove,
}: {
  name: string;
  colorClass: string;
  start: number;
  length: number;
  active: boolean;
  onSelect: () => void;
  onMove: (start: number) => void;
}) {
  const origin = useRef(0);
  const base = useRef(start);

  return (
    <button
      type="button"
      className={cx(
        "press absolute top-1.5 bottom-1.5 overflow-hidden rounded-md px-2 text-left text-xs font-semibold",
        colorClass,
        active && "ring-2 ring-fg",
      )}
      style={{ left: start * PX, width: Math.max(PX * 2, length * PX - 4) }}
      onPointerDown={(event) => {
        onSelect();
        origin.current = event.clientX;
        base.current = start;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bars = Math.round((event.clientX - origin.current) / (PX * 4));
        const next = Math.max(0, base.current + bars * 4);
        if (next !== start) onMove(next);
      }}
    >
      <span className="truncate">{name}</span>
    </button>
  );
}
