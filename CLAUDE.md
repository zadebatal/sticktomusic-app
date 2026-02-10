# StickToMusic Project Context

## Owner
- **Name**: Zade
- **Email**: zadebatal@gmail.com
- **Role**: Conductor (super admin)

## Tech Stack
- **Frontend**: React 18.2 (Create React App), inline styles throughout (dark theme)
- **Database**: Firebase Firestore
- **Auth**: Firebase Auth (Google sign-in)
- **Hosting**: Vercel (auto-deploys on git push)
- **Storage**: Namespaced localStorage + Firestore dual-layer
- **APIs**: Late.co (social posting), Stripe (payments)

## Architecture

### Multi-Artist System
Each artist has isolated data stored in Firestore (`artists` collection) with namespaced localStorage.

### Key Components
- **App.jsx** (~3000 lines) — Auth, routing, artist data loading, theme provider
- **VideoStudio.jsx** — Main studio shell, video editor, cascade delete on draft removal
- **SlideshowEditor.jsx** — Multi-generation slideshow editor with timeline, text overlays, audio, dynamic banks, apply-template-to-all
- **LibraryBrowser.jsx** — Media library + collection management with drag-drop bank columns
- **StudioHome.jsx** — Studio landing, batch generation, bank selector ("Pull From")
- **SchedulingPage.jsx** — Post scheduler with ghost draft detection (orphan badges), lock/unlock
- **ContentLibrary.jsx** — Drafts view with CTAs, "Already Scheduled" section, reverse-chrono sort
- **LandingPage.jsx** — Marketing page (hero, features, pricing, auth modal)
- **AppShell.jsx** — Post-login nav with 5 tabs (Pages, Studio, Schedule, Analytics, Settings)

### Key Services
- `libraryService.js` — localStorage + Firestore dual-layer for media, collections, banks
- `scheduledPostsService.js` — CRUD for scheduled posts, cascade delete by contentId
- `slideshowExportService.js` — Canvas-based export with textTransform + textStroke
- `lateService.js` — Social media API integration
- `whisperService.js` — AI transcription (fully implemented)

## Dynamic Bank System (CURRENT)
Banks are dynamic arrays, NOT hardcoded A/B/C/D:
- `collection.banks = [[], [], ...]` — array of media ID arrays, one per slide position
- `collection.textBanks = [[], [], ...]` — text strings per slide position
- Minimum 2 banks, users add more via "+ Add Slide Bank" (max 10)
- `migrateCollectionBanks(collection)` auto-converts old bankA/B/C/D format on load
- `getBankColor(index)` — rotating 6-color palette (indigo, green, purple, rose, amber, cyan)
- `getBankLabel(index)` — returns "Slide 1", "Slide 2", etc.
- `assignToBank(artistId, colId, mediaIds, bankIndex)` — 0-based numeric index
- `selectedSource` in SlideshowEditor uses format `'bank_0'`, `'bank_1'`, `'colId:bank_0'`

## Theme System
Three themes via ThemeContext: `dark`, `bright`, `saintLaurent`. Persisted to localStorage. Components use `theme.bg.*`, `theme.text.*`, `theme.accent.*` for inline styles.

## Environment Variables

### Client-side (set in Vercel AND .env.local for dev)
- `REACT_APP_FIREBASE_API_KEY`
- `REACT_APP_FIREBASE_AUTH_DOMAIN`
- `REACT_APP_FIREBASE_PROJECT_ID`
- `REACT_APP_FIREBASE_STORAGE_BUCKET`
- `REACT_APP_FIREBASE_MESSAGING_SENDER_ID`
- `REACT_APP_FIREBASE_APP_ID`
- `REACT_APP_STRIPE_PUBLISHABLE_KEY`
- `REACT_APP_CONDUCTOR_EMAILS`

### Server-side ONLY (set in Vercel, NEVER in code)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `LATE_API_KEY`

## Build & Deploy
```bash
npm start                # Dev server (port 3000)
PORT=3001 npm start      # Test build on alternate port
npx react-scripts build  # Production build
git push                 # Auto-deploys to Vercel
```

## Recent Work (9 sessions)
1. Theme system + ThemeContext (dark/bright/saintLaurent)
2. Landing page + AppShell with 5-tab navigation
3. Artist data isolation fixes
4. 25+ bug fixes across 5 waves
5. 31-ticket feature batch: scheduler integrity, audio/lyric workflow, slideshow UX (ALL CAPS, text stroke, resize handles), drafts flow, multi-generation
6. Dynamic bank refactor: A/B/C/D → unlimited numbered slide banks

## Prime Directive
Don't break anything that works. Read before editing. Build-verify after each batch of changes.
