// ═══════════════════════════════════════════════════════════
//  firebase-config.js  —  Firebase setup
//  Replace the firebaseConfig values with your own project.
//  Go to: Firebase Console → Project Settings → Your Apps
// ═══════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── YOUR FIREBASE CONFIG ──────────────────────────────────
// Replace these placeholder values with your own project credentials
const firebaseConfig = {
  apiKey:            "AIzaSyAwEdxBn2i8_6Dfwk0VhYSp2vYYXH7jybU",
  authDomain:        "pediatric-opd.firebaseapp.com",
  projectId:         "pediatric-opd",
  storageBucket:     "pediatric-opd.firebasestorage.app",
  messagingSenderId: "1009806046904",
  appId:             "1:1009806046904:web:3a1bc12de6576b8cbce64d"
};
// ─────────────────────────────────────────────────────────

// Set to true to require a passcode before editing guidelines.
// Leave as empty string '' to allow open editing.
export const GUIDELINES_PASSCODE = '';

let db = null;
let useFirebase = true;
const GUIDELINES_HOSPITAL_ID = 'default';

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  useFirebase = true;
} catch (e) {
  console.warn('[Firebase] Init failed, falling back to localStorage:', e.message);
  useFirebase = false;
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

/**
 * Update an existing culture entry in-place.
 */
export async function updateCulture(entry) {
  if (!useFirebase) {
    let stored = JSON.parse(localStorage.getItem('nicu-cultures') || '[]');
    stored = stored.map(e => e.id === entry.id ? entry : e);
    localStorage.setItem('nicu-cultures', JSON.stringify(stored));
    return entry;
  }
  if (entry._fbId) {
    const { _fbId, _createdAt, ...data } = entry;
    await updateDoc(doc(db, 'cultures', _fbId), data);
  }
  return entry;
}

// ── Guidelines CRUD ───────────────────────────────────────

/**
 * Load all guideline protocols.
 */
export async function loadGuidelines() {
  if (!useFirebase) {
    return JSON.parse(localStorage.getItem('antibiome-guidelines') || '[]');
  }
  const scopedRef = collection(db, 'hospitals', GUIDELINES_HOSPITAL_ID, 'guidelines');
  const legacyRef = collection(db, 'guidelines');

  const mapDocs = (snap, pathTag) => snap.docs.map(d => ({ ...d.data(), _fbId: d.id, _fbPath: pathTag }));
  const isPermissionDenied = err => err?.code === 'permission-denied' || /permission/i.test(err?.message || '');

  try {
    const scopedSnap = await getDocs(scopedRef);
    const scopedRows = mapDocs(scopedSnap, 'scoped');
    try {
      const legacySnap = await getDocs(legacyRef);
      const merged = [...scopedRows];
      mapDocs(legacySnap, 'legacy').forEach(item => {
        if (!merged.some(m => m.id === item.id)) merged.push(item);
      });
      return merged;
    } catch (legacyErr) {
      if (isPermissionDenied(legacyErr)) return scopedRows;
      throw legacyErr;
    }
  } catch (scopedErr) {
    if (!isPermissionDenied(scopedErr)) throw scopedErr;
    const legacySnap = await getDocs(legacyRef);
    return mapDocs(legacySnap, 'legacy');
  }
}

/**
 * Save a guideline protocol.
 */
export async function saveGuideline(protocol) {
  if (!useFirebase) {
    const stored = JSON.parse(localStorage.getItem('antibiome-guidelines') || '[]');
    stored.push(protocol);
    localStorage.setItem('antibiome-guidelines', JSON.stringify(stored));
    return protocol;
  }
  const data = { ...protocol, _createdAt: serverTimestamp() };
  const scopedRef = collection(db, 'hospitals', GUIDELINES_HOSPITAL_ID, 'guidelines');
  try {
    const ref = await addDoc(scopedRef, data);
    return { ...protocol, _fbId: ref.id, _fbPath: 'scoped' };
  } catch (err) {
    if (err?.code !== 'permission-denied') throw err;
    const ref = await addDoc(collection(db, 'guidelines'), data);
    return { ...protocol, _fbId: ref.id, _fbPath: 'legacy' };
  }
}

/**
 * Delete a guideline protocol.
 */
export async function deleteGuideline(protocol) {
  if (!useFirebase) {
    let stored = JSON.parse(localStorage.getItem('antibiome-guidelines') || '[]');
    stored = stored.filter(p => p.id !== protocol.id);
    localStorage.setItem('antibiome-guidelines', JSON.stringify(stored));
    return;
  }
  if (protocol._fbId) {
    const pathTag = protocol._fbPath || 'scoped';
    const scopedDocRef = doc(db, 'hospitals', GUIDELINES_HOSPITAL_ID, 'guidelines', protocol._fbId);
    const legacyDocRef = doc(db, 'guidelines', protocol._fbId);
    try {
      await deleteDoc(pathTag === 'legacy' ? legacyDocRef : scopedDocRef);
    } catch (err) {
      if (err?.code !== 'permission-denied' || pathTag === 'legacy') throw err;
      await deleteDoc(legacyDocRef);
    }
  }
}

/**
 * Update an existing guideline protocol.
 */
export async function updateGuideline(protocol) {
  if (!useFirebase) {
    let stored = JSON.parse(localStorage.getItem('antibiome-guidelines') || '[]');
    stored = stored.map(p => p.id === protocol.id ? protocol : p);
    localStorage.setItem('antibiome-guidelines', JSON.stringify(stored));
    return protocol;
  }
  if (protocol._fbId) {
    const { _fbId, _createdAt, ...data } = protocol;
    const pathTag = protocol._fbPath || 'scoped';
    const scopedDocRef = doc(db, 'hospitals', GUIDELINES_HOSPITAL_ID, 'guidelines', _fbId);
    const legacyDocRef = doc(db, 'guidelines', _fbId);
    try {
      await updateDoc(pathTag === 'legacy' ? legacyDocRef : scopedDocRef, data);
    } catch (err) {
      if (err?.code !== 'permission-denied' || pathTag === 'legacy') throw err;
      await updateDoc(legacyDocRef, data);
    }
  }
  return protocol;
}

export { useFirebase };
