# StickToMusic — UI/UX & Interaction Logic Audit Report

**Date:** 2026-02-06
**Auditor:** Claude (Senior Product Engineer + UX Auditor)
**Scope:** Full codebase — all pages, components, services, APIs
**App version:** Current `main` branch

---

## Executive Summary

StickToMusic is a monolithic React SPA (7,498-line App.jsx + ~36 VideoEditor components) built on React 18, React Router v7, Firebase (Auth/Firestore/Storage), and Tailwind CSS. The app serves two roles (Operator, Artist) across four major areas: Video Studio, Content/Scheduling, Analytics, and Artist Management.

**The audit uncovered 72 distinct issues across the full stack.** The root causes cluster around five themes:

1. **Monolithic architecture** — App.jsx owns all state, routing, and UI, creating cascading desync and maintenance issues.
2. **Inconsistent UI patterns** — Three different dialog systems (native `alert()`/`confirm()`, custom `ConfirmDialog`, state-based modals), two button systems (inline styles vs. `<Button>` component), and multiple error-handling approaches.
3. **Missing safety nets** — No error boundaries beyond VideoEditorModal, no request cancellation on navigation, silent failures in API integrations, unvalidated API responses.
4. **Dead/stub interactions** — At least 8 buttons render but do nothing when clicked, misleading users into thinking features exist.
5. **Security gaps** — Authorization bypass (Late API returns `true` when `db`/`artistId` is missing), loose CORS validation, unsanitized URL parameters.

**Bottom line:** The core Video Studio workflow (create → edit → export) mostly works but has race conditions and stale-closure bugs that cause intermittent data loss. The operator dashboard has multiple dead buttons and unfinished features. The scheduling/posting flow has silent failure modes. The app needs targeted fixes (not a rewrite) to reach production quality.

---

## Severity Definitions

| Severity | Criteria |
|----------|----------|
| **Critical** | Causes data loss, security vulnerability, or blocks core user journey |
| **High** | Significant UX degradation, silent failures, or race conditions that intermittently break features |
| **Medium** | Inconsistencies, missing validation, poor feedback, or confusing UX |
| **Low** | Polish issues, dead code, accessibility gaps, or minor inconsistencies |

---

## Critical Issues (12)

### C-01: Authorization Bypass — Late API Fails Open
- **File:** `api/late.js` lines 107–127
- **Repro:** Call `/api/late?action=accounts` without `artistId` parameter
- **Expected:** Request denied (403)
- **Actual:** `canUserAccessArtist()` returns `true` when `db` or `artistId` is missing, granting access
- **Root cause:** Defensive default returns `true` instead of `false`
- **Fix:** Change `if (!db || !artistId) return true` → `return false`

### C-02: Race Condition — Batch Schedule Submission
- **File:** `src/App.jsx` lines 3701–3826
- **Repro:** Submit batch schedule with 10+ posts, navigate away mid-submission
- **Expected:** Remaining posts cancelled or queued
- **Actual:** Sequential `lateApi.schedulePost()` calls continue in background with 200ms delay, no cancellation, no error recovery if one fails mid-batch
- **Root cause:** No AbortController, no Promise.allSettled, no cleanup on unmount
- **Fix:** Wrap in cancellable Promise.allSettled with unmount cleanup

### C-03: Infinite Loop Vulnerability — Late API Pagination
- **File:** `src/App.jsx` lines 293–318
- **Repro:** API returns malformed response (non-array `posts` field)
- **Expected:** Graceful error
- **Actual:** `while(hasMore)` loop never terminates if `data.posts` is not an array — no type check, no max-page guard
- **Root cause:** Missing response schema validation and loop safeguard
- **Fix:** Add `Array.isArray()` check + max page limit (e.g., 20)

### C-04: CORS Bypass — Loose Vercel Preview Validation
- **File:** `api/late.js` lines 150–152
- **Repro:** Set origin to `evil-sticktomusic.vercel.app`
- **Expected:** CORS rejection
- **Actual:** `isVercelPreview()` uses `origin.includes('sticktomusic')` which matches malicious subdomains
- **Root cause:** Substring match instead of regex anchor
- **Fix:** Use strict regex: `/^https:\/\/[a-z0-9-]+-sticktomusic\.vercel\.app$/i`

### C-05: XSS Vector — Unsanitized Spotify Input
- **File:** `src/components/Analytics/SpotifyComponents.jsx` lines 535–540
- **Repro:** Enter `"><script>alert(1)</script>` as Spotify Artist ID
- **Expected:** Input sanitized before URL construction
- **Actual:** Direct string interpolation into fetch URL
- **Root cause:** No `URLSearchParams` encoding
- **Fix:** Use `new URLSearchParams({ action, spotifyArtistId })`

### C-06: State Desync — Artist Change Doesn't Clear Posts
- **File:** `src/App.jsx` lines 600–624
- **Repro:** View posts for Artist A in Content tab → Switch to Artist B → Posts from A still visible briefly
- **Expected:** Clean slate on artist change
- **Actual:** `latePosts` cleared but `selectedPosts` Set, `dayDetailDrawer`, and filter state retain Artist A data
- **Root cause:** Incomplete state reset in `handleArtistChange()`
- **Fix:** Clear all dependent state: `selectedPosts`, `dayDetailDrawer`, `contentFilter`

### C-07: Unhandled Promise — Spotify Attribution
- **File:** `src/components/Analytics/AnalyticsDashboard.jsx` lines 117–125
- **Repro:** Open Analytics with invalid artist data
- **Expected:** Error caught and displayed
- **Actual:** `computeAttribution()` called without `await` — try-catch never catches async errors
- **Root cause:** Missing `await` keyword
- **Fix:** Add `await computeAttribution(currentArtistId)`

### C-08: Race Condition — Multiple Late API Loops
- **File:** `src/App.jsx` lines 634–687
- **Repro:** Rapidly switch between artists while posts are loading
- **Expected:** Previous requests cancelled
- **Actual:** Multiple `loadLatePages` loops run concurrently, updating state for wrong artist
- **Root cause:** No request cancellation on artist change
- **Fix:** Add AbortController per artist load, cancel on change

### C-09: Dead Buttons — Artist Portal Quick Actions
- **File:** `src/App.jsx` lines 2980–2989
- **Repro:** Log in as Artist → Click "Download Report", "Contact Manager", or "Upload Content"
- **Expected:** Action occurs
- **Actual:** All three buttons have NO `onClick` handler — clicking does nothing
- **Root cause:** Placeholder buttons never wired
- **Fix:** Implement handlers or remove buttons and add disabled state with explanation

### C-10: Dead Buttons — Content Library Footer
- **File:** `src/components/VideoEditor/ContentLibrary.jsx` lines 372–373
- **Repro:** Open Content Library → Click "Edit category" or "Upload your own videos"
- **Expected:** Edit/upload flow begins
- **Actual:** Both buttons have NO `onClick` handler
- **Root cause:** Placeholder buttons never wired
- **Fix:** Wire to existing category edit and file upload functionality

### C-11: Race Condition — Audio Auto-Select Trap (BatchPipeline)
- **File:** `src/components/VideoEditor/BatchPipeline.jsx` lines 207–213
- **Repro:** Open BatchPipeline with 1 audio → deselect it → it re-selects automatically
- **Expected:** User can deselect audio
- **Actual:** `useEffect` re-selects single audio option on every `selectedAudio` change, trapping user
- **Root cause:** Effect depends on state it modifies, no "user has manually selected" flag
- **Fix:** Add `hasUserSelected` ref, skip auto-select after manual interaction

### C-12: Firestore Authorization Bypass — Operator Scope
- **File:** `src/App.jsx` lines 3000–3019
- **Repro:** Operator assigned to Artist A calls Late API with Artist B's ID
- **Expected:** Denied
- **Actual:** No client-side or server-side artist-scope check on operator's assigned artists for some endpoints
- **Root cause:** `canAccessArtist()` not called on all Late API operations
- **Fix:** Enforce `canAccessArtist()` on every Late API call

---

## High Issues (18)

### H-01: Mixed Dialog Systems
- **Files:** `ContentBankManager.jsx:335` (native `window.confirm()`), `AestheticHome.jsx:920` (custom `ConfirmDialog`), `StudioHome.jsx:226` (native `alert()`)
- **Impact:** Users encounter three different confirmation/error UIs for similar actions
- **Fix:** Replace all native dialogs with `ConfirmDialog` component

### H-02: `alert()` Used for Errors in StudioHome
- **File:** `src/components/VideoEditor/StudioHome.jsx` lines 226, 332, 339, 392, 407, 454
- **Impact:** Blocking modals interrupt flow; inconsistent with toast pattern used elsewhere
- **Fix:** Replace with toast notifications

### H-03: Missing Error Boundary Coverage
- **File:** `src/components/VideoEditor/VideoStudio.jsx` lines 101–115
- **Impact:** Only VideoEditorModal has error boundary. SlideshowEditor, BatchPipeline, LibraryBrowser crash without fallback UI
- **Fix:** Wrap all heavy components in error boundaries

### H-04: No Loading State for Video Rendering
- **File:** `src/components/VideoEditor/ContentLibrary.jsx` lines 49–95
- **Impact:** If render stalls, user sees loading forever with no cancel option or timeout
- **Fix:** Add 10-minute timeout + cancel button

### H-05: Stale Closure in Batch Rendering Loop
- **File:** `src/components/VideoEditor/PostingModule.jsx` lines 227–241
- **Impact:** If user edits video during batch rendering, wrong video object rendered
- **Fix:** Snapshot `postsNeedingRender` before loop

### H-06: Memory Leak — AudioContext Not Closed on Error
- **File:** `src/components/VideoEditor/AudioClipSelector.jsx` lines 63–89
- **Impact:** AudioContext accumulates on repeated waveform generation failures
- **Fix:** Close AudioContext in catch block

### H-07: Memory Leak — Blob URLs Never Revoked
- **File:** `src/components/VideoEditor/StudioHome.jsx` lines 261–262
- **Impact:** After 10–20 uploads, browser memory bloats
- **Fix:** Revoke blob URLs after upload completes

### H-08: localStorage Quota Not Handled
- **File:** `src/services/libraryService.js` lines 449–461
- **Impact:** Large libraries silently fail to save; data loss
- **Fix:** Catch `QuotaExceededError`, implement cleanup, propagate error to UI

### H-09: Missing Input Validation — Late API
- **File:** `api/late.js` lines 173–176
- **Impact:** `artistId` and `postId` used without validation
- **Fix:** Validate format with regex before use

### H-10: Firestore Batch Write — No Rollback
- **File:** `src/services/libraryService.js` lines 1513–1527
- **Impact:** Batch commit failure leaves localStorage and Firestore out of sync
- **Fix:** Roll back localStorage on batch failure

### H-11: Infinite Loop — Auto-Select Collection
- **File:** `src/components/VideoEditor/StudioHome.jsx` lines 196–213
- **Impact:** `useEffect` depends on `selectedCollection` while setting it — infinite re-renders
- **Fix:** Remove `selectedCollection` from dependency array

### H-12: Missing Image URL Validation (SlideshowEditor)
- **File:** `src/components/VideoEditor/SlideshowEditor.jsx` lines 282–288
- **Impact:** Null image URLs cause silent export failure
- **Fix:** Validate URLs before use, filter nulls

### H-13: Z-Index Conflicts
- **Files:** `VideoStudio.jsx:125` (z:10000), `ui/index.jsx:67` (z:100), `ui/index.jsx:244` (z:100)
- **Impact:** Modals can render behind overlays
- **Fix:** Centralize z-index scale in CSS variables

### H-14: No Focus Trap in Modals
- **Files:** All modal components except `ConfirmDialog`
- **Impact:** Tab key moves focus outside modal to background content
- **Fix:** Implement focus trap in modal wrapper

### H-15: Missing Escape Key Handlers
- **Files:** `AudioClipSelector.jsx` modals, `SaveToLibraryButton.jsx` modal
- **Impact:** Users can't close modals with keyboard
- **Fix:** Add `onKeyDown` Escape handler to all modal overlays

### H-16: Spotify Sync Partial Failures Hidden
- **File:** `src/services/spotifyService.js` lines 236–272
- **Impact:** Failed track syncs silently skipped; user sees incomplete data with no warning
- **Fix:** Track failures, return summary, show warning

### H-17: Date Parsing Vulnerability
- **File:** `src/services/spotifyService.js` lines 593–620
- **Impact:** Invalid date strings parsed without validation → NaN comparisons
- **Fix:** Validate ISO format before parsing

### H-18: Uncancelled Fetch on Unmount (SpotifyComponents)
- **File:** `src/components/Analytics/SpotifyComponents.jsx` lines 477–498
- **Impact:** setState on unmounted component → React warning, potential memory leak
- **Fix:** Add AbortController with cleanup in useEffect

---

## Medium Issues (22)

### M-01: Button Styling Inconsistency
50+ buttons use inline styles instead of the shared `<Button>` component. Creates maintenance burden and inconsistent hover/disabled states.

### M-02: Batch Schedule — No Past Date Validation
`src/App.jsx` lines 3968–4010: Users can schedule posts in the past.

### M-03: Campaign Creation — Start > End Date Allowed
`src/App.jsx` lines 5076–5184: No validation that start date is before end date.

### M-04: Template Name Collision
`src/App.jsx` lines 6060–6067: Duplicate category names can overwrite existing templates.

### M-05: Add Artist — No Uniqueness Check
`src/App.jsx` lines 5946–6023: Can create duplicate artists with same name.

### M-06: Post Selection Not Cleared on Artist Change
`src/App.jsx` line 600: `selectedPosts` Set persists across artist switches.

### M-07: Day Detail Drawer — Stale Data
`src/App.jsx` lines 7316–7416: Drawer shows deleted posts until manually closed.

### M-08: Sync Status Timeout Not Cancelled on Unmount
`src/App.jsx` lines 3828–3854: `setTimeout` continues after component unmounts.

### M-09: URL Sync Missing Pages
`src/App.jsx` lines 388–399: Intake, pricing pages have no URL representation; refresh → home.

### M-10: Account ID Type Mismatch
`src/App.jsx` lines 2125–2137: Late API returns mixed types for accountId (string vs. object).

### M-11: Inconsistent Empty States
Some components use `<EmptyState>` component, others use plain text, others show nothing.

### M-12: Missing Call-to-Action in Empty States
Upload zones show dashed borders but don't clearly state "Click or drag to upload."

### M-13: Inconsistent Loading Indicators
Custom spinners duplicate `<LoadingSpinner>` component with different sizes/styles.

### M-14: No Loading State for Post Scheduling API Calls
`ContentLibrary.jsx` lines 866–915: No spinner during scheduling; user can re-submit.

### M-15: Disabled Buttons Don't Explain Why
Multiple components disable buttons without tooltip or helper text explaining the condition.

### M-16: Excessive Console Logging in Production
22+ files contain unguarded `console.log` calls including API keys and user data.

### M-17: Missing `aria-label` on Icon Buttons
Emoji-only buttons (✎ rename, ✕ delete) have no screen reader text.

### M-18: No Keyboard Navigation for Tabs
Tab components don't support arrow key navigation or ARIA tab attributes.

### M-19: Mobile Responsive Inconsistencies
Mixed inline styles and Tailwind breakpoints; some components don't adapt.

### M-20: Type Coercion in Account ID Matching
`artistService.js` lines 423–450: String coercion hides type mismatches.

### M-21: Toast Timeout Not Cancelled on Unmount
`ui/index.jsx` lines 29–40: `setTimeout` leaks after ToastProvider unmounts.

### M-22: Missing useCallback Dependencies
`AudioClipSelector.jsx` lines 91–121: `generateWaveform` missing from useEffect deps.

---

## Low Issues (20)

### L-01: "Delete Account" Button Shows Toast Only
`src/App.jsx` lines 5902–5907: Suggests action but just says "Contact support."

### L-02: "View Details" Button in Campaigns — No Handler
`src/App.jsx` line 5061.

### L-03: "Download PDF" Button — No Handler
`src/App.jsx` line 6723. Dead code in unreachable page.

### L-04: "Record Cuts" Disabled Stub
`VideoEditorModal.jsx` line 2520: `disabled` with "Coming soon" title but no explanation.

### L-05: Login Email — No Format Validation Beyond Browser
`src/App.jsx` lines 6994–7003.

### L-06: App Session Saves for Dead "dashboard" Page
`src/App.jsx` lines 370–380: Saves session for page that redirects immediately.

### L-07: Onboarding Flag Never Expires
`src/App.jsx` lines 1108–1113: Shared browser → new operator misses onboarding.

### L-08: Video ID Collision in Batch Generation
`BatchPipeline.jsx` line 481: `Date.now()` in tight loop → duplicate IDs.

### L-09: Batch Slideshow — No Duration Estimate
`StudioHome.jsx` lines 1455–1490: Quantity selector with no time estimate.

### L-10: "Break" Button Label Ambiguous
`VideoEditorModal.jsx` line 2470: Could mean split, pause, or break apart.

### L-11: "Reroll" Button Label is Slang
`VideoEditorModal.jsx` line 2471: Non-obvious action for novice users.

### L-12: HTML Entities in Placeholder
`LyricEditor.jsx` line 354: `&#10;` renders literally in some browsers.

### L-13: Inconsistent Error Message Tone
Mix of technical ("clip data has expired") and casual ("Contact support") messages.

### L-14: Color Contrast — Gray on Dark Background
`AestheticHome.jsx` lines 1134, 1240: `#6b7280` may fail WCAG.

### L-15: Missing Error Boundary for SlideshowEditor
No crash fallback for slideshow creation flow.

### L-16: Race Condition in Spotify Config Load
`SpotifyComponents.jsx` lines 631–641: Rapid artist change → stale data.

### L-17: Hardcoded Operator/Conductor Emails
`utils/roles.js` lines 14–19, `App.jsx` lines 110–113: Should be env-only.

### L-18: File Type Validation — Client-Side Only
`firebaseStorage.js` lines 59–77: MIME type can be spoofed.

### L-19: Console Logs Expose API Activity
`api/late.js` lines 63–67: Logs API key lookups and user emails.

### L-20: Missing Rate Limiting on Spotify Proxy
`api/spotify.js`: No rate limit — token cache lost on cold start.

---

## Files Involved

| File | Issue Count |
|------|------------|
| `src/App.jsx` | 19 |
| `src/components/VideoEditor/VideoEditorModal.jsx` | 6 |
| `src/components/VideoEditor/StudioHome.jsx` | 5 |
| `src/components/VideoEditor/ContentLibrary.jsx` | 4 |
| `src/components/VideoEditor/BatchPipeline.jsx` | 4 |
| `src/components/VideoEditor/SlideshowEditor.jsx` | 2 |
| `src/components/VideoEditor/PostingModule.jsx` | 2 |
| `src/components/VideoEditor/VideoStudio.jsx` | 3 |
| `src/components/VideoEditor/AestheticHome.jsx` | 3 |
| `src/components/VideoEditor/AudioClipSelector.jsx` | 2 |
| `src/components/Analytics/AnalyticsDashboard.jsx` | 2 |
| `src/components/Analytics/SpotifyComponents.jsx` | 3 |
| `src/components/ui/index.jsx` | 3 |
| `src/services/libraryService.js` | 2 |
| `src/services/spotifyService.js` | 3 |
| `src/services/artistService.js` | 2 |
| `src/utils/roles.js` | 1 |
| `api/late.js` | 4 |
| `api/spotify.js` | 2 |
| `src/components/VideoEditor/ContentBankManager.jsx` | 1 |
