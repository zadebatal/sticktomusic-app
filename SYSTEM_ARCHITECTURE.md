# StickToMusic - Complete System Architecture

> **Last Updated:** February 5, 2026
> **Purpose:** Single source of truth for all system components, workflows, and integrations.
> **Use Before:** Any new feature implementation to ensure seamless integration.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Backend Services](#5-backend-services)
6. [Firestore Collections](#6-firestore-collections)
7. [Late.co Integration](#7-lateco-integration)
8. [Video Studio System](#8-video-studio-system)
9. [Operator Dashboard](#9-operator-dashboard)
10. [Data Flow Patterns](#10-data-flow-patterns)
11. [Deployment](#11-deployment)
12. [Critical Invariants](#12-critical-invariants)

---

## 1. Project Overview

**StickToMusic** is a SaaS platform for music artists to create and distribute video content across social media. It provides:

- **World Pages**: Managed social media accounts for artist promotion
- **Video Studio**: Professional video creation with beat-sync, lyrics, and batch generation
- **Slideshow Creator**: Image carousel content for Instagram/TikTok
- **Content Scheduling**: Automated posting via Late.co integration
- **Multi-Artist Management**: Operators manage multiple artists, Conductors oversee everything

### Business Model

| Tier | World Pages | Creative Direction |
|------|-------------|-------------------|
| Scale | 8 pages | Optional (CD Lite/Pro) |
| Standard | 4 pages | Optional |
| Starter | 2 pages | None |
| Sensation | 16 pages | Full CD |

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18.2 | UI framework |
| **Routing** | React Router 7.13 | Client-side navigation |
| **Styling** | Tailwind CSS + Inline styles | Component styling |
| **Auth** | Firebase Auth | Email/password + Google OAuth |
| **Database** | Cloud Firestore | Real-time document storage |
| **Storage** | Firebase Storage | Video/image/audio files |
| **Video Processing** | FFmpeg.js | Client-side video rendering |
| **Audio Analysis** | web-audio-beat-detector, music-tempo | Beat detection |
| **Payments** | Stripe | Artist onboarding payments |
| **Social Posting** | Late.co API | Multi-platform scheduling |
| **Deployment** | Vercel | Hosting + serverless functions |

### Key Dependencies

```json
{
  "@ffmpeg/ffmpeg": "^0.12.15",
  "@ffmpeg/util": "^0.12.2",
  "firebase": "^12.8.0",
  "firebase-admin": "^13.6.1",
  "music-tempo": "^1.0.3",
  "react": "^18.2.0",
  "react-router-dom": "^7.13.0",
  "web-audio-beat-detector": "^8.2.34"
}
```

---

## 3. Directory Structure

```
sticktomusic-app/
├── api/                          # Vercel Serverless Functions
│   ├── late.js                   # Late.co API proxy (secure)
│   ├── spotify.js                # Spotify API proxy
│   └── stripe-webhook.js         # Stripe payment webhooks
│
├── src/
│   ├── App.jsx                   # Main app (7000+ lines, all state)
│   │
│   ├── components/
│   │   ├── Analytics/
│   │   │   ├── AnalyticsDashboard.jsx
│   │   │   └── SpotifyComponents.jsx
│   │   │
│   │   ├── VideoEditor/          # Core Studio Components (27 files)
│   │   │   ├── VideoStudio.jsx       # Main container, routing
│   │   │   ├── AestheticHome.jsx     # Home with mode selection
│   │   │   ├── VideoEditorModal.jsx  # PRODUCTION video editor
│   │   │   ├── SlideshowEditor.jsx   # Slideshow creator
│   │   │   ├── BatchPipeline.jsx     # Batch video generator
│   │   │   ├── ContentLibrary.jsx    # Content management
│   │   │   ├── WordTimeline.jsx      # Word timing editor
│   │   │   ├── AudioClipSelector.jsx # Audio trimmer
│   │   │   ├── EnhancedTimeline.jsx  # Clip timeline
│   │   │   ├── LyricBank.jsx         # Saved lyrics
│   │   │   ├── LyricAnalyzer.jsx     # AI transcription
│   │   │   ├── PostingModule.jsx     # Batch scheduling
│   │   │   ├── ExportAndPostModal.jsx
│   │   │   ├── AutoRemixEngine.js    # Clip generation logic
│   │   │   ├── LyricTemplates.js     # Style templates
│   │   │   └── ... (12 more)
│   │   │
│   │   └── ui/
│   │       └── index.jsx             # Shared UI components
│   │
│   ├── services/                 # Business Logic
│   │   ├── artistService.js          # Artist CRUD + namespacing
│   │   ├── contentTemplateService.js # Caption/hashtag templates
│   │   ├── firebaseStorage.js        # File uploads
│   │   ├── lateService.js            # Late.co client wrapper
│   │   ├── videoExportService.js     # Video rendering
│   │   ├── slideshowExportService.js # Slideshow export
│   │   ├── storageService.js         # localStorage helpers
│   │   ├── whisperService.js         # AI transcription
│   │   └── ... (6 more)
│   │
│   ├── hooks/
│   │   ├── useBeatDetection.js       # Audio beat analysis
│   │   └── useLyricAnalyzer.js       # Whisper integration
│   │
│   └── utils/
│       ├── roles.js                  # Role checking utilities
│       ├── timelineNormalization.js  # Time coordinate conversion
│       ├── captionGenerator.js       # Template-based generation
│       └── thumbnailGenerator.js
│
├── firestore.rules               # Security rules
├── firebase.json                 # Firebase config
├── vercel.json                   # Vercel config
└── package.json
```

---

## 4. User Roles & Permissions

### Role Hierarchy

```
CONDUCTOR (Super-Admin)
    ↓ manages
OPERATOR (Admin)
    ↓ manages
ARTIST (End User)
```

### Role Definitions

| Role | Source | Permissions |
|------|--------|-------------|
| **Conductor** | `REACT_APP_CONDUCTOR_EMAILS` env var | Full system access, manage operators, see all artists |
| **Operator** | Firestore `allowedUsers` with `role: 'operator'` | Manage assigned artists only, create content, schedule posts |
| **Artist** | Firestore `allowedUsers` with `role: 'artist'` | View-only Artist Portal, see campaign performance |

### Access Control Logic

```javascript
// In App.jsx
const isConductor = (user) => user?.role === 'conductor';
const isAdminUser = (user) => user?.role === 'conductor' || user?.role === 'operator';

// Artist filtering for operators
if (!isConductor(user)) {
  const assignedIds = user?.assignedArtistIds || [];
  displayArtists = displayArtists.filter(artist => assignedIds.includes(artist.id));
}
```

### Firestore Security Rules Summary

```javascript
// artists collection
allow read: if isOperatorOrAbove();
allow create: if isOperatorOrAbove();  // Changed from isConductor()
allow update, delete: if isConductor() || canAccessArtist(artistId);

// allowedUsers collection
allow read: if true;  // Needed for login whitelist check
allow write: if isConductor();

// applications collection
allow read: if isOperatorOrAbove();
allow create: if true;  // Public submission
allow update, delete: if isConductor();
```

---

## 5. Backend Services

### Firebase Configuration

**Location:** `src/services/firebaseStorage.js`, `src/App.jsx`

```javascript
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};
```

### Firebase Storage Structure

```
{bucket}/
├── videos/{timestamp}_{filename}
├── thumbnails/{timestamp}_{filename}
├── images/{timestamp}_{filename}
├── audio/{timestamp}_{filename}
└── uploads/{timestamp}_{filename}
```

**Upload Limits:**
- Max file size: 500MB
- Video types: mp4, webm, quicktime, x-msvideo
- Image types: jpeg, png, gif, webp
- Audio types: mpeg, wav, ogg, mp4

### Service Functions

| Service | File | Key Functions |
|---------|------|---------------|
| **Artist** | `artistService.js` | `createArtist()`, `updateArtist()`, `subscribeToArtists()` |
| **Templates** | `contentTemplateService.js` | `getTemplates()`, `saveCategory()`, `generateFromTemplate()` |
| **Storage** | `firebaseStorage.js` | `uploadFile()`, `uploadVideo()`, `generateThumbnail()` |
| **Late** | `lateService.js` | `fetchLateAccounts()`, `schedulePost()`, `deletePost()` |
| **Video** | `videoExportService.js` | `renderVideo()`, `exportAsPreview()` |
| **Slideshow** | `slideshowExportService.js` | `exportSlideshowAsImages()` |

---

## 6. Firestore Collections

### `artists`

```javascript
{
  id: "auto-generated",
  name: "Artist Name",
  tier: "Scale" | "Standard" | "Starter" | "Sensation",
  cdTier: "CD Lite" | "CD Pro" | "None",
  status: "active" | "inactive",
  activeSince: "Mar 2024",
  totalPages: 8,
  lateConnected: true,
  lateAccountIds: { "@handle": { tiktok: "id", instagram: "id" } },
  metrics: { views: 0, engagement: 0, rate: 0 },
  ownerOperatorId: "operator-user-id" | null,
  createdAt: "2024-03-15T...",
  updatedAt: "2024-03-15T..."
}
```

### `allowedUsers`

```javascript
{
  id: "auto-generated",
  email: "user@example.com",
  name: "User Name",
  role: "conductor" | "operator" | "artist",
  status: "active" | "inactive",
  artistId: "artist-id" | null,  // For artist role
  assignedArtistIds: ["id1", "id2"],  // For operator role
  createdAt: "2024-03-15T...",
  // Additional profile fields from applications...
}
```

### `applications`

```javascript
{
  id: "auto-generated",
  name: "Artist Name",
  email: "artist@example.com",
  tier: "Scale",
  status: "pending" | "pending_payment" | "approved" | "declined",
  submitted: "2024-03-15T...",
  paymentLink: "https://stripe.com/...",
  approvedAt: "2024-03-16T...",
  // Full application form data (20+ fields)
}
```

### `contentTemplates`

```javascript
// Document ID = Artist ID
{
  templates: {
    "Fashion": {
      hashtags: {
        always: ["#fashion", "#style"],
        pool: ["#ootd", "#trend", ...]
      },
      captions: {
        always: [],
        pool: ["Serving looks", "Main character energy", ...]
      }
    },
    // More categories...
  },
  updatedAt: serverTimestamp()
}
```

### `artistSecrets` (Server-only)

```javascript
// Document ID = Artist ID
// NEVER accessible from client
{
  lateApiKey: "encrypted-key",
  updatedAt: "2024-03-15T..."
}
```

---

## 7. Late.co Integration

### Architecture

```
Client (lateService.js)
    ↓ Firebase Auth Token
Vercel Serverless (/api/late.js)
    ↓ Late API Key (from artistSecrets or env)
Late.co API (https://getlate.dev/api/v1)
```

### API Endpoints

| Action | Method | Late Endpoint | Purpose |
|--------|--------|---------------|---------|
| `accounts` | GET | `/api/v1/accounts` | Get connected social accounts |
| `posts` | GET | `/api/v1/posts` | Get scheduled posts |
| `posts` | POST | `/api/v1/posts` | Schedule new post |
| `delete` | DELETE | `/api/v1/posts/{id}` | Delete scheduled post |
| `setKey` | POST | (internal) | Save artist Late API key |
| `keyStatus` | GET | (internal) | Check if key configured |

### Scheduling a Post

```javascript
// Client call
await lateApi.schedulePost({
  videoUrl: "https://firebasestorage.../video.webm",
  caption: "Caption with #hashtags",
  accountIds: ["697b3cac77637c5c857cc26b"],
  scheduledTime: "2024-03-20T14:00:00Z",
  artistId: "current-artist-id"
});

// Payload sent to Late API
{
  media_url: videoUrl,
  caption: caption,
  account_ids: accountIds,
  scheduled_at: scheduledTime  // Optional
}
```

### Account ID Mapping

Stored in `LATE_ACCOUNT_IDS` constant in App.jsx:

```javascript
const LATE_ACCOUNT_IDS = {
  '@sarahs.ipodnano': { tiktok: '697b3cac...', instagram: '697b3d24...' },
  '@margiela.mommy': { tiktok: '697b3dbb...', instagram: '697b3e2a...' },
  // ... 6 more handles
};
```

---

## 8. Video Studio System

### Component Hierarchy

```
VideoStudio (root container)
├── AestheticHome (home screen)
│   ├── Category selector
│   ├── Mode selector (VIDEOS / SLIDESHOWS)
│   └── Content banks (clips, audio, images, lyrics)
│
├── ContentLibrary (content management)
│   ├── Video/slideshow grid
│   ├── Filtering & search
│   ├── ExportAndPostModal (single post)
│   └── PostingModule (batch scheduling)
│
├── VideoEditorModal (PRODUCTION editor) ⭐
│   ├── VideoPreview (live preview)
│   ├── WordTimeline (word timing)
│   ├── EnhancedTimeline (clip editing)
│   ├── BeatSelector (beat patterns)
│   ├── AudioClipSelector (audio trim)
│   ├── LyricBank (saved lyrics)
│   ├── LyricAnalyzer (AI transcription)
│   └── TextControls (styling)
│
├── SlideshowEditor
│   ├── Slide canvas
│   ├── Image A/B banks
│   ├── Text overlays
│   └── Export as images
│
└── BatchPipeline (batch generator)
    ├── OPTIONS stage (setup)
    ├── PREVIEW stage (first video)
    ├── GENERATING stage (render all)
    └── VIDEO_BANK stage (review)
```

### Video Creation Workflow

```
1. SELECT AUDIO
   └── AudioClipSelector → Set trim boundaries (startTime/endTime)

2. ADD LYRICS
   ├── Type directly
   ├── Load from LyricBank
   └── AI transcribe via LyricAnalyzer (Whisper)

3. GENERATE CLIPS
   ├── Beat detection (useBeatDetection hook)
   ├── Select beat pattern (every, 2-4, 1-3, every-2, every-4, every-8)
   └── AutoRemixEngine generates clips from bank

4. SYNC WORDS
   ├── WordTimeline: drag/resize word blocks
   ├── LyricEditor: tap-to-sync mode
   └── Save to LyricBank (update or create new)

5. ADJUST STYLE
   └── TextControls: font, size, color, outline, animation

6. SAVE/EXPORT
   ├── Save as draft to category
   ├── Render video (FFmpeg)
   └── Upload to Firebase Storage
```

### Slideshow Creation Workflow

```
1. ADD AUDIO (optional)
   └── AudioClipSelector for background music

2. INITIALIZE SLIDES
   ├── Batch mode: Auto-generate 10 random from A/B banks
   └── Normal mode: Start empty

3. EDIT SLIDES
   ├── Drag images from ImageA/ImageB banks
   ├── Add text overlays from LyricBank
   └── Apply text templates

4. SET ASPECT RATIO
   ├── 9:16 (portrait, 1080x1920)
   └── 4:3 (landscape, 1080x1440)

5. EXPORT
   └── Generate PNG sequence (one per slide)
```

### Critical Time Invariant

**ALL timing data uses LOCAL TIME:**

```javascript
// LOCAL TIME = 0 at trim start, NOT file start
// When audio is trimmed from 10s to 40s:
//   - File time 10s = Local time 0s
//   - File time 25s = Local time 15s
//   - File time 40s = Local time 30s

// Audio object with trim boundaries
{
  url: "...",
  duration: 180,      // Full file duration
  startTime: 10,      // Trim start (file time)
  endTime: 40         // Trim end (file time)
}

// Word object (LOCAL time)
{
  text: "Hello",
  startTime: 5,       // 5 seconds from trim start
  duration: 0.5
}
```

**When trim boundaries change, ALL words/clips/beats are INVALIDATED.**

---

## 9. Operator Dashboard

### Tabs Overview

| Tab | Purpose | Key Components |
|-----|---------|----------------|
| **Artists** | Multi-artist management | Artist cards, tier display, add artist modal |
| **Pages** | Social account management | Late accounts list, linking/unlinking |
| **Content** | Schedule & manage posts | Calendar/list view, batch scheduling, Late sync |
| **Campaigns** | Campaign tracking | Budget, goals, date ranges, categories |
| **Banks** | Caption/hashtag templates | Category editor, pool management |
| **Studio** | Video creation | Opens VideoStudio modal |
| **Analytics** | Performance metrics | AnalyticsDashboard component |
| **Applications** | Artist onboarding | Review, approve, payment links |
| **Settings** | System config (Conductor only) | User management, allowed users |

### State Management (App.jsx)

```javascript
// Navigation
const [currentPage, setCurrentPage] = useState('home');
const [operatorTab, setOperatorTab] = useState('artists');
const [showVideoEditor, setShowVideoEditor] = useState(false);

// Artist data
const [firestoreArtists, setFirestoreArtists] = useState([]);
const [currentArtistId, setCurrentArtistId] = useState(null);
const [allowedUsers, setAllowedUsers] = useState([]);

// Late.co data
const [latePosts, setLatePosts] = useState([]);
const [lateAccounts, setLateAccounts] = useState([]);
const [artistLateConnected, setArtistLateConnected] = useState(false);

// Content templates
const [contentBanks, setContentBanks] = useState({});

// Applications
const [applications, setApplications] = useState([]);
```

### Session Persistence

```javascript
// Saved to localStorage on change
const APP_SESSION_KEY = 'stm_app_session';
{
  currentPage: 'operator',
  operatorTab: 'content',
  showVideoEditor: false
}

// Restored on app load after auth check
```

---

## 10. Data Flow Patterns

### Real-Time Subscriptions

```javascript
// Firestore real-time listeners (in useEffect)
onSnapshot(collection(db, 'artists'), callback);
onSnapshot(collection(db, 'allowedUsers'), callback);
onSnapshot(collection(db, 'applications'), callback);
onSnapshot(doc(db, 'contentTemplates', artistId), callback);
```

### Artist-Scoped Data

```javascript
// localStorage namespacing
`stm_categories_${artistId}`      // Categories with content
`stm_analytics_${artistId}`       // Analytics snapshots
`stm_linked_accounts_${artistId}` // Account groupings
`stm_last_artist_id`              // Last selected artist
```

### Prop Flow (VideoStudio)

```
VideoStudio
  ├── categories, selectedCategory
  ├── studioMode ('videos' | 'slideshows')
  ├── Bank callbacks (onUploadVideos, onUploadAudio, etc.)
  └── Content callbacks (onCreateContent, onViewContent, etc.)
      ↓
AestheticHome / ContentLibrary / VideoEditorModal
```

---

## 11. Deployment

### Vercel Configuration

```json
// vercel.json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

### Environment Variables

**Client-side (in code):**
```
REACT_APP_FIREBASE_API_KEY
REACT_APP_FIREBASE_AUTH_DOMAIN
REACT_APP_FIREBASE_PROJECT_ID
REACT_APP_FIREBASE_STORAGE_BUCKET
REACT_APP_FIREBASE_MESSAGING_SENDER_ID
REACT_APP_FIREBASE_APP_ID
REACT_APP_CONDUCTOR_EMAILS
```

**Server-side (Vercel dashboard only):**
```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
LATE_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

### Build Command

```bash
CI=false npm run build  # CI=false prevents warnings as errors
```

### Serverless Functions

| Endpoint | File | Purpose |
|----------|------|---------|
| `/api/late` | `api/late.js` | Late.co API proxy with auth |
| `/api/spotify` | `api/spotify.js` | Spotify API proxy |
| `/api/stripe-webhook` | `api/stripe-webhook.js` | Payment webhooks |

---

## 12. Critical Invariants

### 1. LOCAL_TIME_INVARIANT
All clip, word, and beat times are relative to audio trim start (0 = trim start).

### 2. ARTIST_SCOPING_INVARIANT
All data must be scoped to an artist. No global content.

### 3. OPERATOR_ISOLATION_INVARIANT
Operators can only see/modify artists in their `assignedArtistIds`.

### 4. LATE_KEY_SECURITY_INVARIANT
Late API keys are NEVER exposed to client. All calls go through `/api/late` proxy.

### 5. AUTH_BEFORE_DATA_INVARIANT
`allowedUsers` must load before login whitelist check.

### 6. BLOB_URL_EXPIRATION_INVARIANT
Blob URLs expire after session. Always prefer cloud URLs from Firebase Storage.

### 7. TRIM_INVALIDATION_INVARIANT
When audio trim boundaries change, all dependent timing data (words, clips, beats) must be cleared.

---

## Quick Reference: Adding New Features

### Before implementing:

1. **Check affected collections** - Will this need new Firestore data?
2. **Check role permissions** - Who can access this feature?
3. **Check artist scoping** - Is data isolated per artist?
4. **Check time handling** - Does this involve timeline data?
5. **Check Late integration** - Does this affect posting?
6. **Check mobile support** - Use `isMobile` state pattern

### Key files to modify:

| Change Type | Files |
|-------------|-------|
| New dashboard tab | `App.jsx` (state + render) |
| New studio feature | `VideoEditorModal.jsx` or `SlideshowEditor.jsx` |
| New Firestore collection | `firestore.rules` + new service file |
| New API integration | `api/` folder + new service file |
| Role-based access | `utils/roles.js` + component guards |

---

*This document should be updated whenever significant architectural changes are made.*
