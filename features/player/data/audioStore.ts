"use client";

/**
 * IndexedDB store for imported backing-track audio. localStorage can't hold
 * multi-MB audio files, so the blobs live here keyed by song id. Metadata
 * (file names) still lives in the localStorage song store.
 */

const DB_NAME = "learn-bass";
const STORE = "backing-audio";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function putBackingAudio(songId: string, file: Blob): Promise<IDBValidKey> {
  return tx("readwrite", (store) => store.put(file, songId));
}

export async function getBackingAudio(songId: string): Promise<Blob | undefined> {
  try {
    return (await tx<Blob | undefined>("readonly", (store) =>
      store.get(songId),
    )) as Blob | undefined;
  } catch {
    return undefined;
  }
}

export function deleteBackingAudio(songId: string): Promise<undefined> {
  return tx("readwrite", (store) => store.delete(songId));
}
