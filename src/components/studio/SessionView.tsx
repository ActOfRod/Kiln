import { useRef } from "react";
import { Copy, Music2, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useStudio, phaseFor } from "@/studio/store";
import { CLIP_BG, cx } from "./ui";

export function SessionView({
  onEdit,
  onPattern,
  onDevice,
}: {
  onEdit: () => void;
  onPattern: () => void;
  onDevice: () => void;
}) {
  const project = useStudio((s) => s.project);
  const selectedSlot = useStudio((s) => s.selectedSlot);
  const launchClip = useStudio((s) => s.launchClip);
  const launchScene = useStudio((s) => s.launchScene);
  const clearClip = useStudio((s) => s.clearClip);
  const duplicateClip = useStudio((s) => s.duplicateClip);
  const renameScene = useStudio((s) => s.renameScene);
  const selectTrack = useStudio((s) => s.selectTrack);

  const slotTrack = project.tracks.find((t) => t.id === selectedSlot?.trackId);
  const slotClip = selectedSlot ? slotTrack?.clips[selectedSlot.scene] : null;
  const sceneName = project.scenes[selectedSlot?.scene ?? 0]?.name ?? "Scene";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-3 py-2">
        <SceneName
          name={project.scenes[useStudio.getState().selectedScene]?.name ?? sceneName}
          onRename={(name) => renameScene(useStudio.getState().selectedScene, name)}
        />
        <BarButton label="Sound" onClick={onDevice}>
          <SlidersHorizontal className="size-4" />
        </BarButton>
        <BarButton label="Pattern" onClick={onPattern} disabled={!selectedSlot}>
          <Music2 className="size-4" />
        </BarButton>
        <BarButton label="Edit" onClick={onEdit} disabled={!slotClip}>
          <Pencil className="size-4" />
        </BarButton>
        <BarButton
          label="Copy"
          disabled={!slotClip || !selectedSlot}
          onClick={() => selectedSlot && duplicateClip(selectedSlot.trackId, selectedSlot.scene)}
        >
          <Copy className="size-4" />
        </BarButton>
        <BarButton
          label="Clear"
          disabled={!slotClip || !selectedSlot}
          onClick={() => selectedSlot && clearClip(selectedSlot.trackId, selectedSlot.scene)}
        >
          <Trash2 className="size-4" />
        </BarButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-w-full">
          {project.tracks.map((track) => (
            <div key={track.id} className="w-36 shrink-0 border-r border-line sm:w-44 lg:w-auto lg:min-w-44 lg:flex-1">
              <div className="sticky top-0 z-20 flex h-12 items-center bg-bg">
                <button
                  type="button"
                  className="press flex h-12 min-w-0 flex-1 items-center gap-2 px-2 text-left"
                  onClick={() => selectTrack(track.id)}
                >
                  <span className={cx("h-3 w-3 shrink-0 rounded-full", CLIP_BG[track.color])} />
                  <span className="truncate text-sm font-semibold">{track.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${track.name} mute`}
                  aria-pressed={track.mute}
                  className={cx(
                    "press grid h-12 w-11 place-items-center text-xs font-semibold",
                    track.mute ? "bg-fg text-bg" : "text-muted",
                  )}
                  onClick={() => useStudio.getState().toggleMute(track.id)}
                >
                  M
                </button>
                <button
                  type="button"
                  aria-label={`${track.name} solo`}
                  aria-pressed={track.solo}
                  className={cx(
                    "press grid h-12 w-11 place-items-center text-xs font-semibold",
                    track.solo ? "bg-accent text-accent-ink" : "text-muted",
                  )}
                  onClick={() => useStudio.getState().toggleSolo(track.id)}
                >
                  S
                </button>
              </div>
              <div className="flex flex-col gap-1.5 p-1.5">
                {project.scenes.map((scene, sceneIndex) => (
                  <ClipCell
                    key={scene.id}
                    trackId={track.id}
                    scene={sceneIndex}
                    onOpen={(hasClip) => {
                      void launchClip(track.id, sceneIndex).then(() => {
                        if (!hasClip) onPattern();
                      });
                    }}
                    onEdit={() => {
                      useStudio.setState({
                        selectedTrackId: track.id,
                        selectedScene: sceneIndex,
                        selectedSlot: { trackId: track.id, scene: sceneIndex },
                      });
                      if (track.clips[sceneIndex]) onEdit();
                      else onPattern();
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="sticky right-0 z-30 w-14 shrink-0 border-l border-line bg-bg">
            <div className="sticky top-0 flex h-12 items-center justify-center bg-bg text-xs font-medium text-muted">
              Run
            </div>
            <div className="flex flex-col gap-1.5 p-1.5">
              {project.scenes.map((scene, index) => (
                <SceneFire key={scene.id} index={index} name={scene.name} onLaunch={() => void launchScene(index)} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const selectedScene = useStudio((s) => s.selectedScene);
  const liveName = useStudio((s) => s.project.scenes[selectedScene]?.name ?? name);
  return (
    <label className="flex min-w-28 flex-1 flex-col">
      <span className="text-xs text-muted">Scene</span>
      <input
        value={liveName}
        aria-label="Scene name"
        className="h-8 bg-transparent text-sm font-semibold text-fg outline-none"
        onChange={(event) => onRename(event.target.value)}
      />
    </label>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="press flex h-11 shrink-0 items-center gap-1.5 rounded-md bg-surface-2 px-3 text-sm font-medium text-fg disabled:opacity-40"
    >
      {children}
      {label}
    </button>
  );
}

function ClipCell({
  trackId,
  scene,
  onOpen,
  onEdit,
}: {
  trackId: string;
  scene: number;
  onOpen: (hasClip: boolean) => void;
  onEdit: () => void;
}) {
  const clip = useStudio((s) => s.project.tracks.find((t) => t.id === trackId)?.clips[scene] ?? null);
  const color = useStudio((s) => s.project.tracks.find((t) => t.id === trackId)?.color ?? "ember");
  const selected = useStudio((s) => s.selectedSlot?.trackId === trackId && s.selectedSlot.scene === scene);
  const phase = useStudio((s) => phaseFor(trackId, scene, s.beat, s.launched, s.project));
  const timer = useRef<number>(0);
  const long = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  return (
    <button
      type="button"
      aria-label={clip ? `${clip.name} clip` : "Empty clip slot"}
      aria-pressed={phase >= 0}
      className={cx(
        "press relative h-16 w-full overflow-hidden rounded-md px-2 py-1.5 text-left",
        clip ? CLIP_BG[clip.color ?? color] : "border border-dashed border-line bg-surface-3 text-muted",
        phase >= 0 && "clip-live ring-2 ring-fg",
        selected && phase < 0 && "ring-2 ring-accent",
      )}
      onPointerDown={(event) => {
        long.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = window.setTimeout(() => {
          long.current = true;
          onEdit();
        }, 420);
      }}
      onPointerMove={(event) => {
        const dx = event.clientX - origin.current.x;
        const dy = event.clientY - origin.current.y;
        if (dx * dx + dy * dy > 64) window.clearTimeout(timer.current);
      }}
      onPointerUp={() => {
        window.clearTimeout(timer.current);
        if (!long.current) onOpen(!!clip);
      }}
      onPointerCancel={() => window.clearTimeout(timer.current)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {clip ? (
        <span className="line-clamp-2 text-sm font-semibold leading-tight">{clip.name}</span>
      ) : (
        <span className="flex h-full items-center justify-center">
          <Plus className="size-4" />
        </span>
      )}
      {phase >= 0 && (
        <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-accent-ink/25">
          <span className="block h-full bg-accent-ink" style={{ width: `${Math.min(100, phase * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

function SceneFire({ index, name, onLaunch }: { index: number; name: string; onLaunch: () => void }) {
  const active = useStudio((s) => {
    const tracks = s.project.tracks.filter((t) => t.clips[index]);
    if (tracks.length === 0) return false;
    return tracks.every((track) => {
      const launch = s.launched[track.id];
      if (!launch) return false;
      const beat = s.beat;
      const idx = beat < launch.launchBeat - 0.001 ? launch.previous?.clipIndex : launch.clipIndex;
      return idx === index;
    });
  });
  const selected = useStudio((s) => s.selectedScene === index);

  return (
    <button
      type="button"
      aria-label={`Launch ${name}`}
      className={cx(
        "press h-16 rounded-md text-sm font-semibold",
        active ? "bg-accent text-accent-ink" : selected ? "bg-surface-3 text-fg" : "bg-surface-2 text-fg",
      )}
      onClick={onLaunch}
    >
      {index + 1}
    </button>
  );
}
