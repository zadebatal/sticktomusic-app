# StickToMusic — UI Changelog

> Tracks every Subframe redesign change with test results.
> Branch: `redesign-test`

---

## Format

```
### Slice N — [Title] (YYYY-MM-DD)
**Files**: list of files changed
**Changes**:
- Change 1
- Change 2

**Test Results**:
- T01: PASS/FAIL/SKIP
- ...

**Build**: PASS/FAIL
**Commit**: hash
```

---

## Completed Slices (Prior Sessions)

### Session 48 — Subframe Component Library Integration (2026-01-XX)
**Files**: `SlideshowEditor.jsx`, `package.json`, `tailwind.config.js`, `tsconfig.json`, `index.css`, `public/index.html`
**Changes**:
- Installed @subframe/core + Radix UI packages + tailwindcss@3
- Converted SlideshowEditor to Subframe components (Button, IconButton, ToggleGroup, TextField, Badge)
- Replaced inline SVGs with Feather icons
- Deleted getStyles() (~450 lines)
- Added Outfit font
**Build**: PASS

### Session 51 — Batch 6B: Settings + Analytics Polish
**Files**: `SettingsTab.jsx`, `AnalyticsDashboard.jsx`
**Changes**:
- SettingsTab: full Subframe conversion (Avatar, Badge, ToggleGroup, Button, TextField)
- AnalyticsDashboard: header (DropdownMenu), tabs (ToggleGroup), Late gate (Subframe card)
**Build**: PASS

### Session 51 — Batch 2A+2B: BeatSyncEditor
**Files**: `BeatSyncEditor.jsx` (NEW), `VideoStudio.jsx`, `PipelineListView.jsx`
**Changes**:
- Created BeatSyncEditor (~470 lines) with full Subframe UI
- Wired into VideoStudio routing
- Added "Beat Sync" button to PipelineListView
**Build**: PASS

### Session 51 — Batch 6C: Artists Management
**Files**: `ArtistsManagement.jsx` (NEW), `App.jsx`
**Changes**:
- Extracted ArtistsManagement from App.jsx inline code (~180 lines removed)
- Full Subframe components (Button, Badge, TextField, DropdownMenu, IconButton)
**Build**: PASS

---

## Session 52 — Redesign Gap Closure (2026-02-15)

### Slice 1 — PipelineListView Polish
**Files**: `PipelineListView.jsx`
**Changes**:
- Show ALL format pills per pipeline row (was only showing first)
- Added content type Badge ("Slideshows" brand / "Videos" neutral)
- Updated typography to Subframe classes (heading-1/2/3, body-bold, caption)
**Build**: PASS

### Slice 2 — PipelineWorkspace Header
**Files**: `PipelineWorkspace.jsx`
**Changes**:
- Added pipeline avatar (colored initials circle) + name heading + @handle subtitle
- Added center ToggleGroup for format switching (conditional on 2+ formats)
- Replaced kebab dropdown with clean Asset/Draft count badges (brand + neutral)
- Removed unused imports (FeatherMoreVertical, FeatherCalendar, SubframeCore, DropdownMenu)
**Build**: PASS

### Slice 4 — AppShell Sidebar Polish
**Files**: `AppShell.jsx`
**Changes**:
- Artist selector: Subframe Avatar + role Badge (neutral), rounded-lg, px-4
- Nav items: rounded-lg, py-2.5, active bg-[#2a2a2a] (was #1a1a1a)
- User footer: Subframe Avatar with Google photo, email subtitle, overflow-hidden truncation
- FeatherMoreVertical flex-none to prevent shrinking
**Build**: PASS

### Slice 5 — SchedulingPage Header + Filters
**Files**: `SchedulingPage.jsx`
**Changes**:
- Filter tabs: redesigned from Badge-wrapped divs to styled buttons with separate Badge counts
- Active filter: bg-[#2a2a2a] white text; inactive: text-neutral-400, transparent bg
- FeatherTrash → FeatherTrash2 icon on delete button
- Subtitle text class: caption → body for post count
**Build**: PASS

### Slice 7 — Analytics Dashboard Polish
**Files**: `AnalyticsDashboard.jsx`
**Changes**:
- Stat cards: Feather icons (Eye, Heart, MessageCircle, TrendingUp), Tailwind card classes
- Period selector: inline styled buttons → ToggleGroup component
- Section headers: style={styles.cardTitle} → text-heading-2 Tailwind classes (all 5 occurrences)
- "View All" buttons: inline styled → Subframe Button (neutral-tertiary)
- Video/song table rows: hover:bg-[#1a1a1aff], border-b border-neutral-800
- Cleaned ~200 lines of unused getStyles() entries
**Build**: PASS

### Slice 9 — Landing Page Overhaul
**Files**: `LandingPage.jsx`
**Changes**:
- Full rewrite to Subframe components + Tailwind (was inline styles)
- Nav: neutral-tertiary "Log in" + brand-primary "Get Started" buttons
- Hero: 72px Outfit font-700, brand-primary CTA + neutral-secondary "See How"
- Features: 3-col responsive grid with IconWithBackground boxes (bg-brand-600)
- How it works: 3 numbered steps with brand-600 circles
- Pricing: Artist/Operator toggle, 4-tier responsive card grid, Growth highlighted (border-brand-600 + Popular Badge)
- Operator calculator: Subframe TextFields + calculated price display
- Auth modal: Login/SignUp tab toggle, Subframe TextFields, FeatherX close button
- All auth logic preserved (handleSubmit, handleTierClick, handleApply, Google auth)
**Build**: PASS

### Slice 3 — PipelineWorkspace Banks + Preview
**Files**: `PipelineWorkspace.jsx`
**Changes**:
- Bank min-width scales with slide count (288px for 2-3, 248px for 4, 220px for 5+)
- Lyrics textarea now functional with `lyricsText` state
- Verified existing features already matched Subframe spec (Import button, hover ring, hint text, grid-cols-3, bank icons, audio display)
**Build**: PASS

### Slice 6 — SchedulingPage Post Rows + CaptionHashtagBank
**Files**: `SchedulingPage.jsx`, `CaptionHashtagBank.jsx`
**Changes**:
- Post rows: rounded-lg card borders, hover:bg transition, FeatherGripVertical drag handles
- Status indicator: Badge component (brand=scheduled, success=posted, error=failed, warning=posting, neutral=draft)
- Row actions: IconButton components (lock/unlock, expand/collapse, delete)
- Expanded drawer: Subframe Button components with Feather icons (Edit, Send, RotateCcw)
- Fixed invalid Button variants (success-secondary → brand-primary, warning-secondary → neutral-secondary)
- CaptionHashtagBank: Added Subframe imports (Button, Badge, IconButton, FeatherPlus, FeatherTrash2, FeatherX)
- Category buttons: raw buttons → Subframe Button/IconButton
- Hashtag chips: Badge variant="brand" (always) + variant="neutral" (pool) with FeatherX iconRight
- Caption entries: Tailwind-styled cards with text-brand-400 (always) / text-neutral-400 (pool)
- Delete category: emoji → IconButton destructive-tertiary with FeatherTrash2
**Build**: PASS

### Slice 8 — Artist Dashboard Portal
**Files**: `ArtistDashboard.jsx`
**Changes**:
- Added Firestore subscription for created content (subscribeToCreatedContent)
- Stat cards: replaced Total Views/Social Sets/Scheduled → Total Content/Scheduled/Posted with branded icon boxes (FeatherLayers, FeatherCalendar, FeatherSend)
- Added 4-col Recent Content grid with thumbnails, status badges (draft/scheduled/posted), type icons, time-ago labels
- Updated Upcoming Posts: thumbnails, platform icons, edit IconButton per row, border-b separators
- Updated Recently Posted: date boxes, platform link pills, "+N more" overflow
- Added `getTimeAgo()` helper, `recentContent` useMemo, `totalContentCount` derived state
- Mobile responsive: grid-cols-1 fallback on stat cards, grid-cols-2 on recent content
**Build**: PASS

---

## Slice 10 — Final Audit
**Changes**:
- Cross-checked all 19 Subframe designs against live code
- Fixed ArtistsManagement: added Avatar component import + usage (was using plain div initials)

**Audit Results**:
| Status | Count | Designs |
|--------|-------|---------|
| **PASS** | 13 | PipelineListView, CreatePipelineModal, PipelineWorkspace (x5 designs), SlideshowEditor (x2), AppShell, BeatSyncEditor, SettingsTab, ArtistsManagement |
| **MINOR** | 4 | ArtistDashboard, CaptionHashtagBank, LandingPage, AnalyticsDashboard |
| **FUTURE** | 2 | Calendar view (SchedulingPage — new feature, not redesign gap), AreaChart (AnalyticsDashboard — component exists but charts not yet wired) |

**Minor gaps (safe to ship)**:
- CaptionHashtagBank: uses custom category buttons instead of Subframe Tabs
- AnalyticsDashboard: chart sections still use getStyles() pattern (stat cards/headers/tables migrated)
- LandingPage: uses custom icon boxes instead of IconWithBackground
- ArtistDashboard: sidebar delegation to AppShell (correct architecture)

**Build**: PASS
