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

// Every read is scoped to one baby. Rows carry `profileId` (or Nara's
// `profileKey`); rows with neither belong to the primary baby.
let scopeId = null, primaryId = null;
const ownerOf = ev => ev.profileId || ev.profileKey || primaryId;
const inScope = ev => !ev.deleted && (!scopeId || ownerOf(ev) === scopeId);

// Views and the sync engine both listen for local changes.
const listeners = new Set();
function emit(reason) { listeners.forEach(fn => { try { fn(reason); } catch {} }); }

export const db = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Which baby reads return, and which baby untagged rows belong to. */
  setScope(current, primary) { scopeId = current || null; primaryId = primary || current || null; },
  scope() { return scopeId; },
  ownerOf,

  // Let the sync engine announce changes it made outside of put/remove.
  notify(reason = 'remote') { emit(reason); },

  /**
   * Local write. Stamps `updated` and marks the row dirty so the sync engine
   * picks it up; pass {remote:true} for rows arriving from Firestore.
   */
  async put(ev, { remote = false } = {}) {
    const row = remote
      ? { ...ev, dirty: false }
      : { ...ev, updated: Date.now(), dirty: true };
    if (!remote && !row.profileId && !row.profileKey && scopeId) row.profileId = scopeId;
    const s = await tx('events', 'readwrite');
    await done(s.put(row));
    emit(remote ? 'remote' : 'local');
    return row;
  },

  // Bulk insert in chunks so a 4k-row import stays inside one transaction each.
  async putMany(list, onProgress, { remote = false } = {}) {
    const database = await open();
    const CHUNK = 500;
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK);
      await new Promise((resolve, reject) => {
        const t = database.transaction('events', 'readwrite');
        const s = t.objectStore('events');
        slice.forEach(ev => {
          const row = remote
            ? { ...ev, dirty: false }
            : { ...ev, updated: ev.updated || Date.now(), dirty: true };
          if (!remote && !row.profileId && !row.profileKey && scopeId) row.profileId = scopeId;
          s.put(row);
        });
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
      if (onProgress) onProgress(Math.min(i + CHUNK, list.length), list.length);
    }
    emit(remote ? 'remote' : 'local');
  },

  async get(id) {
    const row = await done((await tx('events', 'readonly')).get(id));
    return row && row.deleted ? null : row;
  },

  /**
   * Deletes are tombstones, not removals: a hard delete on one phone would be
   * invisible to the other, and the row would sync straight back.
   */
  async remove(id) {
    const s = await tx('events', 'readwrite');
    const row = await done(s.get(id));
    if (!row) return;
    await done(s.put({ ...row, deleted: true, updated: Date.now(), dirty: true }));
    emit('local');
  },

  async clearEvents() {
    await done((await tx('events', 'readwrite')).clear());
    emit('local');
  },

  /** Tombstone every row, so the deletion reaches the other caregivers too. */
  async tombstoneAll() {
    const rows = (await this.allRaw()).filter(r => !r.deleted);
    const now = Date.now();
    await this.putMany(rows.map(r => ({ ...r, deleted: true, updated: now })));
    return rows.length;
  },

  async count() {
    return (await this.all()).length;
  },

  // All live events, newest first.
  async all() {
    const s = await tx('events', 'readonly');
    const out = await done(s.index('by_start').getAll());
    return out.reverse().filter(inScope);
  },

  // Live events with start in [from, to), newest first.
  async range(from, to) {
    const s = await tx('events', 'readonly');
    const out = await done(s.index('by_start').getAll(IDBKeyRange.bound(from, to, false, true)));
    return out.reverse().filter(inScope);
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
        if (inScope(c.value) && (!match || match(c.value))) return resolve(c.value);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async ofType(type, from, to) {
    const s = await tx('events', 'readonly');
    const lo = from ?? -Infinity, hi = to ?? Infinity;
    const out = await done(s.index('by_type_start').getAll(IDBKeyRange.bound([type, lo], [type, hi])));
    return out.reverse().filter(inScope);
  },

  /** Live-row count per baby id, ignoring the current scope. */
  async countByOwner() {
    const rows = await this.allRaw();
    const out = {};
    for (const r of rows) if (!r.deleted) out[ownerOf(r)] = (out[ownerOf(r)] || 0) + 1;
    return out;
  },

  /* ---- sync support ---- */

  // Rows changed locally and not yet pushed (tombstones included).
  async dirty(limit = Infinity) {
    const s = await tx('events', 'readonly');
    const all = await done(s.getAll());
    const out = all.filter(e => e.dirty);
    return limit === Infinity ? out : out.slice(0, limit);
  },

  async markClean(ids) {
    const database = await open();
    await new Promise((resolve, reject) => {
      const t = database.transaction('events', 'readwrite');
      const s = t.objectStore('events');
      ids.forEach(id => {
        const req = s.get(id);
        req.onsuccess = () => { if (req.result) s.put({ ...req.result, dirty: false }); };
      });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },

  // Raw row including tombstones — the sync engine needs to see those.
  async raw(id) { return done((await tx('events', 'readonly')).get(id)); },

  async allRaw() { return done((await tx('events', 'readonly')).getAll()); },

  async metaGet(key, fallback = null) {
    const row = await done((await tx('meta', 'readonly')).get(key));
    return row ? row.value : fallback;
  },

  async metaSet(key, value) {
    await done((await tx('meta', 'readwrite')).put({ key, value }));
    emit('meta');
    return value;
  },
};
