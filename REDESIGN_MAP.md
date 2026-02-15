# StickToMusic — Redesign Map & Gap List

> Maps each Subframe design to its live implementation and identifies gaps.
> Last updated: 2026-02-15 | Branch: `redesign-test`

---

## Subframe Designs (19 total)

| # | Subframe Page | ID | Live File | Status |
|---|--------------|-----|-----------|--------|
| 1 | Studio Home | `a2f7eb16` | `PipelineListView.jsx` | **Done** (Slice 1) |
| 2 | Pipeline Setup | `23fb0168` | `CreatePipelineModal.jsx` | **Done** |
| 3 | Pipeline Media Workspace 2 | `205301d5` | `PipelineWorkspace.jsx` | **Done** (Slices 2+3) |
| 4 | Pipeline Workspace Editor | `3f7d0c8a` | `PipelineWorkspace.jsx` | **Done** (Slices 2+3) |
| 5 | Perty_Bars Pipeline | `795025e0` | `PipelineWorkspace.jsx` | **Done** (Slices 2+3) |
| 6 | Pipeline Media Workspace | `4faae5f9` | `PipelineWorkspace.jsx` | Superseded by #3 |
| 7 | _5_Slide Pipeline Workspace | `ce949c91` | `PipelineWorkspace.jsx` | **Done** (Slices 2+3) |
| 8 | Slideshow Editor | `532e500d` | `SlideshowEditor.jsx` | **Done** (Session 48) |
| 9 | Slideshow Editor 2 | `1b11c00a` | `SlideshowEditor.jsx` | **Done** (Session 48) |
| 10 | Studio Hub | `1d8d3213` | `StudioHome.jsx` | Legacy, replaced by #1 |
| 11 | Operator Dashboard Shell | `7624b857` | `AppShell.jsx` | **Done** (Slice 4) |
| 12 | Content Calendar | `55d891f0` | `SchedulingPage.jsx` | **Done** (Slices 5+6) |
| 13 | Studio Scheduler | `96705ae8` | `SchedulingPage.jsx` | **Done** (Slices 5+6) |
| 14 | Analytics Dashboard | `d481f64f` | `AnalyticsDashboard.jsx` | **Done** (Slice 7) |
| 15 | Settings | `6096fdbe` | `SettingsTab.jsx` | **Done** (Session 51) |
| 16 | Artists Management | `90a07500` | `ArtistsManagement.jsx` | **Done** (Session 51) |
| 17 | Artist Dashboard Portal | `64b7dde8` | `ArtistDashboard.jsx` | **Done** (Slice 8) |
| 18 | Beat Sync Editor | `95378449` | `BeatSyncEditor.jsx` | **Done** (Session 51) |
| 19 | StickToMusic Landing 2 | `88a446b7` | `LandingPage.jsx` | **Done** (Slice 9) |

---

## GAP LIST

### CATEGORY A — Fully Implemented (no gaps)

| Design | File | Notes |
|--------|------|-------|
| Pipeline Setup | `CreatePipelineModal.jsx` | Matches Subframe 1:1 |
| Settings | `SettingsTab.jsx` | Converted in Session 51 |
| Artists Management | `ArtistsManagement.jsx` | Created in Session 51 |
| Beat Sync Editor | `BeatSyncEditor.jsx` | Created in Session 51 |
| Slideshow Editor v1+v2 | `SlideshowEditor.jsx` | Converted in Session 48 |

### CATEGORY B — Minor Gaps (polish only)

#### B1. Studio Home → PipelineListView.jsx
| Gap | Subframe | Live | Fix |
|-----|----------|------|-----|
| Content type badge | `<Badge variant="brand">Slideshows</Badge>` per row | Missing | Add per-pipeline content type badge |
| All format pills shown | Shows ALL format pills per pipeline | Only shows first | Render all format pills |
| Typography | `text-heading-1 font-heading-1` for title | Uses heading-1 | Verify class match |
| Video icon for video pipelines | `FeatherVideo` for video count | Present | Verify icon match |

#### B2. PipelineWorkspace Header + Media Pool
| Gap | Subframe (205301d5) | Live | Fix |
|-----|---------------------|------|-----|
| Header: pipeline avatar | Colored initials circle + name + `@handle . platform` | Simple back + name | Add avatar + subtitle row |
| Header: format ToggleGroup | Center ToggleGroup for format switching | None | Add format switcher |
| Header: Active/Drafts badges | Right-aligned badges with counts | None | Add status badges |
| Header: Generate button | Right-aligned in header | In preview panel | Keep as-is (preview panel better UX) |
| Media Pool: Import button | `FeatherCloud` Import button | Missing | Add Import button |
| Media Pool: filter tabs | All / Unassigned / Audio tabs | Present | Verify match |
| Media Pool: image hover | `hover:ring-1 hover:ring-indigo-500/50` | Missing | Add hover ring |
| Media Pool: audio selected bg | `bg-indigo-500/20` when selected | Present | Verify |
| Hint text | "Drag images to slide banks →" | Missing | Add hint |

#### B3. PipelineWorkspace Banks + Preview
| Gap | Subframe (205301d5) | Live | Fix |
|-----|---------------------|------|-----|
| Bank headers: IconWithBackground | FeatherZap for Hook, FeatherMusic for Lyrics | Missing icons | Add icon + Badge per header |
| Image grid layout | 3-col grid per bank | 2-col | Change to grid-cols-3 |
| "Drop here" placeholder | Dashed border drop zone | Present | Verify style match |
| Bank min-width | 288px for 2-slide | Flexible | Set min-w-72 |
| Text input styling | `border-neutral-800 bg-black` | Present | Verify |
| Preview: audio display | Shows selected audio in generate section | Missing | Add audio name display |
| Preview: "View Drafts" link | Link row below generate | Present | Verify |
| Preview: Lyrics section | Textarea + "Load from Bank" button | Missing | Add lyrics section |

### CATEGORY C — Major Gaps (new sections needed)

#### C1. AppShell Sidebar (7624b857)
**Current**: Left sidebar with logo, artist dropdown, nav items, user footer.
**Subframe design adds**:
| Gap | Description |
|-----|-------------|
| Logo style | `text-heading-2 font-heading-2` "StickToMusic" |
| Artist selector card | Bordered card with Avatar + name + role Badge |
| Nav item active state | `bg-[#2a2a2a]` with full icon + label |
| Nav item inactive | `text-neutral-400` muted |
| User footer | Avatar + name + DropdownMenu (Settings, Log Out) |
| Conductor badge | Role badge next to name |

**Assessment**: Current AppShell already has sidebar structure from Session 40. Needs component swap (inline styles → Subframe) + layout polish.

#### C2. Content Calendar / Studio Scheduler (55d891f0 + 96705ae8)
**Current**: SchedulingPage uses mix of inline styles and Tailwind classes.
**Subframe designs add**:
| Gap | Description |
|-----|-------------|
| Right sidebar (w-96) | Persistent CaptionHashtagBank sidebar |
| Category tabs | Hip-Hop / EDM / Pop tabs in sidebar |
| Hashtag badges | Always Include (brand) + Random Pool (neutral) |
| Post cards | Subframe Badge + IconButton + FeatherGripVertical |
| Artist selector | DropdownMenu with Avatar |
| Filter badges | Subframe Badge components |
| List/Calendar toggle | ToggleGroup with icons |

**Assessment**: Large conversion. SchedulingPage is ~2500 lines with complex state. Convert incrementally: header first, then filter bar, then post rows, then sidebar.

#### C3. Artist Dashboard Portal (64b7dde8) — NEW
**Not implemented at all.** Subframe design includes:
| Section | Description |
|---------|-------------|
| Welcome hero | `text-heading-1` "Welcome back, {name}" |
| Stat cards (3) | IconWithBackground + value + trend arrow |
| Quick action cards (2) | Studio / Schedule with buttons |
| Recent content grid (4-col) | Thumbnails + status badges |
| Upcoming posts list | Edit buttons per post |

**Assessment**: Entirely new component. Should be the default view for artist-role users after login.

#### C4. Landing Page (88a446b7) — NEW DESIGN
**Current**: LandingPage.jsx exists but uses old design (inline styles).
**Subframe design includes**:
| Section | Description |
|---------|-------------|
| Nav | Subframe buttons (Log in / Get Started) |
| Hero | 72px Outfit font-700, Subframe CTA buttons |
| Features | 3-col grid with IconWithBackground (Video/Calendar/BarChart) |
| How it works | 3 numbered steps |
| Pricing | Artist/Operator toggle, 4-tier card grid, Growth highlighted |
| Operator calculator | TextFields for artists/sets, calculated result |

**Assessment**: Full rewrite of LandingPage.jsx. Auth modal logic must be preserved.

---

## IMPLEMENTATION PLAN (10 Slices)

Each slice: implement → build-verify → test → update CHANGELOG_UI.md

### Slice 1: PipelineListView Polish (Small, ~30 min)
**File**: `PipelineListView.jsx`
**Changes**:
- Show ALL format pills per pipeline row (map through all formats)
- Add content type Badge ("Slideshows" brand / "Videos" neutral)
- Verify typography classes match Subframe design

### Slice 2: PipelineWorkspace Header (Medium, ~1 hr)
**File**: `PipelineWorkspace.jsx`
**Changes**:
- Add pipeline avatar (colored initials) + name heading + `@handle . platform` subtitle
- Add format ToggleGroup (center) for switching active format
- Add Active count / Drafts count badges (right)
- Keep Generate in preview panel (better UX)

### Slice 3: PipelineWorkspace Media Pool + Banks (Medium, ~1 hr)
**File**: `PipelineWorkspace.jsx`
**Changes**:
- Media pool: Add Import button, hover ring on images, "Drag images →" hint
- Banks: 2-col → 3-col grid, add FeatherZap/FeatherMusic icons to headers, Badge on count
- Add bank min-width (288px for 2-slide, narrower for 5+)
- Preview: add audio display, lyrics textarea + "Load from Bank"

### Slice 4: AppShell Sidebar Polish (Medium, ~1 hr)
**File**: `AppShell.jsx`
**Changes**:
- Logo: `text-heading-2 font-heading-2`
- Artist selector: bordered card with Avatar + name + role Badge
- Nav items: Feather icons + labels, active `bg-[#2a2a2a]`, inactive `text-neutral-400`
- User footer: Avatar + name + DropdownMenu
- Keep mobile bottom tabs unchanged

### Slice 5: SchedulingPage Header + Filters (Medium, ~1 hr)
**File**: `SchedulingPage.jsx`
**Changes**:
- Header: `text-heading-1`, artist DropdownMenu with Avatar
- Filter tabs: convert to ToggleGroup or Subframe Badge tabs
- Toolbar: convert Select All / Delete to Subframe buttons
- List/Calendar toggle: ToggleGroup with FeatherList/FeatherCalendar
- Do NOT touch post rows or sidebar yet

### Slice 6: SchedulingPage Post Rows + Sidebar (Large, ~2 hr)
**File**: `SchedulingPage.jsx`
**Changes**:
- Post rows: Badge for status, IconButton for actions
- Expanded drawer: Subframe buttons for Edit/Publish/Revert
- Right sidebar (w-96): move CaptionHashtagBank to persistent sidebar
- Category tabs: ToggleGroup or Subframe Tabs
- Hashtag badges: brand (always) + neutral (pool)
- Caption entries: styled cards

### Slice 7: Analytics Dashboard Polish (Small, ~30 min)
**File**: `AnalyticsDashboard.jsx`
**Changes**:
- Already mostly converted in Session 51
- Verify stat cards use IconWithBackground
- Verify chart containers match Subframe card style
- Polish tab typography

### Slice 8: Artist Dashboard Portal (Medium-Large, ~2 hr)
**New file**: `ArtistDashboard.jsx`
**Changes**:
- Welcome hero with artist name
- 3 stat cards: Total Content, Scheduled, Posted (with IconWithBackground + trend)
- 2 quick action cards: "Go to Studio" / "View Schedule" with buttons
- Recent content 4-col grid with thumbnails + status badges
- Upcoming posts list with edit buttons
- Wire into App.jsx as default view for artist-role users

### Slice 9: Landing Page Overhaul (Large, ~2 hr)
**File**: `LandingPage.jsx`
**Changes**:
- Nav with Subframe buttons
- Hero: 72px Outfit heading, Subframe CTA buttons
- Features: 3-col grid with IconWithBackground
- How it works: 3 numbered steps
- Pricing: 4-tier card grid, Growth highlighted
- Operator calculator: TextFields
- Preserve auth modal logic

### Slice 10: Final Polish + Audit (Small, ~30 min)
**All files**
- Cross-check all 19 Subframe designs against live code
- Fix any remaining typography / spacing / color mismatches
- Run full TEST_PLAN.md
- Update CHANGELOG_UI.md with final results

---

## Execution Order

| # | Slice | Complexity | Depends On | Files Changed |
|---|-------|-----------|------------|---------------|
| 1 | PipelineListView polish | Small | — | 1 file |
| 2 | PipelineWorkspace header | Medium | — | 1 file |
| 3 | PipelineWorkspace pools+banks | Medium | Slice 2 | 1 file |
| 4 | AppShell sidebar | Medium | — | 1 file |
| 5 | SchedulingPage header+filters | Medium | — | 1 file |
| 6 | SchedulingPage rows+sidebar | Large | Slice 5 | 1-2 files |
| 7 | Analytics polish | Small | — | 1 file |
| 8 | Artist Dashboard Portal | Medium-Large | Slice 4 | 2 files (new + App.jsx) |
| 9 | Landing Page overhaul | Large | — | 1 file |
| 10 | Final audit | Small | All above | All |

**Parallelizable**: Slices 1, 2, 4, 5, 7, 9 have no dependencies and can be done in any order.
**Sequential**: 2→3 (workspace), 5→6 (schedule), 4→8 (sidebar→dashboard)

---

## Verification Protocol

After each slice:
1. `npx react-scripts build` → must compile clean
2. Visual comparison in browser at `localhost:3000`
3. Run relevant TEST_PLAN.md flows (T01-T20)
4. Update CHANGELOG_UI.md entry
5. Git commit with descriptive message
