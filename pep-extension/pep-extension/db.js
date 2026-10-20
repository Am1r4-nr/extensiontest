// Small IndexedDB wrapper. Stores: people (one row per person per organisation), runs (refresh log),
// associates (family members and close associates of PEPs).
const DB_NAME = 'pep-register';
const DB_VERSION = 2;
let dbPromise;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('people')) {
        const s = db.createObjectStore('people', { keyPath: 'key' });
        s.createIndex('sourceId', 'sourceId');
      }
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' });
      // Family members and close associates, entered manually or imported from CSV.
      if (!db.objectStoreNames.contains('associates')) db.createObjectStore('associates', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const wrap = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export async function getAll(store) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function getBySource(sourceId) {
  const db = await openDb();
  return wrap(db.transaction('people').objectStore('people').index('sourceId').getAll(sourceId));
}

export async function putMany(store, items) {
  if (!items.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const it of items) s.put(it);
  return done(tx);
}

export async function putOne(store, item) { return putMany(store, [item]); }

export async function clearStore(store) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

export async function deleteOne(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}
