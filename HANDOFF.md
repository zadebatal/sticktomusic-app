# StickToMusic — Comprehensive Handoff Document

> Use this document to give Claude (mobile or desktop) full context on the StickToMusic project for brainstorming, debugging, or planning sessions.

---

## What Is StickToMusic?

StickToMusic is a **professional music content creation and distribution platform**. It enables music operators (managers/labels) and artists to:

1. **Create content** — Build videos and slideshows from raw media (clips, photos, audio) using 4 different editors
2. **Organize work** — Group content into Projects and Niches with media banks, text banks, caption banks, hashtag banks
3. **Schedule distribution** — Batch-schedule posts to TikTok, Instagram, YouTube, and Facebook via Late.co API
4. **Track performance** — Analytics dashboard with per-artist metrics and calendar views

### Who Uses It

| Role | What They Do | Example |
|------|-------------|---------|
| **Conductor** (super admin) | Manages operators, sees all artists, system config | *(set via REACT_APP_CONDUCTOR_EMAILS)* |
| **Operator** (manager) | Manages assigned artists, creates content, schedules posts | *(set via allowedUsers in Firestore)* |
| **Artist** | Views own dashboard, studio, schedule | *(linked via allowedUsers.linkedArtistId)* |
| **Collaborator** | Read-only access to linked artist | (same as artist, limited writes) |

### The Core Workflow

1. **Operator creates a Project** (e.g., "Boon Summer Campaign")
2. **Adds Niches** inside the project (e.g., "TikTok Clips", "Instagram Slideshows", "Reels")
3. **Uploads media** into Niche media banks (organized by category — "Live Footage", "Studio Shots", etc.)
4. **Opens an editor** — picks media from banks → creates video/slideshow → saves as draft
5. **Schedules the draft** — picks platforms, sets date/time, writes caption → exported to Late.co
6. **Late.co posts it** — content goes live on social platforms automatically

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.2 (Create React App), Tailwind CSS + Subframe component library |
| Database | Firebase Firestore (real-time sync) |
| Auth | Firebase Auth (Google + email/password sign-in) |
| Storage | Firebase Storage (media files) + localStorage (instant cache) |
| Hosting | Vercel (auto-deploys on `git push` to `main`) |
| Social API | Late.co (TikTok, Instagram, YouTube, Facebook posting) |
| Payments | Stripe (integration ready, not yet active) |
| Serverless | Vercel Functions (`/api/*`) — Late proxy, Stripe webhooks, Whisper transcription |
| Testing | Playwright (205+ E2E tests) |

---

## Architecture Overview

### Data Flow

```
User Action
  → React Component (inline state)
  → libraryService.js (localStorage write — instant)
  → Firestore write (background, async)
  → Firestore subscription fires (other tabs/devices update)
```

### Multi-Artist Isolation

ALL data is namespaced by `artistId`. Every Firestore path includes the artist:
- `artists/{artistId}/library/data/collections/{collectionId}` — projects/niches
- `artists/{artistId}/library/data/mediaItems/{mediaId}` — media files
- `artists/{artistId}/library/data/createdContent/{contentId}` — drafts/exports
- `artists/{artistId}/scheduledPosts/{postId}` — scheduled posts
- `artistSecrets/{artistId}` — API keys (server-only, no client access)

localStorage keys are also namespaced: `stm_collections_{artistId}`, `stm_library_{artistId}`, etc.

### Dual-Layer Storage (The Big Pattern)

Every data write follows this pattern:
1. **Write to localStorage first** → instant UI update, no latency
2. **Write to Firestore in background** → persistence across devices
3. **Firestore subscription** → syncs other tabs/devices in real-time
4. **Safety guards** → prevent subscription from overwriting newer localStorage data

This pattern is throughout `libraryService.js` and its domain modules (`createdContentService.js`, `lyricsService.js`).

---

## Project/Niche/Bank Data Model

### Hierarchy

```
Project (isProjectRoot: true)
├── Niche 1 (isPipeline: true, projectId, contentType: 'video')
│   ├── Media Banks: [{ id, name, mediaIds }]  (up to 6 named banks)
│   ├── Text Banks: [[], [], ...]  (text overlays per slide position)
│   ├── Caption Bank: string[]  (reusable captions)
│   ├── Hashtag Bank: string[]  (reusable hashtags)
│   ├── Templates: [{ id, name, settings }]  (named editor configs)
│   └── Drafts (createdContent linked by collectionId)
├── Niche 2 (contentType: 'slideshow')
│   ├── Slide Banks: [[], [], ...]  (media per slide position, dynamic count)
│   └── ...
└── Niche 3 (contentType: 'upload')
    └── Finished media (uploaded, not edited)
```

### Dynamic Banks (Slide Positions)

Banks replaced the old hardcoded A/B/C/D system with unlimited numbered positions:
- `collection.banks = [[], [], ...]` — array of media ID arrays, one per slide
- `collection.textBanks = [[], [], ...]` — text strings per slide
- Minimum 2 banks, max 10, users add via "+ Add Slide Bank"
- Colors rotate: indigo → green → purple → rose → amber → cyan
- Labels: "Slide 1", "Slide 2", etc.

### Media Banks (Named Categories)

For video niches, media is organized into named banks:
- `niche.mediaBanks = [{ id, name, mediaIds }]` — up to 6 named banks
- Examples: "Live Footage", "Studio Shots", "B-Roll"
- Color-coded headers, inline rename, per-bank upload buttons
- Editor can filter by selected media banks

---

## The 5 Editors

### 1. SlideshowEditor
- Multi-slide creator with timeline
- Each slide: background image + text overlay (position, style, font)
- Audio track with waveform visualization
- Dynamic banks feed slide images
- Text banks feed overlay text
- Multi-generation: create N variations in one session (Fisher-Yates shuffle)
- Supports: TikTok Sans font, multi-line text, text stroke, ALL CAPS
- Export: Canvas-based rendering → MP4

### 2. SoloClipEditor
- Single video with effects
- Text overlays with positioning
- Audio trimming
- Beat sync (BPM detection + BeatSelector)
- Cut by word / cut by beat

### 3. MultiClipEditor
- Multiple clips on a timeline
- Transitions between clips
- Beat sync + reroll
- Cut by word / cut by beat
- "Add N to Timeline" batch operation

### 4. PhotoMontageEditor
- Photo grid → video with Ken Burns zoom effect
- Music sync with waveform
- Color-coded media banks
- Multi-generation support

### 5. ClipperEditor
- FFmpeg stream-copy (no re-encoding)
- Mark in/out points on source video
- Keyboard shortcuts for marking
- Multi-track timeline (Clips + Source tracks)
- Red playhead

### Shared Editor Infrastructure

All editors share:
- **EditorShell** — flex layout (sidebar, canvas, panels)
- **EditorTopBar** — title, save/cancel/export buttons
- **EditorFooter** — status, "Save All", last-saved timestamp
- **useCollapsibleSections** — sidebar section expand/collapse
- **useEditorSessionState** — persist UI state to localStorage
- **useUnsavedChanges** — warn on navigate-away if unsaved
- **useMediaMultiSelect** — rubber-band drag, shift-click range, Select All
- **TemplateConfigurator** — named templates with format-specific settings

---

## Scheduling System

### Batch-First Design

The scheduling page is designed around **batch operations**:
1. Select many drafts (checkboxes)
2. Assign shared account + platforms (TikTok, Instagram, YouTube, Facebook)
3. Set cadence (posts per day, spacing mode: even/fixed/random)
4. Preview projected schedule
5. "Schedule Selected" → applies times to all selected posts

### Three-Tier Hashtag System
1. **Always-on** — from niche templates, auto-included
2. **Campaign/batch** — applied to all selected posts
3. **Per-post overrides** — individual post customization

### Post Lifecycle
```
Draft → Scheduled → Posting → Posted (or Failed)
```

### Late.co Integration (Secure Proxy)
- Client calls `/api/late.js` (Vercel serverless function)
- Function reads API key from `artistSecrets/{artistId}` (Firestore, server-only)
- Proxies request to Late.co API
- Returns response to client
- **API keys NEVER exposed to browser**

### Supported Platforms
- **TikTok** — sends to Creator Inbox (draft mode, user adds music/effects)
- **Instagram** — direct scheduling (Reels, Posts, Stories)
- **YouTube** — direct scheduling (Shorts, Videos)
- **Facebook** — direct scheduling (Reels, Posts)

---

## Navigation & Routing

### URL Structure (No React Router)

App uses state-based navigation with `location.pathname`:

**Operator routes:**
- `/operator/pages` — PagesTab (unified social accounts)
- `/operator/studio` — VideoStudio (projects → niches → editors)
- `/operator/schedule` — SchedulingPage
- `/operator/analytics` — AnalyticsDashboard
- `/operator/artists` — ArtistsManagement
- `/operator/settings` — SettingsTab

**Artist routes:**
- `/artist/dashboard` — ArtistDashboard
- `/artist/studio` — VideoStudio (own projects only)
- `/artist/schedule` — SchedulingPage (own posts only)
- `/artist/analytics` — AnalyticsDashboard (own metrics)
- `/artist/settings` — SettingsTab

**Important routing gotcha:** `setCurrentView()` in VideoStudio must detect URL context (`/artist/` vs `/operator/`) dynamically. Hardcoding `/operator/studio/*` breaks artist accounts.

### AppShell (Post-Login)
5-tab navigation:
- Desktop: sidebar with icons + labels
- Mobile: bottom tab bar (44px min touch targets)
- Tabs vary by role (operators see "Pages" + "Artists", artists don't)

---

## Key Services (Quick Reference)

| Service | Purpose | Lines |
|---------|---------|-------|
| `libraryService.js` | Collections, projects, niches, media, banks, content CRUD | 5,043 |
| `scheduledPostsService.js` | Scheduled posts CRUD, batch create, reorder | ~800 |
| `lateService.js` | Late.co key management, connection status | ~200 |
| `firebaseStorage.js` | File upload/download with progress + quota | ~400 |
| `slideshowExportService.js` | Canvas-based slideshow → MP4 rendering | ~600 |
| `videoExportService.js` | FFmpeg-based video generation | ~500 |
| `artistService.js` | Artist CRUD + real-time subscriptions | ~300 |
| `contentTemplateService.js` | Caption/hashtag template banks | ~200 |
| `settingsService.js` | User preferences (theme, etc.) | ~150 |
| `postStatusPolling.js` | Poll Late.co for post status updates | ~200 |

---

## Serverless API Routes (`/api/*`)

| Route | Purpose |
|-------|---------|
| `/api/late.js` | Secure proxy to Late.co (posting, accounts, profiles) |
| `/api/create-checkout.js` | Stripe checkout session |
| `/api/stripe-webhook.js` | Stripe payment webhooks |
| `/api/cancel-subscription.js` | Subscription cancellation |
| `/api/whisper.js` | Audio transcription (Whisper AI) |
| `/api/caption-generator.js` | AI-generated captions |
| `/api/web-import.js` | Import media from URLs |
| `/api/spotify.js` | Spotify audio analysis |
| `/api/song-recognize.js` | Audio fingerprinting |

---

## Firestore Security Rules

Role-based access enforced at database level:
- **Conductor**: Full read/write on everything
- **Operator**: Read/write on assigned artists only
- **Artist/Collaborator**: Read/write on own linked artist only
- **Public**: Can submit applications (allowedUsers create)
- **Server-only**: `artistSecrets`, `spotifySnapshots`, `growthEvents`, `postAttributions`

---

## UI Framework

### Subframe Component Library
45+ components (Button, IconButton, ToggleGroup, Dialog, etc.) built on Radix UI primitives with Tailwind CSS.

### CRITICAL: Inverted Neutral Scale
Subframe's Tailwind preset uses an **inverted** neutral scale for dark theme:
- `neutral-0` = darkest (rgb(10,10,10)) — use for black surfaces
- `neutral-50` = very dark — use for page backgrounds
- `neutral-100` = dark surface — use for input/card backgrounds
- `neutral-200` = borders — use for dividers
- `neutral-400` = muted text
- `neutral-800/900` = NEAR WHITE — **NEVER use for dark backgrounds**

Rule: `bg-neutral-50/100` for surfaces, `border-neutral-200` for borders, `hover:bg-neutral-200` for hover.

### Theme System
Three themes: `dark`, `bright`, `saintLaurent` (currently locked to dark).
Token map: `theme.bg.page`, `theme.bg.surface`, `theme.text.primary`, `theme.accent.primary`.

---

## Known Issues & Active Bugs

### localStorage Quota Exceeded
- Boon artist has 292 media items → localStorage is full (5MB limit)
- `saveCollections()` silently fails when quota exceeded
- Affects all writes, not just batch delete
- **Needs long-term fix**: reduce localStorage payload, move to IndexedDB, or paginate

### Batch Delete Projects (Partially Fixed)
- Multi-select checkboxes + batch action bar implemented
- Delete calls Firestore `deleteDoc` directly (bypasses library wrappers)
- Frees localStorage space before writing cleaned data
- May still have issues due to localStorage quota — needs verification

### Firestore Subscription Race Conditions
- Subscriptions can overwrite local changes if they fire before async write completes
- Mitigated by: `pendingDeletionIds` (persistent, 5-min TTL), `recentCollectionSnapshots` guard, 2-minute TTL on safety guard preservation

---

## Test Accounts

| Email | Role | Linked Artist |
|-------|------|--------------|
| *(conductor email)* | Conductor | (all artists) |
| *(operator email)* | Operator | Timmy Skelly, Pertinence |
| *(artist email)* | Artist | Boon |
| *(artist email)* | Artist | Pertinence |
| *(artist email)* | Artist | Timmy Skelly |
| *(artist email)* | Artist | Camylio |

> **Credentials are provided separately via secure channel. Never commit passwords to the repository.**

---

## Build & Deploy

```bash
npm start                    # Dev server (port 3000)
PORT=3001 npm start          # Alt port for testing
npx react-scripts build      # Production build
npx playwright test           # Run E2E tests (205+ tests)
git push                     # Auto-deploys to Vercel (sticktomusic.com)
```

---

## File Map (Key Files)

| File | Lines | Purpose |
|------|-------|---------|
| `src/App.jsx` | ~6,300 | Auth, routing, artist loading, theme |
| `src/components/VideoEditor/VideoStudio.jsx` | ~3,300 | Studio router, editor modal dispatch |
| `src/components/VideoEditor/ProjectLanding.jsx` | ~800 | Project grid, new project wizard |
| `src/components/VideoEditor/ProjectWorkspace.jsx` | ~600 | Niche navigator + template config |
| `src/components/VideoEditor/SlideshowEditor.jsx` | ~2,500 | Multi-slide editor |
| `src/components/VideoEditor/SchedulingPage.jsx` | ~1,500 | Batch scheduler |
| `src/services/libraryService.js` | ~3,300 | Core data CRUD (collections, banks, projects) |
| `src/services/createdContentService.js` | ~650 | Draft/content CRUD + Firestore sync |
| `src/services/lyricsService.js` | ~210 | Lyrics CRUD + Firestore sync |
| `src/services/thumbnailService.js` | ~170 | Thumbnail migration utilities |
| `src/components/ContentLibrary/ContentLibrary.jsx` | ~1,200 | Drafts view |
| `src/components/AppShell.jsx` | ~400 | Post-login nav |
| `firestore.rules` | ~160 | Security rules |

---

## What's Next / Open Questions for Brainstorming

1. **localStorage quota crisis** — Boon's 292 media items exceed 5MB. Options: IndexedDB, paginated localStorage, reduce payload size, cloud-only mode?

2. **Batch delete verification** — Last fix pushed but unconfirmed. The localStorage quota is the root cause.

3. **Content pipeline optimization** — How to streamline the create → schedule → post workflow? Fewer clicks?

4. **Analytics depth** — Currently basic. What metrics matter most for music artists? Engagement rates? Growth tracking?

5. **Multi-generation UX** — Creating N variations works but the UX for reviewing/selecting the best ones could improve.

6. **Mobile experience** — Responsive layouts exist but full mobile content creation is limited. Worth investing in?

7. **AI features** — Whisper transcription exists. What other AI features would help? Auto-captions? Content suggestions? Trend analysis?

8. **Pricing/monetization** — Stripe is wired but not actively collecting. When to flip the switch?

---

## Session History (77 Sessions)

The app has been built over 77+ sessions. Key milestones:
- Sessions 1-7: Core features, bug fixes, theme system
- Sessions 8-12: 31-ticket batch, dynamic banks, PagesTab
- Sessions 13-17: Onboarding, mobile responsiveness, Firestore sync
- Sessions 18-31: Editor features, cloud import, Late.co, analytics
- Sessions 32-46: Video editor overhaul, UI reskin (Subframe), slideshow features
- Sessions 47-54: Subframe conversion, pipeline redesign, full audit
- Sessions 55-62: Editor unification, shared hooks, multi-video generation
- Sessions 63-66: Projects/Niches system, template configurator, dead code cleanup
- Sessions 67-72: Upload finished media, Clipper editor, generation flow, preview cleanup
- Sessions 73-78: E2E testing (205+ tests), dogfood fixes, routing bugs, batch delete

---

*Updated 2026-03-05. This document reflects the current state of the StickToMusic codebase.*
