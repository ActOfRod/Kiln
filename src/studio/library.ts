export interface LibrarySound {
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  duration: number;
  addedAt: number;
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
  patch: Partial<Pick<LibrarySound, "name" | "tags" | "favorite">>,
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
