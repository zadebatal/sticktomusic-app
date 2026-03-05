/**
 * Lyrics Service — CRUD + Firestore sync for lyrics entries
 *
 * Extracted from libraryService.js for module separation.
 * Re-exported from libraryService for backward compatibility.
 */

import {
  collection, doc, setDoc, updateDoc, deleteDoc,
  writeBatch, query, orderBy, onSnapshot, serverTimestamp
} from 'firebase/firestore';
import log from '../utils/logger';

// ── Storage Key ──

const getLyricsKey = (artistId) => `stm_lyrics_${artistId}`;

// ── Schema ──

export const createLyricsEntry = ({
  title,
  content,
  words = [],
  audioId = null,
  audioStartTime = null,
  audioEndTime = null,
  collectionIds = []
}) => {
  const now = new Date().toISOString();
  return {
    id: `lyrics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    title,
    content,
    words,
    collectionIds,
    audioId,
    audioStartTime,
    audioEndTime,
    createdAt: now,
    updatedAt: now
  };
};

// ── localStorage CRUD ──

export const getLyrics = (artistId) => {
  try {
    const data = localStorage.getItem(getLyricsKey(artistId));
    return data ? JSON.parse(data) : [];
  } catch (error) {
    log.error('Error loading lyrics:', error);
    return [];
  }
};

export const saveLyrics = (artistId, lyrics) => {
  try {
    localStorage.setItem(getLyricsKey(artistId), JSON.stringify(lyrics));
  } catch (error) {
    log.error('Error saving lyrics:', error);
  }
};

export const addLyrics = (artistId, lyricsData) => {
  const lyrics = getLyrics(artistId);
  const newLyrics = lyricsData.id ? lyricsData : createLyricsEntry(lyricsData);
  lyrics.push(newLyrics);
  saveLyrics(artistId, lyrics);
  return newLyrics;
};

export const updateLyrics = (artistId, lyricsId, updates) => {
  const lyrics = getLyrics(artistId);
  const index = lyrics.findIndex(l => l.id === lyricsId);
  if (index === -1) return null;

  lyrics[index] = {
    ...lyrics[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveLyrics(artistId, lyrics);
  return lyrics[index];
};

export const deleteLyrics = (artistId, lyricsId) => {
  const lyrics = getLyrics(artistId);
  const filtered = lyrics.filter(l => l.id !== lyricsId);
  if (filtered.length === lyrics.length) return false;

  saveLyrics(artistId, filtered);
  return true;
};

// ── Firestore Real-Time Sync ──

const migrateLyricsToFirestore = async (db, artistId, lyrics) => {
  if (!db || !artistId || !lyrics.length) return;

  try {
    const batch = writeBatch(db);
    lyrics.forEach(lyric => {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyric.id);
      batch.set(docRef, { ...lyric, updatedAt: serverTimestamp() });
    });
    await batch.commit();
    log('[Lyrics] Migrated', lyrics.length, 'entries from localStorage to Firestore');
  } catch (error) {
    log.error('[Lyrics] Migration failed:', error.message);
  }
};

export const subscribeToLyrics = (db, artistId, callback) => {
  if (!db || !artistId) {
    log('[Lyrics] No db/artistId — falling back to localStorage');
    callback(getLyrics(artistId));
    return () => {};
  }

  const lyricsRef = collection(db, 'artists', artistId, 'library', 'data', 'lyrics');
  const q = query(lyricsRef, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      log('[Lyrics] Real-time update:', items.length, 'items');

      if (items.length === 0) {
        const local = getLyrics(artistId);
        if (local.length > 0) {
          log('[Lyrics] Firestore empty, using localStorage fallback:', local.length, 'items');
          migrateLyricsToFirestore(db, artistId, local);
          callback(local);
          return;
        }
      }

      saveLyrics(artistId, items);
      callback(items);
    },
    (error) => {
      log.error('[Lyrics] Subscription error:', error);
      callback(getLyrics(artistId));
    }
  );
};

export const addLyricsAsync = async (db, artistId, lyricsData) => {
  const newEntry = lyricsData.id ? lyricsData : createLyricsEntry(lyricsData);

  addLyrics(artistId, newEntry);

  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', newEntry.id);
      await setDoc(docRef, {
        ...newEntry,
        updatedAt: serverTimestamp()
      });
      log('[Lyrics] Saved to Firestore:', newEntry.id);
    } catch (error) {
      log.error('[Lyrics] Firestore write failed:', error.message);
    }
  }

  return newEntry;
};

export const updateLyricsAsync = async (db, artistId, lyricsId, updates) => {
  const updated = updateLyrics(artistId, lyricsId, updates);

  if (db && artistId && updated) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      log('[Lyrics] Updated in Firestore:', lyricsId);
    } catch (error) {
      log.error('[Lyrics] Firestore update failed:', error.message);
      if (error.code === 'not-found' && updated) {
        try {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
          await setDoc(docRef, { ...updated, updatedAt: serverTimestamp() });
          log('[Lyrics] Created missing doc in Firestore:', lyricsId);
        } catch (e2) {
          log.error('[Lyrics] Firestore fallback create failed:', e2.message);
        }
      }
    }
  }

  return updated;
};

export const deleteLyricsAsync = async (db, artistId, lyricsId) => {
  const success = deleteLyrics(artistId, lyricsId);

  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
      await deleteDoc(docRef);
      log('[Lyrics] Deleted from Firestore:', lyricsId);
    } catch (error) {
      log.error('[Lyrics] Firestore delete failed:', error.message);
    }
  }

  return success;
};
