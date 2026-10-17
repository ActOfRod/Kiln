import { useEffect, useState } from "react";
import { useStudio } from "@/studio/store";
import { DRUMS, noteName } from "@/studio/theory";
import { CLIP_BG, cx } from "./ui";

const WHITES = [0, 2, 4, 5, 7, 9, 11];
const BLACKS: Array<{ semi: number; pos: number } | null> = [
  { semi: 1, pos: 1 },
  { semi: 3, pos: 2 },
  null,
  { semi: 6, pos: 4 },
  { semi: 8, pos: 5 },
  { semi: 10, pos: 6 },
  null,
];

export function PlayView() {
  const tracks = useStudio((s) => s.project.tracks);
  const trackId = useStudio((s) => s.selectedTrackId);
  const selectTrack = useStudio((s) => s.selectTrack);
  const recording = useStudio((s) => s.recording);
  const sceneName = useStudio((s) => s.project.scenes[s.selectedScene]?.name ?? "Scene");
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const [octave, setOctave] = useState(track?.kind === "bass" ? 2 : track?.kind === "lead" ? 4 : 3);
  const [pressed, setPressed] = useState<number[]>([]);

  useEffect(() => {
    if (!track) return;
    if (track.kind === "bass") setOctave(2);
    else if (track.kind === "lead") setOctave(4);
    else if (track.kind !== "drums") setOctave(3);
  }, [track?.id, track?.kind]);

  useEffect(() => {
    const map: Record<string, number> = {};
    const whiteKeys = ["a", "s", "d", "f", "g", "h", "j"];
    const blackKeys = ["w", "e", "", "t", "y", "u", ""];
    whiteKeys.forEach((key, i) => {
      map[key] = octave * 12 + (WHITES[i] ?? 0);
    });
    blackKeys.forEach((key, i) => {
      const semi = BLACKS[i]?.semi;
      if (key && semi != null) map[key] = octave * 12 + semi;
    });
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const pitch = map[event.key.toLowerCase()];
      if (pitch == null || !track || track.kind === "drums" || track.kind === "sample") return;
      event.preventDefault();
      setPressed((list) => (list.includes(pitch) ? list : [...list, pitch]));
      void useStudio.getState().noteOn(pitch);
    };
    const up = (event: KeyboardEvent) => {
      const pitch = map[event.key.toLowerCase()];
      if (pitch == null) return;
      setPressed((list) => list.filter((p) => p !== pitch));
      useStudio.getState().noteOff(pitch);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [octave, track?.id, track?.kind]);

  if (!track) return null;

  const press = (pitch: number) => {
    setPressed((list) => (list.includes(pitch) ? list : [...list, pitch]));
    void useStudio.getState().noteOn(pitch);
  };
  const release = (pitch: number) => {
    setPressed((list) => list.filter((p) => p !== pitch));
    useStudio.getState().noteOff(pitch);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto px-3 py-3">
      <div className="flex gap-2 overflow-x-auto">
        {tracks.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cx(
              "press h-11 shrink-0 rounded-full px-3 text-sm font-semibold",
              item.id === track.id ? CLIP_BG[item.color] : "bg-surface-2 text-fg",
            )}
            onClick={() => selectTrack(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="text-sm text-pretty text-muted">
        {recording
          ? `Recording into ${sceneName} on ${track.name}. Turn record off when the take feels right.`
          : track.kind === "sample"
            ? "This track plays an imported recording. Open Sound to load or trim audio."
            : "Play live. Arm record, then hit notes — they land in the selected scene, quantized."}
      </p>
      {track.kind === "drums" ? (
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {DRUMS.map((drum) => {
            const on = pressed.includes(drum.pitch);
            return (
              <button
                key={drum.pitch}
                type="button"
                className={cx(
                  "press flex min-h-24 flex-col items-start justify-between rounded-md p-3 text-left",
                  on ? "bg-accent text-accent-ink" : CLIP_BG[track.color],
                )}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  press(drum.pitch);
                }}
                onPointerUp={() => release(drum.pitch)}
                onPointerCancel={() => release(drum.pitch)}
              >
                <span className="font-mono text-xs">{drum.short}</span>
                <span className="text-lg font-semibold">{drum.name}</span>
              </button>
            );
          })}
        </div>
      ) : track.kind === "sample" ? (
        <div className="grid flex-1 place-items-center rounded-md bg-surface px-6 text-center">
          <p className="max-w-xs text-pretty text-muted">
            Launch the audio clip from Session, or open Sound to import a file from this phone and trim it.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-end gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="press h-11 rounded-md bg-surface-2 px-4 text-sm font-semibold"
              onClick={() => setOctave((o) => Math.max(1, o - 1))}
            >
              Octave down
            </button>
            <span className="font-mono text-sm tabular-nums">{noteName(octave * 12)}</span>
            <button
              type="button"
              className="press h-11 rounded-md bg-surface-2 px-4 text-sm font-semibold"
              onClick={() => setOctave((o) => Math.min(6, o + 1))}
            >
              Octave up
            </button>
          </div>
          <div className="relative h-48">
            <div className="flex h-full gap-1">
              {WHITES.map((semi) => {
                const pitch = octave * 12 + semi;
                const on = pressed.includes(pitch);
                return (
                  <button
                    key={semi}
                    type="button"
                    aria-label={noteName(pitch)}
                    className={cx(
                      "press relative h-full flex-1 rounded-md border border-line text-xs font-semibold",
                      on ? "bg-accent text-accent-ink" : "bg-fg text-accent-ink",
                    )}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      press(pitch);
                    }}
                    onPointerUp={() => release(pitch)}
                    onPointerCancel={() => release(pitch)}
                  >
                    <span className="absolute inset-x-0 bottom-2 text-center">{noteName(pitch)}</span>
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[58%]">
              {BLACKS.map((black) => {
                if (!black) return null;
                const pitch = octave * 12 + black.semi;
                const on = pressed.includes(pitch);
                return (
                  <button
                    key={black.semi}
                    type="button"
                    aria-label={noteName(pitch)}
                    className={cx(
                      "pointer-events-auto press absolute top-0 z-10 h-full w-8 rounded-md text-xs font-semibold",
                      on ? "bg-accent text-accent-ink" : "bg-bg text-fg",
                    )}
                    style={{ left: `${(black.pos / 7) * 100}%`, marginLeft: "-1rem" }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      press(pitch);
                    }}
                    onPointerUp={() => release(pitch)}
                    onPointerCancel={() => release(pitch)}
                  />
                );
              })}
            </div>
          </div>
          <p className="text-center text-xs text-faint">Computer keys A–J play the white keys, W E T Y U the black keys.</p>
        </div>
      )}
    </div>
  );
}
