const DB_NAME = "closet-db";
const DB_VERSION = 2;

// A single shared connection, reused across calls instead of opening a fresh one every
// time. Also releases itself on "versionchange" so that if this app is open in another
// tab and gets updated to a newer schema there, this tab's stale connection doesn't
// permanently block that other tab's upgrade (IndexedDB upgrades otherwise hang forever
// waiting for every open connection to a lower version to close).
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("garments")) {
        db.createObjectStore("garments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("outfits")) {
        db.createObjectStore("outfits", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("wearLog")) {
        db.createObjectStore("wearLog", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("wishlist")) {
        db.createObjectStore("wishlist", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async getAll(storeName) {
    const db_ = await openDb();
    const tx = db_.transaction(storeName, "readonly");
    return reqToPromise(tx.objectStore(storeName).getAll());
  },
  async get(storeName, id) {
    const db_ = await openDb();
    const tx = db_.transaction(storeName, "readonly");
    return reqToPromise(tx.objectStore(storeName).get(id));
  },
  async put(storeName, value) {
    return withStore(storeName, "readwrite", (store) => store.put(value));
  },
  async delete(storeName, id) {
    return withStore(storeName, "readwrite", (store) => store.delete(id));
  },
  async clear(storeName) {
    return withStore(storeName, "readwrite", (store) => store.clear());
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
