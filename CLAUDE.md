# StickToMusic Project Context

## Owner
- **Name**: Zade
- **Email**: zadebatal@gmail.com
- **Role**: Conductor (super admin)

## Tech Stack
- **Frontend**: React (Create React App)
- **Database**: Firebase Firestore
- **Auth**: Firebase Auth (Google sign-in)
- **Hosting**: Vercel (auto-deploys on git push)
- **Storage**: Namespaced localStorage + Firestore

## Architecture

### Multi-Artist System
Each artist has isolated data stored in Firestore (`artists` collection) with namespaced localStorage for categories/presets (`stm_categories_{artistId}`, `stm_presets_{artistId}`).

### Permission Hierarchy
- **Conductor** (Zade): Sees ALL artists, can onboard operators, full Settings access
- **Operators** (sub-admins): Only see their `assignedArtistIds`, no Settings, cannot onboard anyone
- **Artists**: Access only their own portal

### Key Collections (Firestore)
- `artists` - Artist profiles with `ownerOperatorId` for operator assignment
- `allowedUsers` - User access control with `role` and `assignedArtistIds`

## Key Files
- `/src/App.jsx` - Main app with routing, auth, dashboards
- `/src/services/artistService.js` - Firestore CRUD for artists
- `/src/services/storageService.js` - Namespaced localStorage helpers
- `/src/services/firebaseStorage.js` - Firebase config and exports
- `/src/components/VideoEditor/VideoStudio.jsx` - Video/content editor

## Environment Variables
- `REACT_APP_CONDUCTOR_EMAILS` - Comma-separated conductor emails (defaults to zade@sticktomusic.com,zadebatal@gmail.com)

## Deployment
Push to GitHub → Vercel auto-deploys → All users see updates

```bash
git add .
git commit -m "message"
git push
```

## Features Built
- Multi-artist management system
- Conductor/Operator role hierarchy
- Video Studio with slideshow editor
- Content banks (lyrics, hooks, captions)
- Analytics dashboard
- Late API integration
- Artist portal
- Campaign management
