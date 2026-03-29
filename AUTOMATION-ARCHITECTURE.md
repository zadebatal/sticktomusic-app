# StickToMusic Automation Architecture Plan

## Overview

14 features that transform the artist workflow from manual editing to: **dump footage → auto-organize → auto-generate → approve → auto-schedule → learn → repeat**.

The goal: artists pump out as much content onto as many accounts as possible with minimal manual work.

---

## The 14 Features

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | Dump and Generate | Bulk upload → auto-organize → one-click N variations |
| 2 | Whisper → Text Bank Auto-Populate | Transcribe audio → fill lyrics/text banks automatically |
| 3 | Auto-Schedule from Generation | Generate N → spread across calendar + accounts on cadence |
| 4 | Song Recognition + Auto-Clip | Bulk source videos → identify songs → group clips by song |
| 5 | Cross-Niche Sourcing | Mix media from multiple niches in one generation run |
| 6 | Vision-Based Categorization | Auto-tag/sort clips on upload (performance, b-roll, studio, etc.) |
| 7 | Smart Duration Matching | Beat-aware clip selection to fill exact song length |
| 8 | Caption/Hashtag Generation | Claude API generates captions + hashtags, populates banks |
| 9 | Clip Recycling Engine | Track clip freshness, prioritize unused footage in generation |
| 10 | Remix Variations | Same clips/diff audio, same audio/diff clips, same everything/diff text |
| 11 | Auto-QC Before Scheduling | Check for black frames, silence gaps, sync issues before posting |
| 12 | Watch Folder / Auto-Import | Google Drive/Dropbox auto-sync new files into project banks |
| 13 | Approval Queue | Swipe approve/reject generated content, system learns from rejections |
| 14 | Momentum Auto-Edit | Energy-aware auto-cut-point generation (hype/chill/story presets) |

---

## How They Connect (the full chain)

```
RAW CONTENT IN
├─ Watch Folder (#12) ← Google Drive/Dropbox auto-sync
├─ Dump & Generate (#1) ← Bulk upload
└─ Web Import ← already exists

      ↓ AUTO-ORGANIZE

├─ Song Recognition (#4) ← group by song
├─ Vision Categorization (#6) ← tag clips
├─ Clip Recycling (#9) ← track freshness
└─ Whisper → Text Banks (#2) ← auto-fill lyrics

      ↓ AUTO-GENERATE

├─ Caption/Hashtag Gen (#8) ← Claude API
├─ Momentum Auto-Edit (#14) ← energy-aware cuts
├─ Smart Duration Match (#7) ← fill song length
├─ Cross-Niche Sourcing (#5) ← mix footage sources
└─ Remix Variations (#10) ← swap audio/clips/text

      ↓ AUTO-QC

├─ Auto-QC (#11) ← black frames, silence, sync
└─ Clip Recycling (#9) ← don't repost same content

      ↓ APPROVE

└─ Approval Queue (#13) ← swipe approve/reject

      ↓ AUTO-SCHEDULE

└─ Auto-Schedule (#3) ← spread across calendar + accounts
```

---

## Dependency Map & Build Order

### Phase 1: "The Plumbing" (data model + pure functions, no UI changes)

**9. Clip Recycling Engine**
- Add `useCount`, `lastUsedAt`, `lastPostedAt` fields to media items in libraryService.js
- Increment `useCount` in generation algorithms (all 4 editors)
- Increment `lastPostedAt` in `markPostPublished` (scheduledPostsService.js)
- New functions: `getUnusedMedia(artistId, nicheId)`, `getFreshestMedia(artistId, nicheId)`
- **Touches:** `libraryService.js` (media item schema + new query functions)

**11. Auto-QC Service**
- New standalone service: pure functions, no UI
- `analyzeExport(blob) → { passed: boolean, issues: string[] }`
- Checks: black frames (sample canvas pixels at intervals), silent audio gaps (RMS < threshold), duration mismatch vs expected, resolution check (1080p minimum)
- **New file:** `src/services/qcService.js` (~100 lines)

**14. Momentum Auto-Edit**
- `momentumAnalyzer.js` ALREADY EXISTS with energy curves, onset detection, 3 presets (hype/chill/story)
- Add `autoSelectCutPreset(energyCurve)` — returns 'hype'/'chill'/'story' based on average energy level
- Wire into generation: when auto-generating, call `generateCutPoints()` instead of random beat selection
- **Touches:** `src/utils/momentumAnalyzer.js` (add one function), editor generation functions

---

### Phase 2: "Auto-Populate Banks" (fill things without human input)

**2. Whisper → Text Bank Auto-Populate**
- New button on SlideshowNicheContent and VideoNicheContent: "Auto-fill from audio"
- Flow: niche audio → `fetchSyncedLyrics()` (preferred, free via LRCLIB) → fallback to `whisperService.transcribeAudio()` → split transcript into lines → call `addToTextBank()` per slide position (slideshow) or `addToVideoTextBank()` per bank (video)
- `fetchSyncedLyrics()` and `whisperService.transcribeAudio()` ALREADY EXIST, just not wired for auto-populating banks
- **Touches:** `SlideshowNicheContent.jsx`, `VideoNicheContent.jsx` (add button + handler), `libraryService.js` (batch addToTextBank)

**8. Caption/Hashtag Generation (Claude API)**
- AI panel ALREADY EXISTS in ProjectWorkspace: `showAiPanel`, `aiResults`, `aiContext`, `aiAccepted` state all exist
- Just needs a real backend endpoint
- New Vercel serverless function: receives artist name + song title + genre → calls Claude API → returns `{ captions: string[], hashtags: string[] }`
- User accepts/rejects suggestions (aiAccepted Set already wired in UI)
- **New file:** `api/generate-captions.js` (~60 lines, Vercel serverless)
- **Touches:** `ProjectWorkspace.jsx` (wire existing AI panel to real endpoint)

**4. Song Recognition + Auto-Clip**
- New service that chains existing functions: takes array of source video URLs → runs `recognizeSong()` on each (ALREADY EXISTS in lyricsLookupService.js) → groups by song → auto-creates one niche per song → assigns clips to media banks
- Can also use `analyzeSongStructure()` for segment boundaries (verse/chorus/bridge)
- UI: "Analyze All" button in ProjectWorkspace when multiple source videos exist
- **New file:** `src/services/autoClipService.js` (~150 lines)
- **Touches:** `ProjectWorkspace.jsx` (add analyze button), `libraryService.js` (auto-create niches via `createNiche()`)

---

### Phase 3: "Smart Generation" (generation gets intelligent)

**1. Dump and Generate**
- New modal component: user drops files + selects audio
- System uploads all to Firebase Storage → creates temp niche → auto-sorts into media banks
- If Phase 2 features are available: runs song recognition, auto-fills text banks, generates captions
- Opens editor with `_nicheGenerateCount` set → auto-generates N variations on mount
- This is the ORCHESTRATION LAYER that chains Phase 1 & 2 features together
- **New file:** `src/components/VideoEditor/DumpAndGenerateModal.jsx` (~300 lines)
- **Touches:** `ProjectWorkspace.jsx` (trigger modal), `VideoStudio.jsx` (accept batch drafts via `handleMakeVideo`)

**5. Cross-Niche Sourcing**
- Modify `pipelineCategory` useMemo in VideoStudio.jsx to accept `activePipelineIds` (array) instead of single ID
- When multiple niche IDs passed, merge mediaIds from all selected niches into one pool
- Keep single-niche path UNTOUCHED — only branch when array has 2+ IDs
- UI: multi-select checkboxes on niche cards in ProjectWorkspace before "Generate"
- **Touches:** `VideoStudio.jsx` (pipelineCategory useMemo), `ProjectWorkspace.jsx` (multi-select UI)

**7. Smart Duration Matching**
- New utility: `selectClipsForDuration(clips, targetDuration, beats, usageCounts)`
- Uses beat array to find natural cut points
- Selects clips greedily: fill total duration, prefer clips with lowest `useCount` (from clip recycling)
- Replaces random selection in Multi/PhotoMontage generation functions
- **New file:** `src/utils/smartDurationMatcher.js` (~80 lines)
- **Touches:** MultiClipEditor, PhotoMontageEditor generation functions

**10. Remix Variations**
- "Remix" button on draft cards in ContentLibrary
- Opens picker: "Same clips, different audio" / "Same audio, different clips" / "Same everything, different text"
- Creates new draft object with one dimension swapped from existing draft
- Routes to editor via `handleMakeVideo(remixDraft)` — same path as editing existing draft
- **Touches:** `ContentLibrary.jsx` (add remix button + picker), `VideoStudio.jsx` (accept remix draft)

**14. Momentum Auto-Edit (wired to generation)**
- In Multi/Solo generation, if audio exists: auto-run `computeEnergyCurve()` + `autoSelectCutPreset()` + `generateCutPoints()`
- Use returned cut points as clip boundaries instead of random beats or even-spacing
- Add as opt-in flag on generation, not replacing existing random path (fallback safety)
- **Touches:** `MultiClipEditor.jsx`, `SoloClipEditor.jsx` generation functions

---

### Phase 4: "Post-Generation Pipeline" (QC + approve + schedule)

**11. Auto-QC (wired to UI)**
- After each export completes in export services, run `analyzeExport(blob)` from Phase 1
- Store result on draft: `qcResult: { passed: boolean, issues: string[] }`
- ContentLibrary shows green check (passed) or yellow warning badge (issues found)
- Drafts that fail QC don't auto-enter the approval queue
- **Touches:** `slideshowExportService.js`, `videoExportService.js`, `photoMontageExportService.js` (post-render hook), `ContentLibrary.jsx` (QC badge)

**13. Approval Queue**
- New component: card-based UI showing generated drafts one at a time
- Approve = sets `status: 'approved'`
- Reject = sets `status: 'rejected'` + optional reason tag ("bad clips", "bad text", "bad timing")
- Draft model gets new statuses: `'pending_review' | 'approved' | 'rejected'`
- Generation sets status to `'pending_review'` instead of `'draft'`
- **New file:** `src/components/VideoEditor/ApprovalQueue.jsx` (~250 lines)
- **Touches:** `ContentLibrary.jsx` (approval queue tab), `libraryService.js` (draft status field)

**3. Auto-Schedule from Generation**
- After approving N drafts, trigger auto-schedule
- SchedulingPage batch controls ALREADY EXIST: `postsPerDay`, `spacingMode`, `batchStartDate`
- `addManyScheduledPosts()` ALREADY EXISTS in scheduledPostsService.js
- Add "Schedule all approved" button that: computes staggered times based on cadence rules → calls `addManyScheduledPosts()` → calls `handlePublishPost()` per post to push to Late.co
- **Touches:** `SchedulingPage.jsx` (add "auto from approved" trigger, mostly wiring existing controls)

---

### Phase 5: "Background Automation" (hands-off operation)

**12. Watch Folder / Auto-Import**
- New service: on ProjectWorkspace mount, check Drive/Dropbox for new files since `lastSyncAt`
- Download new files → upload to Firebase Storage → assign to niche media banks
- `googleDriveService.listFiles()` and `dropboxService.listFiles()` are BOTH FULLY BUILT
- Config UI in SettingsTab: enable/disable per project, select Drive/Dropbox folder, set sync interval
- **New file:** `src/services/watchFolderService.js` (~200 lines)
- **Touches:** `SettingsTab.jsx` (config UI), `ProjectWorkspace.jsx` (poll on mount)

**6. Vision-Based Categorization**
- New Vercel serverless function: sends thumbnail to Claude vision API → returns tags (`performance`, `b-roll`, `studio`, `crowd`, `close-up`, etc.)
- On upload completion in ProjectWorkspace, call categorize → auto-assign to named media bank matching the tag
- Auto-create banks ("Performance", "B-Roll", "Studio") on first use if they don't exist
- **New file:** `api/categorize-media.js` (~60 lines, Vercel serverless)
- **Touches:** Upload completion handlers in `ProjectWorkspace.jsx`, `libraryService.js` (auto-create banks via `addMediaBank()`)

---

## New Files Summary

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `src/services/autoClipService.js` | Song recognition → auto-group clips | ~150 |
| `src/services/qcService.js` | Export quality checks (pure functions) | ~100 |
| `src/services/watchFolderService.js` | Drive/Dropbox polling + auto-import | ~200 |
| `src/utils/smartDurationMatcher.js` | Beat-aware clip selection for duration | ~80 |
| `src/components/VideoEditor/DumpAndGenerateModal.jsx` | Bulk upload + auto-generate flow | ~300 |
| `src/components/VideoEditor/ApprovalQueue.jsx` | Swipe approve/reject UI | ~250 |
| `api/generate-captions.js` | Vercel serverless — Claude API captions | ~60 |
| `api/categorize-media.js` | Vercel serverless — Claude vision tags | ~60 |

**Total new code: ~1,200 lines across 8 files**

---

## New API Endpoints

| Endpoint | Purpose | Cost |
|----------|---------|------|
| `POST /api/generate-captions` | Claude API → captions + hashtags | ~$0.01/call |
| `POST /api/categorize-media` | Claude vision → clip tags | ~$0.02/call (image input) |

Everything else uses existing services (Whisper proxy, Late.co proxy, AudD proxy, Firebase, Drive, Dropbox).

---

## What Already Exists and Just Needs Wiring

These are built and production-ready but not connected to the automation flows:

| Existing Code | Currently Used In | Automation Use |
|--------------|-------------------|---------------|
| `momentumAnalyzer.js` (energy curves, onset detection, cut points) | MomentumSelector UI only | Wire to generation algorithms for auto-editing |
| `recognizeSong()` in lyricsLookupService | ClipperEditor only | Use in bulk upload to auto-group by song |
| `fetchSyncedLyrics()` in lyricsLookupService | ClipperEditor only | Use to auto-populate text banks |
| `whisperService.transcribeAudio()` | Cut-by-word in editors | Use to auto-populate text banks when no synced lyrics found |
| `googleDriveService.listFiles()` | CloudImportButton manual flow | Use in watch folder polling |
| `dropboxService.listFiles()` | CloudImportButton manual flow | Use in watch folder polling |
| `addManyScheduledPosts()` in scheduledPostsService | Not used anywhere | Use in auto-schedule from approved drafts |
| `showAiPanel` / `aiResults` state in ProjectWorkspace | UI exists, no backend | Wire to /api/generate-captions endpoint |
| `useCount` field on media items | In schema but never incremented | Increment in generation, use for freshness sorting |
| `analyzeSongStructure()` in structureAnalysisService | ClipperEditor only | Use in auto-clip for segment boundaries |
| Batch controls in SchedulingPage (`postsPerDay`, `spacingMode`) | Manual batch scheduling | Use in auto-schedule flow |

---

## Modified Files Per Feature

| Feature | Modified Files |
|---------|---------------|
| #1 Dump and Generate | `ProjectWorkspace.jsx`, `VideoStudio.jsx` |
| #2 Whisper → Text Banks | `SlideshowNicheContent.jsx`, `VideoNicheContent.jsx`, `libraryService.js` |
| #3 Auto-Schedule | `SchedulingPage.jsx` |
| #4 Song Recognition | `ProjectWorkspace.jsx`, `libraryService.js` |
| #5 Cross-Niche Sourcing | `VideoStudio.jsx` (pipelineCategory useMemo), `ProjectWorkspace.jsx` |
| #6 Vision Categorization | `ProjectWorkspace.jsx` upload handlers |
| #7 Smart Duration | MultiClipEditor, PhotoMontageEditor generation functions |
| #8 Caption/Hashtag Gen | `ProjectWorkspace.jsx` (wire existing AI panel) |
| #9 Clip Recycling | `libraryService.js` (media item fields + query functions) |
| #10 Remix Variations | `ContentLibrary.jsx`, `VideoStudio.jsx` |
| #11 Auto-QC | Export services (post-render hook), `ContentLibrary.jsx` |
| #12 Watch Folder | `SettingsTab.jsx`, `ProjectWorkspace.jsx` |
| #13 Approval Queue | `ContentLibrary.jsx`, `libraryService.js` (draft status) |
| #14 Momentum Auto-Edit | `momentumAnalyzer.js`, Multi/Solo editor generation functions |

---

## Key Data Model Changes

### Media Item (libraryService.js) — new fields:
```javascript
{
  ...existing,
  useCount: 0,              // Incremented each time used in generation
  lastUsedAt: null,         // ISO8601, set on generation
  lastPostedAt: null,       // ISO8601, set when post goes live
  tags: [],                 // Vision categorization tags (e.g., ['performance', 'close-up'])
  autoCategory: null,       // Auto-assigned category from vision API
}
```

### Created Content / Draft — new fields:
```javascript
{
  ...existing,
  status: 'draft' | 'pending_review' | 'approved' | 'rejected',  // was just 'draft'
  qcResult: null | { passed: boolean, issues: string[] },          // Auto-QC results
  rejectionReason: null | string,                                   // From approval queue
  sourceClipIds: [],                                                // Track which clips were used (for recycling)
}
```

### Niche/Collection — new fields:
```javascript
{
  ...existing,
  watchFolder: null | {
    provider: 'google_drive' | 'dropbox',
    folderId: string,        // Drive folder ID or Dropbox path
    lastSyncAt: null | ISO8601,
    autoSync: boolean,
    syncInterval: 3600,      // seconds (default 1 hour)
  },
}
```

---

## The End State (artist experience)

1. Artist dumps footage into a Google Drive folder on their phone
2. Watch Folder auto-imports into the project
3. Song recognition groups clips by song, vision tags sort them into banks
4. Text banks auto-fill from lyrics, captions/hashtags auto-generated
5. System generates 10+ variations per song with smart editing (momentum-aware, duration-matched, fresh clips)
6. Artist opens approval queue, swipes through in 2 minutes
7. Auto-QC catches any bad exports
8. Approved content auto-schedules across all accounts for the next 2 weeks
9. Clip recycling ensures fresh footage is prioritized next time

**Artist's only job: make content, dump it, approve what the system makes.**

---

## Important Notes

- Build-verify after each phase before starting the next
- Phase 1-2 are purely additive (new files, new fields, new buttons) — lowest risk
- Phase 3 touches generation algorithms — keep existing random path as fallback
- Phase 4-5 are mostly new components + wiring existing services
- The `pipelineCategory` useMemo change for cross-niche (#5) is the highest-risk single change — keep single-niche path untouched
- All libraryService changes must follow dual-layer pattern (localStorage first, Firestore async)
- Follow CLAUDE.md Pre-Deploy Checklist for any data model changes
