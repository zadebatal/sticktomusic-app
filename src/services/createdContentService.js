/**
 * Created Content Service — CRUD + Firestore sync for videos & slideshows
 *
 * Extracted from libraryService.js for module separation.
 * Re-exported from libraryService for backward compatibility.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  writeBatch, onSnapshot, serverTimestamp
} from 'firebase/firestore';
import log from '../utils/logger';

// ── Storage Keys ──

const getCreatedContentKey = (artistId) => `stm_created_content_${artistId}`;
const getLocallyDeletedKey = (artistId) => `stm_deleted_content_${artistId}`;

// ── Schema ──

export const createCreatedVideo = ({
  name,
  audio,
  clips = [],
  words = [],
  lyrics = '',
  textStyle = {},
  cropMode = 'cover',
  duration = 0,
  bpm = null,
  collectionId = null
}) => {
  const now = new Date().toISOString();
  return {
    id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'video',
    name,
    audio,
    clips,
    words,
    lyrics,
    textStyle,
    cropMode,
    duration,
    bpm,
    collectionId,
    status: 'draft',
    cloudUrl: null,
    thumbnailUrl: null,
    postedTo: [],
    scheduledPostId: null,
    createdAt: now,
    updatedAt: now
  };
};

export const createCreatedSlideshow = ({
  name,
  slides = [],
  audio = null,
  cropMode = '9:16',
  collectionId = null
}) => {
  if (!slides || slides.length === 0) {
    throw new Error('Slideshow must have at least one slide');
  }
  if (slides.some(s => !s.backgroundImage)) {
    log.warn('[Library] Some slides missing background images');
  }

  const now = new Date().toISOString();
  return {
    id: `slideshow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'slideshow',
    name,
    slides,
    audio,
    cropMode,
    duration: slides.length * 3,
    collectionId,
    status: 'draft',
    exportedImages: [],
    postedTo: [],
    scheduledPostId: null,
    createdAt: now,
    updatedAt: now
  };
};

// ── Local Deletion Tracking ──

const trackLocallyDeletedContent = (artistId, itemId) => {
  try {
    const key = getLocallyDeletedKey(artistId);
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    if (!ids.includes(itemId)) ids.push(itemId);
    localStorage.setItem(key, JSON.stringify(ids));
  } catch (e) { /* ignore */ }
};

export const getAndClearLocallyDeletedContent = (artistId) => {
  try {
    const key = getLocallyDeletedKey(artistId);
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    if (ids.length > 0) localStorage.removeItem(key);
    return ids;
  } catch (e) { return []; }
};

// ── localStorage CRUD ──

export const getCreatedContent = (artistId) => {
  try {
    const data = localStorage.getItem(getCreatedContentKey(artistId));
    const content = data ? JSON.parse(data) : { videos: [], slideshows: [] };
    if (content.slideshows?.length > 0) {
      const seen = new Map();
      content.slideshows.forEach(s => {
        if (!seen.has(s.id) || (s.updatedAt && s.updatedAt > (seen.get(s.id).updatedAt || ''))) {
          seen.set(s.id, s);
        }
      });
      if (seen.size < content.slideshows.length) {
        content.slideshows = Array.from(seen.values());
        localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(content));
      }
    }
    return content;
  } catch (error) {
    log.error('Error loading created content:', error);
    return { videos: [], slideshows: [] };
  }
};

export const saveCreatedContent = (artistId, content) => {
  try {
    const cleanedContent = {
      videos: (content.videos || []).map(v => ({
        ...v,
        thumbnail: v.thumbnail?.startsWith('blob:') ? null : (v.thumbnail || null),
        clips: (v.clips || []).map(c => ({
          ...c,
          file: undefined,
          localUrl: undefined,
          url: c.url?.startsWith('blob:') ? null : c.url,
          thumbnail: c.thumbnail?.startsWith('blob:') ? null : (c.thumbnail || null),
          thumbnailUrl: c.thumbnailUrl || null
        })).filter(c => c.url)
      })),
      slideshows: (content.slideshows || []).map(s => ({
        ...s,
        thumbnail: s.thumbnail?.startsWith('blob:') ? null : (s.thumbnail || null),
        audio: s.audio ? {
          ...s.audio,
          file: undefined,
          localUrl: undefined,
          url: s.audio.url?.startsWith('blob:') ? null : s.audio.url
        } : null,
        slides: (s.slides || []).map(slide => ({
          ...slide,
          backgroundImage: slide.backgroundImage?.startsWith('blob:') ? null : slide.backgroundImage
        }))
      }))
    };

    localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(cleanedContent));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      log.warn('[CreatedContent] localStorage quota exceeded — removing cache. Firestore is source of truth.');
      try { localStorage.removeItem(getCreatedContentKey(artistId)); } catch (_) {}
    } else {
      log.error('Error saving created content:', error);
    }
  }
};

export const addCreatedVideo = (artistId, videoData) => {
  const content = getCreatedContent(artistId);
  const newVideo = videoData.id ? { type: 'video', ...videoData } : createCreatedVideo(videoData);
  content.videos.push(newVideo);
  saveCreatedContent(artistId, content);
  return newVideo;
};

export const updateCreatedVideo = (artistId, videoId, updates) => {
  const content = getCreatedContent(artistId);
  const index = content.videos.findIndex(v => v.id === videoId);
  if (index === -1) return null;

  content.videos[index] = {
    ...content.videos[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveCreatedContent(artistId, content);
  return content.videos[index];
};

export const deleteCreatedVideo = (artistId, videoId) => {
  const content = getCreatedContent(artistId);
  const filtered = content.videos.filter(v => v.id !== videoId);
  if (filtered.length === content.videos.length) return false;

  content.videos = filtered;
  saveCreatedContent(artistId, content);
  trackLocallyDeletedContent(artistId, videoId);
  return true;
};

export const addCreatedSlideshow = (artistId, slideshowData) => {
  const content = getCreatedContent(artistId);
  const newSlideshow = slideshowData.id ? { type: 'slideshow', ...slideshowData } : createCreatedSlideshow(slideshowData);
  const existingIndex = content.slideshows.findIndex(s => s.id === newSlideshow.id);
  if (existingIndex >= 0) {
    content.slideshows[existingIndex] = { ...content.slideshows[existingIndex], ...newSlideshow, updatedAt: new Date().toISOString() };
  } else {
    content.slideshows.push(newSlideshow);
  }
  saveCreatedContent(artistId, content);
  return newSlideshow;
};

export const addCreatedSlideshowsBatch = (artistId, slideshowsData) => {
  const content = getCreatedContent(artistId);
  const newSlideshows = slideshowsData.map(data =>
    data.id ? { type: 'slideshow', ...data } : createCreatedSlideshow(data)
  );

  newSlideshows.forEach(newSlideshow => {
    const existingIndex = content.slideshows.findIndex(s => s.id === newSlideshow.id);
    if (existingIndex >= 0) {
      content.slideshows[existingIndex] = { ...content.slideshows[existingIndex], ...newSlideshow, updatedAt: new Date().toISOString() };
    } else {
      content.slideshows.push(newSlideshow);
    }
  });

  saveCreatedContent(artistId, content);
  return newSlideshows;
};

export const updateCreatedSlideshow = (artistId, slideshowId, updates) => {
  const content = getCreatedContent(artistId);
  const index = content.slideshows.findIndex(s => s.id === slideshowId);
  if (index === -1) return null;

  content.slideshows[index] = {
    ...content.slideshows[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveCreatedContent(artistId, content);
  return content.slideshows[index];
};

export const deleteCreatedSlideshow = (artistId, slideshowId) => {
  const content = getCreatedContent(artistId);
  const filtered = content.slideshows.filter(s => s.id !== slideshowId);
  if (filtered.length === content.slideshows.length) return false;

  content.slideshows = filtered;
  saveCreatedContent(artistId, content);
  trackLocallyDeletedContent(artistId, slideshowId);
  return true;
};

// ── Firestore Async Operations ──

export const saveCreatedContentAsync = async (db, artistId, content) => {
  if (!db || !artistId) return;
  try {
    const batch = writeBatch(db);

    (content.videos || []).forEach(video => {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', video.id);
      const cleanedClips = (video.clips || []).map(c => {
        const { file, localUrl, ...clipData } = c;
        const cleaned = {
          ...clipData,
          url: c.url?.startsWith('blob:') ? null : c.url,
          thumbnail: c.thumbnail?.startsWith('blob:') ? null : (c.thumbnail || null),
          thumbnailUrl: c.thumbnailUrl || null
        };
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) delete cleaned[key];
        });
        return cleaned;
      }).filter(c => c.url);

      batch.set(docRef, {
        ...video,
        type: 'video',
        thumbnail: video.thumbnail?.startsWith('blob:') ? null : (video.thumbnail || null),
        clips: cleanedClips,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    (content.slideshows || []).forEach(slideshow => {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', slideshow.id);
      let cleanedAudio = null;
      if (slideshow.audio) {
        const { file, localUrl, ...audioData } = slideshow.audio;
        cleanedAudio = {
          ...audioData,
          url: slideshow.audio.url?.startsWith('blob:') ? null : slideshow.audio.url
        };
        Object.keys(cleanedAudio).forEach(key => {
          if (cleanedAudio[key] === undefined) delete cleanedAudio[key];
        });
        if (!cleanedAudio.url) cleanedAudio = null;
      }

      batch.set(docRef, {
        ...slideshow,
        type: 'slideshow',
        thumbnail: slideshow.thumbnail?.startsWith('blob:') ? null : (slideshow.thumbnail || null),
        audio: cleanedAudio,
        slides: (slideshow.slides || []).map(slide => ({
          ...slide,
          backgroundImage: slide.backgroundImage?.startsWith('blob:') ? null : slide.backgroundImage
        })),
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    await batch.commit();
    log('[Library] Created content saved to Firestore:',
      `${content.videos?.length || 0} videos, ${content.slideshows?.length || 0} slideshows`);
  } catch (error) {
    log.error('[Library] Firestore save created content failed:', error.message);
  }
};

export const loadCreatedContentAsync = async (db, artistId) => {
  if (!db || !artistId) return getCreatedContent(artistId);
  try {
    const oldDocRef = doc(db, 'artists', artistId, 'studio', 'createdContent');
    const oldDoc = await getDoc(oldDocRef);

    if (oldDoc.exists()) {
      const oldData = oldDoc.data();
      const content = {
        videos: oldData.videos || [],
        slideshows: oldData.slideshows || []
      };

      log('[Library] Migrating created content from old path to new structure...');
      await saveCreatedContentAsync(db, artistId, content);

      try {
        await deleteDoc(oldDocRef);
        log('[Library] Migration complete, old document deleted');
      } catch (err) {
        log.warn('[Library] Could not delete old document:', err.message);
      }

      saveCreatedContent(artistId, content);
      return content;
    }

    const collectionRef = collection(db, 'artists', artistId, 'library', 'data', 'createdContent');
    const snapshot = await getDocs(collectionRef);

    const videos = [];
    const slideshows = [];

    const pendingDeletes = new Set(getAndClearLocallyDeletedContent(artistId));
    if (pendingDeletes.size > 0) {
      snapshot.docs.forEach(d => {
        if (pendingDeletes.has(d.id) && !d.data().deletedAt) {
          updateDoc(d.ref, { deletedAt: serverTimestamp() }).catch(err =>
            log.error('[Library] Reconcile soft-delete in load:', err)
          );
        }
      });
    }

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.deletedAt || pendingDeletes.has(doc.id)) return;
      const type = data.type || (data.slides ? 'slideshow' : data.clips ? 'video' : null);
      if (type === 'video') {
        videos.push({ ...data, type: 'video' });
      } else if (type === 'slideshow') {
        slideshows.push({ ...data, type: 'slideshow' });
      }
    });

    const content = { videos, slideshows };

    if (videos.length === 0 && slideshows.length === 0) {
      const localContent = getCreatedContent(artistId);
      if (localContent.videos.length > 0 || localContent.slideshows.length > 0) {
        log('[Library] Migrating created content from localStorage to Firestore...');
        await saveCreatedContentAsync(db, artistId, localContent);
        return localContent;
      }
    }

    saveCreatedContent(artistId, content);
    return content;
  } catch (error) {
    log.error('[Library] Firestore load created content failed:', error.message);
  }
  return getCreatedContent(artistId);
};

export const subscribeToCreatedContent = (db, artistId, callback) => {
  if (!db || !artistId) return () => {};

  const cleanLoadedData = (data) => {
    const cleaned = { ...data };

    if (cleaned.audio) {
      const { file, localUrl, ...audioData } = cleaned.audio;
      cleaned.audio = audioData;
      Object.keys(cleaned.audio).forEach(key => {
        if (cleaned.audio[key] === undefined) delete cleaned.audio[key];
      });
      if (!cleaned.audio.url) cleaned.audio = null;
    }

    if (cleaned.clips) {
      cleaned.clips = cleaned.clips.map(clip => {
        const { file, localUrl, thumbnail, ...clipData } = clip;
        const cleanedClip = clipData;
        Object.keys(cleanedClip).forEach(key => {
          if (cleanedClip[key] === undefined) delete cleanedClip[key];
        });
        return cleanedClip;
      }).filter(c => c.url);
    }

    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === undefined) delete cleaned[key];
    });

    return cleaned;
  };

  let unsubscribeSnapshot = null;
  let cancelled = false;
  loadCreatedContentAsync(db, artistId).then(() => {
    if (cancelled) return;
    const collectionRef = collection(db, 'artists', artistId, 'library', 'data', 'createdContent');
    unsubscribeSnapshot = onSnapshot(collectionRef, (snapshot) => {
      const pendingDeletes = new Set(getAndClearLocallyDeletedContent(artistId));

      if (pendingDeletes.size > 0) {
        snapshot.docs.forEach(d => {
          if (pendingDeletes.has(d.id) && !d.data().deletedAt) {
            updateDoc(d.ref, { deletedAt: serverTimestamp() }).catch(err =>
              log.error('[Library] Reconcile soft-delete failed:', err)
            );
          }
        });
      }

      const videos = [];
      const slideshows = [];

      snapshot.docs.forEach(doc => {
        const data = cleanLoadedData(doc.data());
        if (data.deletedAt || pendingDeletes.has(doc.id)) return;
        const type = data.type || (data.slides ? 'slideshow' : data.clips ? 'video' : null);
        if (type === 'video') {
          videos.push({ ...data, type: 'video' });
        } else if (type === 'slideshow') {
          slideshows.push({ ...data, type: 'slideshow' });
        }
      });

      const content = { videos, slideshows };
      saveCreatedContent(artistId, content);
      callback(content);
    }, (error) => {
      log.error('[Library] Created content subscription error:', error);
    });
  });

  return () => { cancelled = true; if (unsubscribeSnapshot) unsubscribeSnapshot(); };
};

export const addCreatedSlideshowAsync = async (db, artistId, slideshowData) => {
  const result = addCreatedSlideshow(artistId, slideshowData);
  const content = getCreatedContent(artistId);
  try {
    await saveCreatedContentAsync(db, artistId, content);
  } catch (error) {
    log.error('[Library] Failed to sync slideshow to Firestore:', error);
  }
  return result;
};

export const updateCreatedSlideshowAsync = async (db, artistId, slideshowId, updates) => {
  const result = updateCreatedSlideshow(artistId, slideshowId, updates);
  const content = getCreatedContent(artistId);
  try {
    await saveCreatedContentAsync(db, artistId, content);
  } catch (error) {
    log.error('[Library] Failed to sync slideshow update to Firestore:', error);
  }
  return result;
};

export const deleteCreatedSlideshowAsync = async (db, artistId, slideshowId) => {
  const result = deleteCreatedSlideshow(artistId, slideshowId);
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', slideshowId);
    await updateDoc(docRef, { deletedAt: serverTimestamp() });
    log('[Library] Soft-deleted slideshow:', slideshowId);
  } catch (error) {
    log.error('[Library] Failed to soft-delete slideshow from Firestore:', error);
  }
  return result;
};

export const softDeleteCreatedVideoAsync = async (db, artistId, videoId) => {
  const result = deleteCreatedVideo(artistId, videoId);
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', videoId);
    await updateDoc(docRef, { deletedAt: serverTimestamp() });
    log('[Library] Soft-deleted video:', videoId);
  } catch (error) {
    log.error('[Library] Failed to soft-delete video from Firestore:', error);
  }
  return result;
};

export const restoreCreatedContentAsync = async (db, artistId, itemId) => {
  if (!db || !artistId || !itemId) return false;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', itemId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return false;

    await updateDoc(docRef, { deletedAt: null });

    const data = docSnap.data();
    const { deletedAt, ...cleanData } = data;
    const type = cleanData.type || (cleanData.clips ? 'video' : 'slideshow');
    const content = getCreatedContent(artistId);

    if (type === 'video') {
      if (!content.videos.find(v => v.id === itemId)) {
        content.videos.push({ ...cleanData, type: 'video' });
      }
    } else {
      if (!content.slideshows.find(s => s.id === itemId)) {
        content.slideshows.push({ ...cleanData, type: 'slideshow' });
      }
    }
    saveCreatedContent(artistId, content);
    log('[Library] Restored content:', itemId);
    return true;
  } catch (error) {
    log.error('[Library] Failed to restore content from Firestore:', error);
    return false;
  }
};

export const getDeletedContentAsync = async (db, artistId) => {
  if (!db || !artistId) return { videos: [], slideshows: [] };
  try {
    const collectionRef = collection(db, 'artists', artistId, 'library', 'data', 'createdContent');
    const snapshot = await getDocs(collectionRef);

    const videos = [];
    const slideshows = [];

    snapshot.docs.forEach(d => {
      const data = d.data();
      if (!data.deletedAt) return;
      const type = data.type || (data.clips ? 'video' : 'slideshow');
      if (type === 'video') {
        videos.push({ ...data, type: 'video' });
      } else {
        slideshows.push({ ...data, type: 'slideshow' });
      }
    });

    return { videos, slideshows };
  } catch (error) {
    log.error('[Library] Failed to load deleted content:', error);
    return { videos: [], slideshows: [] };
  }
};

export const permanentlyDeleteContentAsync = async (db, artistId, itemId) => {
  if (!db || !artistId || !itemId) return false;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', itemId);
    await deleteDoc(docRef);
    log('[Library] Permanently deleted content:', itemId);
    return true;
  } catch (error) {
    log.error('[Library] Failed to permanently delete content:', error);
    return false;
  }
};

export const addCreatedSlideshowsBatchAsync = async (db, artistId, slideshowsData) => {
  const results = addCreatedSlideshowsBatch(artistId, slideshowsData);

  const content = getCreatedContent(artistId);
  try {
    await saveCreatedContentAsync(db, artistId, content);
  } catch (error) {
    log.error('[Library] Failed to sync batch slideshows to Firestore:', error);
  }

  return results;
};

// ── Scheduling Link Helpers ──

export const markContentScheduled = (artistId, contentId, scheduledPostId) => {
  const content = getCreatedContent(artistId);
  const videoIdx = content.videos.findIndex(v => v.id === contentId);
  if (videoIdx >= 0) {
    content.videos[videoIdx] = { ...content.videos[videoIdx], scheduledPostId, updatedAt: new Date().toISOString() };
    saveCreatedContent(artistId, content);
    return true;
  }
  const slideshowIdx = content.slideshows.findIndex(s => s.id === contentId);
  if (slideshowIdx >= 0) {
    content.slideshows[slideshowIdx] = { ...content.slideshows[slideshowIdx], scheduledPostId, updatedAt: new Date().toISOString() };
    saveCreatedContent(artistId, content);
    return true;
  }
  return false;
};

export const markContentScheduledAsync = async (db, artistId, contentId, scheduledPostId) => {
  const result = markContentScheduled(artistId, contentId, scheduledPostId);
  if (result && db) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', contentId);
      await updateDoc(docRef, { scheduledPostId, updatedAt: serverTimestamp() });
    } catch (error) {
      log.warn('[Library] Failed to sync scheduledPostId to Firestore:', error.message);
    }
  }
  return result;
};

export const unmarkContentScheduled = (artistId, contentId) => {
  return markContentScheduled(artistId, contentId, null);
};

export const unmarkContentScheduledAsync = async (db, artistId, contentId) => {
  return markContentScheduledAsync(db, artistId, contentId, null);
};
