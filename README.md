# StickToMusic

**Professional music content creation and distribution platform.**

StickToMusic enables music operators, labels, and artists to create video content, organize it into campaigns, and schedule distribution across TikTok, Instagram, YouTube, and Facebook — all from one interface.

---

## What It Does

| Feature | Description |
|---------|-------------|
| **Multi-Editor Studio** | 5 content editors (Slideshow, Solo Clip, Multi Clip, Photo Montage, Clipper) with beat sync, text overlays, and multi-generation |
| **Project & Niche System** | Organize work into Projects containing Niches — each with media banks, text banks, caption/hashtag templates |
| **Batch Scheduling** | Select drafts, assign platforms, set cadence, schedule in bulk via Late.co integration |
| **Multi-Artist Management** | Role-based access (Conductor > Operator > Artist > Collaborator) with full data isolation per artist |
| **Real-Time Sync** | Dual-layer storage (localStorage + Firestore) syncs across devices in real-time |
| **Analytics Dashboard** | Per-artist metrics, calendar views, post performance tracking |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.2, Tailwind CSS, Subframe component library |
| Database | Firebase Firestore (real-time subscriptions) |
| Auth | Firebase Auth (Google + email/password) |
| Storage | Firebase Storage (media) + localStorage (instant cache) |
| Hosting | Vercel (auto-deploy on push) |
| Social API | Late.co (TikTok, Instagram, YouTube, Facebook) |
| Serverless | Vercel Functions (Late proxy, Whisper transcription, AI captions) |
| Testing | Playwright (205+ E2E tests) |

---

## Architecture

```
User Action
  → React Component
  → libraryService (localStorage write — instant)
  → Firestore write (async, background)
  → Firestore subscription (other tabs/devices update)
```

All data is namespaced by `artistId`:
- `artists/{artistId}/library/data/collections/{id}` — projects, niches
- `artists/{artistId}/library/data/mediaItems/{id}` — uploaded media
- `artists/{artistId}/library/data/createdContent/{id}` — drafts & exports
- `artists/{artistId}/scheduledPosts/{id}` — scheduled posts
- `artistSecrets/{artistId}` — API keys (server-only, zero client access)

### Security

Firestore rules enforce role-based access at the database level:
- **Conductor**: Full access to all data
- **Operator**: Read/write on assigned artists only
- **Artist**: Read/write on own linked artist only
- API keys stored in `artistSecrets` — inaccessible from client code
- Late.co calls proxied through Vercel Functions (keys never reach browser)

---

## Project Structure

```
src/
├── App.jsx                          # Auth, routing, artist data loading
├── config/
│   ├── firebase.js                  # Firebase initialization
│   └── platforms.js                 # Platform metadata (TikTok, IG, YT, FB)
├── components/
│   ├── AppShell.jsx                 # Post-login navigation (5 tabs)
│   ├── LandingPage.jsx              # Public marketing page
│   ├── VideoEditor/
│   │   ├── VideoStudio.jsx          # Studio router + editor dispatch
│   │   ├── ProjectLanding.jsx       # Project grid
│   │   ├── ProjectWorkspace.jsx     # Niche navigator + media management
│   │   ├── SlideshowEditor.jsx      # Multi-slide editor
│   │   ├── SoloClipEditor.jsx       # Single-clip editor
│   │   ├── MultiClipEditor.jsx      # Multi-clip timeline editor
│   │   ├── PhotoMontageEditor.jsx   # Photo → video editor
│   │   ├── ClipperEditor.jsx        # FFmpeg trim editor
│   │   ├── SchedulingPage.jsx       # Batch scheduler
│   │   ├── ContentLibrary.jsx       # Drafts view
│   │   └── shared/                  # Shared editor hooks & components
│   └── tabs/
│       ├── ArtistDashboard.jsx      # Artist overview
│       └── SettingsTab.jsx          # User preferences
├── services/
│   ├── libraryService.js            # Core CRUD (collections, banks, projects)
│   ├── createdContentService.js     # Draft/content CRUD + Firestore sync
│   ├── lyricsService.js             # Lyrics CRUD + Firestore sync
│   ├── thumbnailService.js          # Thumbnail migration utilities
│   ├── scheduledPostsService.js     # Scheduled posts CRUD
│   ├── lateApiService.js            # Late.co API client (secure proxy)
│   ├── firebaseStorage.js           # File upload/download + quota
│   └── slideshowExportService.js    # Canvas-based MP4 rendering
└── ui/                              # Subframe component library (45+ components)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore, Auth, and Storage enabled
- Vercel account (for hosting + serverless functions)
- Late.co account (for social media posting)

### Setup

1. Clone the repository
2. Copy `.env.example` to `.env.local` and fill in your Firebase credentials
3. Set `REACT_APP_CONDUCTOR_EMAILS` to the super admin email(s)
4. Install dependencies:
   ```bash
   npm install
   ```
5. Deploy Firestore rules:
   ```bash
   npx firebase deploy --only firestore:rules,storage
   ```
6. Start development server:
   ```bash
   npm start
   ```

### Environment Variables

See `.env.example` for the complete list. Key variables:

| Variable | Where | Purpose |
|----------|-------|---------|
| `REACT_APP_FIREBASE_*` | `.env.local` + Vercel | Firebase client config |
| `REACT_APP_CONDUCTOR_EMAILS` | `.env.local` + Vercel | Super admin designation |
| `REACT_APP_OPERATOR_EMAILS` | `.env.local` + Vercel | Operator email allowlist |
| `FIREBASE_PRIVATE_KEY` | Vercel only | Server-side Firebase Admin |
| `LATE_API_KEY` | Vercel only | Late.co social posting |
| `REACT_APP_SENTRY_DSN` | `.env.local` + Vercel | Error monitoring (optional) |

### Build & Deploy

```bash
npm start                    # Dev server (port 3000)
npx react-scripts build      # Production build
npx playwright test           # Run E2E tests (205+ tests)
git push                     # Auto-deploys to Vercel
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [HANDOFF.md](HANDOFF.md) | Comprehensive technical handoff (data model, editors, scheduling, routing) |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | Full system architecture reference |
| [CLAUDE.md](CLAUDE.md) | AI assistant context (codebase conventions, patterns, gotchas) |
| [firestore.rules](firestore.rules) | Database security rules |
| [storage.rules](storage.rules) | Storage security rules |
| [.env.example](.env.example) | Environment variable reference |

---

## Codebase Stats

- **133 source files** across 69,000+ lines
- **205+ E2E tests** (Playwright)
- **45+ UI components** (Subframe library on Radix UI + Tailwind)
- **4 platform integrations** (TikTok, Instagram, YouTube, Facebook)
- **5 content editors** with shared infrastructure
- **Role-based security** enforced at Firestore level

---

## License

Copyright (c) 2026 StickToMusic. All rights reserved. See [LICENSE](LICENSE) for details.
