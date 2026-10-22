import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Copy, Download, Ellipsis, Minus, Plus, Scissors, Trash2, X } from "lucide-react";
import { engine } from "@/studio/engine";
import { compatibleTracks, useStudio } from "@/studio/store";
import { readSound } from "@/studio/library";
import { PATTERNS } from "@/studio/factory";
import { sampleBank } from "@/studio/samples";
import {
  assetOf,
  clipGain,
  clipWindow,
  fadeLevel,
  playbackRate,
  reverseWindow,
  sourcePosition,
} from "@/studio/audio-clip";
import { clamp, DRUMS, noteName, quantize, uid } from "@/studio/theory";
import { MAX_BARS } from "@/studio/regions";
import type { ArrangeClip, Note, Track } from "@/studio/types";
import { CLIP_BG, cx } from "./ui";
import { AudioClipView, MidiClipTools } from "./ClipView";
import { PEER_COLORS, setCursor, setSelection, useCollab } from "@/collab/session";
import type { Presence } from "@/collab/backend";

/** Collaborators' playheads, extrapolated between presence updates. */
function PeerPlayheads({ peers, px, bars }: { peers: Presence[]; px: number; bars: number }) {
  const lines = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = Date.now();
      for (const peer of peers) {
        const line = lines.current.get(peer.clientId);
        if (!line) continue;
        const beat = (peer.beat + ((now - peer.at) / 1000) * (peer.bpm / 60)) % (bars * 4);
        line.style.transform = `translateX(${beat * px}px)`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [peers, px, bars]);
  return (
    <>
      {peers.map((peer) => (
        <div
          key={peer.clientId}
          ref={(node) => {
            if (node) lines.current.set(peer.clientId, node);
            else lines.current.delete(peer.clientId);
          }}
          className="peer-playhead"
          style={{ left: HEADER, background: PEER_COLORS[peer.color] }}
          title={`${peer.name} is playing`}
        />
      ))}
    </>
  );
}

const DRAG_TYPES = ["application/kiln-pattern", "application/kiln-sound", "Files"];

function failure(error: unknown) {
  useStudio.setState({ audioError: error instanceof Error ? error.message : String(error) });
}

function isAudioFile(file: File) {
  return (
    file.type.startsWith("audio/") || /\.(wav|mp3|aiff?|flac|ogg|m4a|aac|webm)$/i.test(file.name)
  );
}

/**
 * Drop library patterns, library sounds or audio files from the computer onto a
 * lane (`target`) or the empty area below the tracks (a new track).
 */
async function dropMaterial(event: DragEvent, target: Track | null, start: number) {
  const act = useStudio.getState();
  const patternId = event.dataTransfer.getData("application/kiln-pattern");
  const soundId = event.dataTransfer.getData("application/kiln-sound");
  const files = Array.from(event.dataTransfer.files).filter(isAudioFile);
  const audioTarget = target?.kind === "sample" ? target.id : null;
  if (patternId) {
    const pattern = PATTERNS.find((item) => item.id === patternId);
    if (!pattern) return;
    let trackId = target && target.kind === pattern.kind ? target.id : null;
    if (!trackId) {
      act.addTrack(pattern.kind);
      trackId = useStudio.getState().selectedTrackId;
    }
    act.addRegion(trackId, patternId, start);
    return;
  }
  if (soundId) {
    const sound = await readSound(soundId);
    await act.placeAudio(audioTarget, sound.data, sound.name, start);
    return;
  }
  if (event.dataTransfer.files.length && !files.length)
    throw new Error("Drop audio files such as WAV, MP3, AIFF, FLAC or OGG.");
  for (const [index, file] of files.entries())
    await act.placeAudio(
      index === 0 ? audioTarget : null,
      await file.arrayBuffer(),
      file.name.replace(/\.[^.]+$/, ""),
      start,
    );
}

type DragMode = "move" | "resize" | "fade-in" | "fade-out";

/**
 * Pointer drag that survives the region re-rendering under another track:
 * listeners live on the window and the target lane is found under the pointer.
 */
function startRegionDrag(
  event: ReactPointerEvent,
  options: {
    trackId: string;
    clip: ArrangeClip;
    px: number;
    snap: number;
    mode: DragMode;
    copy: boolean;
    onMoved: (trackId: string, clipId: string) => void;
    onEnd: (moved: boolean) => void;
  },
) {
  const { clip, px, snap, mode } = options;
  const origin = event.clientX;
  const state = { trackId: options.trackId, clipId: clip.id, copied: false, moved: false };
  const act = useStudio.getState();
  // Holding a region near the timeline's edge scrolls it, so regions can be dragged
  // past the visible (and current last) bar; the song grows to fit.
  const scroller =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest<HTMLElement>(".timeline-scroll")
      : null;
  const scroll0 = scroller?.scrollLeft ?? 0;
  let last: PointerEvent | null = null;
  let frame = 0;
  act.beginEdit();
  const move = (e: PointerEvent) => {
    last = e;
    const scrolled = (scroller?.scrollLeft ?? scroll0) - scroll0;
    if (Math.abs(e.clientX - origin + scrolled) > 3) state.moved = true;
    const beats = (e.clientX - origin + scrolled) / px;
    const studio = useStudio.getState();
    const spb = 60 / studio.project.bpm;
    if (mode === "resize") {
      studio.updateRegion(state.trackId, state.clipId, {
        length: Math.max(snap, quantize(clip.length + beats, snap)),
      });
      return;
    }
    if (mode === "fade-in" || mode === "fade-out") {
      const span = clip.length * spb;
      const base = (mode === "fade-in" ? clip.fadeIn : clip.fadeOut) ?? 0;
      const value = clamp(
        base + (mode === "fade-in" ? beats : -beats) * spb,
        0,
        Math.min(30, span),
      );
      studio.updateRegion(state.trackId, state.clipId, {
        [mode === "fade-in" ? "fadeIn" : "fadeOut"]: Math.round(value * 1000) / 1000,
      });
      return;
    }
    const lane = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-track-id]");
    const from = studio.project.tracks.find((t) => t.id === state.trackId);
    const over = studio.project.tracks.find((t) => t.id === lane?.dataset.trackId);
    const toTrack = over && from && compatibleTracks(from, over) ? over.id : state.trackId;
    const start = Math.max(0, quantize(clip.start + beats, snap));
    if (options.copy && !state.copied) {
      if (Math.abs(e.clientX - origin) < 4 && toTrack === state.trackId) return;
      const id = studio.moveRegion(state.trackId, state.clipId, toTrack, start, true);
      if (!id) return;
      Object.assign(state, { trackId: toTrack, clipId: id, copied: true });
      options.onMoved(toTrack, id);
      return;
    }
    if (toTrack !== state.trackId) {
      state.moved = true;
      if (studio.moveRegion(state.trackId, state.clipId, toTrack, start)) {
        state.trackId = toTrack;
        options.onMoved(toTrack, state.clipId);
      }
    } else studio.moveArrangeClip(state.trackId, state.clipId, start);
  };
  const autoScroll = () => {
    frame = requestAnimationFrame(autoScroll);
    if (!scroller || !last || mode === "fade-in" || mode === "fade-out") return;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(48, rect.width / 6);
    const step =
      last.clientX > rect.right - edge
        ? Math.ceil((last.clientX - (rect.right - edge)) / 4)
        : last.clientX < rect.left + HEADER + edge && scroller.scrollLeft > 0
          ? -Math.ceil((rect.left + HEADER + edge - last.clientX) / 4)
          : 0;
    if (!step) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft += step;
    if (scroller.scrollLeft !== before) move(last);
  };
  frame = requestAnimationFrame(autoScroll);
  const end = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    useStudio.getState().endEdit();
    options.onEnd(state.moved || state.copied);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

const HEADER = 184;
const RUNWAY_BARS = 8;
const COLORS = { ember: "#e8893a", clay: "#d4785a", gold: "#e0c06a", sage: "#9fb58a" };

export function ArrangeView({ onTrackMenu }: { onTrackMenu: (trackId: string) => void }) {
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
  // Empty bars after the song end give regions somewhere to be dragged; the song grows to fit.
  const runway = Math.min(RUNWAY_BARS, MAX_BARS - project.bars);
  const songWidth = project.bars * 4 * px;
  const width = (project.bars + runway) * 4 * px;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const peers = useCollab((s) => s.peers);
  const inRoom = useCollab((s) => !!s.room);
  useEffect(() => setSelection(selected?.clipId ?? null), [selected?.clipId]);
  const choose = (trackId: string, clipId: string, open = true) => {
    act.selectTrack(trackId);
    setSelected({ trackId, clipId });
    if (open) setEditor(true);
  };
  const acceptsDrop = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).some((type) => DRAG_TYPES.includes(type));
  const handleDrop = (event: DragEvent, target: Track | null, start: number) => {
    event.preventDefault();
    setDropTarget(null);
    void dropMaterial(event, target, start).catch(failure);
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
      <div
        ref={scroller}
        className="timeline-scroll"
        onPointerMove={(event) => {
          if (!inRoom) return;
          const lane =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-track-id]")
              : null;
          if (!lane) return setCursor(null);
          const beat = (event.clientX - lane.getBoundingClientRect().left) / px;
          setCursor({ trackId: lane.dataset.trackId!, beat: Math.max(0, beat) });
        }}
        onPointerLeave={() => inRoom && setCursor(null)}
      >
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
              {Array.from({ length: runway }, (_, i) => (
                <span
                  key={`runway-${i}`}
                  className="bar-number beyond"
                  style={{ width: px * 4 }}
                  title="Past the song end: drag a region here to extend the song"
                >
                  {px >= 16 || (project.bars + i) % 4 === 0 ? project.bars + i + 1 : ""}
                </span>
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
                  <small>
                    {t.kind === "sample" ? "AUDIO" : t.kind.toUpperCase()}
                    {peers
                      .filter((peer) => peer.trackId === t.id)
                      .map((peer) => (
                        <span
                          key={peer.clientId}
                          className="peer-track-dot"
                          title={`${peer.name} is on this track`}
                          style={{ background: PEER_COLORS[peer.color] }}
                        />
                      ))}
                  </small>
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
                <button
                  className="track-menu-button"
                  aria-label={`${t.name} track options`}
                  title="Track options: rename, reorder, duplicate, delete"
                  onClick={() => onTrackMenu(t.id)}
                >
                  <Ellipsis size={14} />
                </button>
              </div>
              <div
                className={cx("arrange-lane", dropTarget === t.id && "drop-target")}
                data-track-id={t.id}
                style={{ width, backgroundSize: `${px * 4}px 100%, ${px}px 100%` }}
                onDragOver={(event) => {
                  if (!acceptsDrop(event)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  if (dropTarget !== t.id) setDropTarget(t.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropTarget(null);
                }}
                onDrop={(event) => {
                  const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
                  handleDrop(event, t, quantize(x / px, snap));
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
                    onSelect={() => choose(t.id, clip.id, false)}
                    onEdit={() => choose(t.id, clip.id)}
                    onMoved={(trackId, clipId) => {
                      act.selectTrack(trackId);
                      setSelected({ trackId, clipId });
                    }}
                    peers={peers.filter((peer) => peer.regionId === clip.id)}
                  />
                ))}
                {peers
                  .filter((peer) => peer.cursor?.trackId === t.id)
                  .map((peer) => (
                    <div
                      key={peer.clientId}
                      className="peer-cursor"
                      style={{ left: peer.cursor!.beat * px, color: PEER_COLORS[peer.color] }}
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 12 16" width="12" height="16">
                        <path d="M0 0 L12 9 L6 9.5 L3 16 Z" fill="currentColor" />
                      </svg>
                      <span style={{ background: PEER_COLORS[peer.color] }}>{peer.name}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          <div
            className={cx("timeline-empty", dropTarget === "new" && "drop-target")}
            style={{ marginLeft: HEADER }}
            onDragOver={(event) => {
              if (!acceptsDrop(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              if (dropTarget !== "new") setDropTarget("new");
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
              handleDrop(event, null, quantize(Math.max(0, x) / px, snap));
            }}
          >
            Drop patterns, library sounds or audio files here for a new track. Double-click a MIDI
            lane to draw a region; Alt-drag a region to copy it.
          </div>
          {runway > 0 && (
            <div
              className="timeline-runway"
              style={{ left: HEADER + songWidth, width: width - songWidth }}
              aria-hidden="true"
            />
          )}
          <PeerPlayheads peers={peers.filter((peer) => peer.playing)} px={px} bars={project.bars} />
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
            {editor ? "Hide clip" : "Show clip"}
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
      {editor &&
        track &&
        selectedRegion &&
        (track.kind === "sample" ? (
          <AudioClipView
            key={selectedRegion.id}
            track={track}
            clip={selectedRegion}
            onClose={() => setEditor(false)}
          />
        ) : (
          <RegionEditor
            key={selectedRegion.id}
            track={track}
            clip={selectedRegion}
            onClose={() => setEditor(false)}
          />
        ))}
    </div>
  );
}

function audioPreview(track: Track, clip: ArrangeClip, bpm: number, points = 120): number[] | null {
  const buffer = sampleBank.get(assetOf(track, clip));
  const peaks = engine.peaks(assetOf(track, clip));
  if (!buffer || !peaks?.length) return null;
  const duration = buffer.duration;
  const forward = clipWindow(track, clip, duration);
  const window = clip.reverse ? reverseWindow(forward, duration) : forward;
  const rate = playbackRate(clip, bpm);
  const spb = 60 / bpm;
  const gain = Math.min(1.6, clipGain(clip));
  const span = clip.length * spb;
  return Array.from({ length: points }, (_, i) => {
    const beat = ((i + 0.5) / points) * clip.length;
    const position = sourcePosition(window, (beat + (clip.offset ?? 0)) * spb * rate);
    if (position == null) return 0;
    const real = clip.reverse ? duration - position : position;
    const peak =
      peaks[Math.min(peaks.length - 1, Math.floor((real / duration) * peaks.length))] ?? 0;
    return Math.min(
      1,
      peak * gain * fadeLevel(beat * spb, 0, span, clip.fadeIn ?? 0, clip.fadeOut ?? 0),
    );
  });
}

function RegionBlock({
  track,
  clip,
  px,
  snap,
  selected,
  onSelect,
  onEdit,
  onMoved,
  peers,
}: {
  track: Track;
  clip: ArrangeClip;
  px: number;
  snap: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onMoved: (trackId: string, clipId: string) => void;
  peers: Presence[];
}) {
  useStudio((s) => s.sampleRev);
  const bpm = useStudio((s) => s.project.bpm);
  const audio = track.kind === "sample";
  const wave = audio ? audioPreview(track, clip, bpm) : null;
  const spb = 60 / bpm;
  const fadeInPx = Math.min(clip.length * px, ((clip.fadeIn ?? 0) / spb) * px);
  const fadeOutPx = Math.min(clip.length * px, ((clip.fadeOut ?? 0) / spb) * px);
  const badges = [
    clip.reverse && "REV",
    clip.warp && "WARP",
    clip.transpose ? `${clip.transpose > 0 ? "+" : ""}${clip.transpose}st` : null,
    clip.gain ? `${clip.gain > 0 ? "+" : ""}${clip.gain.toFixed(1)}dB` : null,
  ].filter(Boolean);
  return (
    <div
      role="button"
      aria-label={`Region ${clip.name}`}
      tabIndex={0}
      className={cx("region-block", CLIP_BG[clip.color], selected && "region-selected")}
      data-region-id={clip.id}
      style={{
        left: clip.start * px,
        width: Math.max(8, clip.length * px - 2),
        ...(peers[0] && { boxShadow: `0 0 0 2px ${PEER_COLORS[peers[0].color]}` }),
      }}
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
        const handle =
          event.target instanceof Element ? event.target.closest<HTMLElement>("[data-drag]") : null;
        startRegionDrag(event, {
          trackId: track.id,
          clip,
          px,
          snap,
          mode: (handle?.dataset.drag as DragMode | undefined) ?? "move",
          copy: event.altKey,
          onMoved,
          // A click without dragging opens the Clip View, like Ableton.
          onEnd: (moved) => {
            if (!moved) onEdit();
          },
        });
      }}
    >
      <div className="region-label">
        {clip.name}
        {badges.length > 0 && <span className="region-badges">{badges.join(" · ")}</span>}
      </div>
      <svg
        className="region-preview"
        viewBox="0 0 200 32"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {wave
          ? wave.map((peak, i) => (
              <line
                key={i}
                x1={((i + 0.5) / wave.length) * 200}
                x2={((i + 0.5) / wave.length) * 200}
                y1={16 - peak * 15}
                y2={16 + peak * 15}
                stroke="currentColor"
                strokeWidth={1.2}
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
      {audio && (
        <>
          {fadeInPx > 1 && (
            <span className="region-fade-shape in" style={{ width: fadeInPx }} aria-hidden="true" />
          )}
          {fadeOutPx > 1 && (
            <span
              className="region-fade-shape out"
              style={{ width: fadeOutPx }}
              aria-hidden="true"
            />
          )}
          <span
            className="region-fade-handle in"
            data-drag="fade-in"
            style={{ left: Math.max(0, fadeInPx - 5) }}
            title="Drag to fade in"
          />
          <span
            className="region-fade-handle out"
            data-drag="fade-out"
            style={{ right: Math.max(0, fadeOutPx - 5) }}
            title="Drag to fade out"
          />
        </>
      )}
      {peers.length > 0 && (
        <span
          className="peer-region-tag"
          style={{ background: PEER_COLORS[peers[0]!.color] }}
          title={`${peers.map((p) => p.name).join(", ")} selected this region`}
        >
          {peers.map((p) => p.name).join(", ")}
        </span>
      )}
      <div className="region-resize" data-drag="resize" title="Drag to resize" />
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
      {
        <>
          <MidiClipTools track={track} clip={clip} />
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
      }
    </section>
  );
}
