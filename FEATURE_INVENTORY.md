# StickToMusic — Feature Inventory

> Auto-generated audit of every route, page, feature, button, modal, CRUD action, and edge case.
> Last updated: 2026-02-15 | Branch: `redesign-test`

---

## Table of Contents

1. [App Shell & Routing (App.jsx)](#1-app-shell--routing)
2. [Landing Page](#2-landing-page)
3. [AppShell Navigation](#3-appshell-navigation)
4. [Pages Tab](#4-pages-tab)
5. [Studio — Pipeline List](#5-studio--pipeline-list)
6. [Studio — Pipeline Workspace](#6-studio--pipeline-workspace)
7. [Studio — Create Pipeline Modal](#7-studio--create-pipeline-modal)
8. [Studio — Slideshow Editor](#8-studio--slideshow-editor)
9. [Studio — Beat Sync Editor](#9-studio--beat-sync-editor)
10. [Studio — Content Library](#10-studio--content-library)
11. [Studio — Legacy Home](#11-studio--legacy-home)
12. [Schedule Page](#12-schedule-page)
13. [Analytics Dashboard](#13-analytics-dashboard)
14. [Settings Tab](#14-settings-tab)
15. [Artists Management](#15-artists-management)
16. [Cross-Cutting Systems](#16-cross-cutting-systems)

---

## 1. App Shell & Routing

**File**: `src/App.jsx` (~4600 lines)

### Views / Tabs
| View | Condition | Component |
|------|-----------|-----------|
| Landing (unauthenticated) | `!user` | `LandingPage` |
| Pages | `activeTab === 'pages'` | `PagesTab` |
| Studio | `activeTab === 'studio'` | `VideoStudio` |
| Schedule | `activeTab === 'schedule'` | `SchedulingPage` |
| Analytics | `activeTab === 'analytics'` | `AnalyticsDashboard` |
| Settings | `activeTab === 'settings'` | `SettingsTab` |
| Artists (conductor/operator) | `operatorTab === 'artists'` | `ArtistsManagement` |
| Content (conductor/operator) | `operatorTab === 'content'` | Inline content view with batch scheduling |

### Auth Flow
- Google sign-in via Firebase Auth
- Role hierarchy: `conductor > operator > artist > collaborator`
- `isConductor(user)` — checks `REACT_APP_CONDUCTOR_EMAILS`
- `isOperator(user)` — `role === 'operator'` in allowedUsers
- `isArtistOrCollaborator(user)` — linked to single artist
- Paywall gate: `shouldShowPaymentUI(user)` blocks non-exempt non-paying users

### Modals in App.jsx
| Modal | Trigger | Purpose |
|-------|---------|---------|
| Add Artist | "Add Artist" button | Name input, creates Firestore doc |
| Edit Artist | Kebab → Edit | Edit name, tier, activeSince |
| Delete Artist | Kebab → Delete | Confirm + cascade delete |
| Reassign Artist | Kebab → Reassign | Change ownerOperatorId |
| Late Connect | "Enable Sync" | API key input, validates via fetchAccounts |
| Batch Schedule | "+ Batch Schedule" | 2-step wizard (setup → preview → submit) |
| Stripe Checkout | Paywall CTA | Redirects to Stripe hosted checkout |

### Key State
- `currentArtistId` — active artist context (persisted)
- `firestoreArtists` — all artists from Firestore
- `allowedUsers` — user records with roles
- `latePages` — all Late.co connected pages
- `contentBanks` — caption/hashtag templates per category
- `activeTab` / `operatorTab` — navigation state

### Props Passed Down
| Child | Key Props |
|-------|-----------|
| `AppShell` | `visibleArtists, currentArtistId, onArtistChange, activeTab, onTabChange, user` |
| `VideoStudio` | `db, artistId, latePages, onNavigateToSchedule` |
| `SchedulingPage` | `db, artistId, accounts, lateAccountIds, visibleArtists, onArtistChange, onEditDraft` |
| `AnalyticsDashboard` | `lateAccessToken, artistId, artists, onSyncLate, lateConnected` |
| `SettingsTab` | `user, onLogout, db, artistId` |
| `ArtistsManagement` | `artists, user, currentArtistId, onArtistChange, isConductor, latePages` |
| `PagesTab` | `latePages, visibleArtists, manualAccountsByArtist, onAddManualAccounts` |

---

## 2. Landing Page

**File**: `src/components/LandingPage.jsx`

### Sections
- **Nav bar**: Logo, Log In / Get Started buttons
- **Hero**: Headline, subheading, CTA buttons
- **Features**: 3-column grid (Video, Calendar, Analytics)
- **How It Works**: 3 numbered steps
- **Pricing**: Artist/Operator toggle, 4-tier grid ($500/$1000/$2500/$5000)
- **Operator Calculator**: Inputs for artists × sets, calculated price
- **Footer**: Links, copyright

### Buttons/Actions
- "Log In" → opens auth modal
- "Get Started" → opens auth modal
- Pricing CTA → opens auth modal (or checkout if logged in)

### Modals
- Auth Modal: Google sign-in button

### Edge Cases
- Already logged in → redirects to app
- Mobile: stacked layout, responsive pricing grid

---

## 3. AppShell Navigation

**File**: `src/components/AppShell.jsx`

### Desktop Layout
- Left sidebar (w-64): Logo, artist selector dropdown, nav items with Feather icons, user footer
- Nav items: Pages, Studio, Schedule, Analytics, Settings
- Artist selector: bordered card with Avatar + name + role Badge
- Active state: `bg-[#2a2a2a]`, inactive: `text-neutral-400`

### Mobile Layout
- Bottom tab bar with 5 icons
- No sidebar

### Buttons/Actions
- Nav item click → `onTabChange(tabId)`
- Artist dropdown → `onArtistChange(artistId)`
- User footer → DropdownMenu (Settings, Log Out)

---

## 4. Pages Tab

**File**: `src/components/tabs/PagesTab.jsx`

### Sections
- **Header**: Title, stats row (Total Accounts, Total Handles, Connected Platforms), "Sync All"
- **Per-Artist Sections**: Collapsible, chevron toggle
  - Artist name + Late banner (if unconfigured)
  - Per-handle groups (collapsed by default)
    - Late pages: status dot, platform, followers, Connect button
    - Manual entries: password dots, eye toggle, "Manual" badge, Remove

### Buttons/Actions
| Button | Action |
|--------|--------|
| Sync All | Refresh Late pages |
| + Add Accounts | Opens BulkAccountEntry modal |
| Connect (per platform) | Opens Late OAuth in new tab |
| Remove (manual) | Removes manual account |
| Eye toggle | Show/hide password |
| Expand/collapse | Toggle artist/handle sections |

### Modals
- **BulkAccountEntry**: Multi-row entry (handle + URL auto-detect, platform toggles, passwords)
  - Add Another / Cancel / Done buttons
  - Results display with status badges

### CRUD
- **Create**: `createLateProfile`, `onAddManualAccounts`
- **Read**: `getLateProfiles`, `getLatePages` (subscription), `getConnectUrl`
- **Delete**: `onRemoveManualAccount`

### Edge Cases
- No artists → empty state with "Add artist" CTA
- Unconfigured Late → inline banner
- Social sets at limit → warning badge
- OAuth failures → toast error
- URL auto-detect: parses TikTok/Instagram/YouTube/Twitter/Facebook URLs
- Manual + Late merge: manual only shown if Late doesn't cover that handle+platform

---

## 5. Studio — Pipeline List

**File**: `src/components/VideoEditor/PipelineListView.jsx`

### Sections
- **Header**: "Studio" title, "View Drafts" button, "Beat Sync" button, "New Pipeline" button
- **Stat Cards**: Pipelines count, Drafts Ready, Total Assets
- **Pipeline Rows**: Avatar (colored initials), name, linked page, format pills, asset counts, status dot, action buttons, kebab menu

### Buttons/Actions
| Button | Action |
|--------|--------|
| New Pipeline | Opens CreatePipelineModal |
| View Drafts | Navigates to ContentLibrary |
| Beat Sync | Opens BeatSyncEditor |
| Quick Generate | Navigates to workspace (pipeline ready) |
| Add Media | Navigates to workspace (pipeline not ready) |
| Edit | Opens CreatePipelineModal in edit mode |
| Duplicate | Copies pipeline |
| Delete | Confirm dialog + delete |

### CRUD
- **Create**: via CreatePipelineModal
- **Read**: Firestore subscriptions (collections, library, createdContent)
- **Update**: edit pipeline metadata
- **Delete**: with confirmation dialog

### Edge Cases
- No pipelines → empty state with CTA
- Pipeline not ready → amber dot, "Add Media"
- Pipeline ready → green dot, "Quick Generate"

---

## 6. Studio — Pipeline Workspace

**File**: `src/components/VideoEditor/PipelineWorkspace.jsx`

### Layout: 3 panels
| Panel | Width | Contents |
|-------|-------|----------|
| Media Pool | w-64 | Upload, Import, filter tabs, image grid, audio list |
| Slide Banks | flex-1 | Horizontal kanban columns per slide position |
| Preview + Generate | w-72 | 9:16 preview, generate controls, drafts, lyrics |

### Media Pool
- Upload button → file input
- Import button (placeholder)
- Filter tabs: All / Unassigned / Audio
- 2-col image grid (drag source, colored bank-assignment dots)
- Audio list (selectable, shows duration)

### Slide Banks
- Horizontal kanban columns from active format's slideLabels
- Colored headers (Hook=indigo, Lyrics=green, Vibes=amber)
- 3-col image grid (drop target) + "Drop here" placeholder
- Text bank section: entry list + input field + add/remove

### Preview Panel
- 9:16 phone mockup with sample slide
- Slide dots (clickable navigation)
- Generate count input (1-50)
- Selected audio display
- Generate button
- Drafts counter + "View Drafts" link
- Lyrics textarea + "Load from Bank"

### Drag & Drop
- Images from pool → slide bank columns
- Visual feedback: drag hover highlights bank

### CRUD
- **Create**: upload media, add text entries, generate slideshows
- **Read**: pipeline + media + banks (Firestore subscriptions)
- **Update**: bank assignments, text entries, audio selection
- **Delete**: media items, text entries

### Edge Cases
- Empty media pool → "Upload media to get started"
- Empty bank → placeholder
- Upload in progress → progress bar
- Multiple formats → toggle switches slide count

---

## 7. Studio — Create Pipeline Modal

**File**: `src/components/VideoEditor/CreatePipelineModal.jsx`

### Layout: Split modal (90vw × 90vh)
- **Left**: Pipeline info form (name, page dropdown, description, format preview)
- **Right**: 2×2 format grid + "Custom Format" (coming soon)
- **Footer**: Cancel + Create/Save

### Buttons/Actions
- Format card click → selects format (border + checkmark)
- Page dropdown → selects linked Late page
- Create Pipeline / Save Changes → validates name, calls createPipeline
- Cancel / backdrop click → closes modal

### Edge Cases
- No Late pages → "No pages connected" in dropdown
- Empty name → Save button disabled
- Edit mode → pre-fills from existingPipeline, preserves ID + media

---

## 8. Studio — Slideshow Editor

**File**: `src/components/VideoEditor/SlideshowEditor.jsx` (~4500 lines)

### Layout
- **Top Bar**: Back, name input, aspect ratio toggle (9:16, 4:5, 4:3, 1:1), Save/Export buttons, draft tabs (multi-draft)
- **Left Sidebar**: Collapsible sections (Source, Audio, Text Style, Text Banks, Slide Banks, Lyrics)
- **Center**: Preview canvas with text overlays, filmstrip strip, slide navigation
- **Bottom**: Audio player (progress bar, trim, play/pause, undo/redo)

### Key Features
| Feature | Description |
|---------|-------------|
| Multi-slide editing | Add/remove/reorder slides, per-slide backgrounds |
| Text overlays | Add/edit/move/resize text, font/color/size/alignment/stroke |
| Audio | Upload/trim/play, Apply to All/Remove All (multi-draft) |
| Generation | Batch generate from template + banks (image cycling + text cycling) |
| Keep Text | none / all / per-slide Set toggle |
| Multi-draft | Tab between generated slideshows, independent edits |
| Styled text banks | Save `{ text, style }` entries, apply on generation |
| Pipeline labels | "Hook"/"Lyrics" instead of "Slide 1"/"Slide 2" |
| Undo/Redo | Full slide history (Cmd+Z / Shift+Cmd+Z) |
| Export | Canvas-based image export per slide |
| Lyrics | AI transcription (Whisper), paste lyrics, load from bank |

### Buttons/Actions
- Back/Close (save prompt if unsaved)
- Add/remove/reorder slides
- Set background (from bank / upload / library)
- Reroll image / Reroll text
- Add text overlay / Edit text / Delete text
- Font picker, color picker, size slider, alignment toggle, stroke controls
- Add to text bank (styled)
- Play/Pause/Trim audio
- Template save/apply
- Generate N slideshows
- Export images
- Delete slideshow (multi-draft only)

### Modals
- AudioClipSelector (trim audio)
- LyricAnalyzer (AI transcription)
- Template prompt (save/name)
- Add-to-text-bank picker (slide dropdown)

### CRUD
- Slides: create, update (background, text, audio, transform), delete, reorder
- Text overlays: create, read, update, delete
- Audio: select, trim, upload, link
- Generate: batch creation
- Templates: save, load

### Edge Cases
- Empty banks → can't generate
- Blob URL expiry on reload → fallback to library
- Multi-draft: independent audio per draft
- Audio loading states (metadata/canplay/timeout)
- Image transform clamping
- Stroke parsing (`NNpx color`)
- Text as `string | { text, style }` objects

---

## 9. Studio — Beat Sync Editor

**File**: `src/components/VideoEditor/BeatSyncEditor.jsx` (~470 lines)

### Layout
- **Top Bar**: Back, name input, Save/Export buttons
- **Center**: Preview container, Generate controls, playback (skip/play), progress bar
- **Right Sidebar (w-96)**: 4 collapsible sections
- **Bottom**: Timeline with 3 tracks

### Sidebar Sections
| Section | Contents |
|---------|----------|
| Audio | Track name, waveform bars, Start/End trim TextFields, Upload button |
| Beat Pattern | BPM Badge, Sync Pattern ToggleGroup (Every Beat/2nd/3rd/4th) |
| Lyrics | Textarea, Load from Bank + AI Transcribe buttons, Clear |
| Text Style | Font, size slider, color pickers, outline width, animation |

### Timeline
- 3 tracks: Text (blue), Clips (purple), Audio (green waveform)
- Zoom controls (+/-)
- Playhead scrubber with click-to-seek

### Key Features
- `useBeatDetection` hook: auto-BPM analysis
- Filtered beats computed by sync pattern
- Ref guard pattern for initial audio load

### Edge Cases
- No audio loaded → section shows upload CTA
- BPM detection in progress → "Analyzing..." label
- BPM detected → success Badge with value

---

## 10. Studio — Content Library

**File**: `src/components/VideoEditor/ContentLibrary.jsx`

### Sections
- **Header**: Title, filter tabs (All/Draft/Completed/Approved), date range, back button
- **Video/Slideshow Grid**: Cards with thumbnails, status badges, action buttons
- **Batch Action Bar**: Select All, Delete Selected, Edit Multiple, Schedule
- **Already Scheduled**: Expandable section showing scheduled posts

### Buttons/Actions
| Button | Action |
|--------|--------|
| New Video Draft | Creates empty video draft |
| New Slideshow Draft | Opens SlideshowEditor |
| Make up to 10 | Batch generation |
| Edit | Opens editor for single draft |
| Edit N in Editor | Opens multi-draft SlideshowEditor |
| Delete | Single or bulk delete (with cascade) |
| Approve | Sets video to approved status |
| Render | Triggers video rendering |
| Download | Downloads rendered video |
| Export to Drive | Exports to Google Drive |
| Post/Schedule | Opens scheduling flow |
| Preview | Modal preview (video or slideshow filmstrip) |

### CRUD
- **Create**: new drafts, scheduled posts from content
- **Read**: videos + slideshows (from category/library)
- **Update**: video status, render state
- **Delete**: single/bulk (cascade to scheduled posts)

### Edge Cases
- No content → empty state
- Rendering in progress → overlay with progress bar
- No thumbnail → placeholder icon
- 4+ slides → overflow +N indicator
- Drive not configured → skip export button
- Orphan scheduled posts → cascade delete

---

## 11. Studio — Legacy Home

**File**: `src/components/VideoEditor/StudioHome.jsx`

> Replaced by PipelineListView; kept as fallback.

- Mode selector (Videos / Slideshows / Library)
- Bank selector UI ("Pull From")
- Batch generation quick links
- Media grid
- Audio sidebar

---

## 12. Schedule Page

**File**: `src/components/VideoEditor/SchedulingPage.jsx`

### Sections
- **Header**: Title, post counts, artist selector (multi-artist), pause toggle
- **Batch Bar** (appears when posts selected): Account picker, platform toggles, posts-per-day, spacing mode, date/time, Schedule/Publish buttons
- **Filter Tabs**: All / Drafts / Scheduled / Posting / Posted / Failed (with counts)
- **Toolbar**: Select All, Drafts Only, Delete Selected
- **Post List / Calendar**: Switchable views
- **Caption Bank Sidebar**: Template categories for batch apply
- **Post Rows**: Checkbox, drag handle, thumbnail, name, schedule time, caption, status, actions
- **Expanded Drawer**: Preview, Edit/Confirm/Publish/Revert/Retry, hashtag bank, platform assignment

### Buttons/Actions
| Button | Action |
|--------|--------|
| + (Add from Drafts) | Opens AddFromDraftsModal |
| ⇄ (Randomize) | Shuffles unlocked posts |
| ⏸/▶ (Pause Queue) | Toggles auto-publish |
| # (Caption Bank) | Opens sidebar |
| ≡ (List/Calendar) | View mode toggle |
| Schedule N Posts | Batch schedule selected |
| Publish N Now | Batch publish selected |
| Lock/Unlock | Per-post lock toggle |
| Delete | Per-post or bulk delete |
| Edit in Studio | Opens editor for draft |
| Confirm & Push | Publishes to Late.co |
| Revert to Draft | Reverts status |
| Retry | Retries failed publish |

### Modals
- AddFromDraftsModal: Select drafts → create scheduled posts
- ConfirmDialog: Delete confirmation

### CRUD
- **Create**: `addManyScheduledPosts`
- **Read**: `subscribeToScheduledPosts` (real-time)
- **Update**: `updateScheduledPost` (caption, time, platforms, status)
- **Delete**: `deleteScheduledPost` (cascade, Late sync)
- **Reorder**: `reorderPosts` (queuePosition update)

### Edge Cases
- Loading → spinner
- No posts → empty state
- Ghost drafts → "orphan" badge (source deleted)
- Scheduling conflicts → auto-adjust start time
- Past time → bumps to now + 5 min
- Late API failures → retry button
- Locked posts → can't drag, shuffle respects locks
- Status polling: monitors SCHEDULED posts, checks Late.co status

---

## 13. Analytics Dashboard

**File**: `src/components/Analytics/AnalyticsDashboard.jsx`

### Sections
- **Header**: Title, artist selector (DropdownMenu), last updated, Refresh button
- **Tab Navigation** (ToggleGroup): Overview | Songs | Videos | Spotify
- **Overview**: Stats cards (4), performance chart, category chart, account comparison
- **Songs**: Leaderboard, click-to-drill-down
- **Videos**: Top performing table
- **Spotify**: Spotify metrics + attribution
- **Song Detail**: Back button, stats grid, per-category table, videos table

### Buttons/Actions
- Artist dropdown → switch artist context
- Refresh → sync Late analytics
- Tab toggle → switch view
- Period buttons (Daily/Weekly) → chart period
- Song row click → drill down to detail
- Back to Dashboard → exit song detail

### CRUD
- **Read**: `getStoredAnalytics`, `calculateTotalStats`, `getTopVideos`, `getSongPerformance`, `getCategoryPerformance`, `getTimeSeriesData`, `computeAttribution`
- **Sync**: `onSyncLate` → fetch posts from Late API

### Edge Cases
- No Late connection → gate screen with "Connect Late" message
- Loading → spinner
- No data → falls back to mock data
- Multi-artist → dropdown; single → badge
- Song detail → graceful handling of missing data

---

## 14. Settings Tab

**File**: `src/components/tabs/SettingsTab.jsx`

### Sections
- **Profile**: Avatar, name, email, role Badge
- **Team**: Email input + "Invite" button (creates operator record)
- **Appearance**: Dark/Bright ToggleGroup (FeatherMoon/FeatherSun)
- **Subscription** (conditional): Cancel Subscription button
- **Danger Zone**: Alert icon, red border, "Log Out" button

### Buttons/Actions
- Invite → validates email, creates allowedUsers record
- Theme toggle → persists to localStorage + ThemeContext
- Cancel Subscription → confirms, calls API
- Log Out → Firebase sign-out

### CRUD
- **Create**: invite operator (`setDoc` to `allowedUsers`)
- **Read**: check if email exists
- **Cancel**: POST `/api/cancel-subscription`

### Edge Cases
- Email empty → button disabled
- Already invited → error toast
- Invite success → clear input, success toast (auto-hide 4s)

---

## 15. Artists Management

**File**: `src/components/tabs/ArtistsManagement.jsx`

### Sections
- **Header**: "Artists" title + subtitle, "Add Artist" button
- **Search + Filter**: Search input, tier dropdown (All/Starter/Growth/Scale/Sensation)
- **Artist Cards** (2-col grid): Avatar, name, tier Badge, active status, kebab menu, social sets count, Late.co status, "View Details" button

### Buttons/Actions
- Add Artist → `onAddArtist` callback
- Card click → `onArtistChange`
- View Details → `onArtistChange`
- Kebab: Edit Artist / Manage Pages / Remove Artist (conductor only)
- Search → filters by name
- Tier filter → filters by subscription tier

### Edge Cases
- No artists → empty state with CTA
- No matches → "No matching artists" message
- Inactive → gray status
- Late not connected → "Not Connected"
- Conductor vs operator → Delete only for conductor

---

## 16. Cross-Cutting Systems

### A. Authentication & Authorization
- Firebase Auth (Google sign-in)
- Role-based access: conductor > operator > artist > collaborator
- `allowedUsers` Firestore collection
- `paymentExempt` flag bypasses Stripe
- `REACT_APP_CONDUCTOR_EMAILS` env var

### B. Paywall / Subscription
- `subscriptionService.js`: `computeSocialSetsUsed`, `canAddSocialSet`, `shouldShowPaymentUI`, `getTierForSets`, `calculateOperatorPrice`
- Tiers: Starter ($500), Growth ($1000), Scale ($2500), Sensation ($5000)
- Stripe Checkout integration (server-side API routes)

### C. Data Layer (Dual Sync)
- `libraryService.js`: localStorage (instant) + Firestore (background)
- Write: localStorage first, then Firestore async
- Read: Firestore first (might be newer), fallback localStorage
- Subscribe: migration first, then real-time subscription
- `migrateCollectionBanks` auto-converts old bankA/B/C/D format

### D. Library Service Functions
| Category | Functions |
|----------|-----------|
| Media | `addMedia`, `updateMedia`, `deleteMedia`, `getUserLibrary`, `getUserLibraryAsync` |
| Collections | `createCollection`, `getUserCollections`, `updateCollection`, `deleteCollection` |
| Banks | `assignToBank`, `removeFromBank`, `getBankLabel`, `getBankColor`, `migrateCollectionBanks` |
| Text Banks | `getTextBankText`, `getTextBankStyle`, `addToTextBank`, `removeFromTextBank` |
| Pipelines | `createPipeline`, `getPipelines`, `getPipelineById`, `getPipelineBankLabel`, `getPipelineStatus`, `getPipelineAssetCounts`, `duplicatePipeline`, `switchPipelineFormat` |
| Content | `saveCreatedContent`, `getCreatedContent`, `deleteCreatedContent`, `updateCreatedContent` |
| Firestore Sync | `subscribeToLibrary`, `subscribeToCollections`, `subscribeToCreatedContent`, `loadLibraryAsync`, `saveMediaAsync` |

### E. Late.co Integration
- `lateService.js`: `fetchLateAccounts`, `validateLateToken`, `connectLate`, `disconnectLate`, `getLateProfiles`, `createLateProfile`, `getConnectUrl`, `schedulePost`, `deletePost`
- Proxy through Vercel serverless functions (`/api/late-proxy`)
- OAuth flow: `getConnectUrl` → new tab → Late handles OAuth → redirect back
- Per-artist Late API keys stored in Firestore

### F. Scheduled Posts
- `scheduledPostsService.js`: `addScheduledPost`, `addManyScheduledPosts`, `updateScheduledPost`, `deleteScheduledPost`, `subscribeToScheduledPosts`, `reorderPosts`
- Status flow: DRAFT → SCHEDULED → POSTING → POSTED / FAILED
- Cascade delete by contentId
- Status polling: checks Late.co for post status updates

### G. Export Pipeline
- `slideshowExportService.js`: Canvas-based rendering
- `renderSlideToCanvas` → per-slide with text overlays, transforms, fonts
- `wrapText` → multi-line text layout
- `textTransform` + `textStroke` support
- `document.fonts.ready` await for custom fonts

### H. Cloud Services
- `googleDriveService.js`: Full Google Drive integration (list/search/download/upload/picker)
- `dropboxService.js`: Full Dropbox integration (list/search/download/upload)
- `firebaseStorage.js`: Upload/delete files, thumbnails, video duration detection
- `CloudImportButton.jsx`: Shared component for cloud imports

### I. Audio & Waveform
- `whisperService.js`: AI transcription via Whisper API
- `useBeatDetection.js`: Auto-BPM analysis, beat markers
- `useWaveform.js`: Per-clip waveform generation
- `waveformGenerator.js`: AudioBuffer caching, PCM data extraction

### J. Theme System
- `ThemeContext.jsx`: 3 themes (dark, bright, saintLaurent)
- Tokens: `bg.*`, `text.*`, `accent.*`, `border.*`, `overlay.*`, `destructive.*`
- Tailwind classes for sidebar: `sidebarActive/Inactive/Hover`
- Persisted to localStorage

### K. Upload & Media Processing
- `imageConverter.js`: HEIC/HEIF/TIFF → JPEG conversion
- `uploadPool.js`: Parallel uploads (concurrency 5)
- Supported: images (JPEG, PNG, WebP, HEIC, HEIF, TIFF), video (MP4, MOV, WebM), audio (MP3, WAV, M4A, OGG, FLAC, AAC)

### L. Mobile Responsiveness
- `useIsMobile()` hook (768px breakpoint)
- Pointer Events API for touch drag
- 44px minimum touch targets
- Bottom tabs on mobile, sidebar on desktop

### M. Toast System
- `useToast()` hook for notifications
- Success/error/info variants
- Auto-dismiss with configurable duration

---

## File Map (Quick Reference)

```
src/
├── App.jsx                              # Auth, routing, modals, artist management
├── index.js                             # Entry point
├── index.css                            # Tailwind directives
├── components/
│   ├── AppShell.jsx                     # Navigation shell (sidebar + mobile tabs)
│   ├── LandingPage.jsx                  # Marketing page
│   ├── tabs/
│   │   ├── PagesTab.jsx                 # Social media accounts
│   │   ├── SettingsTab.jsx              # Profile, team, theme, logout
│   │   └── ArtistsManagement.jsx        # Artist grid (conductor/operator)
│   ├── Analytics/
│   │   └── AnalyticsDashboard.jsx       # Multi-tab analytics
│   └── VideoEditor/
│       ├── VideoStudio.jsx              # Studio container + routing
│       ├── SlideshowEditor.jsx          # Slideshow editor (~4500 lines)
│       ├── BeatSyncEditor.jsx           # Beat-sync video editor
│       ├── ContentLibrary.jsx           # Drafts/content view
│       ├── PipelineListView.jsx         # Pipeline home dashboard
│       ├── PipelineWorkspace.jsx        # 3-panel pipeline editor
│       ├── CreatePipelineModal.jsx      # Pipeline creation form
│       ├── SchedulingPage.jsx           # Post scheduler
│       ├── StudioHome.jsx               # Legacy studio home
│       └── LibraryBrowser.jsx           # Media library browser
├── services/
│   ├── libraryService.js               # Dual-layer data (localStorage + Firestore)
│   ├── scheduledPostsService.js         # Scheduled posts CRUD
│   ├── lateService.js                   # Late.co API integration
│   ├── slideshowExportService.js        # Canvas-based export
│   ├── whisperService.js                # AI transcription
│   ├── analyticsService.js              # Analytics data
│   ├── subscriptionService.js           # Stripe/tier logic
│   ├── firebaseStorage.js              # Firebase file upload
│   ├── googleDriveService.js            # Google Drive integration
│   └── dropboxService.js               # Dropbox integration
├── context/
│   └── ThemeContext.jsx                 # Theme system (dark/bright/saintLaurent)
├── hooks/
│   ├── useBeatDetection.js             # BPM analysis
│   ├── useWaveform.js                  # Waveform generation
│   ├── useTimelineZoom.js              # Pinch-zoom for timelines
│   └── useIsMobile.js                  # Mobile detection
└── ui/                                  # Subframe component library
    └── components/                      # Button, Badge, TextField, etc.
```
