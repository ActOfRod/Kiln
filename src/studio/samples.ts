const DB_NAME = "kiln-samples";
const STORE = "buffers";

export const sampleBank = new Map<string, AudioBuffer>();
export const samplePeaks = new Map<string, number[]>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open sample storage"));
  });
}

export async function idbPut(id: string, data: ArrayBuffer): Promise<void> {
  await idbPutMany([[id, data]]);
}

export async function idbPutMany(entries: Array<[string, ArrayBuffer]>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const [id, data] of entries) tx.objectStore(STORE).put(data, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not store sample"));
      tx.onabort = () => reject(tx.error ?? new Error("Sample storage transaction was cancelled"));
    });
  } finally {
    db.close();
  }
}

export async function idbGet(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Could not read sample"));
  });
  db.close();
  return result;
}

export async function idbDel(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not delete sample"));
  });
  db.close();
}

export function computePeaks(buffer: AudioBuffer, buckets = 72): number[] {
  const data = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(data.length, start + size);
    for (let j = start; j < end; j += 8) {
      const v = Math.abs(data[j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
}
