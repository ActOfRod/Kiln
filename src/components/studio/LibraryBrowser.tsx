import { useEffect, useRef, useState } from "react";
import { FolderOpen, Music2, Play, Plus, Search, Square, Star, Trash2, Upload } from "lucide-react";
import { PATTERNS } from "@/studio/factory";
import {
  deleteSound,
  listSounds,
  readSound,
  saveSound,
  updateSound,
  type LibrarySound,
} from "@/studio/library";
import { useStudio } from "@/studio/store";
import type { TrackKind } from "@/studio/types";
import { cx } from "./ui";

const categories = ["all", "drums", "bass", "keys", "lead", "samples", "favorites"] as const;
type Category = (typeof categories)[number];

export function LibraryBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [sounds, setSounds] = useState<LibrarySound[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const request = useRef(0);
  const selectedSound = sounds.find((sound) => sound.id === selected);
  const refresh = async () => setSounds(await listSounds());
  const stopPreview = () => {
    request.current++;
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPreview(null);
  };

  useEffect(() => {
    const activeRequest = request;
    void listSounds()
      .then(setSounds)
      .catch((err: unknown) => setError(String(err)));
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("kiln-pattern-favorites") ?? "[]");
      if (Array.isArray(saved) && saved.every((item) => typeof item === "string"))
        setFavorites(saved);
    } catch {
      setError("Pattern favorites could not be restored.");
    }
    return () => {
      activeRequest.current++;
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  const run = (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    void action()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  const addPattern = (patternId: string, kind: TrackKind) => {
    const state = useStudio.getState();
    let track = state.project.tracks.find((t) => t.id === state.selectedTrackId && t.kind === kind);
    if (!track) {
      if (state.project.tracks.length >= 32) {
        setError("The project already has 32 tracks.");
        return;
      }
      state.addTrack(kind);
      track = useStudio.getState().project.tracks.at(-1);
    }
    if (!track) return;
    if (state.view === "session")
      useStudio.getState().insertPattern(track.id, state.selectedScene, patternId);
    else useStudio.getState().addRegion(track.id, patternId, Math.floor(state.beat / 4) * 4);
  };
  const importFiles = async (files: FileList) => {
    try {
      for (const item of Array.from(files)) {
        if (item.size > 50_000_000) throw new Error(`${item.name} exceeds the 50 MB limit.`);
        const data = await item.arrayBuffer();
        const ctx = new AudioContext();
        try {
          const decoded = await ctx.decodeAudioData(data.slice(0));
          await saveSound({
            id: crypto.randomUUID(),
            name: item.name.replace(/\.[^.]+$/, ""),
            tags: [],
            duration: decoded.duration,
            favorite: false,
            addedAt: Date.now(),
            data,
          });
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await refresh();
      setCategory("samples");
    }
  };
  const audition = async (id: string) => {
    stopPreview();
    const token = request.current;
    const sound = await readSound(id);
    if (request.current !== token) return;
    url.current = URL.createObjectURL(new Blob([sound.data]));
    const player = new Audio(url.current);
    audio.current = player;
    player.onended = stopPreview;
    player.onerror = () => {
      stopPreview();
      setError("This sound could not be previewed.");
    };
    await player.play();
    setPreview(id);
  };
  const q = query.trim().toLowerCase();
  const patterns = PATTERNS.filter(
    (pattern) =>
      category !== "samples" &&
      (category === "all" ||
        category === pattern.kind ||
        (category === "favorites" && favorites.includes(pattern.id))) &&
      `${pattern.name} ${pattern.kind}`.toLowerCase().includes(q),
  );
  const filtered = sounds.filter(
    (sound) =>
      (category === "all" ||
        category === "samples" ||
        (category === "favorites" && sound.favorite)) &&
      `${sound.name} ${sound.tags.join(" ")}`.toLowerCase().includes(q),
  );
  return (
    <aside className="library-panel" aria-label="Sound library">
      <div className="panel-title">
        <FolderOpen size={15} />
        <h2>Library</h2>
        <span className="text-faint text-xs ml-auto">{PATTERNS.length + sounds.length} sounds</span>
      </div>
      <label className="library-search">
        <Search size={15} />
        <input
          aria-label="Search library"
          placeholder="Search sounds, tags…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="library-categories">
        {categories.map((item) => (
          <button
            key={item}
            className={cx(category === item && "active")}
            onClick={() => setCategory(item)}
          >
            {item === "all" ? "All sounds" : item === "favorites" ? "★ Favorites" : item}
          </button>
        ))}
      </div>
      <div className="library-results">
        {patterns.length > 0 && <p className="section-label">KILN patterns · MIDI</p>}
        {patterns.map((pattern) => (
          <div
            key={pattern.id}
            className="library-item"
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData("application/kiln-pattern", pattern.id)
            }
          >
            <Music2 size={16} className="text-accent shrink-0" />
            <button
              className="library-item-name"
              onClick={() => addPattern(pattern.id, pattern.kind)}
              title="Insert on the selected compatible track, or create one"
            >
              <strong>{pattern.name}</strong>
              <small>
                {pattern.kind} · {pattern.length / 4} bar
              </small>
            </button>
            <button
              aria-label={`Favorite ${pattern.name}`}
              aria-pressed={favorites.includes(pattern.id)}
              className="icon-button"
              onClick={() => {
                const next = favorites.includes(pattern.id)
                  ? favorites.filter((id) => id !== pattern.id)
                  : [...favorites, pattern.id];
                try {
                  localStorage.setItem("kiln-pattern-favorites", JSON.stringify(next));
                  setFavorites(next);
                } catch {
                  setError("Favorites could not be saved. Browser storage may be full.");
                }
              }}
            >
              <Star size={13} fill={favorites.includes(pattern.id) ? "currentColor" : "none"} />
            </button>
          </div>
        ))}
        {filtered.length > 0 && <p className="section-label">Your samples · audio</p>}
        {filtered.map((sound) => (
          <div key={sound.id} className={cx("library-item", selected === sound.id && "selected")}>
            <button
              className="icon-button"
              disabled={busy}
              aria-label={`Preview ${sound.name}`}
              onClick={() => (preview === sound.id ? stopPreview() : run(() => audition(sound.id)))}
            >
              {preview === sound.id ? <Square size={14} /> : <Play size={14} />}
            </button>
            <button className="library-item-name" onClick={() => setSelected(sound.id)}>
              <strong>{sound.name}</strong>
              <small>
                {sound.duration.toFixed(1)}s · {sound.tags.join(", ") || "untagged"}
              </small>
            </button>
            <button
              className="icon-button"
              disabled={busy}
              aria-label={`Add ${sound.name} to song`}
              onClick={() =>
                run(async () => {
                  const stored = await readSound(sound.id);
                  await useStudio.getState().addAudioTrack(stored.data, stored.name);
                })
              }
            >
              <Plus size={14} />
            </button>
          </div>
        ))}
        {!patterns.length && !filtered.length && (
          <p className="empty-note">No sounds here. Import audio or try another search.</p>
        )}
      </div>
      {selectedSound && (
        <div className="library-details" key={selectedSound.id}>
          <label>
            Name
            <input
              aria-label="Library sound name"
              defaultValue={selectedSound.name}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name)
                  run(async () => {
                    await updateSound(selectedSound.id, { name });
                    await refresh();
                  });
              }}
            />
          </label>
          <label>
            Tags, separated by commas
            <input
              aria-label="Sample tags"
              defaultValue={selectedSound.tags.join(", ")}
              onBlur={(event) => {
                const tags = event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 12);
                run(async () => {
                  await updateSound(selectedSound.id, { tags });
                  await refresh();
                });
              }}
            />
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy}
              className="studio-button flex-1"
              onClick={() =>
                run(async () => {
                  await updateSound(selectedSound.id, {
                    favorite: !selectedSound.favorite,
                  });
                  await refresh();
                })
              }
            >
              <Star size={13} />
              {selectedSound.favorite ? "Unfavorite" : "Favorite"}
            </button>
            <button
              disabled={busy}
              className="icon-button"
              aria-label="Delete library sound"
              title="Remove from library; project copies are preserved"
              onClick={() =>
                run(async () => {
                  stopPreview();
                  await deleteSound(selectedSound.id);
                  setSelected(null);
                  await refresh();
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="panel-error" role="alert">
          {error}
        </p>
      )}
      <div className="library-footer">
        <button
          disabled={busy}
          className="studio-button w-full"
          onClick={() => file.current?.click()}
        >
          <Upload size={14} />
          {busy ? "Working…" : "Import audio"}
        </button>
        <p>
          WAV, MP3, AIFF & browser-supported audio.
          <br />
          Private, saved in this browser. 50 MB per file.
        </p>
        <input
          type="file"
          ref={file}
          hidden
          accept="audio/*,.wav,.mp3,.aif,.aiff,.flac"
          multiple
          onChange={(event) => {
            const files = event.target.files;
            if (files?.length) run(() => importFiles(files));
            event.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}
