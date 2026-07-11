import type { SignRecording } from '../vision/types'

// Recordings live in IndexedDB (localStorage would cap out after ~20
// recordings — a 5 s recording is roughly 200 KB of JSON). Written as a
// tiny plain-IDB wrapper instead of pulling in a dependency.
const DB_NAME = 'ssl-learn'
const DB_VERSION = 1
const STORE = 'recordings'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = run(tx.objectStore(STORE))
    let result: T
    req.onsuccess = () => {
      result = req.result
    }
    // Resolve only once the transaction commits, so writes are durable.
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    }
  })
}

export async function listRecordings(): Promise<SignRecording[]> {
  const all = await withStore('readonly', (s) => s.getAll() as IDBRequest<SignRecording[]>)
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveRecording(rec: SignRecording): Promise<IDBValidKey> {
  return withStore('readwrite', (s) => s.put(rec))
}

export function deleteRecording(id: string): Promise<undefined> {
  return withStore('readwrite', (s) => s.delete(id))
}
