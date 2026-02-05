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
- **APIs**: Late.co (social posting), Stripe (payments)

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
- `applications` - Artist signup applications

## Key Files
- `/src/App.jsx` - Main app with routing, auth, dashboards
- `/src/services/artistService.js` - Firestore CRUD for artists
- `/src/services/storageService.js` - Namespaced localStorage helpers
- `/src/services/firebaseStorage.js` - Firebase config and exports
- `/src/services/lateService.js` - Late.co API integration (via proxy)
- `/src/components/VideoEditor/VideoStudio.jsx` - Video/content editor
- `/api/late.js` - Serverless proxy for Late API (auth required)
- `/api/stripe-webhook.js` - Stripe payment webhook handler
- `/firestore.rules` - Firestore security rules

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
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LATE_API_KEY`

## Security Notes
- All API keys loaded from environment variables (never hardcoded)
- Late API calls go through authenticated serverless proxy
- Firestore rules enforce role-based access control
- File uploads validated for type and size (500MB max)
- CORS restricted to sticktomusic.com domains only

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
- Late API integration (authenticated proxy)
- Artist portal
- Campaign management
- Stripe payment integration
