// IndexedDB layer. One store for activities, one for settings/timer state.
const DB_NAME = 'witte-baby';
const DB_VERSION = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) {
        const s = db.createObjectStore('events', { keyPath: 'id' });
        s.createIndex('by_start', 'start');
        s.createIndex('by_type_start', ['type', 'start']);
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async put(ev) {
    const s = await tx('events', 'readwrite');
    await done(s.put(ev));
    return ev;
  },

  // Bulk insert in chunks so a 4k-row import stays inside one transaction each.
  async putMany(list, onProgress) {
    const database = await open();
    const CHUNK = 500;
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK);
      await new Promise((resolve, reject) => {
        const t = database.transaction('events', 'readwrite');
        const s = t.objectStore('events');
        slice.forEach(ev => s.put(ev));
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
      if (onProgress) onProgress(Math.min(i + CHUNK, list.length), list.length);
    }
  },

  async get(id) { return done((await tx('events', 'readonly')).get(id)); },

  async remove(id) { return done((await tx('events', 'readwrite')).delete(id)); },

  async clearEvents() { return done((await tx('events', 'readwrite')).clear()); },

  async count() { return done((await tx('events', 'readonly')).count()); },

  // All events, newest first.
  async all() {
    const s = await tx('events', 'readonly');
    const out = await done(s.index('by_start').getAll());
    return out.reverse();
  },

  // Events with start in [from, to), newest first.
  async range(from, to) {
    const s = await tx('events', 'readonly');
    const out = await done(s.index('by_start').getAll(IDBKeyRange.bound(from, to, false, true)));
    return out.reverse();
  },

  // Most recent event of a type (optionally matching a filter), newest first scan.
  async latest(type, match) {
    const s = await tx('events', 'readonly');
    return new Promise((resolve, reject) => {
      const req = s.index('by_type_start').openCursor(
        IDBKeyRange.bound([type, -Infinity], [type, Infinity]), 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(null);
        if (!match || match(c.value)) return resolve(c.value);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async ofType(type, from, to) {
    const s = await tx('events', 'readonly');
    const lo = from ?? -Infinity, hi = to ?? Infinity;
    const out = await done(s.index('by_type_start').getAll(IDBKeyRange.bound([type, lo], [type, hi])));
    return out.reverse();
  },

  async metaGet(key, fallback = null) {
    const row = await done((await tx('meta', 'readonly')).get(key));
    return row ? row.value : fallback;
  },

  async metaSet(key, value) {
    await done((await tx('meta', 'readwrite')).put({ key, value }));
    return value;
  },
};
