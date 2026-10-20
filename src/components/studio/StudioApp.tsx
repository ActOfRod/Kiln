import { useEffect, useRef, useState } from "react";
import {
  AudioWaveform,
  Circle,
  Download,
  FilePlus2,
  FolderOpen,
  KeyboardMusic,
  LayoutGrid,
  Library,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Square,
  Timer,
  Undo2,
} from "lucide-react";
import { useStudio } from "@/studio/store";
import { formatPosition } from "@/studio/theory";
import type { StudioView, TrackKind } from "@/studio/types";
import { ArrangeView } from "./ArrangeView";
import { MixView } from "./MixView";
import { PlayView } from "./PlayView";
import { SessionView } from "./SessionView";
import { DeviceSheet, EditorSheet, PatternSheet } from "./Sheets";
import { LibraryBrowser } from "./LibraryBrowser";
import { TrackInspector } from "./TrackInspector";
import { ExportDialog } from "./ExportDialog";
import { CollabButton, ShareDialog } from "./Collaboration";
import { initCollab, useCollab } from "@/collab/session";
import { Sheet, cx } from "./ui";
import lineageHtml from "../../../docs/lineage/index.html?raw";

const views: Array<{ id: StudioView; label: string; icon: typeof LayoutGrid }> = [
  { id: "arrange", label: "Arrangement", icon: AudioWaveform },
  { id: "session", label: "Session", icon: LayoutGrid },
  { id: "mix", label: "Mixer", icon: SlidersHorizontal },
  { id: "play", label: "Instruments", icon: KeyboardMusic },
];

export function StudioApp() {
  const project = useStudio((s) => s.project);
  const view = useStudio((s) => s.view);
  const playing = useStudio((s) => s.playing);
  const recording = useStudio((s) => s.recording);
  const metronome = useStudio((s) => s.metronome);
  const beat = useStudio((s) => s.beat);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const error = useStudio((s) => s.audioError);
  const inRoom = useCollab((s) => !!s.room);
  const [sheet, setSheet] = useState<
    "device" | "editor" | "pattern" | "export" | "add" | "project" | "lineage" | null
  >(null);
  const [deviceTrack, setDeviceTrack] = useState<string | null>(null);
  const [library, setLibrary] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = (action: () => Promise<void>, success: string) => {
    setMessage(null);
    setBusy(true);
    void action()
      .then(() => setMessage(success))
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (window.innerWidth < 760) setLibrary(false);
    let stopCollab: (() => void) | undefined;
    void Promise.resolve(useStudio.persist.rehydrate()).then(() => {
      stopCollab = initCollab();
    });
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
        event.preventDefault();
        if (!document.querySelector("[role=dialog]"))
          void useStudio
            .getState()
            .saveProject()
            .catch((err: unknown) => useStudio.setState({ audioError: String(err) }));
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable], [role=dialog]")
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ") {
        event.preventDefault();
        if (event.shiftKey) useStudio.getState().redo();
        else useStudio.getState().undo();
        return;
      }
      if (document.querySelector("[role=dialog]")) return;
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        void useStudio.getState().togglePlay();
      }
      if (event.key === "Escape") useStudio.getState().stop();
    };
    const unsub = useStudio.persist.onFinishHydration(() => {
      useStudio.setState({ past: [], future: [] });
    });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unsub();
      stopCollab?.();
    };
  }, []);
  const openDevice = (id?: string) => {
    setDeviceTrack(id ?? useStudio.getState().selectedTrackId);
    setSheet("device");
  };
  return (
    <div
      className="studio desktop-studio"
      onPointerDownCapture={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === "range")
          useStudio.getState().beginEdit();
      }}
      onPointerUpCapture={() => useStudio.getState().endEdit()}
      onPointerCancelCapture={() => useStudio.getState().endEdit()}
    >
      <header className="studio-header">
        <button
          className="brand-lockup"
          onClick={() => setSheet("project")}
          title="Project settings"
        >
          <span className="brand-symbol">≋</span>
          <span>
            KILN<small>DESKTOP STUDIO</small>
          </span>
        </button>
        <div className="project-title">
          <input
            aria-label="Project name"
            value={project.name}
            onChange={(event) => useStudio.getState().renameProject(event.target.value)}
          />
          <span>
            {project.tracks.length} tracks · 4/4 ·{" "}
            {inRoom ? "shared live session" : "local project"}
          </span>
        </div>
        <div className="transport-cluster">
          <button
            aria-label="Stop"
            className="icon-button"
            onClick={() => useStudio.getState().stop()}
          >
            <Square size={16} fill="currentColor" />
          </button>
          <button
            aria-label={playing ? "Pause" : "Play"}
            className={cx("transport-play", playing && "active")}
            onClick={() => void useStudio.getState().togglePlay()}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            aria-label="Record MIDI"
            aria-pressed={recording}
            title="Record notes in Instruments into the selected session clip"
            className={cx("icon-button record-button", recording && "active")}
            onClick={() => useStudio.getState().toggleRecord()}
          >
            <Circle size={17} fill={recording ? "currentColor" : "none"} />
          </button>
          <span className="transport-position">{formatPosition(beat)}</span>
          <label className="tempo-input">
            <input
              aria-label="Tempo BPM"
              type="number"
              min={40}
              max={240}
              value={project.bpm}
              onChange={(event) => {
                if (event.target.value) useStudio.getState().setBpm(Number(event.target.value));
              }}
            />
            <span>BPM</span>
          </label>
          <button
            aria-label="Metronome"
            aria-pressed={metronome}
            className={cx("icon-button", metronome && "active")}
            onClick={() => useStudio.getState().toggleMetronome()}
          >
            <Timer size={17} />
          </button>
        </div>
        <div className="header-actions">
          <CollabButton />
          <button
            className="icon-button"
            title="Open project"
            aria-label="Open project"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            <FolderOpen size={17} />
          </button>
          <button
            className="icon-button"
            title="Save portable project (⌘/Ctrl S)"
            aria-label="Save project"
            disabled={busy}
            onClick={() =>
              run(
                () => useStudio.getState().saveProject(),
                "Portable project downloaded, including audio.",
              )
            }
          >
            <Save size={17} />
          </button>
          <button className="studio-button primary" onClick={() => setSheet("export")}>
            <Download size={15} />
            Export
          </button>
        </div>
      </header>
      <div className="studio-toolbar">
        <button
          className={cx("icon-button", library && "active")}
          aria-label="Toggle library"
          aria-pressed={library}
          onClick={() => setLibrary(!library)}
        >
          <Library size={17} />
        </button>
        <div className="view-tabs" role="tablist" aria-label="Studio views">
          {views.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={view === item.id}
              className={cx(view === item.id && "active")}
              onClick={() => useStudio.getState().setView(item.id)}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <button
          className="icon-button"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={() => useStudio.getState().undo()}
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={() => useStudio.getState().redo()}
        >
          <Redo2 size={16} />
        </button>
        <button className="icon-button" aria-label="Track sound" onClick={() => openDevice()}>
          <SlidersHorizontal size={16} />
        </button>
        <button className="studio-button" onClick={() => setSheet("add")}>
          <Plus size={15} />
          Add track
        </button>
      </div>
      {(error || message) && (
        <div className="studio-notice" role="status">
          <span>{error || message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              setMessage(null);
              useStudio.setState({ audioError: null });
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="studio-workspace">
        {library && <LibraryBrowser />}
        <main
          className="studio-main"
          aria-label={`${views.find((item) => item.id === view)?.label} workspace`}
        >
          {view === "arrange" && <ArrangeView />}
          {view === "session" && (
            <SessionView
              onEdit={() => setSheet("editor")}
              onPattern={() => setSheet("pattern")}
              onDevice={() => openDevice()}
            />
          )}
          {view === "mix" && <MixView onDevice={openDevice} />}
          {view === "play" && <PlayView />}
        </main>
        <TrackInspector onDevice={openDevice} />
      </div>
      <footer className="studio-status">
        <span>
          <i className={playing ? "status-light live" : "status-light"} />
          {playing
            ? `Playing ${useStudio.getState().follow === "arrange" ? "arrangement" : "session"}`
            : "Ready to create"}
        </span>
        <span className="shortcut-hint">
          Space play / pause · Esc stop · ⌘/Ctrl Z undo · drag regions to move
        </span>
        <button onClick={() => setSheet("lineage")}>Data Sources &amp; Lineage</button>
      </footer>
      <input
        type="file"
        ref={file}
        hidden
        accept=".kiln,.json"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected)
            run(
              () => useStudio.getState().openProject(selected),
              "Project opened. Previous project is available with Undo.",
            );
        }}
      />
      {sheet === "device" && deviceTrack && (
        <DeviceSheet trackId={deviceTrack} onClose={() => setSheet(null)} />
      )}
      {sheet === "editor" && <EditorSheet onClose={() => setSheet(null)} />}
      {sheet === "pattern" && <PatternSheet onClose={() => setSheet(null)} />}
      {sheet === "export" && <ExportDialog onClose={() => setSheet(null)} />}
      <ShareDialog />
      {sheet === "add" && (
        <Sheet title="Add a track" onClose={() => setSheet(null)}>
          <p className="text-sm text-muted mb-4">
            An instrument or audio lane, with its own mixer and effects. Up to 32 tracks.
          </p>
          <div className="grid gap-2">
            {(["drums", "bass", "keys", "lead", "sample"] as TrackKind[]).map((kind) => (
              <button
                key={kind}
                disabled={project.tracks.length >= 32}
                className="studio-button justify-start h-12 capitalize"
                onClick={() => {
                  useStudio.getState().addTrack(kind);
                  setSheet(null);
                }}
              >
                {kind === "sample" ? "Audio / microphone" : `${kind} instrument`}
                <Plus size={15} className="ml-auto" />
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "project" && (
        <Sheet title="Project settings" onClose={() => setSheet(null)}>
          <label className="dialog-field">
            Song length in bars
            <input
              aria-label="Song length in bars"
              type="number"
              min={1}
              max={128}
              value={project.bars}
              onChange={(event) => {
                if (event.target.value) useStudio.getState().setBars(Number(event.target.value));
              }}
            />
          </label>
          <p className="text-xs text-muted mb-4">
            Song length cannot be shorter than existing regions. Maximum 128 bars.
          </p>
          <label className="dialog-field">
            Swing · {Math.round(project.swing * 100)}%
            <input
              type="range"
              aria-label="Swing"
              min={0}
              max={0.6}
              step={0.01}
              value={project.swing}
              onChange={(event) => useStudio.getState().setSwing(Number(event.target.value))}
            />
          </label>
          <p className="text-sm text-muted mb-4">
            Projects auto-save in this browser. Download a portable project to keep a backup or
            transfer your song.
          </p>
          <button
            className="studio-button w-full mb-2"
            onClick={() => {
              useStudio.getState().newSet();
              setSheet(null);
            }}
          >
            <FilePlus2 size={15} />
            New empty project (undoable)
          </button>
          <button
            className="studio-button w-full"
            onClick={() => {
              useStudio.getState().resetDemo();
              setSheet(null);
            }}
          >
            Load Night Drive demo (undoable)
          </button>
        </Sheet>
      )}
      {sheet === "lineage" && (
        <Sheet title="Data Sources & Lineage" onClose={() => setSheet(null)} wide>
          <h3 className="text-lg mb-3">
            Your music stays on your device unless you start a live session.
          </h3>
          <div className="space-y-4 text-sm text-muted">
            <p>
              <strong className="text-fg">
                Patterns → tracks → regions → master → audio file.
              </strong>{" "}
              Factory note patterns and your edits feed the shared Web Audio instrument and effects
              engine. Arrangement and session exports use that same signal chain.
            </p>
            <p>
              <strong className="text-fg">
                Imported audio → library (IndexedDB) → independent clip audio.
              </strong>{" "}
              Library metadata stores name, tags, favorites, duration and import date. Each audio
              clip keeps its own immutable copy, so deleting a library sound never breaks a song.
            </p>
            <p>
              <strong className="text-fg">Project edits → browser localStorage.</strong> Clip audio
              is stored separately in IndexedDB. Portable .kiln files include project metadata and
              original audio. Clearing browser data removes local songs and library files;
              downloaded backups remain yours.
            </p>
            <p>
              <strong className="text-fg">
                Live session → Supabase (kiln_rooms, kiln_room_assets).
              </strong>{" "}
              Only when you press Share or open a share link, the song snapshot and the audio files
              it uses are stored in the cloud so collaborators can open them. Database tables are
              reachable only through functions that require the link’s secret; only a hash of the
              secret is stored. Cursors and selections travel as live messages and are not saved.
              Leaving a session returns your own browser song unchanged.
            </p>
            <p>
              <strong className="text-fg">No accounts, warehouse tables or analytics.</strong>{" "}
              Browser storage is not a cross-device backup. Microphone access is requested only when
              you start recording.
            </p>
            <p>
              MP3 is encoded locally at your chosen bitrate; WAV is stereo 16-bit PCM at 44.1 kHz.
              Audio is not sent to an encoding service.
            </p>
            <details>
              <summary className="cursor-pointer text-accent">
                Technical inventory and table-lineage applicability
              </summary>
              <iframe
                className="mt-3 h-96 w-full rounded-md border border-line"
                title="Technical lineage inventory"
                sandbox="allow-scripts"
                srcDoc={lineageHtml}
              />
            </details>
          </div>
        </Sheet>
      )}
    </div>
  );
}
