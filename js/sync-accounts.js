/**
 * Per-caregiver accounts, families and invite codes — the REQUIRE_SIGN_IN path.
 * Dormant unless assets/firebase-config.js asks for it; sync.js loads this on
 * demand and hands over its SDK handles through bind().
 */
let sdk, auth, store, announce, describe, startStreams, stopStreams, schedulePush, uploadEverything, db;
let family = null;

export function bind(deps) {
  ({ sdk, auth, store, announce, describe, startStreams, stopStreams, schedulePush, uploadEverything, db } = deps);
}

export async function onUser(user) {
  stopStreams();
  if (!user) {
    announce({ state: 'signed-out', user: null, family: null });
    return;
  }
  announce({ user: { uid: user.uid, email: user.email, name: user.displayName || '' } });
  const { fs: F } = sdk;
  try {
    const link = await F.getDoc(F.doc(store, 'users', user.uid));
    const familyId = link.exists() ? link.data().familyId : null;
    if (!familyId) { announce({ state: 'no-family', family: null }); return; }
    await attachFamily(familyId);
  } catch (err) {
    console.error(err);
    announce({ state: 'error', error: describe(err) });
  }
}

async function attachFamily(familyId) {
  const { fs: F } = sdk;
  const snap = await F.getDoc(F.doc(store, 'families', familyId));
  if (!snap.exists()) { announce({ state: 'no-family', family: null }); return; }
  family = { id: familyId, ...snap.data() };
  announce({ state: 'live', family, error: '' });
  await db.metaSet('familyId', familyId);
  startStreams(familyId);
  schedulePush();
}

/* ---------------- accounts & families ---------------- */

export async function signUp(email, password, name) {
  const { auth: U } = sdk;
  const cred = await U.createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name) await U.updateProfile(cred.user, { displayName: name });
  return cred.user;
}

export async function signIn(email, password) {
  const { auth: U } = sdk;
  const cred = await U.signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOutNow() {
  stopStreams();
  if (auth) await sdk.auth.signOut(auth);
  await db.metaSet('syncWatermark', 0);
  await db.metaSet('familyId', null);
}

export async function createFamily(name) {
  const { fs: F } = sdk;
  const user = auth.currentUser;
  const ref = F.doc(F.collection(store, 'families'));
  await F.setDoc(ref, {
    name: name || 'Our family',
    createdAt: F.serverTimestamp(),
    memberIds: [user.uid],
    members: { [user.uid]: { name: user.displayName || user.email, email: user.email } },
    inviteOpen: false,
    inviteExpires: F.Timestamp.fromMillis(0),
  });
  await F.setDoc(F.doc(store, 'users', user.uid), { familyId: ref.id, name: user.displayName || '' });
  await attachFamily(ref.id);
  await uploadEverything();
  return ref.id;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1
function makeCode(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Opens the family to joiners for 24 hours and returns the code to share. */
export async function createInvite() {
  const { fs: F } = sdk;
  const familyId = family.id;
  const code = makeCode();
  const expires = Date.now() + 24 * 3600 * 1000;
  await F.setDoc(F.doc(store, 'invites', code), {
    familyId, createdBy: auth.currentUser.uid,
    expiresAt: F.Timestamp.fromMillis(expires),
  });
  await F.updateDoc(F.doc(store, 'families', familyId), {
    inviteOpen: true,
    inviteExpires: F.Timestamp.fromMillis(expires),
  });
  return { code, expires };
}

export async function revokeInvites() {
  const { fs: F } = sdk;
  await F.updateDoc(F.doc(store, 'families', family.id), {
    inviteOpen: false,
    inviteExpires: F.Timestamp.fromMillis(0),
  });
}

export async function joinFamily(code) {
  const { fs: F } = sdk;
  const user = auth.currentUser;
  const invite = await F.getDoc(F.doc(store, 'invites', code.trim().toUpperCase()));
  if (!invite.exists()) throw new Error('That code is not valid');
  const { familyId, expiresAt } = invite.data();
  if (expiresAt?.toMillis?.() < Date.now()) throw new Error('That code has expired');

  await F.updateDoc(F.doc(store, 'families', familyId), {
    memberIds: F.arrayUnion(user.uid),
    [`members.${user.uid}`]: { name: user.displayName || user.email, email: user.email },
  });
  await F.setDoc(F.doc(store, 'users', user.uid), { familyId, name: user.displayName || '' });
  await attachFamily(familyId);
  await uploadEverything();
  return familyId;
}


export async function signOutNow() {
  stopStreams();
  await sdk.auth.signOut(auth);
  await db.metaSet('syncWatermark', 0);
  await db.metaSet('familyId', null);
}
