// ═══════════════════════════════════════════════════════════
//  firebase-config.js  —  Firebase setup
//  Replace the firebaseConfig values with your own project.
//  Go to: Firebase Console → Project Settings → Your Apps
// ═══════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── YOUR FIREBASE CONFIG ──────────────────────────────────
// Replace these placeholder values with your own project credentials
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
// ─────────────────────────────────────────────────────────

let db = null;
let useFirebase = true;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  // Quick connectivity check — will fail gracefully if config is invalid
  useFirebase = firebaseConfig.apiKey !== "YOUR_API_KEY";
} catch (e) {
  console.warn('[Firebase] Init failed, falling back to localStorage:', e.message);
}

// ── Public API used by app.js ─────────────────────────────

/**
 * Save a culture entry. Returns the saved entry with its id.
 */
export async function saveCulture(entry) {
  if (!useFirebase) {
    const stored = JSON.parse(localStorage.getItem('nicu-cultures') || '[]');
    stored.unshift(entry);
    localStorage.setItem('nicu-cultures', JSON.stringify(stored));
    return entry;
  }
  const ref = await addDoc(collection(db, 'cultures'), {
    ...entry,
    _createdAt: serverTimestamp()
  });
  return { ...entry, _fbId: ref.id };
}

/**
 * Load all culture entries (once).
 */
export async function loadCultures() {
  if (!useFirebase) {
    return JSON.parse(localStorage.getItem('nicu-cultures') || '[]');
  }
  const snap = await getDocs(query(collection(db, 'cultures'), orderBy('date', 'desc')));
  return snap.docs.map(d => ({ ...d.data(), _fbId: d.id }));
}

/**
 * Delete a culture entry by id / _fbId.
 */
export async function deleteCulture(entry) {
  if (!useFirebase) {
    let stored = JSON.parse(localStorage.getItem('nicu-cultures') || '[]');
    stored = stored.filter(e => e.id !== entry.id);
    localStorage.setItem('nicu-cultures', JSON.stringify(stored));
    return;
  }
  if (entry._fbId) {
    await deleteDoc(doc(db, 'cultures', entry._fbId));
  }
}

/**
 * Subscribe to real-time updates. Returns an unsubscribe function.
 * Falls back to a no-op with immediate empty callback when offline.
 */
export function subscribeCultures(callback) {
  if (!useFirebase) {
    const data = JSON.parse(localStorage.getItem('nicu-cultures') || '[]');
    callback(data);
    return () => {};
  }
  const q = query(collection(db, 'cultures'), orderBy('date', 'desc'));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ ...d.data(), _fbId: d.id })));
  });
}

export { useFirebase };
