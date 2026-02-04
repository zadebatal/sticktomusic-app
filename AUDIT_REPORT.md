# StickToMusic Comprehensive Audit Report
**Date:** February 4, 2026
**Auditor Role:** Principal Engineer + Security Reviewer + Product/UI Reviewer

---

## Executive Summary (10 Key Points)

1. **🔴 CRITICAL: API Keys Exposed in Client Code** — Firebase config and Stripe key are hardcoded in App.jsx (visible to anyone inspecting source)
2. **🔴 CRITICAL: Legacy File Contains Exposed Secret** — `StickToMusic_Complete.jsx` contains hardcoded Late API key (`sk_935df1...`)
3. **🟠 HIGH: Monolithic App.jsx (~300KB)** — Single file handles auth, routing, API calls, and UI; maintenance nightmare
4. **🟠 HIGH: localStorage Stores Sensitive Session Data** — Unencrypted tokens/session state vulnerable to XSS
5. **🟡 MEDIUM: No Rate Limiting on API Proxy** — `/api/late` proxy could be abused for spam/cost attacks
6. **🟡 MEDIUM: Missing Input Validation** — User inputs (captions, filenames) not sanitized before storage/display
7. **🟢 GOOD: Proper Firebase App Initialization** — Prevents duplicate-app errors with `getApps()` check
8. **🟢 GOOD: Error Boundary Implemented** — `EditorErrorBoundary` prevents blank page crashes in editor
9. **🟢 GOOD: Vercel SPA Routing Configured** — `vercel.json` rewrites ensure client-side routing works
10. **🟢 WIN: Session State Persistence** — User workflow preserved across refreshes via localStorage

---

## Top 10 Issues (Prioritized)

### 1. 🔴 Hardcoded Firebase Config in Source Code
**File:** `src/App.jsx:47-54`
**Why it matters:** Firebase API key, project ID, and app ID are visible in client-side JavaScript. While Firebase security rules should protect data, exposed config enables enumeration attacks and abuse billing.
**Fix:** Move to environment variables using `process.env.REACT_APP_FIREBASE_*` (already set up in `.env.example`)

### 2. 🔴 Exposed Late API Secret Key
**File:** `StickToMusic_Complete.jsx:50`
**Why it matters:** Production API key `sk_935df1a3...` is committed to repo. Anyone can use this to post to your Late.co accounts.
**Fix:** Delete this file immediately (appears to be legacy). Verify key is rotated in Late.co dashboard.

### 3. 🔴 Stripe Publishable Key Hardcoded
**File:** `src/App.jsx:68`
**Why it matters:** While publishable keys are meant to be public, hardcoding prevents key rotation and environment separation.
**Fix:** Move to `process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY`

### 4. 🟠 Massive App.jsx File (~6000+ lines)
**File:** `src/App.jsx`
**Why it matters:** Single file handles authentication, routing, state management, API calls, and multiple UI views. Makes debugging, testing, and onboarding extremely difficult.
**Fix:** Extract into modules: `services/auth.js`, `services/lateApi.js`, `contexts/AuthContext.jsx`, `pages/*.jsx`

### 5. 🟠 localStorage Session Data Unencrypted
**File:** `src/components/VideoEditor/VideoStudio.jsx:90-116`
**Why it matters:** Session state including workflow data stored in plain localStorage. XSS vulnerability could leak user data.
**Fix:** Use sessionStorage for sensitive data, implement encryption wrapper, or move to secure cookies

### 6. 🟠 Hardcoded Operator Email Whitelist
**File:** `src/App.jsx:72` and `src/utils/roles.js:15`
**Why it matters:** Adding operators requires code deploy. Duplicated in two places (out of sync risk).
**Fix:** Store in Firestore with admin UI, or use Firebase custom claims

### 7. 🟡 No Rate Limiting on Late API Proxy
**File:** `api/late.js`
**Why it matters:** Proxy passes through requests without limits. Attacker could spam Late.co API, causing billing issues or account suspension.
**Fix:** Add Vercel Edge rate limiting or implement token bucket in serverless function

### 8. 🟡 Hardcoded Late Account ID Mapping
**File:** `src/App.jsx:82-91`
**Why it matters:** Adding/removing social accounts requires code changes. IDs are exposed in client bundle.
**Fix:** Fetch accounts dynamically from Late.co API (already have `fetchAccounts` function)

### 9. 🟡 Missing XSS Sanitization on Captions
**File:** Multiple components
**Why it matters:** User-entered captions/text are rendered without sanitization. Malicious input could execute scripts.
**Fix:** Use DOMPurify or React's built-in escaping consistently; validate inputs server-side

### 10. 🟡 Console.log Statements in Production
**File:** Multiple (`App.jsx:137`, `VideoStudio.jsx:95-96`)
**Why it matters:** Debug logs expose internal state, slow performance, clutter browser console.
**Fix:** Remove or wrap in `process.env.NODE_ENV === 'development'` check

---

## Security Findings Table

| Severity | Finding | File:Line | CVSS | Remediation |
|----------|---------|-----------|------|-------------|
| CRITICAL | Exposed Late API secret key | StickToMusic_Complete.jsx:50 | 9.1 | Delete file, rotate key |
| HIGH | Firebase config in source | App.jsx:47-54 | 6.5 | Move to env vars |
| HIGH | Stripe key hardcoded | App.jsx:68 | 5.0 | Move to env vars |
| HIGH | localStorage sensitive data | VideoStudio.jsx:90-116 | 6.0 | Encrypt or use secure storage |
| MEDIUM | No API rate limiting | api/late.js | 5.5 | Add rate limiter |
| MEDIUM | Hardcoded operator emails | App.jsx:72, roles.js:15 | 4.0 | Move to database |
| MEDIUM | Missing input sanitization | Multiple | 5.5 | Add DOMPurify |
| LOW | Debug console.logs | Multiple | 2.0 | Remove/condition |
| LOW | No CSP headers | vercel.json | 3.0 | Add security headers |

---

## UI/UX Tickets (Prioritized)

### P0 - Critical User Experience
1. **Mobile Responsiveness Not Verified** — Test and fix touch targets, layouts on iOS/Android
2. **No Loading States for Batch Operations** — "Make 10" shows no progress, users don't know if it's working
3. **Error Messages Are Technical** — "Failed: 401" should be "Please log in again"

### P1 - High Impact
4. **Slideshow Library Empty State Confusing** — No guidance on how to create first slideshow
5. **Browser Back Button Can Lose Work** — No "unsaved changes" warning when navigating away from editor
6. **Video Export Progress Hidden** — FFmpeg conversion shows no progress indicator

### P2 - Medium Impact
7. **Category Names Truncated on Small Screens** — Need responsive text or tooltips
8. **Delete Confirmation Too Easy to Click** — Red button next to Edit; needs spacing or different position
9. **No Keyboard Shortcuts Documented** — Power users have no way to discover hotkeys
10. **Scheduling Calendar Hard to Use** — Time picker needs better UX for quick selection

---

## Refactor/Architecture Tickets

### Immediate (Sprint 1)
1. **Extract AuthContext** — Move auth state from App.jsx to dedicated context provider
2. **Create LateApiService** — Extract lines 94-200 from App.jsx into `services/lateApi.js`
3. **Delete Legacy Files** — Remove `StickToMusic_Complete.jsx` (contains secrets, appears unused)

### Near-term (Sprint 2-3)
4. **Split App.jsx into Pages** — Create `pages/Login.jsx`, `pages/ArtistDashboard.jsx`, `pages/OperatorDashboard.jsx`
5. **Implement React Query** — Replace manual fetch/state with proper data fetching library
6. **Add TypeScript** — Start with new files, gradually migrate for type safety

### Long-term (Quarter)
7. **State Management Review** — Evaluate Zustand/Jotai vs current useState sprawl
8. **Component Library** — Extract shared UI components to `/components/ui` (partially done)
9. **API Layer Abstraction** — Create unified API client with retry, caching, error handling

---

## Performance Opportunities

| Opportunity | Impact | Effort | Priority |
|-------------|--------|--------|----------|
| Code split App.jsx (reduce initial bundle) | HIGH | MEDIUM | P0 |
| Lazy load FFmpeg.wasm (load on-demand) | HIGH | LOW | P0 |
| Memoize expensive renders in VideoStudio | MEDIUM | LOW | P1 |
| Virtualize long lists (Content Library) | MEDIUM | MEDIUM | P1 |
| Image optimization (WebP, lazy loading) | MEDIUM | LOW | P1 |
| Prefetch Late.co accounts on login | LOW | LOW | P2 |
| Service worker for offline support | LOW | HIGH | P3 |

---

## Test Plan

### Unit Tests (Jest + React Testing Library)
- [ ] `storageService.js` — Test load/save/cleanup functions
- [ ] `roles.js` — Test `isUserOperator` with various emails
- [ ] `status.js` — Test VIDEO_STATUS constants and helpers
- [ ] `lateApi` functions — Mock fetch, test success/error paths

### Integration Tests
- [ ] Auth flow — Login, logout, session persistence
- [ ] Category CRUD — Create, update, delete categories
- [ ] Video generation — Single video creation flow
- [ ] Batch generation — 10 videos/slideshows creation
- [ ] Slideshow editor — Slide management, reroll, export

### E2E Tests (Playwright/Cypress)
- [ ] Artist journey — Login → View content → Logout
- [ ] Operator journey — Login → Studio → Create video → Schedule → Verify in Late.co
- [ ] Mobile flow — Same journeys on mobile viewport

### Security Tests
- [ ] XSS injection in caption fields
- [ ] CSRF protection on API endpoints
- [ ] Auth bypass attempts
- [ ] Rate limit testing on `/api/late`

---

## Patch Suggestions (Top 3 Issues)

### Patch 1: Move Firebase Config to Environment Variables

**File:** `src/App.jsx`

```diff
- // Firebase configuration
- const firebaseConfig = {
-   apiKey: "AIzaSyDIw9xCnMVpDHW36vyxsNtwvmOfVlIHa0Y",
-   authDomain: "sticktomusic-c8b23.firebaseapp.com",
-   projectId: "sticktomusic-c8b23",
-   storageBucket: "sticktomusic-c8b23.firebasestorage.app",
-   messagingSenderId: "621559911733",
-   appId: "1:621559911733:web:4fe5066433967245ada87c"
- };
+ // Firebase configuration from environment variables
+ const firebaseConfig = {
+   apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
+   authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
+   projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
+   storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
+   messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
+   appId: process.env.REACT_APP_FIREBASE_APP_ID
+ };
```

**Then create `.env.local`:**
```bash
REACT_APP_FIREBASE_API_KEY=AIzaSyDIw9xCnMVpDHW36vyxsNtwvmOfVlIHa0Y
REACT_APP_FIREBASE_AUTH_DOMAIN=sticktomusic-c8b23.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=sticktomusic-c8b23
REACT_APP_FIREBASE_STORAGE_BUCKET=sticktomusic-c8b23.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=621559911733
REACT_APP_FIREBASE_APP_ID=1:621559911733:web:4fe5066433967245ada87c
```

---

### Patch 2: Delete Legacy File with Exposed Secret

**Action:** Delete `StickToMusic_Complete.jsx`

```bash
rm StickToMusic_Complete.jsx
```

**Then in Late.co Dashboard:**
1. Go to Settings → API Keys
2. Revoke key starting with `sk_935df1a3...`
3. Generate new key
4. Add to Vercel environment variables as `LATE_API_KEY`

---

### Patch 3: Move Stripe Key to Environment Variable

**File:** `src/App.jsx`

```diff
- // Stripe Configuration
- const STRIPE_PUBLISHABLE_KEY = 'pk_live_51SwClT6Yzynsfn3ImqR6SMOHy1EgQoTeQ7o7i3iMBRWSTTaYo2WrIq6G5ZpOMrhGCmEwuKc9mpKFMZXKFn9TLfUv00lfBRoJyl';
+ // Stripe Configuration
+ const STRIPE_PUBLISHABLE_KEY = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
```

**Add to `.env.local`:**
```bash
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_live_51SwClT6Yzynsfn3ImqR6SMOHy1EgQoTeQ7o7i3iMBRWSTTaYo2WrIq6G5ZpOMrhGCmEwuKc9mpKFMZXKFn9TLfUv00lfBRoJyl
```

---

## Summary

**Total Issues Found:** 28
**Critical (Fix Immediately):** 3
**High (This Sprint):** 4
**Medium (Backlog):** 12
**Low (Nice to Have):** 9

**Estimated Effort for Critical Fixes:** 2-4 hours
**Estimated Effort for High Priority:** 1-2 days

The most urgent action is deleting `StickToMusic_Complete.jsx` and rotating the exposed Late API key. The Firebase and Stripe keys should also be moved to environment variables today.
