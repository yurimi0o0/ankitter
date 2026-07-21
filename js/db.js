// Low-level IndexedDB access. No domain knowledge lives here — see repo.js.

const DB_NAME = 'ankitter-db';
const DB_VERSION = 1;

export const STORES = {
  sources: 'sources',
  cards: 'cards',
  userComments: 'userComments',
  likes: 'likes',
  retweets: 'retweets',
  viewHistory: 'viewHistory',
  settings: 'settings',
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORES.sources)) {
        db.createObjectStore(STORES.sources, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.cards)) {
        const s = db.createObjectStore(STORES.cards, { keyPath: 'id' });
        s.createIndex('sourceId', 'sourceId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.userComments)) {
        const s = db.createObjectStore(STORES.userComments, { keyPath: 'id', autoIncrement: true });
        s.createIndex('cardId', 'cardId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.likes)) {
        db.createObjectStore(STORES.likes, { keyPath: 'cardId' });
      }
      if (!db.objectStoreNames.contains(STORES.retweets)) {
        const s = db.createObjectStore(STORES.retweets, { keyPath: 'id', autoIncrement: true });
        s.createIndex('cardId', 'cardId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.viewHistory)) {
        const s = db.createObjectStore(STORES.viewHistory, { keyPath: 'id', autoIncrement: true });
        s.createIndex('cardId', 'cardId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return reqToPromise(tx.objectStore(store).get(key));
}

export async function dbGetAll(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return reqToPromise(tx.objectStore(store).getAll());
}

export async function dbGetAllByIndex(store, indexName, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return reqToPromise(tx.objectStore(store).index(indexName).getAll(value));
}

export async function dbPut(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const result = await reqToPromise(tx.objectStore(store).put(value));
  return result;
}

export async function dbBulkPut(store, values) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  return reqToPromise(tx.objectStore(store).delete(key));
}

export async function dbDeleteByIndex(store, indexName, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const index = os.index(indexName);
  return new Promise((resolve, reject) => {
    const cursorReq = index.openCursor(value);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function dbClear(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  return reqToPromise(tx.objectStore(store).clear());
}

export async function dbCount(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return reqToPromise(tx.objectStore(store).count());
}

// Deletes the oldest `excess` records of a store ordered by primary key
// (used to keep view history from growing without bound).
export async function dbTrimOldest(store, keep) {
  const db = await openDB();
  const total = await dbCount(store);
  if (total <= keep) return;
  const excess = total - keep;
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  return new Promise((resolve, reject) => {
    let deleted = 0;
    const cursorReq = os.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor && deleted < excess) {
        cursor.delete();
        deleted++;
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}
