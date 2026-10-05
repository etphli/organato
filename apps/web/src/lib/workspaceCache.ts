import type { WorkspaceSnapshot } from "@organato/domain";

const databaseName = "organato-workspace-v1";
const storeName = "snapshots";
const maximumAgeMs = 24 * 60 * 60 * 1000;

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Workspace cache is unavailable."));
  });
}

async function read(key: string): Promise<unknown> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadWorkspaceCache(
  key: string,
): Promise<WorkspaceSnapshot | null> {
  try {
    const value = await read(key);
    if (!value) return null;
    const { workspaceCacheSchema } = await import("@organato/domain/backup");
    const result = workspaceCacheSchema.safeParse(value);
    if (!result.success) return null;
    const age = Date.now() - Date.parse(result.data.exportedAt);
    return age >= 0 && age < maximumAgeMs
      ? (result.data as WorkspaceSnapshot)
      : null;
  } catch {
    return null;
  }
}

export async function saveWorkspaceCache(
  key: string,
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  await write(key, snapshot);
  void import("@organato/domain/backup").catch(() => undefined);
}

export async function clearWorkspaceCache(): Promise<void> {
  await write();
}

let pendingWrite = Promise.resolve();

function write(key?: string, snapshot?: WorkspaceSnapshot): Promise<void> {
  pendingWrite = pendingWrite.then(() => writeSnapshot(key, snapshot));
  return pendingWrite;
}

async function writeSnapshot(
  key?: string,
  snapshot?: WorkspaceSnapshot,
): Promise<void> {
  try {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        // Keep only the current authenticated account on shared browsers.
        store.clear();
        if (key && snapshot) store.put(snapshot, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Private browsing, quota limits, and denied storage fall back to the API.
  }
}
