import { useEffect, useState } from "react";
import {
  AudioWaveform,
  Circle,
  KeyboardMusic,
  LayoutGrid,
  Menu,
  Pause,
  Play,
  SlidersHorizontal,
  Square,
  Timer,
  X,
} from "lucide-react";
import { useStudio } from "@/studio/store";
import { formatPosition } from "@/studio/theory";
import type { StudioView } from "@/studio/types";
import { ArrangeView } from "./ArrangeView";
import { MixView } from "./MixView";
import { PlayView } from "./PlayView";
import { SessionView } from "./SessionView";
import { DeviceSheet, EditorSheet, MenuSheet, PatternSheet, TempoSheet } from "./Sheets";
import { cx } from "./ui";

type SheetId = "device" | "editor" | "pattern" | "menu" | "tempo";

export function StudioApp() {
  const view = useStudio((s) => s.view);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [deviceTrack, setDeviceTrack] = useState<string | null>(null);
  const hint = useStudio((s) => !s.hintDismissed);
  const error = useStudio((s) => s.audioError);

  useEffect(() => {
    void useStudio.persist.rehydrate();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        void useStudio.getState().togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openDevice = (trackId?: string) => {
    setDeviceTrack(trackId ?? useStudio.getState().selectedTrackId);
    setSheet("device");
  };

  return (
    <div className="studio mx-auto flex h-dvh max-w-6xl flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-bold tracking-tight">KILN</h1>
            <HearMark />
          </div>
          <button type="button" className="press block max-w-full truncate text-left text-sm text-muted" onClick={() => setSheet("menu")}>
            <SetName />
          </button>
        </div>
        <button
          type="button"
          className="press flex h-12 flex-col items-end justify-center rounded-md px-2"
          onClick={() => setSheet("tempo")}
        >
          <Bpm />
          <Position />
        </button>
        <button
          type="button"
          aria-label="Set menu"
          className="press grid h-12 w-12 place-items-center rounded-md bg-surface-2"
          onClick={() => setSheet("menu")}
        >
          <Menu className="size-5" />
        </button>
      </header>

      {error && (
        <p className="bg-record px-3 py-2 text-sm text-accent-ink">{error}</p>
      )}
      {hint && view === "session" && (
        <div className="flex shrink-0 items-start gap-2 border-b border-line bg-surface-2 px-3 py-2">
          <p className="flex-1 text-sm text-pretty">
            Press play to run Groove. Tap a clip to launch it on the next bar. Hold a clip to edit the notes.
          </p>
          <button
            type="button"
            aria-label="Dismiss tip"
            className="press grid h-11 w-11 shrink-0 place-items-center"
            onClick={() => useStudio.getState().dismissHint()}
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1">
        {view === "session" && (
          <SessionView
            onEdit={() => setSheet("editor")}
            onPattern={() => setSheet("pattern")}
            onDevice={() => openDevice()}
          />
        )}
        {view === "arrange" && <ArrangeView />}
        {view === "mix" && <MixView onDevice={(id) => openDevice(id)} />}
        {view === "play" && <PlayView />}
      </main>

      <Transport onSound={() => openDevice()} />
      <Nav />

      {sheet === "device" && deviceTrack && <DeviceSheet trackId={deviceTrack} onClose={() => setSheet(null)} />}
      {sheet === "editor" && <EditorSheet onClose={() => setSheet(null)} />}
      {sheet === "pattern" && <PatternSheet onClose={() => setSheet(null)} />}
      {sheet === "menu" && <MenuSheet onClose={() => setSheet(null)} />}
      {sheet === "tempo" && <TempoSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function SetName() {
  const name = useStudio((s) => s.project.name);
  return name;
}

function Bpm() {
  const bpm = useStudio((s) => s.project.bpm);
  return <span className="font-mono text-base font-medium tabular-nums">{bpm} bpm</span>;
}

function Position() {
  const beat = useStudio((s) => s.beat);
  return <span className="font-mono text-xs text-muted tabular-nums">{formatPosition(beat)}</span>;
}

function HearMark() {
  const playing = useStudio((s) => s.playing);
  const follow = useStudio((s) => s.follow);
  if (!playing) return <span className="text-xs text-faint">Studio</span>;
  return <span className="text-xs font-medium text-accent">{follow === "arrange" ? "Song" : "Session"}</span>;
}

function Transport({ onSound }: { onSound: () => void }) {
  const playing = useStudio((s) => s.playing);
  const recording = useStudio((s) => s.recording);
  const metronome = useStudio((s) => s.metronome);
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2">
      <button
        type="button"
        aria-label="Metronome"
        aria-pressed={metronome}
        className={cx(
          "press grid h-12 w-12 place-items-center rounded-md",
          metronome ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg",
        )}
        onClick={() => useStudio.getState().toggleMetronome()}
      >
        <Timer className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Stop"
        className="press grid h-12 w-12 place-items-center rounded-md bg-surface-2"
        onClick={() => useStudio.getState().stop()}
      >
        <Square className="size-4 fill-current" />
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        className="press grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-ink"
        onClick={() => void useStudio.getState().togglePlay()}
      >
        {playing ? <Pause className="size-6 fill-current" /> : <Play className="play-nudge size-6 fill-current" />}
      </button>
      <button
        type="button"
        aria-label="Record"
        aria-pressed={recording}
        className={cx(
          "press grid h-12 w-12 place-items-center rounded-full",
          recording ? "bg-record text-accent-ink" : "bg-surface-2 text-record",
        )}
        onClick={() => useStudio.getState().toggleRecord()}
      >
        <Circle className={cx("size-5", recording && "fill-current")} />
      </button>
      <button
        type="button"
        aria-label="Sound"
        className="press grid h-12 w-12 place-items-center rounded-md bg-surface-2"
        onClick={onSound}
      >
        <SlidersHorizontal className="size-5" />
      </button>
    </div>
  );
}

function Nav() {
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const items: Array<{ id: StudioView; label: string; icon: typeof LayoutGrid }> = [
    { id: "session", label: "Session", icon: LayoutGrid },
    { id: "arrange", label: "Song", icon: AudioWaveform },
    { id: "mix", label: "Mix", icon: SlidersHorizontal },
    { id: "play", label: "Play", icon: KeyboardMusic },
  ];
  return (
    <nav className="safe-bottom grid shrink-0 grid-cols-4 border-t border-line" aria-label="Studio">
      {items.map((item) => {
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            className={cx(
              "press flex h-14 flex-col items-center justify-center gap-1 text-xs font-medium",
              active ? "text-accent" : "text-muted",
            )}
            onClick={() => setView(item.id)}
          >
            <Icon className="size-5" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
