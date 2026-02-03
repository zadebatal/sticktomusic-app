# StickToMusic Domain Invariants (Constitution)

> **Version:** 1.0.0
> **Last Updated:** 2026-02-03
> **Purpose:** Single source of truth for domain models, invariants, and normalization rules.

This document defines the canonical domain models and invariants that ALL subsystems must conform to.
Violations of these invariants are bugs that must be fixed.

---

## A) Time Window (Active Range)

### Source of Truth Fields
```javascript
// In VideoEditorModal state:
selectedAudio: {
  startTime: number,  // GLOBAL: trim start in seconds from file start
  endTime: number,    // GLOBAL: trim end in seconds from file start
  duration: number,   // Full audio file duration
  // Computed: trimmedDuration = endTime - startTime
}
```

### Invariants
1. **LOCAL_TIME_INVARIANT:** All time-based UI/processing uses LOCAL time (0 to trimmedDuration)
2. **GLOBAL_TIME_ONLY_FOR_PLAYBACK:** GLOBAL time is ONLY used for audio/video playback positioning
3. **NORMALIZATION_AT_ENTRY:** Timestamps are normalized when data ENTERS the system, not in consumers

### Normalization Rule
```
External timestamps → Filter to range → Subtract startTime → LOCAL time (0-based)
```

### Coordinate System Reference
| Concept | GLOBAL Time | LOCAL Time |
|---------|-------------|------------|
| Definition | Offset from audio file start | Offset from trim start |
| Range | 0 to audio.duration | 0 to trimmedDuration |
| Used for | Audio playback, seeking | UI timeline, clips, words, beats |

### Utility Functions (src/utils/timelineNormalization.js)
- `normalizeWordsToTrimRange(words, trimStart, trimEnd, options)` → Returns LOCAL words
- `normalizeBeatsToTrimRange(beats, trimStart, trimEnd)` → Returns LOCAL beats
- `localToGlobalTime(localTime, trimStart)` → For playback
- `globalToLocalTime(globalTime, trimStart)` → For display
- `getTrimBoundaries(audio, fallbackDuration)` → Extract trim info
- `validateLocalTimeData(data, trimmedDuration)` → Dev validation

---

## B) Asset Lifecycle (Video/Audio)

### States
```
[Upload/Create] → Raw/Pending → [Firebase Upload] → Persisted → [Load] → Active
```

### Source of Truth Fields
```javascript
// Persisted asset (localStorage/Firestore):
{
  id: string,           // Unique identifier
  url: string,          // Firebase Storage URL (https://...)
  storagePath: string,  // Firebase path for deletion
  duration: number,     // Media duration in seconds
  // For audio with trim:
  startTime: number,    // Trim start (GLOBAL)
  endTime: number,      // Trim end (GLOBAL)
  isTrimmed: boolean,
  // NEVER stored:
  // - localUrl (blob: URLs)
  // - file (File objects)
  // - thumbnail (base64 strings > 1KB)
}
```

### Invariants
1. **NO_BLOB_URL_PERSISTENCE:** Persisted library items NEVER contain `blob:` URLs
2. **NO_FILE_OBJECT_PERSISTENCE:** File objects are NOT serializable and must not be stored
3. **NO_LARGE_THUMBNAILS:** Thumbnails (base64) are stripped before localStorage persistence
4. **DURABLE_URL_REQUIRED:** Assets must have Firebase URL before persistence

### Normalization Rule
```
Upload → Generate blob URL for session → Upload to Firebase → Store Firebase URL only
```

### Utility Functions (src/utils/assets.js - TO BE CREATED)
- `assertNoBlobUrls(object)` → Throws if blob: URL found
- `normalizeAssetForPersistence(asset)` → Strips non-serializable fields
- `isValidPersistedAsset(asset)` → Boolean check

---

## C) Role/Permission (Operator vs Artist)

### Source of Truth
```javascript
// In App.jsx:
const OPERATOR_EMAILS = ['zade@sticktomusic.com', 'zadebatal@gmail.com'];

// User object after auth:
user: {
  email: string,
  role: 'operator' | 'artist',
  // ...
}
```

### Roles
| Role | Access Level |
|------|--------------|
| `operator` | Full access: all artists, Late.co posting, approvals, analytics |
| `artist` | Own content only: own categories, own videos, no Late.co direct access |

### Invariants
1. **SERVER_SIDE_GATES:** Privileged operations (Late.co posting, approvals) MUST be server-gated
2. **UI_ROLE_FILTERING:** Operator-only UI elements NEVER shown to artists
3. **EMAIL_BASED_OPERATOR:** Operator status determined by email match, not user input
4. **NO_ROLE_ESCALATION:** Users cannot change their own role

### Operator-Only Actions
- Direct Late.co API access
- Approve/reject videos
- View all artists
- Access analytics dashboard
- Manage applications

### Utility Functions (src/utils/roles.js - TO BE CREATED)
- `isOperator(email)` → Boolean
- `assertOperator(user)` → Throws if not operator
- `canAccessArtist(user, artistId)` → Boolean
- `filterForRole(items, user)` → Filters items by role access

---

## D) Status Enum Mapping

### Valid Statuses
```javascript
// Video/Project Status
const VIDEO_STATUS = {
  DRAFT: 'draft',           // Initial creation, editing in progress
  RENDERING: 'rendering',   // Video export in progress
  COMPLETED: 'completed',   // Export finished, ready for review
  APPROVED: 'approved',     // Operator approved for posting
};

// Application Status (for artist applications)
const APPLICATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

// Late.co Post Status
const POST_STATUS = {
  SCHEDULED: 'scheduled',
  POSTED: 'posted',
  FAILED: 'failed',
};
```

### Invariants
1. **SINGLE_MAPPING_POINT:** External status strings mapped to internal enum in ONE place
2. **NO_RAW_STATUS_COMPARISON:** Never compare `status === 'draft'`; use enum
3. **STATUS_TRANSITIONS:** Transitions follow state machine (e.g., draft → rendering → completed → approved)

### Utility Functions (src/utils/status.js - TO BE CREATED)
- `VIDEO_STATUS` enum object
- `isValidVideoStatus(status)` → Boolean
- `getStatusDisplay(status)` → Human-readable label
- `canTransitionTo(fromStatus, toStatus)` → Boolean

---

## E) Error/Loading/Empty State Standard

### Invariants
1. **NO_BLANK_STATES:** Every async operation has loading + error + empty states handled
2. **ERROR_WITH_RETRY:** Errors always offer retry action where applicable
3. **LOADING_INDICATOR:** All async ops show loading feedback (spinner, skeleton, or text)
4. **EMPTY_STATE_GUIDANCE:** Empty states guide user to action (not just "No items")

### Required State Pattern
```javascript
// Every async consumer must track:
const [data, setData] = useState(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState(null);

// And render all three states:
if (isLoading) return <LoadingState />;
if (error) return <ErrorState error={error} onRetry={retry} />;
if (!data || data.length === 0) return <EmptyState onAction={action} />;
return <DataView data={data} />;
```

### Async Operations Requiring This Pattern
- Transcription (Whisper, AssemblyAI)
- Beat detection
- Video export
- Firebase upload/download
- Late.co API calls
- Category/preset loading

---

## Enforcement Points (Boundaries)

| Boundary | What to Enforce |
|----------|-----------------|
| After transcription result | Words normalized to LOCAL time |
| After beat detection result | Beats normalized to LOCAL time |
| Before saving to localStorage | No blob URLs, no File objects, no large thumbnails |
| Before saving to library | Asset has durable Firebase URL |
| Before calling Late.co API | User is operator |
| Before rendering timelines | All data in LOCAL time |
| Before status display | Status mapped through enum |

---

## Violation Response

When a violation is detected:
1. **Development:** Console warning + assertion failure
2. **Production:** Console error + graceful fallback
3. **Critical (P0):** Block operation + user-facing error

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-03 | 1.0.0 | Initial constitution |
