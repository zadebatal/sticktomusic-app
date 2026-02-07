# StickToMusic App — Full Code Audit

**Date:** February 5, 2026
**Scope:** Locally-run app (localhost), full codebase excluding node_modules/build/.git
**Auditor:** Claude

---

## Executive Summary

The StickToMusic Video Studio app has a **fundamental architectural split** that causes most of its bugs: it has two parallel systems for managing media — a legacy **category-based system** and a newer **library-based system** (`USE_LIBRARY_SYSTEM = true`). The library system is active, but many handlers and the editor modal still assume the old category system. This creates **silent failures** throughout the primary user flow (upload → select → create video → save).

**Critical path broken:** Upload works. Library displays clips. But **saving a created video does nothing** because `handleSaveVideo` bails on `if (!selectedCategory) return` — and `selectedCategory` is always `null` in library mode.

---

## P0 — Critical (Blocks primary flow)

### AUD-001: handleSaveVideo silently fails in library mode

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/VideoStudio.jsx` |
| **Line** | 542–543 |
| **Function** | `handleSaveVideo` |
| **Repro** | Select clips → Create Video → edit in modal → press Confirm |
| **Impact** | Video is never saved. No error, no toast, no feedback. |

**Root cause:** Line 543: `if (!selectedCategory) return;` — In library mode, `selectedCategory` is `null` because StudioHome never sets it. The synthetic category object passed as a prop to the editor modal is not the same as `selectedCategory` state.

**Fix:**
```javascript
const handleSaveVideo = useCallback((videoData) => {
  // Library mode: save via libraryService
  if (!selectedCategory && selectedLibraryMedia.videos.length > 0) {
    const newVideo = addCreatedVideo(currentArtistId, {
      ...videoData,
      id: videoData.id || `video_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: VIDEO_STATUS.DRAFT
    });
    setShowEditor(false);
    setEditingVideo(null);
    setSelectedLibraryMedia({ videos: [], audio: null, images: [] });
    return;
  }
  if (!selectedCategory) return;
  // ... rest of existing category-based save logic
}, [selectedCategory, selectedLibraryMedia, currentArtistId]);
```

---

### AUD-002: 19+ handlers silently fail with same `!selectedCategory` guard

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/VideoStudio.jsx` |
| **Lines** | 543, 586, 685, 756, 803, 834, 862, 887, 944, 972, 995, 1052, 1138, 1179, 1231, 1255, 1275, 1301, 1324 |
| **Functions** | handleSaveVideo, handleUploadVideos, handleUploadAudio, handleSaveAudioClip, handleSaveLyricsToAudio, handleDeleteVideo, handleDeleteBankVideo, handleDeleteBankAudio, handleRenameBankVideo, handleRenameBankAudio, handleEditAudio, handleApproveVideo, handleUpdateVideo, handleMakeSlideshow, handleUploadImages, handleDeleteBankImage, handleDeleteSlideshow, handleAddLyrics, handleUpdateLyrics, handleDeleteLyrics |
| **Repro** | Any content operation in library mode |
| **Impact** | All content management silently broken in library mode |

**Fix:** Each handler needs a library-mode branch or at minimum a user-visible error.

---

## P1 — High (Breaks secondary flows)

### AUD-003: selectedLibraryMedia state never cleared

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/VideoStudio.jsx` |
| **Lines** | 387, 537–540 |
| **Function** | `handleCloseEditor` |
| **Repro** | Open editor → close → navigate → open editor again |
| **Impact** | Stale clips from previous session appear in new editor session |

**Fix:**
```javascript
const handleCloseEditor = useCallback(() => {
  setShowEditor(false);
  setEditingVideo(null);
  setSelectedLibraryMedia({ videos: [], audio: null, images: [] });
  setPullFromCollection(null);
}, []);
```

---

### AUD-004: LibraryBrowser.getDisplayedMedia calls localStorage inside useCallback

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/LibraryBrowser.jsx` |
| **Lines** | ~111, ~128 |
| **Function** | `getDisplayedMedia` |
| **Repro** | View a collection in library mode |
| **Impact** | `getCollections(artistId)` reads from localStorage every render, while `collections` state is already loaded. Data inconsistency risk. |

**Fix:** Use the `collections` state variable instead of calling `getCollections()`. Add `collections` to the useCallback dependency array.

---

### AUD-005: Race condition — migration and subscription start simultaneously

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/StudioHome.jsx` |
| **Lines** | 110–135 |
| **Function** | `useEffect` (load data) |
| **Repro** | First load with localStorage data that hasn't been migrated |
| **Impact** | Subscription fires before migration completes → shows empty, then eventually fills in. Causes flash of empty state. |

**Evidence:**
```javascript
// Migration runs async (no await)
migrateToFirestore(db, artistId).then(result => { ... });
// Subscription starts immediately
const unsubscribe = subscribeToLibrary(db, artistId, (items) => {
  setLibrary(items);
});
```

**Fix:** Either await migration before subscribing, or accept the fallback behavior (current localStorage fallback handles this, but creates a flash).

---

### AUD-006: Data shape mismatch — library items vs editor expectations

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/VideoStudio.jsx` |
| **Lines** | 1649–1663 (synthetic category) |
| **Function** | Render (editor modal) |
| **Repro** | Use library clips in editor → Cut by Beat/Word |
| **Impact** | Editor functions access `category.videos[n].thumbnail`, `localUrl`, etc. Library items may not have these properties. |

**Fix:** Transform library items when creating synthetic category:
```javascript
videos: selectedLibraryMedia.videos.map(v => ({
  ...v,
  name: v.name || v.metadata?.originalName || 'Clip',
  thumbnail: null,
  localUrl: v.url
})),
```

---

### AUD-007: addManyToLibraryAsync doesn't properly await Firestore writes

| Field | Value |
|-------|-------|
| **File** | `src/services/libraryService.js` |
| **Lines** | 1258–1285 |
| **Function** | `addManyToLibraryAsync` |
| **Repro** | Upload multiple files rapidly |
| **Impact** | Function returns localStorage result before Firestore batch commits. Subscription may not see new items immediately. |

**Fix:** The function already awaits `batch.commit()`, but the return happens at line 1284 before the catch block fully resolves. The real issue is that `localResult` (line 1262) is returned regardless of Firestore outcome, which is intentional as a fallback but means callers can't know if Firestore succeeded.

---

## P2 — Medium (Edge cases, data integrity)

### AUD-008: Preset filtering returns empty in library mode

| Field | Value |
|-------|-------|
| **File** | `src/components/VideoEditor/VideoStudio.jsx` |
| **Lines** | ~1338–1340 |
| **Impact** | "Apply preset" dropdown is empty when using library mode |

**Fix:** Filter presets for global ones (categoryId === null) when selectedCategory is null.

---

### AUD-009: createMediaItem missing `localUrl` field

| Field | Value |
|-------|-------|
| **File** | `src/services/libraryService.js` |
| **Lines** | 136–183 |
| **Function** | `createMediaItem` |
| **Impact** | Components that check `item.localUrl` get `undefined` |

**Fix:** Add `localUrl: null` to the schema.

---

### AUD-010: uploadFile return shape inconsistency

| Field | Value |
|-------|-------|
| **File** | `src/services/firebaseStorage.js` |
| **Impact** | `uploadFile` returns `{url, path}` but `uploadVideo` returns just a URL string. Callers must know which function they called. |

**Fix:** Normalize return type to always be `{url, path}`.

---

### AUD-011: No 404/catch-all route

| Field | Value |
|-------|-------|
| **File** | `src/App.jsx` |
| **Impact** | Unknown URLs render whatever `currentPage` state matches. No user-visible 404. |

---

### AUD-012: `firebase-admin` in client devDependencies

| Field | Value |
|-------|-------|
| **File** | `package.json` |
| **Impact** | Backend-only package shouldn't be in client bundle. |

---

### AUD-013: Hardcoded LATE_ACCOUNT_IDS

| Field | Value |
|-------|-------|
| **File** | `src/App.jsx` lines 187–197 |
| **Impact** | Not scalable. Adding new accounts requires code change + deploy. |

---

## Interactive Element Audit

| Page | Element | Expected | Actual | Status | File | Fix |
|------|---------|----------|--------|--------|------|-----|
| Studio Home | Upload Videos button | Opens file picker, uploads, shows in grid | Works | ✅ Pass | StudioHome.jsx | — |
| Studio Home | Upload Audio button | Opens file picker, uploads, shows in audio section | Works | ✅ Pass | StudioHome.jsx | — |
| Studio Home | Upload Media (empty state) | Opens file picker | Works | ✅ Pass | LibraryBrowser.jsx | — |
| Studio Home | Search library input | Filters displayed media | **Filters nothing** — `searchLibrary()` reads localStorage, not Firestore state | ❌ Fail | LibraryBrowser.jsx | Fixed in getDisplayedMedia rewrite |
| Studio Home | Sort dropdown (Newest) | Sorts media | Works with new getDisplayedMedia | ✅ Pass | LibraryBrowser.jsx | — |
| Studio Home | Collection sidebar items | Filters by collection | **May show empty** — getCollectionMedia reads localStorage | ⚠️ Partial | LibraryBrowser.jsx | Use library state |
| Studio Home | Click video clip | Selects/deselects for editor | Works | ✅ Pass | LibraryBrowser.jsx | — |
| Studio Home | View Library button | Opens content library view | Works | ✅ Pass | StudioHome.jsx | — |
| Studio Home | **Create Video** button | Opens editor modal with selected clips | **Works after our fix** | ✅ Pass | VideoStudio.jsx | Fixed (synthetic category) |
| Editor Modal | Cut by Beat | Distributes clips across beat markers | Works if audio + clips loaded | ✅ Pass | VideoEditorModal.jsx | — |
| Editor Modal | Cut by Word | Distributes clips across word timings | Works | ✅ Pass | VideoEditorModal.jsx | — |
| Editor Modal | Reroll | Randomizes clip assignments | Works | ✅ Pass | VideoEditorModal.jsx | — |
| Editor Modal | AI Transcribe | Sends audio to Whisper API | Works (needs API key) | ✅ Pass | VideoEditorModal.jsx | — |
| Editor Modal | Cancel | Closes editor | Works | ✅ Pass | VideoEditorModal.jsx | — |
| Editor Modal | **Confirm** | Saves video and closes | **Silent no-op** — handleSaveVideo bails | ❌ **P0 Fail** | VideoStudio.jsx:543 | AUD-001 |
| Editor Modal | Make 10 at once | Opens batch pipeline | **Silent no-op** if no selectedCategory | ❌ Fail | VideoStudio.jsx | Same root cause as AUD-002 |

---

## 7-Day Remediation Plan

### Day 1–2: Fix P0 (Save flow)
- **AUD-001:** Add library-mode save path in `handleSaveVideo`
- **AUD-002:** Audit all 19 `!selectedCategory` guards, add library-mode branches for user-facing ones
- **AUD-003:** Clear `selectedLibraryMedia` on editor close
- Deploy + verify Confirm button works end-to-end

### Day 3: Fix P1 data flow
- **AUD-004:** Rewrite `getDisplayedMedia` to use component state consistently
- **AUD-005:** Sequence migration before subscription (or accept flash)
- **AUD-006:** Normalize library item shape for editor compatibility

### Day 4–5: Fix P2 edge cases
- **AUD-008:** Fix preset filtering for library mode
- **AUD-009:** Add `localUrl` to `createMediaItem` schema
- **AUD-010:** Normalize `uploadFile`/`uploadVideo` return types

### Day 6: Testing
- Test full flow: upload → select → create → save → view in library
- Test across fresh browser (no localStorage) and returning user
- Test category mode still works (regression check)

### Day 7: Cleanup
- **AUD-011:** Add 404 route
- **AUD-012:** Remove `firebase-admin` from client deps
- **AUD-013:** Plan migration of hardcoded IDs to Firestore

---

## Prioritized Backlog

| Priority | ID | Issue | Effort | Risk |
|----------|----|-------|--------|------|
| P0 | AUD-001 | handleSaveVideo silent fail | S | Low |
| P0 | AUD-002 | 19 handlers with same bug | M | Med |
| P1 | AUD-003 | Stale selectedLibraryMedia | S | Low |
| P1 | AUD-004 | getDisplayedMedia localStorage | S | Low |
| P1 | AUD-005 | Migration race condition | M | Med |
| P1 | AUD-006 | Data shape mismatch | S | Low |
| P1 | AUD-007 | Async write ordering | M | Med |
| P2 | AUD-008 | Empty presets in library mode | S | Low |
| P2 | AUD-009 | Missing localUrl field | S | Low |
| P2 | AUD-010 | Upload return shape | S | Low |
| P2 | AUD-011 | No 404 route | S | Low |
| P3 | AUD-012 | firebase-admin in client | S | Low |
| P3 | AUD-013 | Hardcoded Late account IDs | M | Low |
