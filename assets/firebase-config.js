/**
 * Firebase project settings, baked into the app the same way LaManna Big Year does it.
 *
 * Paste the config block from
 *   Firebase console → ⚙ Project settings → Your apps → Web app
 * into `firebaseConfig` below. These values are public by design — they identify
 * the project, they are not credentials. What the data is actually protected by
 * is `firestore.rules` at the repo root.
 *
 * Leave firebaseConfig as null to keep sync off; the app then runs purely local
 * and the More screen offers a paste box instead.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyDSP_eosyrG-0H6RGauNka2NLMh5ebmGgs",
  authDomain: "witte-baby-tracker.firebaseapp.com",
  projectId: "witte-baby-tracker",
  storageBucket: "witte-baby-tracker.firebasestorage.app",
  messagingSenderId: "810934800977",
  appId: "1:810934800977:web:095120cb68045570ad1e70",
};

/**
 * The one shared dataset both phones read and write. Everything lives under
 * families/<SPACE> in Firestore, and this name must match firestore.rules.
 */
export const SPACE = 'witte';

/** Human label shown on the Sync card. */
export const SPACE_NAME = 'Witte family';

/**
 * false — no accounts, no sign-in: open the app and you are in (and so is
 * anyone else who has the link). Set to true to switch to per-caregiver
 * email/password accounts with invite codes; the code for that is still here.
 */
export const REQUIRE_SIGN_IN = false;

/**
 * Public half of the web-push signing key. The private half is a GitHub
 * repository secret (VAPID_PRIVATE_KEY) that the notify workflow uses.
 */
export const VAPID_PUBLIC_KEY = 'BJ3-sB3PueLvdaYbgbVC9UsJirpuq-np2n-y125u2mC-8ylwjJi4n7ERAlpxpnOZlQvNFxigfzVN7Nbp-RWsrzc';
