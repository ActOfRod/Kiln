export interface LibrarySound {
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  duration: number;
  addedAt: number;
  /** Imported folder the sound belongs to; absent means "My samples". */
  folder?: string;
}

interface StoredSound extends LibrarySound {
  data: ArrayBuffer;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kiln-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sounds", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Sound library could not be opened."));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("sounds", mode);
      const request = run(tx.objectStore("sounds"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error("Sound library could not be saved."));
      tx.onabort = () => reject(tx.error ?? new Error("Sound library transaction was cancelled."));
    });
  } finally {
    db.close();
  }
}

export async function listSounds(): Promise<LibrarySound[]> {
  const sounds = await transact<StoredSound[]>("readonly", (store) => store.getAll());
  return sounds.map(({ data: _data, ...sound }) => sound).sort((a, b) => b.addedAt - a.addedAt);
}

export async function readSound(id: string): Promise<StoredSound> {
  const sound = await transact<StoredSound | undefined>("readonly", (store) => store.get(id));
  if (!sound) throw new Error("This sound is no longer in the library.");
  return sound;
}

export async function saveSound(sound: StoredSound): Promise<void> {
  await transact("readwrite", (store) => store.put(sound));
}

export async function updateSound(
  id: string,
  patch: Partial<Pick<LibrarySound, "name" | "tags" | "favorite" | "folder">>,
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sounds", "readwrite");
      const store = tx.objectStore("sounds");
      const request: IDBRequest<StoredSound | undefined> = store.get(id);
      let failure: Error | null = null;
      request.onsuccess = () => {
        if (!request.result) {
          failure = new Error("This sound is no longer in the library.");
          tx.abort();
          return;
        }
        store.put({ ...request.result, ...patch });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Sound metadata could not be saved."));
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("Sound metadata update was cancelled."));
    });
  } finally {
    db.close();
  }
}

export async function deleteSound(id: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(id));
}

export async function deleteSounds(ids: string[]): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sounds", "readwrite");
      const store = tx.objectStore("sounds");
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Sounds could not be deleted."));
      tx.onabort = () => reject(tx.error ?? new Error("Folder delete was cancelled."));
    });
  } finally {
    db.close();
  }
}

/** Folder for an imported file: its directory inside the picked folder, e.g. "Pack / Kicks". */
export function folderOf(relativePath: string): string | undefined {
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  const folder = parts.join(" / ").trim().slice(0, 80);
  return folder || undefined;
}

/** "My samples" first (newest first), then folders A–Z with their sounds in name order. */
export function groupSounds(sounds: LibrarySound[]): {
  loose: LibrarySound[];
  folders: Array<{ name: string; sounds: LibrarySound[] }>;
} {
  const loose: LibrarySound[] = [];
  const byFolder = new Map<string, LibrarySound[]>();
  for (const sound of sounds) {
    if (!sound.folder) loose.push(sound);
    else byFolder.set(sound.folder, [...(byFolder.get(sound.folder) ?? []), sound]);
  }
  const order = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return {
    loose,
    folders: [...byFolder.entries()]
      .sort(([a], [b]) => order(a, b))
      .map(([name, list]) => ({ name, sounds: list.sort((a, b) => order(a.name, b.name)) })),
  };
}

export interface FolderNode {
  /** Last segment, e.g. "Kicks". */
  name: string;
  /** Full folder name as stored on sounds, e.g. "Pack / Kicks". */
  path: string;
  sounds: LibrarySound[];
  children: FolderNode[];
  /** Sounds in this folder and every sub-folder. */
  count: number;
}

/** Nest "Pack / Kicks" style folder names (from groupSounds) into a browsable tree. */
export function folderTree(folders: Array<{ name: string; sounds: LibrarySound[] }>): FolderNode[] {
  const roots: FolderNode[] = [];
  for (const group of folders) {
    let level = roots;
    let path = "";
    let node: FolderNode | undefined;
    for (const part of group.name.split(" / ")) {
      path = path ? `${path} / ${part}` : part;
      node = level.find((item) => item.path === path);
      if (!node) {
        node = { name: part, path, sounds: [], children: [], count: 0 };
        level.push(node);
      }
      node.count += group.sounds.length;
      level = node.children;
    }
    node?.sounds.push(...group.sounds);
  }
  return roots;
}

/** Whether a sound's folder is `path` or one of its sub-folders. */
export function inFolder(folder: string | undefined, path: string): boolean {
  return folder === path || !!folder?.startsWith(`${path} / `);
}
