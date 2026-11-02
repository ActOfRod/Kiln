/**
 * A folder on the user's machine that the library reads in place.
 * Chrome and Edge can remember the folder. The audio bytes stay in that folder
 * until a sound is placed on a track.
 */

const DB_NAME = "kiln-linked-folders";
const STORE = "folders";
const AUDIO_NAME = /\.(wav|mp3|aiff?|flac|ogg|m4a|aac|webm)$/i;

export interface SampleDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterable<[string, SampleHandle]>;
  queryPermission?(descriptor: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" }): Promise<PermissionState>;
  isSameEntry?(other: SampleDirectoryHandle): Promise<boolean>;
}

export interface SampleFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
}

export type SampleHandle = SampleDirectoryHandle | SampleFileHandle;

export interface LinkedSound {
  id: string;
  folderId: string;
  name: string;
  relativePath: string;
  /** Parent folders inside the linked folder, e.g. "Kicks" or "Drums / Kicks". */
  group?: string;
  size: number;
}

export interface StoredLink {
  id: string;
  name: string;
  handle: SampleDirectoryHandle;
}

export type FolderAccess = "granted" | "denied" | "prompt" | "missing";

const memory = new Map<string, StoredLink>();
const openFiles = new Map<string, SampleFileHandle>();
const listeners = new Set<() => void>();
let persistence: "unknown" | "ok" | "off" = "unknown";

export function isAudioName(name: string): boolean {
  return AUDIO_NAME.test(name);
}

export function soundLabel(filename: string): string {
  const stripped = filename.replace(/\.[^.]+$/, "");
  return stripped || filename;
}

/** Directory portion of a relative path, using the library's "A / B" folder names. */
export function groupPath(relativePath: string): string | undefined {
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  const folder = parts.join(" / ").trim();
  return folder || undefined;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  const mb = size / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function canLinkFolders(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function subscribeFolders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

export async function pickSampleFolder(): Promise<SampleDirectoryHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker: (options: {
        mode: "read";
        id: string;
      }) => Promise<SampleDirectoryHandle>;
    }
  ).showDirectoryPicker;
  return picker({ mode: "read", id: "kiln-sample-folder" });
}

export async function folderPermission(handle: SampleDirectoryHandle): Promise<FolderAccess> {
  if (!handle.queryPermission) return "granted";
  try {
    const state = await handle.queryPermission({ mode: "read" });
    return state === "granted" || state === "denied" || state === "prompt" ? state : "prompt";
  } catch (error) {
    return missingFolder(error) ? "missing" : "prompt";
  }
}

export async function requestFolderAccess(handle: SampleDirectoryHandle): Promise<FolderAccess> {
  if (!handle.requestPermission) return "granted";
  try {
    const state = await handle.requestPermission({ mode: "read" });
    return state === "granted" || state === "denied" || state === "prompt" ? state : "prompt";
  } catch (error) {
    return missingFolder(error) ? "missing" : "denied";
  }
}

function missingFolder(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function sameFolder(a: SampleDirectoryHandle, b: SampleDirectoryHandle): Promise<boolean> {
  if (a === b) return true;
  if (!a.isSameEntry) return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Linked folders could not be opened."));
  });
}

async function idbAll(): Promise<StoredLink[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      tx.oncomplete = () => resolve((request.result as StoredLink[] | undefined) ?? []);
      tx.onerror = () => reject(tx.error ?? new Error("Linked folders could not be read."));
      tx.onabort = () => reject(tx.error ?? new Error("Linked folders could not be read."));
    });
  } finally {
    db.close();
  }
}

async function idbPut(record: StoredLink): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("This folder could not be remembered."));
      tx.onabort = () => reject(tx.error ?? new Error("This folder could not be remembered."));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("This folder link could not be removed."));
      tx.onabort = () => reject(tx.error ?? new Error("This folder link could not be removed."));
    });
  } finally {
    db.close();
  }
}

export async function listLinks(): Promise<StoredLink[]> {
  if (persistence === "off") return [...memory.values()];
  try {
    const stored = await idbAll();
    memory.clear();
    for (const record of stored) memory.set(record.id, record);
    persistence = "ok";
    return stored;
  } catch {
    persistence = "off";
    return [...memory.values()];
  }
}

/** Remember a folder and tell the library to read it. The same folder is not added twice. */
export async function rememberFolder(handle: SampleDirectoryHandle): Promise<StoredLink> {
  const current = await listLinks();
  for (const existing of current) {
    if (await sameFolder(existing.handle, handle)) {
      emit();
      return existing;
    }
  }
  const record: StoredLink = {
    id: crypto.randomUUID(),
    name: handle.name || "Folder",
    handle,
  };
  memory.set(record.id, record);
  if (persistence !== "off") {
    try {
      await idbPut(record);
      persistence = "ok";
    } catch {
      persistence = "off";
    }
  }
  emit();
  return record;
}

export async function removeLink(id: string): Promise<void> {
  memory.delete(id);
  for (const key of [...openFiles.keys()]) {
    if (key.startsWith(`${id}/`)) openFiles.delete(key);
  }
  if (persistence !== "off") {
    try {
      await idbDelete(id);
    } catch {
      persistence = "off";
    }
  }
  emit();
}

export function notifyFolders() {
  emit();
}

/**
 * List audio files under a folder. File handles are kept so a sound can be read
 * later without copying the whole folder.
 */
export async function collectSounds(
  folderId: string,
  handle: SampleDirectoryHandle,
  onCount?: (count: number) => void,
  files: Map<string, SampleFileHandle> = openFiles,
): Promise<LinkedSound[]> {
  for (const key of [...files.keys()]) {
    if (key.startsWith(`${folderId}/`)) files.delete(key);
  }
  const sounds: LinkedSound[] = [];
  await walk(handle, "", folderId, sounds, files, onCount);
  onCount?.(sounds.length);
  sounds.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
  return sounds;
}

async function walk(
  dir: SampleDirectoryHandle,
  prefix: string,
  folderId: string,
  sounds: LinkedSound[],
  files: Map<string, SampleFileHandle>,
  onCount?: (count: number) => void,
) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await walk(handle, path, folderId, sounds, files, onCount);
      continue;
    }
    if (handle.kind !== "file" || name.startsWith(".") || !isAudioName(name)) continue;
    const file = await handle.getFile();
    const id = `${folderId}/${path}`;
    files.set(id, handle);
    sounds.push({
      id,
      folderId,
      name: soundLabel(name),
      relativePath: path,
      group: groupPath(path),
      size: file.size,
    });
    if (onCount && sounds.length % 25 === 0) onCount(sounds.length);
  }
}

export async function openLinkedFile(id: string): Promise<File> {
  const handle = openFiles.get(id);
  if (!handle)
    throw new Error("That sound is not in the linked folder anymore. Add the folder again.");
  return handle.getFile();
}

export async function readLinkedFile(id: string): Promise<{ name: string; data: ArrayBuffer }> {
  const file = await openLinkedFile(id);
  return { name: soundLabel(file.name), data: await file.arrayBuffer() };
}
