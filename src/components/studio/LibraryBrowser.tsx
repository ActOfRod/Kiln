import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Music2,
  Play,
  Plus,
  Search,
  Square,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { engine } from "@/studio/engine";
import { PATTERNS, defaultDevice } from "@/studio/factory";
import {
  deleteSound,
  deleteSounds,
  folderOf,
  folderTree,
  groupSounds,
  inFolder,
  listSounds,
  readSound,
  saveSound,
  updateSound,
  type FolderNode,
  type LibrarySound,
} from "@/studio/library";
import { useStudio } from "@/studio/store";
import type { Pattern, TrackKind } from "@/studio/types";
import { cx } from "./ui";

/** Pattern categories, shown as folders like Ableton's browser. */
const KINDS: Array<{ kind: TrackKind; label: string }> = [
  { kind: "drums", label: "Drums" },
  { kind: "bass", label: "Bass" },
  { kind: "keys", label: "Keys" },
  { kind: "lead", label: "Lead" },
];

const MY_SAMPLES = "My samples";
const OPEN_KEY = "kiln-library-open";

function isAudio(file: File) {
  return (
    file.type.startsWith("audio/") || /\.(wav|mp3|aiff?|flac|ogg|m4a|aac|webm)$/i.test(file.name)
  );
}

/** Tree keys for a sample folder and its parents, so a new folder shows up opened. */
function folderKeys(path: string): string[] {
  const parts = path.split(" / ");
  return parts.map((_, i) => `dir:${parts.slice(0, i + 1).join(" / ")}`);
}

export function LibraryBrowser() {
  const [query, setQuery] = useState("");
  const [sounds, setSounds] = useState<LibrarySound[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [naming, setNaming] = useState<File[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const request = useRef(0);
  const rendered = useRef(new Map<string, Blob>());
  const restored = useRef(false);
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
  const expand = (keys: string[]) => setOpen((current) => [...new Set([...current, ...keys])]);
  const toggle = (key: string) =>
    setOpen((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  useEffect(() => {
    const activeRequest = request;
    void listSounds()
      .then(setSounds)
      .catch((err: unknown) => setError(String(err)));
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("kiln-pattern-favorites") ?? "[]");
      if (Array.isArray(saved) && saved.every((item) => typeof item === "string"))
        setFavorites(saved);
      const folders: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
      if (Array.isArray(folders) && folders.every((item) => typeof item === "string"))
        setOpen(folders);
    } catch {
      setError("Library favorites could not be restored.");
    }
    restored.current = true;
    return () => {
      activeRequest.current++;
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* folder state is a convenience; storage may be full */
    }
  }, [open]);

  const run = (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
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
  /**
   * Import files into the library. Files picked as a folder keep their folder (and
   * sub-folders); single files go to "My samples" unless `folder` names one.
   */
  const importFiles = async (files: File[], folder?: string) => {
    const audioFiles = files.filter(isAudio);
    let skipped = files.length - audioFiles.length;
    const folders = new Set<string>();
    const ctx = new AudioContext();
    try {
      for (const item of audioFiles) {
        if (item.size > 50_000_000) {
          if (audioFiles.length === 1) throw new Error(`${item.name} exceeds the 50 MB limit.`);
          skipped++;
          continue;
        }
        const data = await item.arrayBuffer();
        let duration: number;
        try {
          duration = (await ctx.decodeAudioData(data.slice(0))).duration;
        } catch (err) {
          if (audioFiles.length === 1) throw err;
          skipped++;
          continue;
        }
        const home = folderOf(item.webkitRelativePath) ?? folder;
        if (home) folders.add(home);
        await saveSound({
          id: crypto.randomUUID(),
          name: item.name.replace(/\.[^.]+$/, ""),
          tags: [],
          duration,
          favorite: false,
          addedAt: Date.now(),
          data,
          ...(home && { folder: home }),
        });
      }
    } finally {
      await ctx.close();
      await refresh();
      expand(folders.size ? [...folders].flatMap(folderKeys) : ["samples"]);
    }
    if (!audioFiles.length) throw new Error("No audio files found. Try WAV, MP3, AIFF or FLAC.");
    if (skipped)
      setNotice(
        `Skipped ${skipped} ${skipped === 1 ? "file that wasn't" : "files that weren't"} usable audio.`,
      );
  };
  const pickedFolder = (files: File[]) => {
    // Browsers without folder picking (e.g. some phones) hand back plain files; ask for a name.
    if (files.some((item) => item.webkitRelativePath)) run(() => importFiles(files));
    else setNaming(files);
  };
  const audition = async (id: string, load: () => Promise<Blob>) => {
    stopPreview();
    const token = request.current;
    const data = await load();
    if (request.current !== token) return;
    url.current = URL.createObjectURL(data);
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
  const togglePreview = (id: string, load: () => Promise<Blob>) =>
    preview === id ? stopPreview() : run(() => audition(id, load));
  const soundAudio = async (id: string) => new Blob([(await readSound(id)).data]);
  /** A pattern played by itself on the song's instrument for that kind, at the song tempo. */
  const patternAudio = async (pattern: Pattern) => {
    const { project, selectedTrackId } = useStudio.getState();
    const track =
      project.tracks.find((t) => t.id === selectedTrackId && t.kind === pattern.kind) ??
      project.tracks.find((t) => t.kind === pattern.kind);
    const device = track?.device ?? defaultDevice(pattern.kind);
    const key = `${pattern.id}|${project.bpm}|${project.swing}|${JSON.stringify(device)}`;
    let blob = rendered.current.get(key);
    if (!blob) {
      blob = await engine.renderPattern(pattern, device, project);
      if (rendered.current.size >= 24) rendered.current.clear();
      rendered.current.set(key, blob);
    }
    return blob;
  };
  const toggleFavorite = (patternId: string) => {
    const next = favorites.includes(patternId)
      ? favorites.filter((id) => id !== patternId)
      : [...favorites, patternId];
    try {
      localStorage.setItem("kiln-pattern-favorites", JSON.stringify(next));
      setFavorites(next);
    } catch {
      setError("Favorites could not be saved. Browser storage may be full.");
    }
  };

  const q = query.trim().toLowerCase();
  const patterns = PATTERNS.filter((pattern) =>
    `${pattern.name} ${pattern.kind}`.toLowerCase().includes(q),
  );
  const filtered = sounds.filter((sound) =>
    `${sound.name} ${sound.tags.join(" ")} ${sound.folder ?? ""}`.toLowerCase().includes(q),
  );
  const groups = groupSounds(filtered);
  const tree = folderTree(groups.folders);
  const folderNames = groupSounds(sounds).folders.map((group) => group.name);
  const favoritePatterns = patterns.filter((pattern) => favorites.includes(pattern.id));
  const favoriteSounds = filtered.filter((sound) => sound.favorite);

  const patternRow = (pattern: Pattern) => {
    const id = `pattern:${pattern.id}`;
    const favorite = favorites.includes(pattern.id);
    return (
      <div
        key={pattern.id}
        className={cx("library-item", preview === id && "selected")}
        draggable
        title="Click to hear it on its own · drag onto a track, or below the tracks for a new one"
        onDragStart={(event) => event.dataTransfer.setData("application/kiln-pattern", pattern.id)}
      >
        <button
          className="icon-button"
          disabled={busy && preview !== id}
          aria-label={`Preview ${pattern.name}`}
          aria-pressed={preview === id}
          onClick={() => togglePreview(id, () => patternAudio(pattern))}
        >
          {preview === id ? <Square size={14} /> : <Music2 size={14} className="text-accent" />}
        </button>
        <button
          className="library-item-name"
          onClick={() => togglePreview(id, () => patternAudio(pattern))}
        >
          <strong>{pattern.name}</strong>
          <small>
            {pattern.kind} · {pattern.length / 4} bar · MIDI
          </small>
        </button>
        <button
          aria-label={`Favorite ${pattern.name}`}
          aria-pressed={favorite}
          className="icon-button"
          onClick={() => toggleFavorite(pattern.id)}
        >
          <Star size={13} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button
          className="icon-button"
          aria-label={`Add ${pattern.name} to song`}
          title="Add to the selected track at the playhead, or to a new track"
          onClick={() => addPattern(pattern.id, pattern.kind)}
        >
          <Plus size={14} />
        </button>
      </div>
    );
  };
  const soundRow = (sound: LibrarySound) => (
    <div
      key={sound.id}
      className={cx("library-item", selected === sound.id && "selected")}
      draggable
      title="Click to hear it · drag onto the arrangement to place this sound"
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/kiln-sound", sound.id);
      }}
    >
      <button
        className="icon-button"
        disabled={busy && preview !== sound.id}
        aria-label={`Preview ${sound.name}`}
        aria-pressed={preview === sound.id}
        onClick={() => togglePreview(sound.id, () => soundAudio(sound.id))}
      >
        {preview === sound.id ? <Square size={14} /> : <Play size={14} />}
      </button>
      <button
        className="library-item-name"
        onClick={() => {
          setSelected(sound.id);
          togglePreview(sound.id, () => soundAudio(sound.id));
        }}
      >
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
  );
  /** One folder in the browser tree; searching opens every folder with a match. */
  const folder = (options: {
    id: string;
    label: string;
    count: number;
    depth?: number;
    icon?: ReactNode;
    actions?: ReactNode;
    children: () => ReactNode;
    empty?: string;
  }) => {
    const expanded = !!q || open.includes(options.id);
    const depth = options.depth ?? 0;
    return (
      <div
        key={options.id}
        className="library-folder"
        style={{ "--depth": depth } as CSSProperties}
      >
        <div className="library-folder-header">
          <button
            className="library-folder-toggle"
            aria-expanded={expanded}
            onClick={() => toggle(options.id)}
          >
            <ChevronRight size={13} className={cx("chevron", expanded && "open")} />
            {options.icon ?? (expanded ? <FolderOpen size={14} /> : <Folder size={14} />)}
            <strong>{options.label}</strong>
            <small>{options.count}</small>
          </button>
          {options.actions}
        </div>
        {expanded && (
          <div className="library-folder-items">
            {options.count ? (
              options.children()
            ) : (
              <p className="library-folder-empty">{options.empty ?? "Empty"}</p>
            )}
          </div>
        )}
      </div>
    );
  };
  const deleteActions = (path: string) =>
    deleting === path ? (
      <>
        <button
          className="library-folder-confirm danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              stopPreview();
              const all = sounds.filter((sound) => inFolder(sound.folder, path));
              await deleteSounds(all.map((sound) => sound.id));
              if (all.some((sound) => sound.id === selected)) setSelected(null);
              setDeleting(null);
              await refresh();
            })
          }
        >
          Delete
        </button>
        <button className="library-folder-confirm" onClick={() => setDeleting(null)}>
          Keep
        </button>
      </>
    ) : (
      <button
        className="icon-button"
        aria-label={`Delete folder ${path}`}
        title="Remove this folder from the library; project copies are preserved"
        onClick={() => setDeleting(path)}
      >
        <Trash2 size={13} />
      </button>
    );
  const folderNode = (node: FolderNode, depth: number): ReactNode =>
    folder({
      id: `dir:${node.path}`,
      label: node.name,
      count: node.count,
      depth,
      actions: deleteActions(node.path),
      children: () => [
        ...node.children.map((child) => folderNode(child, depth + 1)),
        ...node.sounds.map(soundRow),
      ],
    });
  const kindFolders = KINDS.map(({ kind, label }) => {
    const list = patterns.filter((pattern) => pattern.kind === kind);
    if (q && !list.length) return null;
    return folder({
      id: `cat:${kind}`,
      label,
      count: list.length,
      children: () => list.map(patternRow),
    });
  });
  const favoriteCount = favoritePatterns.length + favoriteSounds.length;
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
          placeholder="Search sounds, tags, folders…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="library-results">
        {!q && (
          <>
            <p className="section-label">Collections</p>
            {folder({
              id: "favorites",
              label: "Favorites",
              count: favoriteCount,
              icon: <Star size={14} className="text-accent" />,
              empty: "Star a pattern or sound to collect it here.",
              children: () => [
                ...favoritePatterns.map(patternRow),
                ...favoriteSounds.map(soundRow),
              ],
            })}
          </>
        )}
        {patterns.length > 0 && <p className="section-label">KILN patterns · MIDI</p>}
        {kindFolders}
        {(!q || filtered.length > 0) && <p className="section-label">Places · audio</p>}
        {(!q || groups.loose.length > 0) &&
          folder({
            id: "samples",
            label: MY_SAMPLES,
            count: groups.loose.length,
            empty: "Imported files land here.",
            children: () => groups.loose.map(soundRow),
          })}
        {tree.map((node) => folderNode(node, 0))}
        {q && !patterns.length && !filtered.length && (
          <p className="empty-note">No sounds match. Try another search or import audio.</p>
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
            Folder
            <input
              aria-label="Sample folder"
              list="kiln-sample-folders"
              placeholder={MY_SAMPLES}
              defaultValue={selectedSound.folder ?? ""}
              onBlur={(event) => {
                const folder = event.target.value.trim().slice(0, 80);
                if (folder === (selectedSound.folder ?? "") || folder === MY_SAMPLES) return;
                run(async () => {
                  await updateSound(selectedSound.id, { folder: folder || undefined });
                  if (folder) expand(folderKeys(folder));
                  await refresh();
                });
              }}
            />
            <datalist id="kiln-sample-folders">
              {folderNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
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
      {naming && (
        <form
          className="library-details"
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("folder") ?? "")
              .trim()
              .slice(0, 80);
            const files = naming;
            setNaming(null);
            run(() => importFiles(files, name || undefined));
          }}
        >
          <label>
            Name this folder ({naming.length} {naming.length === 1 ? "file" : "files"})
            <input name="folder" aria-label="New folder name" defaultValue="New folder" autoFocus />
          </label>
          <div className="flex gap-2">
            <button type="button" className="studio-button flex-1" onClick={() => setNaming(null)}>
              Cancel
            </button>
            <button type="submit" className="studio-button primary flex-1">
              Import
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="panel-error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="panel-notice" role="status">
          {notice}
        </p>
      )}
      <div className="library-footer">
        <div className="flex gap-2">
          <button
            disabled={busy}
            className="studio-button flex-1"
            onClick={() => file.current?.click()}
          >
            <Upload size={14} />
            {busy ? "Working…" : "Import files"}
          </button>
          <button
            disabled={busy}
            className="studio-button flex-1"
            title="Import a whole folder; its sounds stay grouped"
            onClick={() => folderInput.current?.click()}
          >
            <FolderPlus size={14} />
            Folder
          </button>
        </div>
        <p>
          Files go to {MY_SAMPLES}; folders stay grouped. WAV, MP3, AIFF & more.
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
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) run(() => importFiles(files));
          }}
        />
        <input
          type="file"
          ref={folderInput}
          hidden
          multiple
          // Folder picking is a non-standard attribute React does not type.
          {...{ webkitdirectory: "" }}
          aria-label="Import a folder of samples"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) pickedFolder(files);
          }}
        />
      </div>
    </aside>
  );
}
