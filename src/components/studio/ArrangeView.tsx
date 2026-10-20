import { useEffect, useRef, useState } from "react";
import { Copy, Download, Minus, Plus, Scissors, Trash2, X } from "lucide-react";
import { engine } from "@/studio/engine";
import { useStudio } from "@/studio/store";
import { DRUMS, noteName, quantize, uid } from "@/studio/theory";
import type { ArrangeClip, Note, Track } from "@/studio/types";
import { CLIP_BG, cx } from "./ui";

const HEADER = 184;
const COLORS = { ember: "#e8893a", clay: "#d4785a", gold: "#e0c06a", sage: "#9fb58a" };

export function ArrangeView() {
  const project = useStudio((s) => s.project);
  const playing = useStudio((s) => s.playing);
  const beat = useStudio((s) => s.beat);
  const selectedTrack = useStudio((s) => s.selectedTrackId);
  const follow = useStudio((s) => s.follow);
  const launched = useStudio((s) => s.launched);
  const [px, setPx] = useState(24);
  const [snap, setSnap] = useState(1);
  const [selected, setSelected] = useState<{ trackId: string; clipId: string } | null>(null);
  const [editor, setEditor] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const selectedRegion = project.tracks
    .find((t) => t.id === selected?.trackId)
    ?.arrangement.find((c) => c.id === selected?.clipId);
  const track = project.tracks.find((t) => t.id === selected?.trackId);
  const act = useStudio.getState();

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const current = playing ? engine.currentBeat() : beat;
      if (head.current) head.current.style.transform = `translateX(${current * px}px)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, px, beat]);
  const width = project.bars * 4 * px;
  const choose = (trackId: string, clipId: string) => {
    act.selectTrack(trackId);
    setSelected({ trackId, clipId });
  };
  return (
    <div
      className="arrangement-view"
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("input, select, textarea, button")
        )
          return;
        if (selected && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          act.deleteArrangeClip(selected.trackId, selected.clipId);
          setSelected(null);
        }
        if (selected && (event.ctrlKey || event.metaKey) && event.code === "KeyD") {
          event.preventDefault();
          act.duplicateArrangeClip(selected.trackId, selected.clipId);
        }
      }}
    >
      <div className="arrange-toolbar">
        <span className="text-xs text-muted mr-auto">
          {project.bars} bars <span className="text-faint">/</span> {project.tracks.length} tracks
        </span>
        <button
          className="studio-button"
          title="Copy selected session scene to playhead"
          onClick={act.captureScene}
        >
          <Download size={13} />
          Capture scene
        </button>
        <label className="snap-control">
          Snap
          <select
            aria-label="Timeline snap"
            value={snap}
            onChange={(event) => setSnap(Number(event.target.value))}
          >
            <option value={4}>Bar</option>
            <option value={1}>Beat</option>
            <option value={0.25}>1/16</option>
          </select>
        </label>
        <button
          className="icon-button"
          aria-label="Zoom out"
          disabled={px <= 8}
          onClick={() => setPx(Math.max(8, px - 8))}
        >
          <Minus size={14} />
        </button>
        <span className="text-xs font-mono text-faint">{Math.round((px / 24) * 100)}%</span>
        <button
          className="icon-button"
          aria-label="Zoom in"
          disabled={px >= 64}
          onClick={() => setPx(Math.min(64, px + 8))}
        >
          <Plus size={14} />
        </button>
      </div>
      {(follow !== "arrange" || Object.values(launched).some((l) => l.clipIndex >= 0)) && (
        <button className="back-to-song" onClick={act.returnToSong}>
          Session playback is active — return to arrangement
        </button>
      )}
      <div ref={scroller} className="timeline-scroll">
        <div className="timeline" style={{ width: width + HEADER, minHeight: "100%" }}>
          <div className="timeline-ruler" style={{ paddingLeft: HEADER }}>
            <div className="track-ruler-label" style={{ width: HEADER }}>
              TRACKS <span>4/4</span>
            </div>
            <div className="flex" style={{ width }}>
              {Array.from({ length: project.bars }, (_, bar) => (
                <button
                  key={bar}
                  aria-label={`Seek to bar ${bar + 1}`}
                  className={cx("bar-number", bar % 4 === 0 && "major")}
                  style={{ width: px * 4 }}
                  onClick={() => act.seek(bar * 4)}
                >
                  {px >= 16 || bar % 4 === 0 ? bar + 1 : ""}
                </button>
              ))}
            </div>
          </div>
          {project.tracks.map((t, index) => (
            <div
              key={t.id}
              className={cx("arrange-track", selectedTrack === t.id && "selected-track")}
            >
              <div className="arrange-track-header" style={{ width: HEADER }}>
                <span className="track-color-strip" style={{ background: COLORS[t.color] }} />
                <button className="track-name-button" onClick={() => act.selectTrack(t.id)}>
                  <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{t.name}</strong>
                  <small>{t.kind === "sample" ? "AUDIO" : t.kind.toUpperCase()}</small>
                </button>
                <div className="track-switches">
                  <button
                    aria-label={`${t.name} mute`}
                    aria-pressed={t.mute}
                    className={cx(t.mute && "active")}
                    onClick={() => act.toggleMute(t.id)}
                  >
                    M
                  </button>
                  <button
                    aria-label={`${t.name} solo`}
                    aria-pressed={t.solo}
                    className={cx(t.solo && "active")}
                    onClick={() => act.toggleSolo(t.id)}
                  >
                    S
                  </button>
                </div>
              </div>
              <div
                className="arrange-lane"
                style={{ width, backgroundSize: `${px * 4}px 100%, ${px}px 100%` }}
                onDragOver={(event) => {
                  if (Array.from(event.dataTransfer.types).includes("application/kiln-pattern"))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const patternId = event.dataTransfer.getData("application/kiln-pattern");
                  const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
                  act.addRegion(t.id, patternId, quantize(x / px, snap));
                }}
                onDoubleClick={(event) => {
                  if (event.target !== event.currentTarget || t.kind === "sample") return;
                  const start = Math.max(
                    0,
                    Math.min(
                      project.bars * 4 - snap,
                      quantize(
                        (event.clientX - event.currentTarget.getBoundingClientRect().left) / px,
                        snap,
                      ),
                    ),
                  );
                  const id = uid("arr");
                  const region: ArrangeClip = {
                    id,
                    name: "New region",
                    color: t.color,
                    start,
                    length: Math.min(4, project.bars * 4 - start),
                    patternLength: 4,
                    notes: [],
                  };
                  useStudio.setState((s) => ({
                    project: {
                      ...s.project,
                      tracks: s.project.tracks.map((item) =>
                        item.id === t.id
                          ? { ...item, arrangement: [...item.arrangement, region] }
                          : item,
                      ),
                    },
                  }));
                  choose(t.id, id);
                  setEditor(true);
                }}
              >
                {t.arrangement.map((clip) => (
                  <RegionBlock
                    key={clip.id}
                    track={t}
                    clip={clip}
                    px={px}
                    snap={snap}
                    selected={selected?.clipId === clip.id}
                    onSelect={() => choose(t.id, clip.id)}
                    onEdit={() => {
                      choose(t.id, clip.id);
                      setEditor(true);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="timeline-empty" style={{ marginLeft: HEADER }}>
            Drag a pattern from the library, or double-click a lane to create a region.
          </div>
          <div ref={head} className="timeline-playhead" style={{ left: HEADER }}>
            <span />
          </div>
        </div>
      </div>
      {selected && selectedRegion && (
        <div className="region-toolbar">
          <span className="region-color" style={{ background: COLORS[selectedRegion.color] }} />
          <strong className="truncate text-sm">{selectedRegion.name}</strong>
          <span className="text-xs text-muted">
            {(selectedRegion.length / 4).toFixed(2).replace(/\.00$/, "")} bars
          </span>
          <div className="toolbar-spacer" />
          <button className="studio-button" onClick={() => setEditor(!editor)}>
            {editor ? "Hide editor" : "Edit region"}
          </button>
          <button
            className="icon-button"
            aria-label="Duplicate region"
            onClick={() => act.duplicateArrangeClip(selected.trackId, selected.clipId)}
          >
            <Copy size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Split region at playhead"
            disabled={
              beat <= selectedRegion.start || beat >= selectedRegion.start + selectedRegion.length
            }
            onClick={() => act.splitArrangeClip(selected.trackId, selected.clipId, beat)}
          >
            <Scissors size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Delete region"
            onClick={() => {
              act.deleteArrangeClip(selected.trackId, selected.clipId);
              setSelected(null);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {editor && track && selectedRegion && (
        <RegionEditor
          key={selectedRegion.id}
          track={track}
          clip={selectedRegion}
          onClose={() => setEditor(false)}
        />
      )}
    </div>
  );
}

function RegionBlock({
  track,
  clip,
  px,
  snap,
  selected,
  onSelect,
  onEdit,
}: {
  track: Track;
  clip: ArrangeClip;
  px: number;
  snap: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const drag = useRef<{ x: number; value: number; resize: boolean } | null>(null);
  const peaks = track.kind === "sample" ? engine.peaks(track.id) : null;
  useStudio((s) => s.sampleRev);
  return (
    <div
      role="button"
      aria-label={`Region ${clip.name}`}
      tabIndex={0}
      className={cx("region-block", CLIP_BG[clip.color], selected && "region-selected")}
      style={{ left: clip.start * px, width: Math.max(8, clip.length * px - 2) }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEdit();
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          useStudio.getState().deleteArrangeClip(track.id, clip.id);
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onSelect();
        useStudio.getState().beginEdit();
        const resize =
          event.target instanceof HTMLElement && event.target.dataset.resize === "true";
        drag.current = { x: event.clientX, value: resize ? clip.length : clip.start, resize };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const next = quantize(drag.current.value + (event.clientX - drag.current.x) / px, snap);
        if (drag.current.resize)
          useStudio.getState().updateRegion(track.id, clip.id, { length: Math.max(snap, next) });
        else useStudio.getState().moveArrangeClip(track.id, clip.id, Math.max(0, next));
      }}
      onPointerUp={() => {
        drag.current = null;
        useStudio.getState().endEdit();
      }}
      onPointerCancel={() => {
        drag.current = null;
        useStudio.getState().endEdit();
      }}
    >
      <div className="region-label">{clip.name}</div>
      <svg
        className="region-preview"
        viewBox="0 0 200 32"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {peaks
          ? peaks.map((peak, i) => (
              <line
                key={i}
                x1={(i / peaks.length) * 200}
                x2={(i / peaks.length) * 200}
                y1={16 - peak * 15}
                y2={16 + peak * 15}
                stroke="currentColor"
                strokeWidth={1.4}
              />
            ))
          : clip.notes
              .slice(0, 150)
              .map((note) => (
                <rect
                  key={note.id}
                  x={(note.start / clip.patternLength) * 200}
                  y={track.kind === "drums" ? (note.pitch % 8) * 3 + 2 : 28 - (note.pitch % 24)}
                  width={Math.max(1, (note.duration / clip.patternLength) * 200)}
                  height={2}
                  fill="currentColor"
                />
              ))}
      </svg>
      <div className="region-resize" data-resize="true" title="Drag to resize" />
    </div>
  );
}

function RegionEditor({
  track,
  clip,
  onClose,
}: {
  track: Track;
  clip: ArrangeClip;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedNote = clip.notes.find((note) => note.id === selected);
  const act = useStudio.getState();
  const change = (patch: Partial<ArrangeClip>) => act.updateRegion(track.id, clip.id, patch);
  const patchNote = (patch: Partial<Note>) =>
    change({
      notes: clip.notes.map((note) => (note.id === selected ? { ...note, ...patch } : note)),
    });
  const highest = Math.max(track.kind === "bass" ? 48 : 72, ...clip.notes.map((n) => n.pitch));
  const lowest = Math.min(highest - 24, ...clip.notes.map((n) => n.pitch));
  const rows =
    track.kind === "drums"
      ? DRUMS.map((drum) => ({ pitch: drum.pitch, name: drum.name }))
      : Array.from({ length: Math.min(48, highest - lowest + 1) }, (_, i) => ({
          pitch: highest - i,
          name: noteName(highest - i),
        }));
  const cell = 22;
  return (
    <section className="region-editor" aria-label="Region editor">
      <div className="editor-title">
        <input
          aria-label="Region name"
          value={clip.name}
          onChange={(event) => change({ name: event.target.value.slice(0, 40) })}
        />
        <span className="text-xs text-muted">
          {track.kind === "sample" ? "AUDIO REGION" : "PIANO ROLL"}
        </span>
        <button className="icon-button ml-auto" aria-label="Close region editor" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {track.kind === "sample" ? (
        <p className="text-sm text-muted p-3">
          Audio regions use this track’s source file. Open the inspector’s Audio sampler to trim the
          source or record a microphone take. Independent audio files live on separate tracks.
        </p>
      ) : (
        <>
          <div className="note-editor-controls">
            <label>
              Pattern beats
              <input
                aria-label="Region pattern length"
                type="number"
                min={1}
                max={32}
                value={clip.patternLength}
                onChange={(event) => {
                  const length = Number(event.target.value);
                  if (length >= 1 && length <= 32)
                    change({
                      patternLength: length,
                      notes: clip.notes.filter((n) => n.start < length),
                    });
                }}
              />
            </label>
            {selectedNote ? (
              <>
                <label>
                  Pitch
                  <input
                    aria-label="Note pitch"
                    type="number"
                    min={0}
                    max={127}
                    value={selectedNote.pitch}
                    onChange={(event) =>
                      patchNote({
                        pitch: Math.max(0, Math.min(127, Math.round(Number(event.target.value)))),
                      })
                    }
                  />
                </label>
                <label>
                  Start
                  <input
                    aria-label="Note start"
                    type="number"
                    min={0}
                    max={clip.patternLength - 0.25}
                    step={0.25}
                    value={selectedNote.start}
                    onChange={(event) =>
                      patchNote({
                        start: Math.max(
                          0,
                          Math.min(clip.patternLength - 0.25, Number(event.target.value)),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Length
                  <input
                    aria-label="Note length"
                    type="number"
                    min={0.0625}
                    max={32}
                    step={0.25}
                    value={selectedNote.duration}
                    onChange={(event) =>
                      patchNote({
                        duration: Math.max(0.0625, Math.min(32, Number(event.target.value))),
                      })
                    }
                  />
                </label>
                <label>
                  Velocity
                  <input
                    aria-label="Note velocity"
                    type="number"
                    min={1}
                    max={127}
                    value={Math.round(selectedNote.velocity * 127)}
                    onChange={(event) =>
                      patchNote({
                        velocity: Math.max(1, Math.min(127, Number(event.target.value))) / 127,
                      })
                    }
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label="Delete note"
                  onClick={() => {
                    change({ notes: clip.notes.filter((note) => note.id !== selected) });
                    setSelected(null);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </>
            ) : (
              <span className="text-xs text-muted">
                Click a cell to add a note. Select a note to edit pitch, length or velocity.
              </span>
            )}
          </div>
          <div className="piano-scroll">
            <div style={{ width: 60 + clip.patternLength * 4 * cell }}>
              {rows.map((row) => (
                <div key={row.pitch} className="piano-row">
                  <span>{row.name}</span>
                  <div
                    className="piano-cells"
                    style={{
                      width: clip.patternLength * 4 * cell,
                      backgroundSize: `${cell * 4}px 100%, ${cell}px 100%`,
                    }}
                    onClick={(event) => {
                      if (event.target !== event.currentTarget) return;
                      const start =
                        Math.floor(
                          (event.clientX - event.currentTarget.getBoundingClientRect().left) / cell,
                        ) * 0.25;
                      const id = uid("n");
                      change({
                        notes: [
                          ...clip.notes,
                          { id, pitch: row.pitch, start, duration: 0.25, velocity: 0.8 },
                        ],
                      });
                      setSelected(id);
                    }}
                  >
                    {clip.notes
                      .filter((note) => note.pitch === row.pitch)
                      .map((note) => (
                        <button
                          key={note.id}
                          aria-label={`${noteName(note.pitch)} at beat ${note.start + 1}`}
                          className={cx("piano-note", note.id === selected && "selected")}
                          style={{
                            left: note.start * 4 * cell,
                            width: Math.max(5, note.duration * 4 * cell - 2),
                            opacity: 0.5 + note.velocity * 0.5,
                          }}
                          onClick={() => setSelected(note.id)}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
