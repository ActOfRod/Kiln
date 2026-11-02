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
import {
  canLinkFolders,
  collectSounds,
  folderPermission,
  formatBytes,
  listLinks,
  notifyFolders,
  openLinkedFile,
  pickSampleFolder,
  readLinkedFile,
  rememberFolder,
  removeLink,
  requestFolderAccess,
  subscribeFolders,
  type FolderAccess,
  type LinkedSound,
} from "@/studio/local-folders";
import { formatImportEta, importMeter, type ImportMeter } from "@/studio/import-progress";
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

interface LinkView {
  id: string;
  name: string;
  permission: FolderAccess;
  sounds: LinkedSound[];
  scanning: boolean;
  seen: number;
}

function labelOf(file: File) {
  const stripped = file.name.replace(/\.[^.]+$/, "");
  return stripped || file.name;
}

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
  const [importing, setImporting] = useState<ImportMeter | null>(null);
  const [importSpoken, setImportSpoken] = useState("");
  const [links, setLinks] = useState<LinkView[]>([]);
  const eta = useRef<number | null>(null);
  const spokenAt = useRef(0);
  const revealLink = useRef<string | null>(null);
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

  useEffect(() => {
    let generation = 0;
    const load = async () => {
      const ticket = ++generation;
      let records;
      try {
        records = await listLinks();
      } catch (err) {
        if (ticket === generation) setError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (ticket !== generation) return;
      setLinks((current) =>
        records.map((record) => {
          const previous = current.find((item) => item.id === record.id);
          return {
            id: record.id,
            name: record.name,
            permission: previous?.permission ?? "prompt",
            sounds: previous?.sounds ?? [],
            scanning: true,
            seen: previous?.sounds.length ?? 0,
          };
        }),
      );
      for (const record of records) {
        if (ticket !== generation) return;
        let permission: FolderAccess = "prompt";
        try {
          permission = await folderPermission(record.handle);
        } catch {
          permission = "missing";
        }
        if (ticket !== generation) return;
        if (permission !== "granted") {
          setLinks((current) =>
            current.map((item) =>
              item.id === record.id ? { ...item, permission, scanning: false } : item,
            ),
          );
          continue;
        }
        try {
          const sounds = await collectSounds(record.id, record.handle, (seen) => {
            if (ticket !== generation) return;
            setLinks((current) =>
              current.map((item) =>
                item.id === record.id
                  ? { ...item, seen, scanning: true, permission: "granted" }
                  : item,
              ),
            );
          });
          if (ticket !== generation) return;
          setLinks((current) =>
            current.map((item) =>
              item.id === record.id
                ? { ...item, sounds, seen: sounds.length, scanning: false, permission: "granted" }
                : item,
            ),
          );
          if (revealLink.current === record.id) {
            revealLink.current = null;
            setOpen((current) => [...new Set([...current, `link:${record.id}`])]);
            const count = sounds.length.toLocaleString();
            setNotice(
              sounds.length
                ? `Showing ${count} ${sounds.length === 1 ? "sound" : "sounds"} from ${record.name}. They stay in that folder.`
                : `No audio files in ${record.name}.`,
            );
            requestAnimationFrame(() =>
              document
                .getElementById(`link-folder-${record.id}`)
                ?.scrollIntoView({ block: "nearest" }),
            );
          }
        } catch (err) {
          if (ticket !== generation) return;
          setLinks((current) =>
            current.map((item) =>
              item.id === record.id ? { ...item, permission: "missing", scanning: false } : item,
            ),
          );
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void load();
    return subscribeFolders(() => void load());
  }, []);

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
    const unreadable = files.length - audioFiles.length;
    let skipped = unreadable;
    const folders = new Set<string>();
    const ctx = new AudioContext();
    const startedAt = performance.now();
    const bytesTotal = audioFiles.reduce((sum, item) => sum + item.size, 0);
    let bytesDone = 0;
    let done = 0;
    eta.current = null;
    spokenAt.current = 0;
    let lastPaint = 0;
    const paint = (name: string, force = false) => {
      const now = performance.now();
      if (!force && now - lastPaint < 120) return;
      lastPaint = now;
      const meter = importMeter({
        done,
        total: audioFiles.length,
        bytesDone,
        bytesTotal,
        name,
        startedAt,
        now,
        previousEta: eta.current,
      });
      eta.current = meter.etaMs;
      setImporting(meter);
      if (force || now - spokenAt.current > 8000) {
        spokenAt.current = now;
        setImportSpoken(
          `Importing ${done.toLocaleString()} of ${audioFiles.length.toLocaleString()} into this browser. ${formatImportEta(meter.etaMs)}`,
        );
      }
    };
    try {
      if (audioFiles.length) paint(labelOf(audioFiles[0]!), true);
      for (const item of audioFiles) {
        const label = labelOf(item);
        paint(label);
        if (item.size > 50_000_000) {
          if (audioFiles.length === 1) throw new Error(`${item.name} exceeds the 50 MB limit.`);
          skipped++;
          done++;
          bytesDone += item.size;
          continue;
        }
        const data = await item.arrayBuffer();
        let duration: number;
        try {
          duration = (await ctx.decodeAudioData(data.slice(0))).duration;
        } catch (err) {
          if (audioFiles.length === 1) throw err;
          skipped++;
          done++;
          bytesDone += item.size;
          continue;
        }
        const home = folderOf(item.webkitRelativePath) ?? folder;
        if (home) folders.add(home);
        await saveSound({
          id: crypto.randomUUID(),
          name: label,
          tags: [],
          duration,
          favorite: false,
          addedAt: Date.now(),
          data,
          ...(home && { folder: home }),
        });
        done++;
        bytesDone += item.size;
        paint(label, done === audioFiles.length);
      }
    } finally {
      await ctx.close();
      setImporting(null);
      eta.current = null;
      await refresh();
      expand(folders.size ? [...folders].flatMap(folderKeys) : ["samples"]);
    }
    if (!audioFiles.length) throw new Error("No audio files found. Try WAV, MP3, AIFF or FLAC.");
    const saved = audioFiles.length - (skipped - unreadable);
    const parts: string[] = [];
    if (saved > 1) parts.push(`Saved ${saved.toLocaleString()} sounds in this browser.`);
    if (skipped)
      parts.push(
        `Skipped ${skipped} ${skipped === 1 ? "file that wasn't" : "files that weren't"} usable audio.`,
      );
    if (parts.length) setNotice(parts.join(" "));
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
  const linkedMatch = links.some(
    (link) =>
      link.name.toLowerCase().includes(q) ||
      link.sounds.some((sound) => `${sound.name} ${sound.group ?? ""}`.toLowerCase().includes(q)),
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
    domId?: string;
  }) => {
    const expanded = !!q || open.includes(options.id);
    const depth = options.depth ?? 0;
    return (
      <div
        key={options.id}
        id={options.domId}
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
  const placeLinked = async (sound: LinkedSound) => {
    const file = await readLinkedFile(sound.id);
    if (file.data.byteLength > 50_000_000)
      throw new Error(`${file.name} exceeds the 50 MB limit for a track.`);
    await useStudio.getState().addAudioTrack(file.data, file.name);
  };
  const linkedRow = (sound: LinkedSound) => (
    <div
      key={sound.id}
      className={cx("library-item", selected === sound.id && "selected")}
      draggable
      title="Click to hear it · drag onto the arrangement. The file stays in its folder until you place it."
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/kiln-linked", sound.id);
      }}
    >
      <button
        className="icon-button"
        disabled={busy && preview !== sound.id}
        aria-label={`Preview ${sound.name}`}
        aria-pressed={preview === sound.id}
        onClick={() => togglePreview(sound.id, () => openLinkedFile(sound.id))}
      >
        {preview === sound.id ? <Square size={14} /> : <Play size={14} />}
      </button>
      <button
        className="library-item-name"
        onClick={() => {
          setSelected(sound.id);
          togglePreview(sound.id, () => openLinkedFile(sound.id));
        }}
      >
        <strong>{sound.name}</strong>
        <small>{formatBytes(sound.size)}</small>
      </button>
      <button
        className="icon-button"
        disabled={busy}
        aria-label={`Add ${sound.name} to song`}
        onClick={() => run(() => placeLinked(sound))}
      >
        <Plus size={14} />
      </button>
    </div>
  );
  const linkedTree = (folderId: string, sounds: LinkedSound[]) => {
    const byId = new Map(sounds.map((sound) => [sound.id, sound]));
    const grouped = groupSounds(
      sounds.map((sound) => ({
        id: sound.id,
        name: sound.name,
        tags: [],
        favorite: false,
        duration: 0,
        addedAt: 0,
        ...(sound.group ? { folder: sound.group } : {}),
      })),
    );
    const node = (entry: FolderNode, depth: number): ReactNode =>
      folder({
        id: `linkdir:${folderId}:${entry.path}`,
        label: entry.name,
        count: entry.count,
        depth,
        children: () => [
          ...entry.children.map((child) => node(child, depth + 1)),
          ...entry.sounds.flatMap((sound) => {
            const linked = byId.get(sound.id);
            return linked ? [linkedRow(linked)] : [];
          }),
        ],
      });
    return [
      ...grouped.loose.flatMap((sound) => {
        const linked = byId.get(sound.id);
        return linked ? [linkedRow(linked)] : [];
      }),
      ...folderTree(grouped.folders).map((entry) => node(entry, 1)),
    ];
  };
  const allowLink = (id: string) => {
    void (async () => {
      const record = (await listLinks()).find((item) => item.id === id);
      if (!record) return;
      const permission = await requestFolderAccess(record.handle);
      if (permission === "denied") setError(`Access to ${record.name} was denied.`);
      if (permission === "missing") setError(`${record.name} can't be found anymore.`);
      notifyFolders();
    })().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const addFolder = () => {
    if (!canLinkFolders()) {
      folderInput.current?.click();
      return;
    }
    void (async () => {
      try {
        const handle = await pickSampleFolder();
        const record = await rememberFolder(handle);
        revealLink.current = record.id;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof DOMException && err.name === "SecurityError") {
          setError(
            "Add folder needs the studio in its own window. Open KILN in a full tab, then choose Add folder. The files stay in that folder.",
          );
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };
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
        <span className="text-faint text-xs ml-auto">
          {(
            PATTERNS.length +
            sounds.length +
            links.reduce((sum, link) => sum + link.sounds.length, 0)
          ).toLocaleString()}{" "}
          sounds
        </span>
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
        {(links.length > 0 || !q || filtered.length > 0) && (
          <p className="section-label">Places · audio</p>
        )}
        {links.map((link) => {
          const matched = q
            ? link.sounds.filter((sound) =>
                `${sound.name} ${sound.group ?? ""} ${link.name}`.toLowerCase().includes(q),
              )
            : link.sounds;
          if (q && !matched.length && !link.name.toLowerCase().includes(q)) return null;
          const readable = link.permission === "granted";
          return folder({
            id: `link:${link.id}`,
            domId: `link-folder-${link.id}`,
            label: link.name,
            count: link.scanning ? link.seen : matched.length,
            empty: link.scanning
              ? "Reading this folder…"
              : readable
                ? "No audio files in this folder."
                : link.permission === "missing"
                  ? "This folder can't be found."
                  : "Allow access to see the files in this folder.",
            actions: (
              <>
                {link.permission !== "granted" && link.permission !== "missing" && (
                  <button className="library-folder-confirm" onClick={() => allowLink(link.id)}>
                    Allow
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Remove folder ${link.name}`}
                  title="Remove this link. The files stay on your machine."
                  onClick={() =>
                    void removeLink(link.id).catch((err: unknown) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    )
                  }
                >
                  <Trash2 size={13} />
                </button>
              </>
            ),
            children: () => linkedTree(link.id, matched),
          });
        })}
        {(!q || groups.loose.length > 0) &&
          folder({
            id: "samples",
            label: MY_SAMPLES,
            count: groups.loose.length,
            empty: "Copied files land here. Add folder leaves files where they are.",
            children: () => groups.loose.map(soundRow),
          })}
        {tree.map((node) => folderNode(node, 0))}
        {patterns.length > 0 && <p className="section-label">KILN patterns · MIDI</p>}
        {kindFolders}
        {q && !patterns.length && !filtered.length && !linkedMatch && (
          <p className="empty-note">No sounds match. Try another search or add a folder.</p>
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
        {importing && (
          <div className="library-import">
            <div className="library-import-meta">
              <span>Importing into this browser</span>
              <span>
                {importing.done.toLocaleString()} / {importing.total.toLocaleString()}
              </span>
            </div>
            <div
              className="library-import-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={importing.percent}
              aria-valuetext={`${importing.percent} percent. ${formatImportEta(importing.etaMs)}`}
              aria-label="Library import"
            >
              <div className="library-import-fill" style={{ width: `${importing.ratio * 100}%` }} />
            </div>
            <p className="library-import-name" title={importing.name}>
              {importing.name}
            </p>
            <p className="library-import-eta">
              {importing.percent}% · {formatImportEta(importing.etaMs)}
            </p>
            <span className="sr-only" aria-live="polite">
              {importSpoken}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            disabled={busy}
            className="studio-button primary flex-1"
            aria-label="Add folder"
            title="Show a folder from this machine. The files stay where they are."
            onClick={addFolder}
          >
            <FolderPlus size={14} />
            Add folder
          </button>
          <button
            disabled={busy}
            className="studio-button flex-1"
            onClick={() => file.current?.click()}
          >
            <Upload size={14} />
            {importing ? "Importing…" : busy ? "Working…" : "Copy files"}
          </button>
        </div>
        <p>
          Add folder reads sounds where they already are. WAV, MP3, AIFF and more.
          <br />
          Copy files saves a private copy in this browser, up to 50 MB each.
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
