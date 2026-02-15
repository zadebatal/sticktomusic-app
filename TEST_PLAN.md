# StickToMusic — Test Plan

> 20 critical flows that must pass after every UI change.
> Run manually in browser at `localhost:3000` after each redesign slice.
> Last updated: 2026-02-15

---

## How to Use

After every slice of the Subframe redesign:
1. `npm start` (dev server)
2. Run through all 20 flows below
3. Mark each as PASS / FAIL / SKIP in `CHANGELOG_UI.md`
4. If any flow FAILS, fix before merging

---

## Critical Flows

### AUTH & ROUTING

**T01 — Google Sign-In → Landing to App**
1. Visit app logged out → LandingPage renders
2. Click "Get Started" → auth modal appears
3. Sign in with Google → redirects to AppShell
4. Correct tab active (Pages for artist, Studio for operator)
5. Artist selector shows correct artist(s)

**T02 — Role-Based Access**
1. Log in as conductor → sees Artists tab + Content tab + all artists
2. Log in as operator → sees only assigned artists
3. Log in as artist → sees only own artist, no Artists tab
4. Paywall blocks non-exempt users without subscription

### NAVIGATION

**T03 — Sidebar Navigation**
1. Click each tab (Pages, Studio, Schedule, Analytics, Settings)
2. Active tab highlighted, content changes
3. Artist dropdown switches artist context
4. All pages reload data for new artist
5. Mobile: bottom tabs work, correct icons

### PAGES

**T04 — Pages Tab: View & Connect Accounts**
1. Navigate to Pages → stats cards render (Total Accounts, Handles, Platforms)
2. Expand artist section → handle groups appear
3. Expand handle → Late pages + manual entries visible
4. Click "Connect" → opens Late OAuth URL in new tab
5. "Sync All" → refreshes Late pages

**T05 — Pages Tab: Add Manual Accounts**
1. Click "+ Add Accounts" → BulkAccountEntry modal opens
2. Enter handle + toggle platforms → password fields appear
3. Click "Add Another" → new row
4. Click "Done" → accounts saved, modal closes
5. New accounts appear in handle list with "Manual" badge

### STUDIO

**T06 — Pipeline Create → Workspace → Generate**
1. Navigate to Studio → PipelineListView renders
2. Click "New Pipeline" → CreatePipelineModal opens
3. Enter name, select page, pick format (Hook+Lyrics) → "Create Pipeline"
4. Pipeline appears in list with amber status
5. Click pipeline → PipelineWorkspace opens (3 panels)
6. Upload images → appear in media pool
7. Drag image to Hook bank → colored dot appears on image
8. Add text to Lyrics bank → entry appears
9. Set generate count to 3 → click "Generate"
10. 3 slideshows created → drafts counter updates

**T07 — Slideshow Editor: Create & Edit**
1. Open existing slideshow in editor → slides render
2. Add text overlay → text appears on canvas
3. Change font, color, size → preview updates
4. Add audio → player bar appears, progress bar works
5. Play/pause → audio plays, progress bar moves
6. Undo (Cmd+Z) → last change reverts
7. Save → returns to content library, slideshow persisted

**T08 — Slideshow Editor: Generate from Banks**
1. Open editor with collection/pipeline banks populated
2. Select source bank → images preview in sidebar
3. Set generate count to 5, keep text = "all"
4. Click "Generate" → 5 tabs appear
5. Switch tabs → each has different images, same text
6. Reroll image → new random image from bank
7. Reroll text → new random text from text bank

**T09 — Slideshow Editor: Multi-Draft**
1. Select 3+ slideshows in ContentLibrary
2. Click "Edit N in Editor" → editor opens with tabs
3. Switch between tabs → each draft independent
4. Apply Audio to All → all tabs get same audio
5. Remove Audio from All → all tabs cleared
6. Save All → all drafts saved, returns to library

**T10 — Content Library: Filter, Select, Delete**
1. Navigate to Drafts → content cards render
2. Filter by Draft/Completed/Approved → list updates
3. Select 3 items → batch bar appears
4. Click "Delete Selected" → confirm dialog → items removed
5. Check scheduled posts cascade-deleted too

### SCHEDULE

**T11 — Schedule: Add Drafts & Batch Schedule**
1. Navigate to Schedule → page loads (no infinite loop!)
2. Click "+" → AddFromDraftsModal opens
3. Select drafts → create scheduled posts
4. Posts appear in list with DRAFT status
5. Select 5 posts → batch bar appears
6. Pick account, set posts-per-day, spacing, start date
7. Click "Schedule N Posts" → times assigned, status = SCHEDULED

**T12 — Schedule: Publish to Late.co**
1. Expand a SCHEDULED post → drawer opens
2. Click "Confirm & Push to Late" → publishes
3. Status changes to POSTING → then POSTED (poll)
4. Caption + hashtags sent correctly

**T13 — Schedule: Drag Reorder & Lock**
1. Drag post to new position → order updates
2. Lock a post → lock icon appears
3. Click "Randomize" → locked posts stay in place, unlocked shuffle
4. Drag locked post → fails (can't move)

### ANALYTICS

**T14 — Analytics: View & Refresh**
1. Navigate to Analytics → Late gate if not connected
2. If connected → stats cards render with data
3. Switch tabs (Overview/Songs/Videos/Spotify)
4. Click song → drill-down view opens
5. Click "Back to Dashboard" → returns
6. Click "Refresh" → data reloads

### SETTINGS

**T15 — Settings: Theme & Logout**
1. Navigate to Settings → profile card renders
2. Toggle theme Dark ↔ Bright → entire UI updates
3. Refresh page → theme persists
4. Click "Log Out" → redirects to LandingPage

**T16 — Settings: Invite Operator**
1. Enter email in Team section → click "Invite"
2. If new email → success toast, input clears
3. If existing email → error toast "already an allowed user"

### ARTISTS (Conductor/Operator)

**T17 — Artists Management: CRUD**
1. Navigate to Artists tab → grid of artist cards
2. Search by name → filters cards
3. Filter by tier → filters cards
4. Click "Add Artist" → modal opens → create → card appears
5. Kebab → Edit → change name → save → name updates
6. Kebab → Remove (conductor only) → confirm → card removed

### DATA INTEGRITY

**T18 — Artist Switching: Data Isolation**
1. Switch from Artist A to Artist B → library reloads
2. Artist B's media/collections/drafts shown (not A's)
3. Switch back to A → A's data restored
4. Schedule page shows only current artist's posts

**T19 — Firestore Sync: Dual-Layer**
1. Create a collection → appears instantly (localStorage)
2. Refresh page → still there (Firestore loaded)
3. Add media to collection → persists after refresh
4. Delete collection → removed from both layers

### MOBILE

**T20 — Mobile Responsive Layout**
1. Resize to mobile width (< 768px)
2. Sidebar collapses → bottom tabs appear
3. Pages: stacked layout, larger touch targets
4. Schedule: batch bar wraps, filters scroll horizontally
5. Studio: full-width panels, no sidebar overlap
6. Settings: forms stack naturally

---

## Regression Checklist (Quick Scan)

After every change, verify these do NOT break:

- [ ] App builds clean (`npx react-scripts build`)
- [ ] No console errors on page load
- [ ] No infinite loops or rapid re-renders
- [ ] Theme tokens applied (no white-on-white text)
- [ ] Mobile layout doesn't overflow
- [ ] Drag-and-drop still works in workspace
- [ ] Audio playback works in slideshow editor
- [ ] Firestore subscriptions fire (data loads after refresh)
- [ ] Pipeline → Generate → Drafts flow works end-to-end
