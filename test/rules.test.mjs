/**
 * firestore.rules check: the shared family log is open to the app, and nothing
 * else in the project is reachable. Run against the emulator:
 *   firebase emulators:start --project demo-witte --only firestore
 *   node test/rules.test.mjs
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, deleteDoc,
         collection, getDocs } from 'firebase/firestore';

const app = initializeApp({ apiKey: 'demo-key', authDomain: '127.0.0.1', projectId: 'witte-baby-tracker', appId: '1:1:web:1' });
const fs = getFirestore(app);
connectFirestoreEmulator(fs, '127.0.0.1', 8080);

const SPACE = 'witte';
const pass = [], fail = [];
const note = (name, ok, extra = '') => (ok ? pass : fail).push(`${name}${extra ? ' — ' + extra : ''}`);
async function allowed(name, fn) {
  try { await fn(); note(name, true); } catch (e) { note(name, false, e.code || e.message); }
}
async function denied(name, fn) {
  try { await fn(); note(name, false, 'ALLOWED but should be denied'); }
  catch (e) { note(name, e.code === 'permission-denied', e.code); }
}

// the app's own path — no sign-in, by design
await allowed('app writes an entry', () => setDoc(doc(fs, 'families', SPACE, 'events', 'test-1'),
  { type: 'diaper', start: Date.now(), wet: true }));
await allowed('app reads that entry', () => getDoc(doc(fs, 'families', SPACE, 'events', 'test-1')));
await allowed('app lists the log', () => getDocs(collection(fs, 'families', SPACE, 'events')));
await allowed('app writes shared settings', () => setDoc(doc(fs, 'families', SPACE, 'meta', 'units'),
  { value: { weight: 'lb' }, updated: Date.now() }));
await allowed('app reads the family doc', () => getDoc(doc(fs, 'families', SPACE)));
await allowed('app deletes an entry', () => deleteDoc(doc(fs, 'families', SPACE, 'events', 'test-1')));

// everything else in the project stays shut
await denied('another family is unreachable', () => getDocs(collection(fs, 'families', 'someone-else', 'events')));
await denied('writing to another family', () => setDoc(doc(fs, 'families', 'someone-else', 'events', 'x'), { a: 1 }));
await denied('reading another family doc', () => getDoc(doc(fs, 'families', 'someone-else')));
await denied('a stray top-level collection', () => setDoc(doc(fs, 'whatever', 'x'), { a: 1 }));
await denied('reading a stray collection', () => getDocs(collection(fs, 'whatever')));

console.log('\nPASS:'); pass.forEach(x => console.log('  ✓', x));
console.log('FAIL:'); fail.length ? fail.forEach(x => console.log('  ✗', x)) : console.log('  (none)');
process.exit(fail.length ? 1 : 0);
