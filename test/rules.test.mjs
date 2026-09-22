import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc,
         collection, getDocs, arrayUnion, Timestamp } from 'firebase/firestore';

const cfg = { apiKey: 'demo-key', authDomain: '127.0.0.1', projectId: 'demo-witte', appId: '1:1:web:1' };
const app = initializeApp(cfg);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fs = getFirestore(app);
connectFirestoreEmulator(fs, '127.0.0.1', 8080);

const settle = () => new Promise(r => setTimeout(r, 1500));   // let the auth token reach Firestore
const pass = [], fail = [];
const check = (name, ok, extra = '') => (ok ? pass : fail).push(`${name}${extra ? ' — ' + extra : ''}`);
async function denied(name, fn) {
  try { await fn(); check(name, false, 'ALLOWED but should be denied'); }
  catch (e) { check(name, e.code === 'permission-denied', e.code); }
}
async function allowed(name, fn) {
  try { const r = await fn(); check(name, true); return r; }
  catch (e) { check(name, false, e.code || e.message); }
}

// --- as A (a family member)
await signInWithEmailAndPassword(auth, 'a@example.com', 'test1234'); await settle();
const uidA = auth.currentUser.uid;
const link = await getDoc(doc(fs, 'users', uidA));
const familyId = link.data().familyId;
console.log('family', familyId);
await allowed('member reads family', () => getDoc(doc(fs, 'families', familyId)));
await allowed('member reads events', () => getDocs(collection(fs, 'families', familyId, 'events')));
await allowed('member closes invites', () => updateDoc(doc(fs, 'families', familyId),
  { inviteOpen: false, inviteExpires: Timestamp.fromMillis(0) }));
await signOut(auth); await settle();

// --- as C (a stranger with an account)
await createUserWithEmailAndPassword(auth, `c${Date.now()}@example.com`, 'test1234').catch(async e => {
  if (e.code === 'auth/email-already-in-use') await signInWithEmailAndPassword(auth, 'c@example.com', 'test1234');
});
await settle();
const uidC = auth.currentUser.uid;
const emailC = auth.currentUser.email;
await denied("stranger reads the family doc", () => getDoc(doc(fs, 'families', familyId)));
await denied("stranger lists the family's events", () => getDocs(collection(fs, 'families', familyId, 'events')));
await denied('stranger reads another user link', () => getDoc(doc(fs, 'users', uidA)));
await denied('stranger writes an event', () => setDoc(doc(fs, 'families', familyId, 'events', 'x'), { hi: 1 }));
await denied('stranger joins with invites closed', () => updateDoc(doc(fs, 'families', familyId),
  { memberIds: arrayUnion(uidC), [`members.${uidC}`]: { name: 'C' } }));
await denied('stranger mints an invite', () => setDoc(doc(fs, 'invites', 'HACKED01'),
  { familyId, createdBy: uidC, expiresAt: Timestamp.fromMillis(Date.now() + 1e6) }));
await allowed('any signed-in user may look up a code', () => getDoc(doc(fs, 'invites', 'NOSUCHCODE')));
await signOut(auth); await settle();

// --- A opens an invite, C joins, then C has access
await signInWithEmailAndPassword(auth, 'a@example.com', 'test1234'); await settle();
const code = 'T' + Date.now().toString(36).toUpperCase().slice(-7);
const expires = Timestamp.fromMillis(Date.now() + 3600e3);
await allowed('member mints an invite', () => setDoc(doc(fs, 'invites', code), { familyId, createdBy: uidA, expiresAt: expires }));
await allowed('member opens the family', () => updateDoc(doc(fs, 'families', familyId), { inviteOpen: true, inviteExpires: expires }));
await signOut(auth); await settle();

// --- C joins with a valid, open code and then has access
await signInWithEmailAndPassword(auth, emailC, 'test1234'); await settle();
const inv = await allowed('joiner reads the invite', () => getDoc(doc(fs, 'invites', code)));
await allowed('joiner adds themselves while the invite is open', () => updateDoc(doc(fs, 'families', inv.data().familyId),
  { memberIds: arrayUnion(uidC), [`members.${uidC}`]: { name: 'C' } }));
await allowed('new member reads events', () => getDocs(collection(fs, 'families', familyId, 'events')));
await signOut(auth); await settle();

console.log('\nPASS:'); pass.forEach(x => console.log('  ✓', x));
console.log('FAIL:'); fail.length ? fail.forEach(x => console.log('  ✗', x)) : console.log('  (none)');
process.exit(fail.length ? 1 : 0);
