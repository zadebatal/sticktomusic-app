# StickToMusic — UI Fix Plan

**Date:** 2026-02-06
**Branch:** `ui-audit-fixes-2026-02-06`
**Estimated effort:** 3–4 focused sessions

---

## Prioritized Implementation Order

### Wave 1: Security & Data Integrity (Do First)
*Quick wins with highest risk reduction. Each fix is small and isolated.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 1 | **C-01:** Fix auth bypass — Late API `canUserAccessArtist` fails open | `api/late.js` | 5 min | Blocks unauthorized access |
| 2 | **C-04:** Fix CORS bypass — strict Vercel preview regex | `api/late.js` | 5 min | Closes origin spoofing |
| 3 | **C-05:** Fix XSS — sanitize Spotify input with URLSearchParams | `SpotifyComponents.jsx` | 10 min | Prevents injection |
| 4 | **H-09:** Validate Late API input params (artistId, postId) | `api/late.js` | 15 min | Prevents injection |
| 5 | **C-12:** Enforce artist-scope on all Late API calls | `App.jsx`, `api/late.js` | 30 min | Prevents cross-artist data access |
| 6 | **C-03:** Add response validation + max-page guard to Late pagination | `App.jsx` | 15 min | Prevents infinite loop |

### Wave 2: Dead Buttons & Broken Interactions (High Visibility)
*Users notice these immediately. Each fix is surgical.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 7 | **C-09:** Wire or remove Artist Portal quick actions | `App.jsx` | 20 min | Eliminates 3 dead buttons |
| 8 | **C-10:** Wire or remove Content Library footer buttons | `ContentLibrary.jsx` | 15 min | Eliminates 2 dead buttons |
| 9 | **L-02:** Remove or disable "View Details" campaign button | `App.jsx` | 5 min | Eliminates 1 dead button |
| 10 | **L-04:** Replace "Coming soon" stub with proper disabled state + explanation | `VideoEditorModal.jsx` | 10 min | Clear user expectation |
| 11 | **L-01:** Replace "Delete Account" toast with proper disabled state | `App.jsx` | 5 min | Honest affordance |

### Wave 3: State Desync & Race Conditions (Stability)
*These cause intermittent bugs that erode trust.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 12 | **C-06:** Clear all dependent state on artist change | `App.jsx` | 20 min | Fixes stale posts/selections |
| 13 | **C-02:** Add AbortController + Promise.allSettled to batch schedule | `App.jsx` | 45 min | Prevents orphaned API calls |
| 14 | **C-08:** Cancel Late API requests on artist change | `App.jsx` | 30 min | Prevents wrong-artist data |
| 15 | **C-11:** Fix audio auto-select trap in BatchPipeline | `BatchPipeline.jsx` | 10 min | Users can deselect audio |
| 16 | **H-11:** Fix infinite loop in auto-select collection | `StudioHome.jsx` | 10 min | Prevents freeze |
| 17 | **H-05:** Snapshot posts before batch rendering loop | `PostingModule.jsx` | 15 min | Prevents wrong video render |
| 18 | **C-07:** Add missing `await` to computeAttribution | `AnalyticsDashboard.jsx` | 5 min | Fixes silent error |

### Wave 4: Dialog & Error Handling Consistency (UX Polish)
*Unify the user experience.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 19 | **H-01:** Replace all `window.confirm()` with ConfirmDialog | `ContentBankManager.jsx`, `StudioHome.jsx` | 30 min | Consistent delete UX |
| 20 | **H-02:** Replace all `alert()` with toast notifications | `StudioHome.jsx` (6 instances) | 20 min | Non-blocking errors |
| 21 | **M-15:** Add disabled-reason tooltips to key buttons | `VideoEditorModal.jsx`, `BatchPipeline.jsx` | 30 min | Users know why buttons disabled |
| 22 | **H-04:** Add timeout + cancel to video rendering | `ContentLibrary.jsx` | 20 min | Users can escape stuck renders |
| 23 | **M-14:** Add loading spinner during post scheduling | `ContentLibrary.jsx` | 15 min | Prevents double-submit |

### Wave 5: Memory Leaks & Resource Cleanup (Performance)
*Important for long sessions.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 24 | **H-06:** Close AudioContext on error | `AudioClipSelector.jsx` | 5 min | Prevents memory leak |
| 25 | **H-07:** Revoke blob URLs after upload | `StudioHome.jsx` | 10 min | Prevents memory bloat |
| 26 | **H-08:** Handle localStorage quota with cleanup | `libraryService.js` | 20 min | Prevents silent data loss |
| 27 | **M-21:** Cancel toast timeouts on unmount | `ui/index.jsx` | 10 min | Clean unmount |
| 28 | **H-18:** Add AbortController to Spotify fetch | `SpotifyComponents.jsx` | 15 min | Clean unmount |
| 29 | **M-08:** Cancel sync status timeout on unmount | `App.jsx` | 5 min | Clean unmount |

### Wave 6: Form Validation (Data Quality)
*Prevent bad data from entering the system.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 30 | **M-02:** Block past dates in batch schedule | `App.jsx` | 10 min | Valid schedules only |
| 31 | **M-03:** Validate start < end date in campaigns | `App.jsx` | 10 min | Valid campaigns only |
| 32 | **M-04:** Check template name uniqueness | `App.jsx` | 10 min | Prevent overwrites |
| 33 | **M-05:** Check artist name uniqueness | `App.jsx` | 10 min | Prevent duplicates |
| 34 | **H-12:** Validate image URLs in SlideshowEditor | `SlideshowEditor.jsx` | 15 min | Prevent silent export failure |
| 35 | **H-17:** Validate date formats in Spotify service | `spotifyService.js` | 10 min | Prevent NaN comparisons |

### Wave 7: Accessibility & Keyboard Navigation (Inclusive UX)
*Bring app to baseline accessibility.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 36 | **H-14:** Add focus trap to all modals | `ui/index.jsx` (create wrapper) | 45 min | Keyboard users can't escape |
| 37 | **H-15:** Add Escape key handlers to all modals | Various (5 files) | 20 min | Keyboard close everywhere |
| 38 | **M-17:** Add aria-labels to icon-only buttons | `AestheticHome.jsx`, `VideoEditorModal.jsx` | 30 min | Screen reader support |
| 39 | **M-18:** Add ARIA tab attributes + arrow key nav | Tab components (4 files) | 45 min | Keyboard tab navigation |

### Wave 8: Cleanup & Consistency (Tech Debt)
*Reduce maintenance burden.*

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 40 | **M-16:** Guard console.log with NODE_ENV | 22+ files | 30 min | Clean production console |
| 41 | **H-13:** Centralize z-index scale | `ui/index.jsx`, CSS vars | 20 min | Predictable stacking |
| 42 | **M-01:** Migrate inline-style buttons to Button component | Various (10+ files) | 60 min | Consistent look & feel |
| 43 | **H-03:** Add error boundaries to SlideshowEditor, BatchPipeline | `VideoStudio.jsx` | 20 min | Crash recovery |
| 44 | **L-08:** Fix video ID collision in batch generation | `BatchPipeline.jsx` | 5 min | Unique IDs |

---

## Quick Wins (< 15 min each, high ROI)

1. Auth bypass fix → `api/late.js` one-line change
2. CORS fix → `api/late.js` regex swap
3. XSS fix → `SpotifyComponents.jsx` URLSearchParams
4. Late pagination guard → `App.jsx` add Array.isArray + max page
5. `await` attribution → `AnalyticsDashboard.jsx` add keyword
6. Audio auto-select fix → `BatchPipeline.jsx` add ref flag
7. Infinite loop fix → `StudioHome.jsx` remove dep
8. AudioContext cleanup → `AudioClipSelector.jsx` add .close()
9. Dead button removal → `App.jsx` remove 3 buttons
10. Blob URL revoke → `StudioHome.jsx` add revokeObjectURL

---

## Structural Fixes (Require careful implementation)

### S-01: Unified Dialog System
**What:** Create `useDialog()` hook wrapping `ConfirmDialog`. Replace all `window.confirm()`, `window.alert()`, and ad-hoc modals.
**Why:** Three different dialog patterns confuse users and create maintenance burden.
**Risk:** Moderate — must ensure all existing confirm/cancel flows still work.
**Approach:**
1. Create `useDialog()` hook in `ui/index.jsx`
2. Replace native dialogs one file at a time
3. Test each replacement before moving to next

### S-02: Request Cancellation System
**What:** Create `useApiRequest()` hook with built-in AbortController, loading state, error state, and unmount cleanup.
**Why:** 5+ race conditions from uncancelled API calls.
**Risk:** Moderate — must handle in-flight requests correctly.
**Approach:**
1. Create hook
2. Replace Late API calls first (highest risk)
3. Then Spotify calls
4. Then Firestore subscriptions

### S-03: Modal Focus Management
**What:** Create `<FocusTrap>` wrapper component. Apply to all modals.
**Why:** Keyboard users can tab into background content behind modals.
**Risk:** Low — additive change, doesn't modify existing logic.
**Approach:**
1. Build `<FocusTrap>` with first/last-focusable tracking
2. Wrap `ConfirmDialog` first
3. Extend to VideoEditorModal and others

---

## UX Reroutes / Feature Changes

### R-01: Artist Portal Quick Actions → Disable with Explanation
**Current:** Three dead buttons that do nothing.
**Proposed:** Remove "Download Report" and "Upload Content" buttons entirely. Replace "Contact Manager" with mailto link to operator email if available, or hide if not.
**Rationale:** Non-functional buttons are worse than no buttons. Each button must either work or clearly explain why it can't.

### R-02: "Coming Soon" → Disabled with Roadmap Link
**Current:** "Record cuts" shows "Coming soon" in tooltip.
**Proposed:** Style as clearly disabled (grayed out, strikethrough) with tooltip: "This feature is in development. [See roadmap]"
**Rationale:** Honest communication builds trust. "Coming soon" in a tooltip feels broken.

### R-03: Content Library Footer → Remove Dead Buttons
**Current:** "Edit category" and "Upload your own videos" buttons do nothing.
**Proposed:** Remove both buttons. The category edit functionality exists in the sidebar. Upload exists in the header.
**Rationale:** Duplicate, non-functional entry points add confusion. Existing entry points work.

### R-04: Batch Schedule Error Recovery → Show Per-Post Status
**Current:** Batch schedule fires posts sequentially with no per-post status.
**Proposed:** Show a progress list with checkmark/X for each post. Allow retry for failed posts. Show summary at end.
**Rationale:** Users need to know which posts succeeded vs. failed, especially in 10+ post batches.

---

## Risk Notes & Rollback Strategy

### Risk Assessment
| Wave | Risk Level | Rollback |
|------|-----------|----------|
| Wave 1 (Security) | **Low** — isolated API changes | Revert single file |
| Wave 2 (Dead Buttons) | **Low** — removing/disabling only | Revert single file |
| Wave 3 (State/Race) | **Medium** — touches core state logic | Revert commit; state flows may interleave |
| Wave 4 (Dialogs) | **Low** — UI-only changes | Revert commit |
| Wave 5 (Memory) | **Low** — additive cleanup | Revert commit |
| Wave 6 (Validation) | **Low** — additive checks | Revert commit |
| Wave 7 (A11y) | **Low** — additive attributes | Revert commit |
| Wave 8 (Cleanup) | **Medium** — touches many files | Revert commit; may need cherry-pick |

### Rollback Strategy
- Each wave is a separate commit (or small group of commits)
- Every commit message references the issue ID (e.g., "fix(C-01): auth bypass in late API")
- If a wave introduces regressions, `git revert <commit>` reverts cleanly
- App.jsx changes are highest risk — these get individual commits

### Testing Dependencies
- Waves 1–2 can be tested independently
- Wave 3 requires testing all artist-switching flows end-to-end
- Wave 4 requires testing every modal open/close/confirm path
- Waves 5–8 can be tested independently

---

## Test Plan

### Manual Testing (Critical Paths)

| Test Case | Steps | Expected Result |
|-----------|-------|----------------|
| **Artist switch clears state** | 1. Load posts for Artist A. 2. Switch to Artist B. 3. Check Content tab. | All Artist A data cleared; Artist B loads fresh |
| **Batch schedule cancellation** | 1. Start 10-post batch. 2. Navigate away mid-batch. | API calls cancelled; no orphaned posts |
| **Late API auth** | 1. Call `/api/late` without artistId. | 403 Forbidden (not 200) |
| **Dead buttons removed** | 1. Visit Artist Portal. 2. Check quick actions area. | No non-functional buttons visible |
| **Modal focus trap** | 1. Open any modal. 2. Press Tab repeatedly. | Focus cycles within modal only |
| **Dialog consistency** | 1. Delete a content bank item. 2. Delete a video. 3. Delete a category. | Same styled ConfirmDialog every time |
| **Disabled button feedback** | 1. Open BatchPipeline with no audio. 2. Hover over disabled Generate button. | Tooltip explains "Select audio to enable" |
| **Past date blocked** | 1. Open Batch Schedule. 2. Pick a past date. | Form shows error, submit disabled |

### Automated Testing (Recommended)

| Area | Tool | What to Test |
|------|------|-------------|
| API Auth | Jest + Supertest | All `/api/late` endpoints reject unauthorized requests |
| Input Validation | Jest | `canUserAccessArtist` returns false for null inputs |
| State Reset | React Testing Library | `handleArtistChange` clears all dependent state |
| Dialog Rendering | React Testing Library | `ConfirmDialog` opens, closes, returns correct value |
| Form Validation | React Testing Library | Date picker rejects past dates, campaign rejects invalid ranges |

---

## Definition of Done Checklist

- [ ] No dead primary-action buttons
- [ ] Critical user journeys complete successfully (create → edit → export → schedule)
- [ ] Clear loading/empty/error states on all async operations
- [ ] Consistent interaction patterns (one dialog system, one button system, one error pattern)
- [ ] Role-based flows enforce scope correctly (Late API, artist access)
- [ ] All modals have Escape-to-close and focus management
- [ ] No silent failures — every error shows user feedback
- [ ] No memory leaks in long sessions
- [ ] No production console.log calls
- [ ] App builds and runs cleanly (`npm run build` passes)
- [ ] All security issues (C-01, C-04, C-05, C-12) verified fixed
