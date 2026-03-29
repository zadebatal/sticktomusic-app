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
npx react-grab@latest    # Visual element selector → describe changes to Claude Code (dev tool, not a dependency)
```

## Recent Work (82 sessions)
See `~/.claude/projects/.../memory/MEMORY.md` for full session timeline. Key milestones:
- Projects/Niches system (replaced Pipeline), 6 editors, template configurator
- Full Subframe→Tailwind conversion, mobile responsive, dark theme locked
- Automation engine (14 features), approval queue, auto-schedule
- Comprehensive E2E suite (205 passing tests)
- Codebase refactoring: App.jsx 7,684→6,307 lines, libraryService split into 4 files
- Full routing audit (27 fixes), architecture docs created

## Prime Directive
Don't break anything that works. Read before editing. Build-verify after each batch of changes.

## Bug Fix Protocol
When a bug is reported, **do not jump straight to fixing it**. Follow this order:
1. **Reproduce** — understand the exact steps and conditions
2. **Write a failing test** that reproduces the bug (unit test or E2E assertion)
3. **Fix the bug** — use subagents if the fix is non-trivial
4. **Verify** — the previously failing test now passes

This prevents regressions and proves the fix actually works.

## Plan Mode Discipline
**Enter plan mode for ANY non-trivial task** (3+ steps, multi-file changes, or architectural decisions). If something goes sideways mid-implementation, **STOP and re-plan immediately** — don't keep pushing through a broken approach.

## Pre-Deploy Checklist for Data Changes

**CRITICAL:** Before changing ANY function in `libraryService.js`, `scheduledPostsService.js`, or any Firestore path:

### 1. Impact Analysis
- [ ] Ran `grep -r "functionName" src/` to find all usages
- [ ] Ran `grep -r "doc(db.*oldPath" src/` to find all Firestore reads
- [ ] Ran `grep -r "collection(db.*oldPath" src/` to find all subscriptions
- [ ] Identified ALL files that will be affected by this change

### 2. Testing Requirements
- [ ] Tested with **empty data** (new user scenario)
- [ ] Tested with **existing data** (simulated old structure)
- [ ] Tested with **localStorage populated** but Firestore empty
- [ ] Tested with **Firestore populated** but localStorage empty
- [ ] Tested on test artist account (not production artist)

### 3. Migration Strategy
- [ ] Written migration for **old → new** (dual-path support)
- [ ] Migration preserves **ALL** existing data
- [ ] Migration runs BEFORE subscription overwrites localStorage
- [ ] Migration cleans up old data after successful copy
- [ ] Migration logs count of migrated items for monitoring

### 4. Deployment Plan
- [ ] Have explicit **rollback plan** (git revert command ready)
- [ ] Deploying on **Friday afternoon** (time to monitor over weekend)
- [ ] Tagged commit with **`[MIGRATION]`** prefix
- [ ] Phase 2 cleanup scheduled for 48 hours later

### 5. Commit Format
```
[MIGRATION] Brief description of what's changing

Phase 1: Add dual-path support for [feature]. Reads old path
(artists/{id}/old/path) first, migrates to new path
(artists/{id}/new/path), then deletes old. Preserves all data.
Phase 2 cleanup will deploy in 48 hours.

- Added: Migration logic in loadDataAsync()
- Changed: saveDataAsync() to use new path
- Tested: Empty data, existing data, localStorage fallback
- Rollback: git revert HEAD && git push
```

## Migration Workflow

See **[MIGRATIONS.md](./MIGRATIONS.md)** for detailed examples and patterns.

**Two-Phase Deploy (MANDATORY for breaking changes):**

### Phase 1 (Friday Week 1)
- Deploy code that works with BOTH old and new structures
- Migrate old data to new structure on first load
- Monitor for 48 hours

### Phase 2 (Friday Week 2)
- Remove old path code
- Clean implementation with only new structure

**NEVER deploy a breaking change without Phase 1 migration first.**

## Known Gotchas

### Firestore Subscriptions
- Run migration BEFORE subscribing to new path
- Only overwrite localStorage if Firestore has data OR localStorage is empty
- Check for blob URLs and replace with Firebase Storage URLs

### Non-Serializable Fields
- Firestore rejects: `File`, `Blob`, `localUrl` (blob URLs)
- Always clean before saving: `const { file, localUrl, ...clean } = obj`
- Upload blob URLs to Firebase Storage first, save permanent URL

### localStorage vs Firestore Priority
- **Write:** Always write to localStorage first (instant), then Firestore (async)
- **Read:** Check Firestore first (might have newer data from other device), fallback to localStorage
- **Subscribe:** Run migration first, then subscribe

## Friday Deployment Rule

Deploy risky changes on **Friday afternoon**:
- ✅ Weekend to monitor and fix issues
- ✅ Lower traffic for issues to surface
- ✅ Time to rollback before Monday
- ❌ Never deploy migrations on Monday-Thursday
