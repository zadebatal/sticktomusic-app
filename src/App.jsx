import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Shared UI Components
import {
  LoadingSpinner,
  LoadingOverlay,
  ErrorPanel,
  EmptyState as SharedEmptyState,
  ConfirmDialog,
  StatusPill,
  PageHeader,
  Button as UIButton,
  HelperText,
  ToastProvider
} from './components/ui';

// Video Studio - Flowstage-inspired workflow
import { VideoStudio, SchedulingPage } from './components/VideoEditor';

// Analytics Dashboard
import { AnalyticsDashboard } from './components/Analytics';

// Theme system
import { ThemeProvider, THEMES } from './contexts/ThemeContext';

// New UI components (redesign)
import LandingPage from './components/LandingPage';
import AppShell from './components/AppShell';
import PagesTab from './components/tabs/PagesTab';
import SettingsTab from './components/tabs/SettingsTab';
import ArtistDashboard from './components/tabs/ArtistDashboard';
import ArtistsManagement from './components/tabs/ArtistsManagement';
import OnboardingWizard from './components/OnboardingWizard';

// Domain enforcement utilities
import { isUserOperator, isArtistOrCollaborator, getEffectiveArtistId, ROLES } from './utils/roles';

// Subscription service
import { computeSocialSetsUsed, canAddSocialSet, shouldShowPaymentUI } from './services/subscriptionService';

// Cloud services
import { initDropbox } from './services/dropboxService';

// Initialize Dropbox if app key is configured
if (process.env.REACT_APP_DROPBOX_APP_KEY) {
  initDropbox(process.env.REACT_APP_DROPBOX_APP_KEY);
}

// Artist Service for multi-artist management
import {
  subscribeToArtists,
  subscribeToArtistById,
  ensureBoonArtistExists,
  getLastArtistId,
  setLastArtistId,
  createArtist,
  updateArtist,
  deleteArtist,
  getLinkedAccountGroups,
  linkAccounts,
  unlinkAccount
} from './services/artistService';

// Late Service - for per-artist Late connection status
import { getArtistLateKeyStatus, setArtistLateKey, removeArtistLateKey } from './services/lateService';

// Content Template Service - reusable caption/hashtag templates
import {
  subscribeToTemplates,
  saveCategory,
  deleteCategory,
  resetToDefaults,
  generateFromTemplate,
  getCategoryNames,
  DEFAULT_TEMPLATES
} from './services/contentTemplateService';

// Firebase Storage for video uploads
import { uploadFile } from './services/firebaseStorage';

// Firebase imports
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  doc,
  onSnapshot
} from 'firebase/firestore';
import log from './utils/logger';
import { loadSettings, saveSettings, clearSettingsCache } from './services/settingsService';

// Firebase configuration - loaded from environment variables for security
// Set these in .env.local for development or Vercel dashboard for production
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Initialize Firebase only if not already initialized (prevents duplicate-app error)
let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// Stripe Configuration - loaded from environment variable for security
const STRIPE_PUBLISHABLE_KEY = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;

// Conductor emails (these users get full conductor/super-admin access)
// Can be overridden via REACT_APP_CONDUCTOR_EMAILS environment variable (comma-separated)
// Conductors can see ALL artists and onboard operators
// Operators (added via allowedUsers) can only see their assigned artists
const CONDUCTOR_EMAILS = (process.env.REACT_APP_CONDUCTOR_EMAILS || 'zade@sticktomusic.com,zadebatal@gmail.com')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

// Late API Configuration - API key is now stored securely in Vercel environment variables
// The /api/late serverless function proxies requests with the key
const LATE_API_PROXY = '/api/late';

// Centralized Platform Configuration - supports TikTok, Instagram, Facebook, YouTube
// Add new platforms here and they'll work across the entire app
const PLATFORMS = {
  tiktok: {
    key: 'tiktok',
    label: 'TT',
    fullName: 'TikTok',
    bgColor: 'bg-pink-500/20',
    textColor: 'text-pink-400',
    hoverBg: 'hover:bg-pink-500/30',
    icon: '♪',
    urlPattern: (username) => `https://www.tiktok.com/@${username}`,
    weight: 1.0  // For analytics attribution
  },
  instagram: {
    key: 'instagram',
    label: 'IG',
    fullName: 'Instagram',
    bgColor: 'bg-purple-500/20',
    textColor: 'text-purple-400',
    hoverBg: 'hover:bg-purple-500/30',
    icon: '◐',
    urlPattern: (username) => `https://www.instagram.com/${username}`,
    weight: 0.85
  },
  facebook: {
    key: 'facebook',
    label: 'FB',
    fullName: 'Facebook',
    bgColor: 'bg-blue-500/20',
    textColor: 'text-blue-400',
    hoverBg: 'hover:bg-blue-500/30',
    icon: 'f',
    urlPattern: (username) => `https://www.facebook.com/${username}`,
    weight: 0.7
  },
  youtube: {
    key: 'youtube',
    label: 'YT',
    fullName: 'YouTube',
    bgColor: 'bg-red-500/20',
    textColor: 'text-red-400',
    hoverBg: 'hover:bg-red-500/30',
    icon: '▶',
    urlPattern: (username) => `https://www.youtube.com/@${username}`,
    weight: 0.9
  }
};

// Platform helper functions
const getPlatformConfig = (platform) => {
  // Normalize platform names (Late API might return 'tik_tok', 'TikTok', etc.)
  const normalized = (platform || '').toLowerCase().replace('_', '').replace(' ', '');
  const key = normalized === 'tiktok' ? 'tiktok'
    : normalized === 'instagram' ? 'instagram'
    : normalized === 'facebook' ? 'facebook'
    : normalized === 'youtube' ? 'youtube'
    : null;
  return PLATFORMS[key] || PLATFORMS.tiktok; // Fallback to TikTok styling
};

const getPlatformUrl = (platform, username) => {
  const config = getPlatformConfig(platform);
  const cleanUsername = (username || '').replace('@', '');
  return config.urlPattern(cleanUsername);
};

const getPlatformKeys = () => Object.keys(PLATFORMS);


// Helper to get Firebase auth token for API requests
async function getFirebaseToken() {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user.getIdToken();
}

// Late API Functions - now using secure serverless proxy with Firebase auth
const lateApi = {
  async fetchAccounts(artistId = null) {
    try {
      const token = await getFirebaseToken();
      const url = artistId
        ? `${LATE_API_PROXY}?action=accounts&artistId=${artistId}`
        : `${LATE_API_PROXY}?action=accounts`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      const data = await response.json();
      // Handle different response formats
      const accounts = data.accounts || data.data || (Array.isArray(data) ? data : []);
      return { success: true, accounts };
    } catch (error) {
      console.warn('[Late] fetchAccounts:', error.message);
      return { success: false, error: error.message };
    }
  },

  async schedulePost({ platforms, caption, videoUrl, scheduledFor, artistId = null, type = 'video', images = null, audioUrl = null }) {
    try {
      const token = await getFirebaseToken();
      // Validate required fields
      if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
        throw new Error('No platforms selected for posting. Please select TikTok or Instagram.');
      }
      if (type !== 'carousel' && !videoUrl) {
        throw new Error('No video URL provided. The video must be rendered/exported before posting.');
      }
      if (type === 'carousel' && (!images || images.length === 0)) {
        throw new Error('No carousel images provided');
      }
      if (!scheduledFor) {
        throw new Error('No schedule time provided');
      }

      // Build media items based on post type
      const mediaItems = type === 'carousel'
        ? images.map(img => ({ type: 'image', url: img.url }))
        : [{ type: 'video', url: videoUrl }];

      // Late API payload — only include fields Late expects (platform + accountId)
      const hasTikTok = platforms.some(p => p.platform === 'tiktok');
      const isCarousel = type === 'carousel';
      const payload = {
        content: caption || '',
        mediaItems,
        platforms: platforms.map(p => ({
          platform: p.platform,
          accountId: p.accountId
        })),
        scheduledFor,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'
      };

      // TikTok requires specific settings for all posts
      if (hasTikTok) {
        payload.tiktokSettings = {
          privacyLevel: 'PUBLIC_TO_EVERYONE',
          allowComment: true,
          contentPreviewConfirmed: true,
          expressConsentGiven: true,
          ...(isCarousel
            ? {
                // Send to TikTok creator inbox (not publish directly)
                draft: true,
                mediaType: 'photo',
                photoCoverIndex: 0,
                autoAddMusic: true
              }
            : { allowDuet: true, allowStitch: true })
        };
        // NOTE: Do NOT set isDraft=true at root level — that creates a Late draft.
        // tiktokSettings.draft=true tells Late to use TikTok's Creator Inbox
        // (MEDIA_UPLOAD mode) so the artist can add music/effects before posting.
      }

      log('Sending to Late:', JSON.stringify(payload, null, 2));

      // Use action=posts in query string (consistent with other endpoints)
      const url = artistId
        ? `${LATE_API_PROXY}?action=posts&artistId=${artistId}`
        : `${LATE_API_PROXY}?action=posts`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed: ${response.status}`);
      }
      return { success: true, post: await response.json() };
    } catch (error) {
      console.warn('[Late] schedulePost:', error.message);
      return { success: false, error: error.message };
    }
  },

  async fetchScheduledPosts(page = 1, artistId = null) {
    try {
      const token = await getFirebaseToken();
      // Fetch all pages of posts
      let allPosts = [];
      let currentPage = page;
      let hasMore = true;

      while (hasMore) {
        const url = artistId
          ? `${LATE_API_PROXY}?action=posts&page=${currentPage}&artistId=${artistId}`
          : `${LATE_API_PROXY}?action=posts&page=${currentPage}`;
        log('📡 Fetching Late posts from:', url);
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        log('📡 Late API response status:', response.status);
        if (!response.ok) throw new Error(`Failed: ${response.status}`);
        const data = await response.json();
        log('📡 Late API raw response:', JSON.stringify(data, null, 2));
        const posts = data.posts || data.data || data || [];
        log('📡 Extracted posts count:', posts.length);

        if (Array.isArray(posts) && posts.length > 0) {
          allPosts = [...allPosts, ...posts];
          currentPage++;
          // Stop if we got fewer than the limit (last page)
          if (posts.length < 50) hasMore = false;
        } else {
          hasMore = false;
        }

        // Safety limit to prevent infinite loops
        if (currentPage > 20) hasMore = false;
      }

      return { success: true, posts: allPosts };
    } catch (error) {
      console.warn('[Late] fetchScheduledPosts:', error.message);
      return { success: false, error: error.message };
    }
  },

  async deletePost(postId, artistId = null) {
    try {
      const token = await getFirebaseToken();
      const url = artistId
        ? `${LATE_API_PROXY}?action=delete&postId=${postId}&artistId=${artistId}`
        : `${LATE_API_PROXY}?action=delete&postId=${postId}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${response.status}`);
      }
      return { success: true };
    } catch (error) {
      console.warn('[Late] deletePost:', error.message);
      return { success: false, error: error.message };
    }
  }
};

// App-level session persistence
const APP_SESSION_KEY = 'stm_app_session';

const loadAppSession = () => {
  try {
    const saved = localStorage.getItem(APP_SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      log.debug('[App Session] Loaded:', parsed);
      return parsed;
    }
  } catch (e) {
    console.warn('Failed to load app session:', e);
  }
  return null;
};

const saveAppSession = (state) => {
  try {
    // Only save authenticated pages (not landing/marketing pages)
    if (['operator', 'artist-portal', 'artist-dashboard', 'dashboard'].includes(state.currentPage)) {
      localStorage.setItem(APP_SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
      log.debug('[App Session] Saved:', state);
    }
  } catch (e) {
    console.warn('Failed to save app session:', e);
  }
};

const StickToMusic = () => {
  // React Router hooks for URL-based navigation
  const navigate = useNavigate();
  const location = useLocation();

  // Detect Safari private mode and check localStorage availability
  const [showPrivateModeWarning, setShowPrivateModeWarning] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem('_stm_test', '1');
      localStorage.removeItem('_stm_test');
    } catch (e) {
      console.error('[App] Private mode detected or localStorage disabled');
      setShowPrivateModeWarning(true);
    }
  }, []);

  // Detect checkout success from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      // Clean up URL
      const url = new URL(window.location);
      url.searchParams.delete('checkout');
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', url.pathname);
    }
  }, []);

  // Offline detection
  useEffect(() => {
    const handleOnline = () => console.log('[App] Back online');
    const handleOffline = () => console.warn('[App] Offline mode');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Parse initial state from URL
  const getInitialStateFromUrl = () => {
    const path = location.pathname;
    if (path.startsWith('/operator/studio')) {
      return { page: 'operator', tab: 'studio', showStudio: true };
    } else if (path.startsWith('/operator/')) {
      const tab = path.replace('/operator/', '').split('/')[0] || 'artists';
      return { page: 'operator', tab, showStudio: false };
    } else if (path === '/operator') {
      return { page: 'operator', tab: 'artists', showStudio: false };
    }
    return { page: 'home', tab: 'artists', showStudio: false };
  };

  const initialState = getInitialStateFromUrl();

  // Load saved page - but only use it after auth is confirmed
  const savedAppSession = loadAppSession();
  const [currentPage, setCurrentPage] = useState(initialState.page);
  const [pendingPage, setPendingPage] = useState(savedAppSession?.currentPage || null);
  const [pendingOperatorTab, setPendingOperatorTab] = useState(savedAppSession?.operatorTab || null);
  const [pendingShowVideoEditor, setPendingShowVideoEditor] = useState(savedAppSession?.showVideoEditor || false);
  const [sessionRestoreComplete, setSessionRestoreComplete] = useState(!savedAppSession); // Skip if no saved session
  const [operatorTab, setOperatorTab] = useState(initialState.tab); // Moved up for restore effect
  const [showVideoEditor, setShowVideoEditor] = useState(initialState.showStudio); // Moved up for restore effect
  const [artistTab, setArtistTab] = useState('dashboard'); // Tab for artist-dashboard view
  const [artistScheduleFilter, setArtistScheduleFilter] = useState(null); // Filter for artist schedule tab
  const [openFaq, setOpenFaq] = useState(null);

  // ═══ Theme bridge: since ThemeProvider wraps return JSX, we listen for changes via custom event ═══
  const [appThemeId, setAppThemeId] = useState(() => {
    try { return localStorage.getItem('stm_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    const handler = (e) => setAppThemeId(e.detail);
    window.addEventListener('stm-theme-change', handler);
    return () => window.removeEventListener('stm-theme-change', handler);
  }, []);
  const t = (THEMES[appThemeId] || THEMES.dark).tw;

  // Sync URL when navigation state changes
  useEffect(() => {
    let targetPath = '/';
    if (currentPage === 'operator') {
      if (showVideoEditor) {
        targetPath = '/operator/studio';
      } else {
        targetPath = `/operator/${operatorTab}`;
      }
    } else if (currentPage === 'artist-dashboard') {
      targetPath = `/artist/${artistTab}`;
    }
    // Only update if path is different to avoid loops
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: false });
    }
  }, [currentPage, operatorTab, showVideoEditor, artistTab]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/operator/studio')) {
      if (currentPage !== 'operator') setCurrentPage('operator');
      if (!showVideoEditor) setShowVideoEditor(true);
    } else if (path.startsWith('/operator/')) {
      const tab = path.replace('/operator/', '').split('/')[0] || 'artists';
      if (currentPage !== 'operator') setCurrentPage('operator');
      if (showVideoEditor) setShowVideoEditor(false);
      if (operatorTab !== tab) setOperatorTab(tab);
    } else if (path === '/operator') {
      if (currentPage !== 'operator') setCurrentPage('operator');
      if (showVideoEditor) setShowVideoEditor(false);
    } else if (path.startsWith('/artist/')) {
      const tab = path.replace('/artist/', '').split('/')[0] || 'dashboard';
      if (currentPage !== 'artist-dashboard') setCurrentPage('artist-dashboard');
      if (artistTab !== tab) setArtistTab(tab);
    } else if (path === '/' || path === '') {
      // Don't override artist-dashboard or operator pages on root path
      if (currentPage !== 'home' && currentPage !== 'artist-dashboard' && currentPage !== 'operator') {
        setCurrentPage('home');
      }
    }
  }, [location.pathname]);

  // Authentication state
  const [user, setUser] = useState(null); // { email, role, name, artistId }
  const [currentAuthUser, setCurrentAuthUser] = useState(null); // Firebase auth user object
  const [authChecked, setAuthChecked] = useState(false); // True once initial auth check completes
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '', error: null });
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupForm, setSignupForm] = useState({ email: '', password: '', name: '', role: 'artist', error: null });
  const [authError, setAuthError] = useState(null);

  // Add Artist modal
  const [showAddArtistModal, setShowAddArtistModal] = useState(false);
  const [addArtistForm, setAddArtistForm] = useState({ name: '', tier: 'Scale', cdTier: 'CD Lite', assignedOperatorId: '', artistEmail: '', socialSetsForArtist: 5, error: null, isLoading: false });
  const [deleteArtistConfirm, setDeleteArtistConfirm] = useState({ show: false, artist: null, isDeleting: false });
  const [reassignArtist, setReassignArtist] = useState({ show: false, artist: null });
  const [editArtistModal, setEditArtistModal] = useState({ show: false, artist: null, activeSince: '', isSaving: false });

  // Firestore data - allowed users loaded from database
  const [allowedUsers, setAllowedUsers] = useState([]);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);

  // Multi-artist state - artists loaded from Firestore
  const [firestoreArtists, setFirestoreArtists] = useState([]);
  const [currentArtistId, setCurrentArtistId] = useState(() => getLastArtistId() || null); // Restore last selected artist, validated by subscription
  const [artistsLoaded, setArtistsLoaded] = useState(false);

  // Master auth listener - tracks Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      log('🔐 Auth state changed:', firebaseUser?.email || 'null');
      setCurrentAuthUser(firebaseUser);
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  // Load allowed users from Firestore
  // Re-subscribes when auth state changes (e.g., after login) because Firestore rules
  // require authentication to read allowedUsers. Before login the query fails, so we
  // retry once currentAuthUser is set.
  useEffect(() => {
    if (!authChecked) {
      log('⏳ Waiting for auth check...');
      return;
    }

    // Don't query Firestore when not authenticated — rules require auth.
    // Mark loaded so the landing page can render; after login this effect re-fires.
    if (!currentAuthUser) {
      log('👤 Not authenticated — skipping allowedUsers query');
      setAllowedUsers([]);
      setFirestoreLoaded(true);
      return;
    }

    // Reset firestoreLoaded so user-resolution effect waits for fresh data
    // (prevents race condition where user is resolved against stale/empty allowedUsers)
    setFirestoreLoaded(false);

    log('📥 Loading allowedUsers from Firestore...', `(as ${currentAuthUser.email})`);
    const unsubscribe = onSnapshot(
      collection(db, 'allowedUsers'),
      (snapshot) => {
        const rawUsers = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        // Deduplicate by email, keeping highest-privilege role (conductor > operator > artist)
        const roleOrder = { conductor: 3, operator: 2, artist: 1 };
        const userMap = new Map();
        rawUsers.forEach(user => {
          const email = user.email?.toLowerCase();
          if (!email) return;

          const existing = userMap.get(email);
          const currentPriority = roleOrder[user.role] || 0;
          const existingPriority = existing ? (roleOrder[existing.role] || 0) : -1;

          if (currentPriority > existingPriority) {
            userMap.set(email, user);
          }
        });

        const users = Array.from(userMap.values());
        setAllowedUsers(users);
        setFirestoreLoaded(true);
        log('✅ Loaded allowed users:', users.length, '(deduped from', rawUsers.length, ')');
      },
      (error) => {
        console.error('❌ Error loading allowed users:', error);
        // Authenticated but still failed — real permissions issue, proceed anyway
        setFirestoreLoaded(true);
      }
    );
    return () => unsubscribe();
  }, [authChecked, currentAuthUser]);

  // Track if we've already initialized Boon artist (prevents double-calls)
  const boonInitializedRef = useRef(false);

  // Subscribe to artists from Firestore (for multi-artist support)
  useEffect(() => {
    if (!authChecked || !currentAuthUser) {
      setArtistsLoaded(true);
      return;
    }

    // Wait for allowedUsers to load before subscribing — otherwise we can't
    // determine the user's role and may issue a collection query that fails
    // for artist/collaborator roles.
    if (!firestoreLoaded) return;

    // Reset so loadLatePages effect re-fires when real data arrives
    // (artistsLoaded may already be true from the unauthenticated early-return)
    setArtistsLoaded(false);

    log('📥 Loading artists from Firestore...');

    // Determine if current user is a conductor (super-admin)
    const isCond = CONDUCTOR_EMAILS.includes(currentAuthUser?.email?.toLowerCase());

    // Only ensure Boon exists for conductor users — Boon is the conductor's default artist.
    // Non-conductors must only see their assigned artists, never Boon.
    if (!boonInitializedRef.current && isCond) {
      boonInitializedRef.current = true;
      ensureBoonArtistExists(db).then((boonArtist) => {
        if (boonArtist && !currentArtistId) {
          log('🎵 Setting default artist to Boon:', boonArtist.id);
          setCurrentArtistId(boonArtist.id);
          setLastArtistId(boonArtist.id);
        }
      }).catch((err) => {
        console.warn('Could not ensure Boon exists:', err.message);
      });
    }

    // Determine the user's role and linked artist from allowedUsers
    const userRecord = allowedUsers.find(u => u.email?.toLowerCase() === currentAuthUser?.email?.toLowerCase());
    const userRole = userRecord?.role;
    const isUserConductor = userRole === 'conductor' || isCond;
    const isArtistOrCollab = userRole === 'artist' || userRole === 'collaborator';
    const linkedArtistId = userRecord?.linkedArtistId || userRecord?.artistId;

    // For artist/collaborator roles: subscribe to just their linked artist document
    // For conductor/operator roles: subscribe to all artists
    let unsubscribe;

    if (isArtistOrCollab && linkedArtistId) {
      log('📥 Artist/collaborator mode — subscribing to linked artist:', linkedArtistId);
      unsubscribe = subscribeToArtistById(db, linkedArtistId, (artists) => {
        log('✅ Loaded linked artist:', artists.length, artists.map(a => a.name).join(', '));
        setFirestoreArtists(artists);
        setArtistsLoaded(true);
        if (artists.length > 0) {
          setCurrentArtistId(artists[0].id);
          setLastArtistId(artists[0].id);
        }
      });
    } else {
      // Conductor/operator: subscribe to all artists
      unsubscribe = subscribeToArtists(db, (artists) => {
        log('✅ Loaded artists:', artists.length, artists.map(a => a.name).join(', '));
        setFirestoreArtists(artists);
        setArtistsLoaded(true);

        if (artists.length > 0) {
          const userId = userRecord?.id || null;
          const visibleArtists = isUserConductor ? artists : artists.filter(a =>
            userId && a.ownerOperatorId === userId
          );

          log('🔐 Artist isolation check:', {
            email: currentAuthUser?.email,
            isUserConductor,
            userId,
            visibleCount: visibleArtists.length,
            currentArtistId
          });

          const currentIsValid = currentArtistId && visibleArtists.find(a => a.id === currentArtistId);
          if (!currentIsValid) {
            if (visibleArtists.length > 0) {
              const lastId = getLastArtistId();
              const artistToSelect = lastId && visibleArtists.find(a => a.id === lastId)
                ? lastId
                : visibleArtists[0].id;
              setCurrentArtistId(artistToSelect);
              setLastArtistId(artistToSelect);
            } else if (!isUserConductor) {
              log('⚠️ Non-conductor has no assigned artists, clearing selection');
              setCurrentArtistId(null);
            }
          }
        }
      });
    }

    return () => unsubscribe();
  }, [authChecked, currentAuthUser, allowedUsers]);

  // Check Late connection status for an artist
  const checkArtistLateStatus = async (artistId) => {
    if (!artistId) {
      setArtistLateConnected(false);
      return false;
    }

    setCheckingLateStatus(true);
    try {
      const status = await getArtistLateKeyStatus(artistId);
      log.debug('🔗 Late status for artist', artistId, ':', status);
      setArtistLateConnected(status.configured);
      return status.configured;
    } catch (error) {
      log.debug('[Late] Status check unavailable (expected in dev):', error.message);
      setArtistLateConnected(false);
      return false;
    } finally {
      setCheckingLateStatus(false);
    }
  };

  // Handle artist change
  const handleArtistChange = async (newArtistId) => {
    log('🎵 Switching to artist:', newArtistId);
    setCurrentArtistId(newArtistId);
    setLastArtistId(newArtistId);

    // C-06: Clear ALL artist-dependent state — not just posts
    setLatePosts([]);
    setLastSynced(null);
    setSelectedPosts(new Set());
    setDayDetailDrawer({ isOpen: false, date: null, posts: [] });

    // BUG-009: Reset content filters so stale filters don't carry across artists
    setPostSearch('');
    setPostPlatformFilter('all');
    setContentStatus('all');

    // BUG-010: Clear settings cache for previous artist, load new artist's settings
    if (currentArtistId) clearSettingsCache(currentArtistId);
    loadSettings(db, newArtistId).then(settings => {
      log('[App] Loaded settings for artist:', newArtistId, settings);
    }).catch(() => {});

    // Check if new artist has Late connected
    const hasLate = await checkArtistLateStatus(newArtistId);

    // If artist has Late connected, fetch their posts
    if (hasLate) {
      try {
        const result = await lateApi.fetchScheduledPosts(1, newArtistId);
        if (result.success) {
          setLatePosts(result.posts || []);
          setLastSynced(new Date());
        } else if (result.error && result.error.includes('401')) {
          // Stale key — auto-remove to stop future 401s
          try { await removeArtistLateKey(newArtistId); } catch (_) {}
          setArtistLateConnected(false);
        }
      } catch (error) {
        console.warn('Error fetching Late posts for new artist:', error.message);
      }
    }
  };

  // Check Late status when currentArtistId changes (including initial load)
  useEffect(() => {
    if (currentArtistId && authChecked && currentAuthUser) {
      checkArtistLateStatus(currentArtistId);
    }
  }, [currentArtistId, authChecked, currentAuthUser]);

  // Load Late pages on startup once artists are loaded (populates derivedLateAccountIds)
  useEffect(() => {
    if (artistsLoaded && authChecked && currentAuthUser && firestoreArtists.length > 0) {
      loadLatePages();
    }
  }, [artistsLoaded, authChecked, currentAuthUser]);

  // Load Late pages (connected accounts) for all artists with Late configured
  const loadLatePages = async () => {
    // Only load pages for artists this user can see
    const visibleArtists = getVisibleArtists();
    const artistsToLoad = firestoreArtists.filter(a => visibleArtists.some(v => v.id === a.id));
    if (!artistsToLoad.length || loadingLatePages) return;

    setLoadingLatePages(true);
    const allPages = [];
    const unconfigured = [];

    try {
      for (const artist of artistsToLoad) {
        try {
          // Check if this artist has Late configured
          const status = await getArtistLateKeyStatus(artist.id);
          if (!status.configured) {
            unconfigured.push({ id: artist.id, name: artist.name });
            continue;
          }

          // Fetch accounts from Late API
          const result = await lateApi.fetchAccounts(artist.id);
          if (result.success && result.accounts) {
            // Transform Late accounts to page format
            result.accounts.forEach((account) => {
              const realId = account._id || account.id || account.account_id;
              if (!realId) {
                console.warn(`[Late] Skipping account without ID for ${artist.name}:`, JSON.stringify(account));
                return;
              }
              const platform = (account.platform || account.type || '').toLowerCase();
              allPages.push({
                id: `${artist.id}-${realId}`,
                handle: account.username ? `@${account.username.replace('@', '')}` : (account.handle || account.name || 'Unknown'),
                platform: platform === 'tik_tok' ? 'tiktok' : platform,
                artist: artist.name,
                artistId: artist.id,
                niche: artist.niche || 'General',
                followers: account.followers_count || account.followers || 0,
                views: account.total_views || account.views || 0,
                status: account.is_active !== false ? 'active' : 'inactive',
                profileImage: account.profile_image || account.avatar,
                lateAccountId: String(realId)
              });
            });
          } else if (!result.success && result.error && result.error.includes('401')) {
            // Key is stale or revoked — auto-remove it to stop future 401s
            try { await removeArtistLateKey(artist.id); } catch (_) {}
            unconfigured.push({ id: artist.id, name: artist.name });
          }
        } catch (artistError) {
          // If we get a 403 or other error for this artist, treat as unconfigured
          console.warn(`Late API error for ${artist.name}:`, artistError.message);
          unconfigured.push({ id: artist.id, name: artist.name });
        }
      }

      setLatePages(allPages);
      setUnconfiguredLateArtists(unconfigured);
      log('📱 Loaded', allPages.length, 'Late pages from', artistsToLoad.length, 'artists,', unconfigured.length, 'unconfigured');
    } catch (error) {
      console.error('Error loading Late pages:', error);
    } finally {
      setLoadingLatePages(false);
    }
  };

  // ═══ Manual Account Entry ═══
  // Save manual accounts to Firestore artist doc, returns status array for UI feedback
  const handleAddManualAccounts = async (artistId, accounts) => {
    if (!db || !artistId || !accounts.length) return [];

    const artist = firestoreArtists.find(a => a.id === artistId);
    const existing = artist?.manualAccounts || [];

    // Dedup: skip if same handle+platform already exists
    const newAccounts = accounts.filter(acc =>
      !existing.some(e =>
        e.handle?.replace('@', '').toLowerCase() === acc.handle?.replace('@', '').toLowerCase() &&
        e.platform === acc.platform
      )
    ).map(acc => ({
      ...acc,
      addedAt: new Date().toISOString(),
      addedBy: user?.email || 'unknown',
    }));

    if (newAccounts.length === 0) {
      showToast('All accounts already exist', 'info');
      return accounts.map(a => ({ ...a, status: 'duplicate' }));
    }

    const merged = [...existing, ...newAccounts];

    try {
      await updateArtist(db, artistId, { manualAccounts: merged });
      log('✅ Added', newAccounts.length, 'manual accounts for artist', artistId);
      showToast(`Added ${newAccounts.length} account${newAccounts.length !== 1 ? 's' : ''}`, 'success');
      return newAccounts.map(a => ({ ...a, status: 'saved' }));
    } catch (err) {
      console.error('Failed to save manual accounts:', err);
      showToast('Failed to save accounts', 'error');
      return accounts.map(a => ({ ...a, status: 'error' }));
    }
  };

  // Remove a single manual account by index
  const handleRemoveManualAccount = async (artistId, index) => {
    if (!db || !artistId) return;
    const artist = firestoreArtists.find(a => a.id === artistId);
    const existing = [...(artist?.manualAccounts || [])];
    if (index >= 0 && index < existing.length) {
      existing.splice(index, 1);
      try {
        await updateArtist(db, artistId, { manualAccounts: existing });
        showToast('Account removed', 'success');
      } catch (err) {
        console.error('Failed to remove manual account:', err);
        showToast('Failed to remove account', 'error');
      }
    }
  };

  // Handle adding a new artist
  const handleAddArtist = async (e) => {
    e.preventDefault();
    if (!addArtistForm.name.trim()) {
      setAddArtistForm(prev => ({ ...prev, error: 'Artist name is required' }));
      return;
    }

    setAddArtistForm(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // For operators, auto-assign to themselves if no operator selected
      // For conductors, use the selected operator (or none)
      const currentUserRecord = allowedUsers.find(u => u.email?.toLowerCase() === user?.email?.toLowerCase());
      const assignToOperatorId = isConductor(user)
        ? addArtistForm.assignedOperatorId || null
        : currentUserRecord?.id || null; // Operators auto-assign to themselves

      const newArtist = await createArtist(db, {
        name: addArtistForm.name.trim(),
        tier: addArtistForm.tier,
        cdTier: addArtistForm.cdTier,
        ownerOperatorId: assignToOperatorId
      });

      log('✅ Created new artist:', newArtist);

      // Auto-assign artist to the operator (either selected or self)
      if (assignToOperatorId) {
        const operatorUser = allowedUsers.find(u => u.id === assignToOperatorId);
        if (operatorUser && operatorUser.email) {
          // Use email as doc ID — matches Firestore security rules (allowedUsers/{email})
          const operatorRef = doc(db, 'allowedUsers', operatorUser.email.toLowerCase());
          const currentAssigned = operatorUser.assignedArtistIds || [];
          await updateDoc(operatorRef, {
            assignedArtistIds: [...currentAssigned, newArtist.id]
          });
          log('✅ Assigned artist to operator:', operatorUser.email);
        }
      }

      // If artist email provided, create allowedUsers record so the artist can log in
      if (addArtistForm.artistEmail?.trim()) {
        const artistEmail = addArtistForm.artistEmail.trim().toLowerCase();
        try {
          await setDoc(doc(db, 'allowedUsers', artistEmail), {
            email: artistEmail,
            name: addArtistForm.name.trim(),
            role: 'artist',
            artistId: newArtist.id,
            socialSetsAllocated: addArtistForm.socialSetsForArtist || 5,
            socialSetsAllowed: addArtistForm.socialSetsForArtist || 5,
            status: 'active',
            ownerOperatorId: assignToOperatorId,
            onboardingComplete: false,
            createdAt: new Date().toISOString(),
            invitedBy: user?.email || 'unknown',
          });
          log('✅ Created allowedUsers record for artist:', artistEmail);
        } catch (err) {
          console.warn('Could not create allowedUsers record:', err);
        }
      }

      // Select the new artist
      setCurrentArtistId(newArtist.id);
      setLastArtistId(newArtist.id);

      // Close modal and reset form
      setShowAddArtistModal(false);
      setAddArtistForm({ name: '', assignedOperatorId: '', artistEmail: '', socialSetsForArtist: 5, error: null, isLoading: false });
    } catch (error) {
      console.error('Failed to create artist:', error);
      setAddArtistForm(prev => ({ ...prev, error: error.message || 'Failed to create artist', isLoading: false }));
    }
  };

  // Handle deleting an artist (Firestore + cleanup)
  const handleDeleteArtist = async () => {
    const artist = deleteArtistConfirm.artist;
    if (!artist) return;
    setDeleteArtistConfirm(prev => ({ ...prev, isDeleting: true }));
    try {
      await deleteArtist(db, artist.id);
      // If we just deleted the currently selected artist, switch to another
      if (currentArtistId === artist.id) {
        const remaining = firestoreArtists.filter(a => a.id !== artist.id);
        if (remaining.length > 0) {
          setCurrentArtistId(remaining[0].id);
          setLastArtistId(remaining[0].id);
        } else {
          setCurrentArtistId(null);
          setLastArtistId(null);
        }
      }
      // Also remove from any operator's assignedArtistIds
      for (const u of allowedUsers) {
        if (u.assignedArtistIds?.includes(artist.id)) {
          const operatorRef = doc(db, 'allowedUsers', u.email.toLowerCase());
          await updateDoc(operatorRef, {
            assignedArtistIds: u.assignedArtistIds.filter(id => id !== artist.id)
          });
        }
      }
      log('Deleted artist:', artist.id, artist.name);
    } catch (error) {
      console.error('Failed to delete artist:', error);
      showToast('Failed to delete artist: ' + error.message, 'error');
    }
    setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false });
  };

  // Handle reassigning an artist to a different operator
  const handleReassignArtist = async (artistId, newOwnerId) => {
    try {
      await updateArtist(db, artistId, { ownerOperatorId: newOwnerId || null });
      // Update assignedArtistIds for old and new operators
      const artist = firestoreArtists.find(a => a.id === artistId);
      // Remove from old operator's assignedArtistIds
      if (artist?.ownerOperatorId) {
        const oldOwner = allowedUsers.find(u => u.id === artist.ownerOperatorId);
        if (oldOwner?.email && oldOwner.assignedArtistIds?.includes(artistId)) {
          const oldRef = doc(db, 'allowedUsers', oldOwner.email.toLowerCase());
          await updateDoc(oldRef, {
            assignedArtistIds: oldOwner.assignedArtistIds.filter(id => id !== artistId)
          });
        }
      }
      // Add to new operator's assignedArtistIds
      if (newOwnerId) {
        const newOwner = allowedUsers.find(u => u.id === newOwnerId);
        if (newOwner?.email) {
          const newRef = doc(db, 'allowedUsers', newOwner.email.toLowerCase());
          const currentAssigned = newOwner.assignedArtistIds || [];
          if (!currentAssigned.includes(artistId)) {
            await updateDoc(newRef, {
              assignedArtistIds: [...currentAssigned, artistId]
            });
          }
        }
      }
      log('Reassigned artist:', artistId, '→ owner:', newOwnerId);
    } catch (error) {
      console.error('Failed to reassign artist:', error);
      showToast('Failed to reassign: ' + error.message, 'error');
    }
    setReassignArtist({ show: false, artist: null });
  };

  // Handle saving edits to artist activeSince
  const handleSaveArtistEdit = async () => {
    if (!editArtistModal.artist) return;
    setEditArtistModal(prev => ({ ...prev, isSaving: true }));
    try {
      await updateArtist(db, editArtistModal.artist.id, {
        activeSince: editArtistModal.activeSince
      });
      log('Updated artist details:', editArtistModal.artist.id);
    } catch (error) {
      console.error('Failed to update artist:', error);
      showToast('Failed to save: ' + error.message, 'error');
    }
    setEditArtistModal({ show: false, artist: null, activeSince: '', isSaving: false });
  };

  // Set the app-level user state based on currentAuthUser and allowedUsers
  useEffect(() => {
    if (!authChecked || !firestoreLoaded) return;

    if (currentAuthUser) {
      const email = currentAuthUser.email;

      // Debug: Log Firebase Auth user data
      log('🔍 Firebase Auth user:', {
        email: currentAuthUser.email,
        displayName: currentAuthUser.displayName,
        photoURL: currentAuthUser.photoURL,
        providerData: currentAuthUser.providerData
      });

      // Check if user is a conductor (super-admin with full access)
      if (CONDUCTOR_EMAILS.includes(email?.toLowerCase())) {
        const condUserData = allowedUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
        const newUser = {
          email: email,
          role: 'conductor',
          name: currentAuthUser.displayName || email.split('@')[0],
          photoURL: currentAuthUser.photoURL || null,
          artistId: null,
          paymentExempt: true,
          socialSetsAllowed: 999,
          onboardingComplete: true,
        };
        log('👑 Setting conductor user:', newUser);
        setUser(newUser);
      } else if (allowedUsers.some(u => u.email?.toLowerCase() === email?.toLowerCase() && u.status === 'active')) {
        const userData = allowedUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
        const newUser = {
          email: email,
          role: userData?.role || 'artist',
          name: userData?.name || currentAuthUser.displayName || email.split('@')[0],
          photoURL: currentAuthUser.photoURL || null,
          artistId: userData?.artistId || null,
          assignedArtistIds: userData?.assignedArtistIds || [],
          // Subscription & paywall fields
          linkedArtistId: userData?.linkedArtistId || null,
          socialSetsAllowed: userData?.socialSetsAllowed || 0,
          paymentExempt: userData?.paymentExempt || false,
          onboardingComplete: userData?.onboardingComplete || false,
          subscriptionId: userData?.subscriptionId || null,
          subscriptionStatus: userData?.subscriptionStatus || null,
          ownerOperatorId: userData?.ownerOperatorId || null,
          invitedBy: userData?.invitedBy || null,
        };
        log('🎨 Setting allowed user:', newUser);
        setUser(newUser);
      } else {
        log('🚫 User not in allowed list:', email);
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, [authChecked, firestoreLoaded, currentAuthUser, allowedUsers]);

  // Restore saved page after user is authenticated
  useEffect(() => {
    if (user && pendingPage) {
      // Verify user has access to the pending page
      if (pendingPage === 'operator' && (user.role === 'operator' || user.role === 'conductor')) {
        log.debug('[App Session] Restoring operator page, tab:', pendingOperatorTab, 'editor:', pendingShowVideoEditor);
        setCurrentPage('operator');
        if (pendingOperatorTab) {
          setOperatorTab(pendingOperatorTab);
          setPendingOperatorTab(null);
        }
        if (pendingShowVideoEditor) {
          setShowVideoEditor(true);
          setPendingShowVideoEditor(false);
        }
      } else if ((pendingPage === 'artist-dashboard' || pendingPage === 'artist-portal') && isArtistOrCollaborator(user)) {
        log.debug('[App Session] Restoring artist-dashboard page');
        setCurrentPage('artist-dashboard');
      } else if (pendingPage === 'operator' || pendingPage === 'artist-portal' || pendingPage === 'artist-dashboard') {
        // User is authenticated but role doesn't match - go to their correct dashboard
        log.debug('[App Session] Role mismatch, going to correct dashboard');
        setCurrentPage(isArtistOrCollaborator(user) ? 'artist-dashboard' : 'operator');
      }
      setPendingPage(null); // Clear pending page after restore
      setSessionRestoreComplete(true);
    } else if (authChecked && firestoreLoaded && !pendingPage) {
      // No pending session to restore - mark complete
      setSessionRestoreComplete(true);
    } else if (authChecked && firestoreLoaded && !user && pendingPage) {
      // User is NOT authenticated but has a pending page (e.g., was logged out)
      // Clear pending page and proceed to home - user will need to login
      log.debug('[App Session] User not authenticated, clearing pending page:', pendingPage);
      setPendingPage(null);
      setSessionRestoreComplete(true);
    }
  }, [user, pendingPage, pendingOperatorTab, pendingShowVideoEditor, authChecked, firestoreLoaded]);

  // Auto-redirect logged-in users from home page to their dashboard
  useEffect(() => {
    if (user && currentPage === 'home' && sessionRestoreComplete) {
      log('🏠 Redirecting logged-in user from home to dashboard');
      const target = isArtistOrCollaborator(user) ? 'artist-dashboard' : 'operator';
      setCurrentPage(target);
    }
  }, [user, currentPage, sessionRestoreComplete]);

  // Role-based URL guard: prevent artists from accessing /operator/* and vice versa
  useEffect(() => {
    if (!user || !authChecked) return;
    const path = location.pathname;
    if (isArtistOrCollaborator(user) && path.startsWith('/operator')) {
      log('🔒 Artist on operator URL — redirecting to artist dashboard');
      setCurrentPage('artist-dashboard');
    } else if (!isArtistOrCollaborator(user) && path.startsWith('/artist/')) {
      log('🔒 Operator on artist URL — redirecting to operator dashboard');
      setCurrentPage('operator');
    }
  }, [user, authChecked, location.pathname]);

  // Save session state when navigation changes
  useEffect(() => {
    saveAppSession({ currentPage, operatorTab, showVideoEditor });
  }, [currentPage, operatorTab, showVideoEditor]);

  // Load applications from Firestore for operators
  useEffect(() => {
    if (user?.role === 'operator') {
      const unsubscribe = onSnapshot(
        collection(db, 'applications'),
        (snapshot) => {
          const apps = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          // Sort by submitted date, newest first
          apps.sort((a, b) => new Date(b.submitted) - new Date(a.submitted));
          setApplications(apps);
          log('Loaded applications from Firestore:', apps.length);
        },
        (error) => {
          console.error('Error loading applications:', error);
        }
      );
      return () => unsubscribe();
    }
  }, [user?.role]);

  // Helper to check if email is allowed (from Firestore + operator fallback)
  const isEmailAllowed = (email) => {
    const normalizedEmail = email?.toLowerCase();
    // Always allow operator emails (fallback if Firestore has issues)
    if (CONDUCTOR_EMAILS.includes(normalizedEmail)) {
      return true;
    }
    // Check Firestore allowedUsers
    return allowedUsers.some(u => u.email?.toLowerCase() === normalizedEmail && u.status === 'active');
  };

  // Helper to get user data from Firestore
  const getAllowedUserData = (email) => {
    const normalizedEmail = email?.toLowerCase();
    return allowedUsers.find(u => u.email?.toLowerCase() === normalizedEmail);
  };

  // Helper to determine user role from email
  const getUserRole = (email) => {
    const userData = getAllowedUserData(email);
    if (userData?.role) return userData.role;
    if (CONDUCTOR_EMAILS.includes(email?.toLowerCase())) return 'conductor';
    return 'artist';
  };

  // Helper to check if user has admin access (conductor or operator)
  const isAdminUser = (userObj) => {
    return userObj?.role === 'conductor' || userObj?.role === 'operator';
  };

  // Helper to check if user is a conductor (super-admin)
  const isConductor = (userObj) => {
    return userObj?.role === 'conductor';
  };

  // Helper to get visible artists — operators only see artists they own (ownerOperatorId)
  const getVisibleArtists = () => {
    const allArtists = firestoreArtists.map(a => ({ id: a.id, name: a.name, ownerOperatorId: a.ownerOperatorId || null }));

    if (isConductor(user)) return allArtists;

    // Artists/collaborators see only their linked artist
    if (isArtistOrCollaborator(user)) {
      const effectiveId = getEffectiveArtistId(user);
      return effectiveId ? allArtists.filter(a => a.id === effectiveId) : [];
    }

    // Operators see ONLY artists they own (created). ownerOperatorId is the source of truth.
    const currentUserRecord = allowedUsers.find(u => u.email?.toLowerCase() === user?.email?.toLowerCase());
    const currentUserId = currentUserRecord?.id || null;

    if (!currentUserId) return [];
    return allArtists.filter(a => a.ownerOperatorId === currentUserId);
  };

  // Helper to get artist info from Firestore
  const getArtistInfo = (email) => {
    const userData = getAllowedUserData(email);
    if (userData) {
      return {
        artistId: userData.artistId || null,
        name: userData.name || email?.split('@')[0]
      };
    }
    return null;
  };

  // Calendar navigation state
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Search/filter state
  const [postSearch, setPostSearch] = useState('');
  const [postPlatformFilter, setPostPlatformFilter] = useState('all'); // 'all', 'tiktok', 'instagram'
  const [postAccountFilter, setPostAccountFilter] = useState('all'); // 'all' or specific username
  const [applicationFilter, setApplicationFilter] = useState('all'); // 'all', 'pending', 'approved', 'declined'

  // Toast notification state
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Toast component
  const ToastContainer = () => (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up ${
            toast.type === 'success' ? 'bg-green-600 text-white' :
            toast.type === 'error' ? 'bg-red-600 text-white' :
            toast.type === 'info' ? 'bg-blue-600 text-white' :
            'bg-zinc-800 text-white'
          }`}
        >
          <span>
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span className="text-sm">{toast.message}</span>
          <button
            onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
            className="ml-2 opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  // Skeleton Loading Component
  const Skeleton = ({ className = '', variant = 'default' }) => {
    const baseClass = 'animate-pulse bg-zinc-800 rounded';
    const variants = {
      default: '',
      circle: 'rounded-full',
      text: 'h-4',
      title: 'h-6',
      card: 'h-32',
      row: 'h-12',
    };
    return <div className={`${baseClass} ${variants[variant]} ${className}`} />;
  };

  // Empty State Component
  const EmptyState = ({ icon, title, description, action, actionLabel }) => (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-zinc-500 text-sm mb-6 max-w-sm">{description}</p>
      {action && (
        <button
          onClick={action}
          className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );

  // Table Loading Skeleton
  const TableSkeleton = ({ rows = 5, cols = 4 }) => (
    <div className="space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-4 p-4 bg-zinc-900 rounded-lg">
          {[...Array(cols)].map((_, j) => (
            <Skeleton key={j} className="flex-1 h-4" />
          ))}
        </div>
      ))}
    </div>
  );

  // Card Loading Skeleton
  const CardSkeleton = () => (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" className="w-10 h-10" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-20" />
    </div>
  );

  // Undo Toast state
  const [undoAction, setUndoAction] = useState(null);

  // Show undo toast
  const showUndoToast = (message, onUndo, duration = 5000) => {
    const id = Date.now();
    setUndoAction({ id, message, onUndo });
    setTimeout(() => {
      setUndoAction(prev => prev?.id === id ? null : prev);
    }, duration);
  };

  // Undo Toast Component
  const UndoToast = () => undoAction && (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] bg-zinc-800 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-4 animate-slide-up">
      <span className="text-sm">{undoAction.message}</span>
      <button
        onClick={() => {
          undoAction.onUndo();
          setUndoAction(null);
        }}
        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium transition"
      >
        Undo
      </button>
      <button
        onClick={() => setUndoAction(null)}
        className="text-zinc-500 hover:text-white"
      >
        ✕
      </button>
    </div>
  );

  // Confirm Dialog state (P0-UI-05: Destructive Action Confirmation)
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    confirmVariant: 'primary',
    onConfirm: null,
    isLoading: false
  });

  const showConfirmDialog = ({ title, message, confirmLabel, confirmVariant = 'destructive', onConfirm }) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmLabel,
      confirmVariant,
      onConfirm,
      isLoading: false
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
  };

  const handleConfirmDialogConfirm = async () => {
    if (confirmDialog.onConfirm) {
      setConfirmDialog(prev => ({ ...prev, isLoading: true }));
      await confirmDialog.onConfirm();
      setConfirmDialog(prev => ({ ...prev, isOpen: false, isLoading: false }));
    }
  };

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Check if first time user (would normally check localStorage)
  useEffect(() => {
    if (user && user.role === 'operator') {
      const hasSeenOnboarding = localStorage.getItem('stm_onboarding_complete');
      if (!hasSeenOnboarding) {
        setShowOnboarding(true);
      }
    }
  }, [user]);

  // Onboarding steps
  const onboardingSteps = [
    {
      title: 'Welcome to StickToMusic! 🎵',
      description: 'Let\'s take a quick tour of your operator dashboard.',
      target: null
    },
    {
      title: 'Artists Tab',
      description: 'View and manage all your artists here. See their stats and pages.',
      target: 'artists'
    },
    {
      title: 'Content Tab',
      description: 'Schedule and manage posts across all world pages. Sync to see scheduled content.',
      target: 'content'
    },
    {
      title: 'Applications Tab',
      description: 'Review new artist applications, approve them, and send payment links.',
      target: 'applications'
    },
    {
      title: 'You\'re all set! 🚀',
      description: 'Start by clicking "Sync" in the Content tab to load your scheduled posts.',
      target: null
    }
  ];

  const completeOnboarding = () => {
    localStorage.setItem('stm_onboarding_complete', 'true');
    // BUG-010: Persist onboarding completion to Firestore
    saveSettings(db, currentArtistId, { onboarding: { completed: true, completedAt: new Date().toISOString() } });
    setShowOnboarding(false);
    setOnboardingStep(0);
  };

  // Onboarding Tooltip Component
  const OnboardingTooltip = () => {
    if (!showOnboarding) return null;
    const step = onboardingSteps[onboardingStep];

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-md mx-4 shadow-xl animate-slide-up">
          <div className="text-center mb-4">
            <h3 className="text-xl font-bold mb-2">{step.title}</h3>
            <p className="text-zinc-400">{step.description}</p>
          </div>

          <div className="flex items-center justify-between mt-6">
            <div className="flex gap-1">
              {onboardingSteps.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition ${i === onboardingStep ? 'bg-purple-500' : 'bg-zinc-700'}`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={completeOnboarding}
                className="px-4 py-2 text-zinc-400 hover:text-white text-sm transition"
              >
                Skip
              </button>
              {onboardingStep < onboardingSteps.length - 1 ? (
                <button
                  onClick={() => {
                    setOnboardingStep(prev => prev + 1);
                    if (onboardingSteps[onboardingStep + 1]?.target) {
                      setOperatorTab(onboardingSteps[onboardingStep + 1].target);
                    }
                  }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={completeOnboarding}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition"
                >
                  Get Started
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Dashboard state
  const [dateRange, setDateRange] = useState({ start: '2025-01-01', end: '2025-01-30' });
  const [dashboardTab, setDashboardTab] = useState('overview');

  // Operator dashboard state (operatorTab & showVideoEditor moved to top for session restore)
  const [selectedArtist, setSelectedArtist] = useState('all');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [contentArtist, setContentArtist] = useState('all');
  const [contentStatus, setContentStatus] = useState('all');
  const [contentSortOrder, setContentSortOrder] = useState('newest'); // 'newest' | 'oldest'

  // Batch Schedule modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [batchForm, setBatchForm] = useState({
    artist: 'Boon',
    category: 'Fashion',  // Must select specific category - videos are aesthetic-specific
    artistVideos: '',     // Videos featuring the artist's music (~30%)
    adjacentVideos: '',   // Videos featuring adjacent artists' music (~70%)
    weekStart: '',        // Start date
    numDays: 7,           // How many days to schedule
    step: 1               // 1 = setup, 2 = preview
  });
  const [generatedSchedule, setGeneratedSchedule] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [lateAccounts, setLateAccounts] = useState([]);
  const [showLateAccounts, setShowLateAccounts] = useState(false);
  const [latePosts, setLatePosts] = useState([]);
  const [artistLateConnected, setArtistLateConnected] = useState(false); // Track if current artist has Late connected
  const [checkingLateStatus, setCheckingLateStatus] = useState(false);
  const [latePages, setLatePages] = useState([]); // Connected accounts from Late API
  const [loadingLatePages, setLoadingLatePages] = useState(false);
  const [unconfiguredLateArtists, setUnconfiguredLateArtists] = useState([]); // Artists without Late API keys
  const [showLateConnectModal, setShowLateConnectModal] = useState(false);
  const [lateApiKeyInput, setLateApiKeyInput] = useState('');
  const [connectingLate, setConnectingLate] = useState(false);

  // Derive lateAccountIds mapping from live latePages data (replaces old hardcoded constant)
  // Shape: { '@handle': { tiktok: 'accountId', instagram: 'accountId', ... } }
  const derivedLateAccountIds = useMemo(() => {
    const mapping = {};
    latePages.forEach(page => {
      if (!mapping[page.handle]) mapping[page.handle] = {};
      mapping[page.handle][page.platform] = page.lateAccountId;
    });
    return mapping;
  }, [latePages]);

  // Derive manual accounts from artist docs (auto-updates via onSnapshot)
  const manualAccountsByArtist = useMemo(() => {
    const map = {};
    firestoreArtists.forEach(a => {
      if (a.manualAccounts?.length) map[a.id] = a.manualAccounts;
    });
    return map;
  }, [firestoreArtists]);

  // Account linking state - scoped per artist to prevent cross-contamination
  const [accountLinkingArtistId, setAccountLinkingArtistId] = useState(null); // null = off, artistId = linking for that artist
  const [selectedAccountsToLink, setSelectedAccountsToLink] = useState([]);
  const [linkVersion, setLinkVersion] = useState(0); // Incremented to force re-render after linking/unlinking

  // Video Upload state
  const [showVideoUploadModal, setShowVideoUploadModal] = useState(false);
  const [uploadedVideos, setUploadedVideos] = useState([]); // { id, name, url, uploadedAt, artistId }
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [contentView, setContentView] = useState(() => {
    try { return localStorage.getItem('stm_contentView') || 'list'; } catch { return 'list'; }
  }); // 'list', 'calendar', or 'month' — persisted across sessions
  useEffect(() => {
    try { localStorage.setItem('stm_contentView', contentView); } catch {}
  }, [contentView]);
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);

  // Bulk selection state
  const [selectedPosts, setSelectedPosts] = useState(new Set());

  // UI-12/13: Day detail drawer state
  const [dayDetailDrawer, setDayDetailDrawer] = useState({ isOpen: false, date: null, posts: [] });
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    notifications: true,
    emailAlerts: true,
    autoSync: false,
    syncInterval: 30,
    theme: 'dark',
    timezone: 'America/Los_Angeles'
  });

  // Toggle post selection
  const togglePostSelection = (postId) => {
    setSelectedPosts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(postId)) {
        newSet.delete(postId);
      } else {
        newSet.add(postId);
      }
      return newSet;
    });
  };

  // Select all posts
  const selectAllPosts = () => {
    if (selectedPosts.size === latePosts.length) {
      setSelectedPosts(new Set());
    } else {
      setSelectedPosts(new Set(latePosts.map(p => p.id)));
    }
  };

  // Bulk delete posts — H-01: uses ConfirmDialog instead of window.confirm
  const handleBulkDelete = () => {
    if (selectedPosts.size === 0) return;

    showConfirmDialog({
      title: `Delete ${selectedPosts.size} post${selectedPosts.size > 1 ? 's' : ''}?`,
      message: 'This will permanently remove the selected posts. This action cannot be undone.',
      confirmLabel: `Delete ${selectedPosts.size}`,
      confirmVariant: 'destructive',
      onConfirm: () => executeBulkDelete()
    });
  };

  const executeBulkDelete = async () => {
    setBulkDeleting(true);
    const deletedPosts = latePosts.filter(p => selectedPosts.has(p.id));
    let successCount = 0;
    let failCount = 0;

    for (const postId of selectedPosts) {
      const result = await lateApi.deletePost(postId, currentArtistId);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    setBulkDeleting(false);
    setSelectedPosts(new Set());

    if (failCount > 0) {
      showToast(`Deleted ${successCount}, failed ${failCount}`, 'error');
    } else {
      showUndoToast(
        `Deleted ${successCount} post(s)`,
        () => {
          // Undo is complex for bulk - just show message
          showToast('Please sync to restore', 'info');
        }
      );
    }

    // Refresh posts
    const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
    if (result.success) {
      setLatePosts(result.posts || []);
    }
  };

  // Loading states for better UX
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Delete confirmation modal
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({ show: false, postId: null, caption: '' });

  // Quick search modal (Cmd+K)
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const quickSearchRef = useRef(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K or Ctrl+K to open quick search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowQuickSearch(true);
        setQuickSearchQuery('');
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        setShowQuickSearch(false);
        setDeleteConfirmModal({ show: false, postId: null, caption: '' });
        setDayDetailDrawer({ isOpen: false, date: null, posts: [] }); // UI-13
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus quick search input when opened
  useEffect(() => {
    if (showQuickSearch && quickSearchRef.current) {
      quickSearchRef.current.focus();
    }
  }, [showQuickSearch]);

  // NOTE: Auth state listener has been consolidated into the master auth listener above (around line 193)
  // The user state is now set by the useEffect at line 238 which handles auth + Firestore data together

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
      // Now authenticated — read allowedUsers directly from Firestore
      const snapshot = await getDocs(collection(db, 'allowedUsers'));
      const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const userEmail = loginForm.email.toLowerCase();
      const isCond = CONDUCTOR_EMAILS.includes(userEmail);
      const allowed = isCond || users.some(u => u.email?.toLowerCase() === userEmail && u.status === 'active');
      if (!allowed) {
        await signOut(auth);
        setLoginForm(prev => ({ ...prev, error: 'Access denied. Please contact us to get access.' }));
        setIsLoggingIn(false);
        return;
      }
      // User is allowed — reactive effects will set full user state
      setShowLoginModal(false);
      setLoginForm({ email: '', password: '', error: null });
      showToast(`Welcome back!`, 'success');
      // Role-aware redirect
      const loginUserData = users.find(u => u.email?.toLowerCase() === userEmail);
      const loginRole = loginUserData?.role || (isCond ? 'conductor' : 'artist');
      setCurrentPage((loginRole === 'artist' || loginRole === 'collaborator') ? 'artist-dashboard' : 'operator');
    } catch (error) {
      let errorMessage = 'Invalid email or password';
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many attempts. Please try again later';
      }
      setLoginForm(prev => ({ ...prev, error: errorMessage }));
    }
    setIsLoggingIn(false);
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email;

      // Now authenticated — read allowedUsers directly from Firestore
      const snapshot = await getDocs(collection(db, 'allowedUsers'));
      const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const userEmail = email.toLowerCase();
      const isCond = CONDUCTOR_EMAILS.includes(userEmail);
      const allowed = isCond || users.some(u => u.email?.toLowerCase() === userEmail && u.status === 'active');
      if (!allowed) {
        await signOut(auth);
        setAuthError('Access denied. Please contact us to get access.');
        setIsLoggingIn(false);
        return;
      }
      // User is allowed — reactive effects will set full user state
      const googleUserData = users.find(u => u.email?.toLowerCase() === userEmail);
      const googleRole = googleUserData?.role || (isCond ? 'conductor' : 'artist');
      setCurrentPage((googleRole === 'artist' || googleRole === 'collaborator') ? 'artist-dashboard' : 'operator');
      showToast(`Welcome, ${result.user.displayName || 'there'}!`, 'success');
    } catch (error) {
      console.error('Google sign-in error:', error);
      let errorMessage = 'Google sign-in failed';
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'Sign-in cancelled';
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage = 'Popup blocked. Please allow popups for this site';
      }
      setLoginForm(prev => ({ ...prev, error: errorMessage }));
    }
    setIsLoggingIn(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setIsSigningUp(true);

    // Check whitelist before creating account
    if (!isEmailAllowed(signupForm.email)) {
      setSignupForm(prev => ({ ...prev, error: 'Access denied. Please contact us to get access or use Google Sign-in if you already have access.' }));
      setIsSigningUp(false);
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        signupForm.email,
        signupForm.password
      );
      const email = userCredential.user.email;
      const role = getUserRole(email); // Use role based on email, not form selection
      const artistInfo = getArtistInfo(email);

      setUser({
        email: email,
        role: role,
        name: signupForm.name || userCredential.user.displayName || email.split('@')[0],
        photoURL: userCredential.user.photoURL || null,
        artistId: artistInfo?.artistId || null
      });
      setShowSignupModal(false);
      setSignupForm({ email: '', password: '', name: '', role: 'artist', error: null });
      showToast(`Welcome to StickToMusic, ${signupForm.name || userCredential.user.displayName || email.split('@')[0]}!`, 'success');

      setCurrentPage((role === 'artist' || role === 'collaborator') ? 'artist-dashboard' : 'operator');
    } catch (error) {
      let errorMessage = 'Signup failed';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Email already exists. Try logging in instead';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      }
      setSignupForm(prev => ({ ...prev, error: errorMessage }));
    }
    setIsSigningUp(false);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setCurrentArtistId(null);   // Clear artist selection so next user gets their own
      try { localStorage.removeItem('stm_last_artist_id'); } catch {} // Clear persisted artist
      setCurrentPage('home');
      showToast('Logged out successfully', 'success');
    } catch (error) {
      console.error('Logout error:', error);
      showToast('Logout failed', 'error');
    }
  };

  // Landing page auth wrappers (accept email/password directly from LandingPage component)
  const handleLandingLogin = async (email, password) => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Now authenticated — read allowedUsers directly from Firestore
      // (can't rely on reactive state due to async timing of React effects)
      const snapshot = await getDocs(collection(db, 'allowedUsers'));
      const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const userEmail = email.toLowerCase();
      const isCond = CONDUCTOR_EMAILS.includes(userEmail);
      const allowed = isCond || users.some(u => u.email?.toLowerCase() === userEmail && u.status === 'active');
      if (!allowed) {
        await signOut(auth);
        setAuthError('Access denied. Please contact us to get access.');
        setIsLoggingIn(false);
        return;
      }
      // User is allowed — the onAuthStateChanged + allowedUsers subscription
      // will handle setting the full user state reactively. Just navigate.
      const landingUserData = users.find(u => u.email?.toLowerCase() === userEmail);
      const landingRole = landingUserData?.role || (isCond ? 'conductor' : 'artist');
      setCurrentPage((landingRole === 'artist' || landingRole === 'collaborator') ? 'artist-dashboard' : 'operator');
      showToast('Welcome back!', 'success');
    } catch (error) {
      let msg = 'Invalid email or password';
      if (error.code === 'auth/user-not-found') msg = 'No account found with this email';
      else if (error.code === 'auth/wrong-password') msg = 'Incorrect password';
      else if (error.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later';
      setAuthError(msg);
    }
    setIsLoggingIn(false);
  };

  const handleLandingSignup = async (email, password, name) => {
    setIsSigningUp(true);
    setAuthError(null);
    if (!isEmailAllowed(email)) {
      setAuthError('Access denied. Contact us to get access.');
      setIsSigningUp(false);
      return;
    }
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const userEmail = userCredential.user.email;
      const role = getUserRole(userEmail);
      const artistInfo = getArtistInfo(userEmail);
      setUser({
        email: userEmail,
        role: role,
        name: name || userCredential.user.displayName || userEmail.split('@')[0],
        photoURL: userCredential.user.photoURL || null,
        artistId: artistInfo?.artistId || null
      });
      setCurrentPage((role === 'artist' || role === 'collaborator') ? 'artist-dashboard' : 'operator');
      showToast(`Welcome, ${name || userCredential.user.displayName || userEmail.split('@')[0]}!`, 'success');
    } catch (error) {
      let msg = 'Signup failed';
      if (error.code === 'auth/email-already-in-use') msg = 'Email already exists. Try logging in';
      else if (error.code === 'auth/weak-password') msg = 'Password should be at least 6 characters';
      setAuthError(msg);
    }
    setIsSigningUp(false);
  };

  // Export to CSV function
  const exportToCSV = async () => {
    if (latePosts.length === 0) return;
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 300));

    const headers = ['Date', 'Time', 'Platforms', 'Caption', 'Status'];
    const rows = latePosts.map(post => {
      const date = post.scheduledFor ? new Date(post.scheduledFor) : null;
      return [
        date ? date.toLocaleDateString() : '',
        date ? date.toLocaleTimeString() : '',
        (post.platforms || []).map(p => p.platform || p).join(', '),
        `"${(post.content || '').replace(/"/g, '""')}"`,
        post.status || ''
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sticktomusic-schedule-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Schedule exported to CSV', 'success');
    setIsExporting(false);
  };

  // Fetch Late accounts on demand
  const fetchLateAccounts = async () => {
    setSyncing(true);
    setSyncStatus('Fetching accounts...');
    const result = await lateApi.fetchAccounts(currentArtistId);
    setSyncing(false);
    if (result.success) {
      const accounts = Array.isArray(result.accounts) ? result.accounts : [];
      setLateAccounts(accounts);
      setShowLateAccounts(true);
      setSyncStatus(`Found ${accounts.length} accounts`);
    } else {
      setSyncStatus(`Error: ${result.error}`);
    }
    setTimeout(() => setSyncStatus(null), 3000);
  };

  // Intake form state
  const [formStep, setFormStep] = useState(0);
  const [formData, setFormData] = useState({
    artistName: '',
    email: '',
    phone: '',
    managerContact: '',
    spotify: '',
    instagram: '',
    tiktok: '',
    youtube: '',
    otherPlatforms: '',
    projectType: '',
    releaseDate: '',
    genre: '',
    projectDescription: '',
    aestheticWords: '',
    vibes: [],
    otherVibes: '',
    adjacentArtists: '',
    ageRanges: [],
    idealListener: '',
    contentAssets: [],
    contentFolder: '',
    pageTier: '',
    cdTier: '',
    spotifyForArtists: '',
    duration: '',
    anythingElse: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const faqs = [
    {
      q: "How is this different from paying for views?",
      a: "Services that blast your song through random accounts are buying you numbers, not fans. We build ecosystems—pages with real audiences who engage because the content fits their taste."
    },
    {
      q: "Will I see which accounts are posting my music?",
      a: "We keep our methodology under the hood. You'll get aggregate performance data and monthly reports, but the world pages operate independently. This is what makes them feel organic."
    },
    {
      q: "How long until I see results?",
      a: "World pages compound over time. Most artists start seeing traction in 4-6 weeks, with significant growth by month 3."
    },
    {
      q: "What do I need to provide?",
      a: "Your music, any existing visual assets, and 15 minutes to fill out our intake form. We handle everything else."
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. No long-term contracts. We earn your business every month."
    }
  ];

  const tiers = [
    {
      name: "Starter",
      pages: 5,
      price: 800,
      description: "Testing the waters",
      detail: "Perfect for indie artists or anyone wanting to test the world page approach.",
      features: ["5 world pages", "TikTok, Instagram, Facebook, YouTube", "Monthly performance report"]
    },
    {
      name: "Standard",
      pages: 15,
      price: 1500,
      description: "Ready to scale",
      detail: "For artists serious about building cultural presence. Enough coverage to hit multiple niches simultaneously.",
      features: ["15 world pages", "TikTok, Instagram, Facebook, YouTube", "Monthly performance report"]
    },
    {
      name: "Scale",
      pages: 30,
      price: 2500,
      description: "Full scale",
      detail: "Album rollouts, tour promotion, or artists who want comprehensive coverage. Serious infrastructure.",
      features: ["30 world pages", "TikTok, Instagram, Facebook, YouTube", "Monthly performance report"]
    },
    {
      name: "Sensation",
      pages: 50,
      price: 3500,
      description: "Maximum coverage",
      detail: "The full ecosystem. 50 world pages means your music is everywhere your target fans spend time.",
      features: ["50 world pages", "TikTok, Instagram, Facebook, YouTube", "Monthly performance report"]
    }
  ];

  const cdTiers = [
    {
      name: "CD Lite",
      price: 2500,
      description: "Content partnership",
      features: ["Main account content creation", "Content strategy & planning"]
    },
    {
      name: "CD Standard",
      price: 5000,
      description: "Full creative direction",
      features: [
        "Everything in CD Lite",
        "Rollout planning & content calendar",
        "Visual direction & mood boards",
        "Asset briefs (covers, visuals, videos)",
        "Social content templates",
        "Analytics & performance insights"
      ]
    }
  ];

  const vibeOptions = [
    'Dark / Moody', 'Ethereal / Dreamy', 'High Fashion', 'Street / Urban',
    'Y2K / Nostalgic', 'Minimalist / Clean', 'Cinematic', 'Anime / Manga',
    'Nature / Organic', 'EDM / Rave', 'Romantic / Soft', 'Chaotic / Glitchy'
  ];

  const assetOptions = [
    'Music videos', 'Behind-the-scenes footage', 'Live performance clips',
    'Lyric videos', 'Photo/video shoots', 'Visualizers', 'Interview clips',
    'Studio sessions', 'None yet'
  ];

  // Dashboard data (mock - would come from API)
  const artistData = {
    name: "Boon",
    tier: "Scale",
    cdTier: "CD Lite",
    activeSince: "November 2024",
    totalPages: 30
  };

  const dashboardMetrics = {
    reach: {
      totalViews: 2847000,
      totalImpressions: 4120000,
      uniqueReach: 1890000,
      change: 23.4
    },
    engagement: {
      likes: 284700,
      comments: 18420,
      shares: 42300,
      saves: 67800,
      engagementRate: 4.2,
      change: 18.7
    },
    platforms: {
      tiktok: { views: 1840000, engagement: 89400 },
      instagram: { views: 620000, engagement: 34200 },
      facebook: { views: 287000, engagement: 12100 },
      youtube: { views: 100000, engagement: 8400 }
    }
  };

  const monthlyReports = [
    { month: "January 2025", status: "current", highlights: "Best performing month yet" },
    { month: "December 2024", status: "available", highlights: "Holiday content surge" },
    { month: "November 2024", status: "available", highlights: "Content launch" }
  ];

  // Operator dashboard data - artists with their Late connection status
  const operatorArtists = [
    {
      id: 1,
      name: "Boon",
      tier: "Scale",
      cdTier: "CD Lite",
      status: "active",
      activeSince: "Nov 2024",
      totalPages: 8,
      lateConnected: true, // Has Late account connected
      metrics: { views: 0, engagement: 0, rate: 0 } // Will be populated from Late API
    }
  ];

  // Note: Pages/accounts are now loaded dynamically from Late API via latePages state
  // The hardcoded worldPages array has been removed in favor of real Late data

  // Content Banks - hashtags and captions per aesthetic category (loaded from Firestore)
  const [contentBanks, setContentBanks] = useState(DEFAULT_TEMPLATES);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    hashtagsAlways: '',
    hashtagsPool: '',
    captionsAlways: '',
    captionsPool: ''
  });
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Subscribe to templates when artist changes
  useEffect(() => {
    if (!currentArtistId || !db) return;

    const unsubscribe = subscribeToTemplates(db, currentArtistId, (templates) => {
      setContentBanks(templates);
    });

    return () => unsubscribe();
  }, [currentArtistId]);

  // Helper function to generate hashtags and caption for a post
  const generatePostContent = (category, platform) => {
    const bank = contentBanks[category];
    if (!bank) return { hashtags: '', caption: '' };

    // Get always-use hashtags
    const alwaysHashtags = bank.hashtags.always || [];

    // Pick 3-5 random hashtags from pool
    const poolHashtags = [...(bank.hashtags.pool || [])];
    const randomCount = Math.floor(Math.random() * 3) + 3; // 3-5 random
    const selectedRandom = [];
    for (let i = 0; i < randomCount && poolHashtags.length > 0; i++) {
      const idx = Math.floor(Math.random() * poolHashtags.length);
      selectedRandom.push(poolHashtags.splice(idx, 1)[0]);
    }

    // Combine hashtags (platform-specific limits)
    const allHashtags = [...alwaysHashtags, ...selectedRandom];
    const maxHashtags = platform === 'tiktok' ? 5 : 10; // TikTok likes fewer
    const finalHashtags = allHashtags.slice(0, maxHashtags).join(' ');

    // Pick random caption from pool
    const captions = bank.captions.pool || [];
    const caption = captions.length > 0
      ? captions[Math.floor(Math.random() * captions.length)]
      : '';

    return { hashtags: finalHashtags, caption };
  };

  const contentQueue = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fmt = (d, h) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${h}`;
    const d1 = today, d2 = tomorrow;
    return [
      { id: 1, artist: "Boon", page: "@sarahs.ipodnano", platform: "tiktok", type: "Video", song: "Late", caption: "4:3, winter mood", scheduledFor: fmt(d1,"14:00"), status: "scheduled" },
      { id: 2, artist: "Boon", page: "@sarahs.ipodnano", platform: "instagram", type: "Reel", song: "Late", caption: "4:3, winter mood", scheduledFor: fmt(d1,"14:00"), status: "scheduled" },
      { id: 3, artist: "Boon", page: "@margiela.mommy", platform: "tiktok", type: "Video", song: "Late", caption: "we're forever.", scheduledFor: fmt(d1,"15:00"), status: "scheduled" },
      { id: 4, artist: "Boon", page: "@margiela.mommy", platform: "instagram", type: "Reel", song: "Late", caption: "we're forever.", scheduledFor: fmt(d1,"15:00"), status: "scheduled" },
      { id: 5, artist: "Boon", page: "@yumabestfriend", platform: "tiktok", type: "Video", song: "Late", caption: "wub", scheduledFor: fmt(d1,"16:00"), status: "scheduled" },
      { id: 6, artist: "Boon", page: "@yumabestfriend", platform: "instagram", type: "Reel", song: "Late", caption: "wub", scheduledFor: fmt(d1,"16:00"), status: "scheduled" },
      { id: 7, artist: "Boon", page: "@hedislimanerickowens", platform: "tiktok", type: "Video", song: "Late", caption: "electroclash clean girl", scheduledFor: fmt(d1,"17:00"), status: "scheduled" },
      { id: 8, artist: "Boon", page: "@hedislimanerickowens", platform: "instagram", type: "Reel", song: "Late", caption: "electroclash clean girl", scheduledFor: fmt(d1,"17:00"), status: "scheduled" },
      { id: 9, artist: "Boon", page: "@princessvamp2016", platform: "tiktok", type: "Video", song: "Late", caption: "mood", scheduledFor: fmt(d1,"18:00"), status: "scheduled" },
      { id: 10, artist: "Boon", page: "@princessvamp2016", platform: "instagram", type: "Reel", song: "Late", caption: "mood", scheduledFor: fmt(d1,"18:00"), status: "scheduled" },
      { id: 11, artist: "Boon", page: "@2016iscalling", platform: "tiktok", type: "Video", song: "Late", caption: "archive", scheduledFor: fmt(d1,"19:00"), status: "scheduled" },
      { id: 12, artist: "Boon", page: "@2016iscalling", platform: "instagram", type: "Reel", song: "Late", caption: "archive", scheduledFor: fmt(d1,"19:00"), status: "scheduled" },
      { id: 13, artist: "Boon", page: "@xxshadowskiesxx", platform: "tiktok", type: "Video", song: "Late", caption: "dancedancedance", scheduledFor: fmt(d1,"20:00"), status: "scheduled" },
      { id: 14, artist: "Boon", page: "@xxshadowskiesxx", platform: "instagram", type: "Reel", song: "Late", caption: "dancedancedance", scheduledFor: fmt(d1,"20:00"), status: "scheduled" },
      { id: 15, artist: "Boon", page: "@neonphoebe", platform: "tiktok", type: "Video", song: "Late", caption: "vibe", scheduledFor: fmt(d1,"21:00"), status: "scheduled" },
      { id: 16, artist: "Boon", page: "@neonphoebe", platform: "instagram", type: "Reel", song: "Late", caption: "vibe", scheduledFor: fmt(d1,"21:00"), status: "scheduled" },
      { id: 17, artist: "Boon", page: "@sarahs.ipodnano", platform: "tiktok", type: "Video", song: "Late", caption: "aesthetic", scheduledFor: fmt(d2,"14:00"), status: "scheduled" },
      { id: 18, artist: "Boon", page: "@sarahs.ipodnano", platform: "instagram", type: "Reel", song: "Late", caption: "aesthetic", scheduledFor: fmt(d2,"14:00"), status: "scheduled" },
      { id: 19, artist: "Boon", page: "@margiela.mommy", platform: "tiktok", type: "Video", song: "Late", caption: "forever", scheduledFor: fmt(d2,"15:00"), status: "scheduled" },
      { id: 20, artist: "Boon", page: "@margiela.mommy", platform: "instagram", type: "Reel", song: "Late", caption: "forever", scheduledFor: fmt(d2,"15:00"), status: "scheduled" },
      { id: 21, artist: "Boon", page: "@yumabestfriend", platform: "tiktok", type: "Video", song: "Late", caption: "wub wub", scheduledFor: fmt(d2,"16:00"), status: "scheduled" },
      { id: 22, artist: "Boon", page: "@yumabestfriend", platform: "instagram", type: "Reel", song: "Late", caption: "wub wub", scheduledFor: fmt(d2,"16:00"), status: "scheduled" },
      { id: 23, artist: "Boon", page: "@hedislimanerickowens", platform: "tiktok", type: "Video", song: "Late", caption: "pretty", scheduledFor: fmt(d2,"17:00"), status: "scheduled" },
      { id: 24, artist: "Boon", page: "@hedislimanerickowens", platform: "instagram", type: "Reel", song: "Late", caption: "pretty", scheduledFor: fmt(d2,"17:00"), status: "scheduled" },
      { id: 25, artist: "Boon", page: "@princessvamp2016", platform: "tiktok", type: "Video", song: "Late", caption: "dreaming", scheduledFor: fmt(d2,"18:00"), status: "scheduled" },
      { id: 26, artist: "Boon", page: "@princessvamp2016", platform: "instagram", type: "Reel", song: "Late", caption: "dreaming", scheduledFor: fmt(d2,"18:00"), status: "scheduled" },
      { id: 27, artist: "Boon", page: "@2016iscalling", platform: "tiktok", type: "Video", song: "Late", caption: "core", scheduledFor: fmt(d2,"19:00"), status: "scheduled" },
      { id: 28, artist: "Boon", page: "@2016iscalling", platform: "instagram", type: "Reel", song: "Late", caption: "core", scheduledFor: fmt(d2,"19:00"), status: "scheduled" },
      { id: 29, artist: "Boon", page: "@xxshadowskiesxx", platform: "tiktok", type: "Video", song: "Late", caption: "<3", scheduledFor: fmt(d2,"20:00"), status: "scheduled" },
      { id: 30, artist: "Boon", page: "@xxshadowskiesxx", platform: "instagram", type: "Reel", song: "Late", caption: "<3", scheduledFor: fmt(d2,"20:00"), status: "scheduled" },
      { id: 31, artist: "Boon", page: "@neonphoebe", platform: "tiktok", type: "Video", song: "Late", caption: "inspo", scheduledFor: fmt(d2,"21:00"), status: "scheduled" },
      { id: 32, artist: "Boon", page: "@neonphoebe", platform: "instagram", type: "Reel", song: "Late", caption: "inspo", scheduledFor: fmt(d2,"21:00"), status: "scheduled" },
    ];
  }, []);

  // Applications state - stores intake form submissions (starts empty)
  const [applications, setApplications] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);

  // Stripe Payment Link - You can create this in Stripe Dashboard
  // Go to: Stripe Dashboard > Products > + Add Product > Create a Payment Link
  const STRIPE_PAYMENT_LINK_BASE = 'https://buy.stripe.com/'; // Add your payment link here

  // Handle application approval - shows payment modal
  const handleApproveApplication = async (app) => {
    // Use new approve-application API that handles Stripe checkout + emails
    try {
      const token = await getFirebaseToken();
      const response = await fetch('/api/approve-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ applicationId: app.id, action: 'approve' }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.paymentSkipped) {
          showToast(`Approved ${app.name} — access granted (no Stripe configured)`, 'success');
        } else {
          showToast(`Approved ${app.name} — payment link sent to ${app.email}`, 'success');
        }
      } else {
        showToast(data.error || 'Failed to approve', 'error');
      }
    } catch (err) {
      console.error('Approve error:', err);
      showToast('Failed to approve application', 'error');
    }
  };

  const handleDenyApplication = async (app) => {
    if (!window.confirm(`Deny application from ${app.name} (${app.email})? They will be notified by email.`)) return;
    try {
      const token = await getFirebaseToken();
      const response = await fetch('/api/approve-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ applicationId: app.id, action: 'deny' }),
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Denied application from ${app.name}`, 'info');
      } else {
        showToast(data.error || 'Failed to deny', 'error');
      }
    } catch (err) {
      console.error('Deny error:', err);
      showToast('Failed to deny application', 'error');
    }
  };

  // Send payment link and update application status
  const handleSendPaymentLink = async (app, paymentLink) => {
    setPaymentLinkLoading(true);
    try {
      // Update in Firestore
      const appRef = doc(db, 'applications', app.id);
      await updateDoc(appRef, {
        status: 'pending_payment',
        paymentLink,
        updatedAt: new Date().toISOString()
      });

      // Local state will update via onSnapshot listener

      // Copy link to clipboard
      await navigator.clipboard.writeText(paymentLink);

      showToast(`Payment link copied! Send to ${app.email}`, 'success');
      setShowPaymentModal(false);
      setSelectedApplication(null);
    } catch (error) {
      console.error('Error:', error);
      showToast('Failed to process. Try again.', 'error');
    }
    setPaymentLinkLoading(false);
  };

  // Add user to Firestore allowedUsers (called after payment confirmed)
  // Also creates full artist profile with application data
  const addUserToAllowed = async (email, name, role = 'artist', artistId = null, applicationData = null) => {
    try {
      // Build artist profile from application data
      const artistProfile = {
        email: email.toLowerCase(),
        name: name,
        role: role,
        artistId: artistId || name.toLowerCase().replace(/\s+/g, '-'),
        status: 'active',
        createdAt: new Date().toISOString()
      };

      // If we have application data, add all the profile fields
      if (applicationData) {
        artistProfile.genre = applicationData.genre || '';
        artistProfile.vibes = applicationData.vibes || [];
        artistProfile.phone = applicationData.phone || '';
        artistProfile.managerContact = applicationData.managerContact || '';
        artistProfile.spotify = applicationData.spotify || '';
        artistProfile.instagram = applicationData.instagram || '';
        artistProfile.tiktok = applicationData.tiktok || '';
        artistProfile.youtube = applicationData.youtube || '';
        artistProfile.tier = applicationData.tier || '';
        artistProfile.projectType = applicationData.projectType || '';
        artistProfile.projectDescription = applicationData.projectDescription || '';
        artistProfile.releaseDate = applicationData.releaseDate || '';
        artistProfile.aestheticWords = applicationData.aestheticWords || '';
        artistProfile.adjacentArtists = applicationData.adjacentArtists || '';
        artistProfile.ageRanges = applicationData.ageRanges || [];
        artistProfile.idealListener = applicationData.idealListener || '';
        artistProfile.contentTypes = applicationData.contentTypes || [];
        artistProfile.cdTier = applicationData.cdTier || '';
        artistProfile.duration = applicationData.duration || '';
        artistProfile.referral = applicationData.referral || '';
        artistProfile.applicationId = applicationData.id || null;
      }

      // Use email as document ID — Firestore security rules look up allowedUsers by email
      await setDoc(doc(db, 'allowedUsers', email.toLowerCase()), artistProfile);
      showToast(`${name} added to allowed users!`, 'success');
      return true;
    } catch (error) {
      console.error('Error adding user:', error);
      showToast('Failed to add user', 'error');
      return false;
    }
  };

  // Manually mark payment as complete (for testing or manual verification)
  const handleMarkPaymentComplete = async (app) => {
    const success = await addUserToAllowed(app.email, app.name, 'artist', null, app);
    if (success) {
      // Update in Firestore
      try {
        const appRef = doc(db, 'applications', app.id);
        await updateDoc(appRef, {
          status: 'approved',
          approvedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error updating application status:', error);
      }
      // Local state will update via onSnapshot listener
    }
  };

  // Helper to extract account username from a post
  const getPostAccount = (post) => {
    const platform = post.platforms?.[0];
    return platform?.accountId?.username || platform?.accountId?.displayName || null;
  };

  // Helper to get unique accounts from posts
  const getUniqueAccounts = (posts) => {
    const accounts = new Set();
    posts.forEach(post => {
      const account = getPostAccount(post);
      if (account) accounts.add(account);
    });
    return Array.from(accounts).sort();
  };

  // Helper to get post thumbnail
  const getPostThumbnail = (post) => {
    const mediaItem = post.mediaItems?.[0];
    return mediaItem?.thumbnail || mediaItem?.url || null;
  };

  // Helper to get social media URLs for posts (supports all platforms via PLATFORMS config)
  const getPostUrls = (post) => {
    const urls = [];
    const platforms = post.platforms || [];

    platforms.forEach(p => {
      const platform = p.platform || p;
      const config = getPlatformConfig(platform);
      // Get username from accountId object (Late API returns accountId as object with username)
      const username = p.accountId?.username || p.accountId?.displayName;

      // Priority 1: Direct post URL from Late (platforms return this for published posts)
      if (p.platformPostUrl) {
        urls.push({
          platform,
          url: p.platformPostUrl,
          label: config.fullName,
          isActualPost: true
        });
        return;
      }

      // Priority 2: Construct URL from platformPostId + username (platform-specific patterns)
      if (p.platformPostId && username && p.status === 'published') {
        if (platform === 'tiktok') {
          // Late returns TikTok IDs like "v_pub_url~v2-1.7602051149071468575"
          let videoId = p.platformPostId;
          if (videoId.includes('.')) {
            videoId = videoId.split('.').pop();
          }
          if (/^\d{15,}$/.test(videoId)) {
            urls.push({ platform: 'tiktok', url: `https://www.tiktok.com/@${username}/video/${videoId}`, label: 'TikTok', isActualPost: true });
            return;
          }
        } else if (platform === 'instagram') {
          urls.push({ platform: 'instagram', url: `https://www.instagram.com/reel/${p.platformPostId}/`, label: 'IG', isActualPost: true });
          return;
        } else if (platform === 'youtube') {
          urls.push({ platform: 'youtube', url: `https://www.youtube.com/watch?v=${p.platformPostId}`, label: 'YT', isActualPost: true });
          return;
        } else if (platform === 'facebook') {
          urls.push({ platform: 'facebook', url: `https://www.facebook.com/${username}/videos/${p.platformPostId}`, label: 'FB', isActualPost: true });
          return;
        }
      }

      // Priority 3: Link to profile if we have username (using centralized config)
      if (username) {
        urls.push({
          platform,
          url: getPlatformUrl(platform, username),
          label: config.label,
          isActualPost: false
        });
        return;
      }

      // Priority 4: Fallback to our local account ID mapping (legacy support)
      const accountIdStr = typeof p.accountId === 'string' ? p.accountId : p.accountId?._id;
      const handleEntry = Object.entries(derivedLateAccountIds).find(([handle, ids]) =>
        Object.values(ids).includes(accountIdStr)
      );
      if (handleEntry) {
        const handle = handleEntry[0].replace('@', '');
        urls.push({
          platform,
          url: getPlatformUrl(platform, handle),
          label: config.label,
          isActualPost: false
        });
      }
    });

    return urls;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400';
      case 'onboarding': return 'bg-yellow-500/20 text-yellow-400';
      case 'paused': return 'bg-zinc-500/20 text-zinc-400';
      case 'building': return 'bg-blue-500/20 text-blue-400';
      case 'scheduled': return 'bg-purple-500/20 text-purple-400';
      case 'posted': return 'bg-green-500/20 text-green-400';
      case 'draft': return 'bg-zinc-500/20 text-zinc-400';
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-zinc-500/20 text-zinc-400';
    }
  };

  const getPlatformIcon = (platform) => {
    switch (platform) {
      case 'tiktok': return '♪';
      case 'instagram': return '◐';
      case 'facebook': return 'f';
      case 'youtube': return '▶';
      default: return '•';
    }
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  // Form helpers
  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleArrayField = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter(v => v !== value)
        : [...prev[field], value]
    }));
  };

  const nextFormStep = () => setFormStep(s => s + 1);
  const prevFormStep = () => setFormStep(s => s - 1);

  const handleSubmit = async () => {
    log('Form submitted:', formData);
    // Store the application
    const tierMap = {
      'starter': 'Starter',
      'standard': 'Standard',
      'scale': 'Scale',
      'sensation': 'Sensation',
      'discuss': 'To Discuss'
    };
    const newApplication = {
      name: formData.artistName,
      email: formData.email,
      tier: tierMap[formData.pageTier] || formData.pageTier,
      submitted: new Date().toISOString(),
      status: 'pending',
      genre: formData.genre,
      vibes: formData.vibes || [],
      phone: formData.phone || '',
      managerContact: formData.managerContact || '',
      spotify: formData.spotify,
      instagram: formData.instagram,
      tiktok: formData.tiktok,
      youtube: formData.youtube || '',
      projectType: formData.projectType,
      projectDescription: formData.projectDescription,
      releaseDate: formData.releaseDate || '',
      aestheticWords: formData.aestheticWords,
      adjacentArtists: formData.adjacentArtists,
      ageRanges: formData.ageRanges || [],
      idealListener: formData.idealListener,
      contentTypes: formData.contentTypes || [],
      cdTier: formData.cdTier,
      duration: formData.duration,
      referral: formData.referral || ''
    };

    // Save to Firestore
    try {
      const docRef = await addDoc(collection(db, 'applications'), newApplication);
      setApplications(prev => [{ id: docRef.id, ...newApplication }, ...prev]);
      setSubmitted(true);
      showToast('Application submitted successfully!', 'success');
    } catch (error) {
      console.error('Error saving application:', error);
      // Still add locally even if Firestore fails
      setApplications(prev => [{ id: Date.now().toString(), ...newApplication }, ...prev]);
      setSubmitted(true);
      showToast('Application submitted!', 'success');
    }
  };

  const goToIntake = () => {
    setCurrentPage('intake');
  };

  // Form field renderer - inline to prevent re-creation
  const renderInput = (label, field, type = 'text', required = false, placeholder = '') => (
    <div className="mb-6" key={field}>
      <label htmlFor={field} className="block text-sm font-medium text-zinc-400 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        id={field}
        name={field}
        type={type}
        value={formData[field] || ''}
        onChange={(e) => updateField(field, e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
        autoComplete="off"
      />
    </div>
  );

  const renderTextArea = (label, field, required = false, placeholder = '') => (
    <div className="mb-6" key={field}>
      <label htmlFor={field} className="block text-sm font-medium text-zinc-400 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <textarea
        id={field}
        name={field}
        value={formData[field] || ''}
        onChange={(e) => updateField(field, e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition resize-none"
        autoComplete="off"
      />
    </div>
  );

  const renderCheckboxGroup = (label, field, options, required = false) => (
    <div className="mb-6" key={field}>
      <label className="block text-sm font-medium text-zinc-400 mb-3">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {options.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => toggleArrayField(field, option)}
            className={`px-4 py-2 rounded-lg text-sm text-left transition ${
              formData[field]?.includes(option)
                ? 'bg-white text-black'
                : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );

  // Keep old component names for backward compatibility
  const InputField = ({ label, field, type = 'text', required = false, placeholder = '' }) =>
    renderInput(label, field, type, required, placeholder);

  const TextArea = ({ label, field, required = false, placeholder = '' }) =>
    renderTextArea(label, field, required, placeholder);

  const CheckboxGroup = ({ label, field, options, required = false }) =>
    renderCheckboxGroup(label, field, options, required);

  const RadioGroup = ({ label, field, options, required = false }) => (
    <div className="mb-6">
      <label className="block text-sm font-medium text-zinc-400 mb-3">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="space-y-2">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => updateField(field, option.value)}
            className={`w-full px-4 py-3 rounded-xl text-left transition flex justify-between items-center ${
              formData[field] === option.value
                ? 'bg-white text-black'
                : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            <div>
              <div className="font-medium">{option.label}</div>
              {option.desc && <div className={`text-sm ${formData[field] === option.value ? 'text-zinc-600' : 'text-zinc-500'}`}>{option.desc}</div>}
            </div>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              formData[field] === option.value ? 'border-black bg-black' : 'border-zinc-600'
            }`}>
              {formData[field] === option.value && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const FormNavButtons = ({ canContinue = true, isLast = false }) => (
    <div className="flex justify-between mt-8">
      {formStep > 0 ? (
        <button type="button" onClick={prevFormStep} className="px-6 py-3 text-zinc-400 hover:text-white transition">
          ← Back
        </button>
      ) : (
        <button type="button" onClick={() => setCurrentPage('home')} className="px-6 py-3 text-zinc-400 hover:text-white transition">
          ← Back to site
        </button>
      )}
      <button
        type="button"
        onClick={isLast ? handleSubmit : nextFormStep}
        disabled={!canContinue}
        className={`px-8 py-3 rounded-full font-semibold transition ${
          canContinue ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
        }`}
      >
        {isLast ? 'Submit →' : 'Continue →'}
      </button>
    </div>
  );

  // Dashboard components
  const StatCard = ({ label, value, change, prefix = '', suffix = '' }) => (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <p className="text-zinc-500 text-sm mb-1">{label}</p>
      <p className="text-3xl font-bold">{prefix}{typeof value === 'number' ? formatNumber(value) : value}{suffix}</p>
      {change !== undefined && (
        <p className={`text-sm mt-1 ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs previous period
        </p>
      )}
    </div>
  );

  const PlatformBar = ({ platform, views, engagement, maxViews }) => {
    const percentage = (views / maxViews) * 100;
    const platformColors = {
      tiktok: 'bg-pink-500',
      instagram: 'bg-purple-500',
      facebook: 'bg-blue-500',
      youtube: 'bg-red-500'
    };
    const platformNames = {
      tiktok: 'TikTok',
      instagram: 'Instagram',
      facebook: 'Facebook',
      youtube: 'YouTube'
    };

    return (
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">{platformNames[platform]}</span>
          <span className="text-sm text-zinc-400">{formatNumber(views)} views</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full ${platformColors[platform]} rounded-full transition-all`} style={{ width: `${percentage}%` }} />
        </div>
        <p className="text-xs text-zinc-500 mt-1">{formatNumber(engagement)} engagements</p>
      </div>
    );
  };

  // Navigation
  const Nav = () => (
    <nav className="fixed top-0 w-full z-50 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <button onClick={() => { setCurrentPage('home'); setMobileMenuOpen(false); }} className="text-lg md:text-xl font-bold hover:text-zinc-300 transition">
          StickToMusic
        </button>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">
          <button
            onClick={() => setCurrentPage('how')}
            className={`px-3 py-1 rounded transition font-medium ${currentPage === 'how' ? 'text-white bg-zinc-800' : 'text-zinc-400 hover:text-white'}`}
          >
            How It Works
          </button>
          <button
            onClick={() => setCurrentPage('pricing')}
            className={`px-3 py-1 rounded transition font-medium ${currentPage === 'pricing' ? 'text-white bg-zinc-800' : 'text-zinc-400 hover:text-white'}`}
          >
            Pricing
          </button>
          <button onClick={goToIntake} className="px-5 py-2 bg-white text-black rounded-full font-semibold hover:bg-zinc-200 transition">
            Apply
          </button>
          {user ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentPage(user.role === 'artist' ? 'artist-portal' : 'operator')}
                className="flex items-center gap-2 text-zinc-300 hover:text-white transition"
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
                    {user.name[0]}
                  </div>
                )}
                <span className="text-sm">{user.name}</span>
              </button>
              <button onClick={handleLogout} className="text-zinc-500 hover:text-white transition text-sm">
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="text-zinc-400 hover:text-white transition text-sm font-medium"
            >
              Login
            </button>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden items-center gap-3">
          {user && (
            <button
              onClick={() => setCurrentPage(user.role === 'artist' ? 'artist-portal' : 'operator')}
              className="w-8 h-8 rounded-full overflow-hidden"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full bg-purple-600 flex items-center justify-center text-xs font-bold">
                  {user.name[0]}
                </div>
              )}
            </button>
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-zinc-400 hover:text-white"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-zinc-900 border-t border-zinc-800 px-4 py-4 space-y-3">
          <button
            onClick={() => { setCurrentPage('how'); setMobileMenuOpen(false); }}
            className="block w-full text-left px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 transition"
          >
            How It Works
          </button>
          <button
            onClick={() => { setCurrentPage('pricing'); setMobileMenuOpen(false); }}
            className="block w-full text-left px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 transition"
          >
            Pricing
          </button>
          <button
            onClick={() => { goToIntake(); setMobileMenuOpen(false); }}
            className="block w-full text-center px-4 py-2 bg-white text-black rounded-full font-semibold"
          >
            Apply
          </button>
          {user ? (
            <>
              <button
                onClick={() => { setCurrentPage(user.role === 'artist' ? 'artist-portal' : 'operator'); setMobileMenuOpen(false); }}
                className="block w-full text-left px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 transition"
              >
                Dashboard
              </button>
              <button
                onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                className="block w-full text-left px-3 py-2 rounded-lg text-red-400 hover:bg-zinc-800 transition"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={() => { setShowLoginModal(true); setMobileMenuOpen(false); }}
              className="block w-full text-left px-3 py-2 rounded-lg text-purple-400 hover:bg-zinc-800 transition"
            >
              Login
            </button>
          )}
        </div>
      )}
    </nav>
  );

  // Show loading screen while restoring session (prevents flash of wrong content)
  if (!sessionRestoreComplete && pendingPage) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // ═══ NEW ROUTING: Non-authenticated users → Landing Page ═══
  if (!user) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <LandingPage
            onLogin={handleLandingLogin}
            onSignup={handleLandingSignup}
            onGoogleAuth={handleGoogleSignIn}
            authError={authError}
            authLoading={isLoggingIn || isSigningUp}
          />
        </ToastProvider>
      </ThemeProvider>
    );
  }

  // INTAKE FORM PAGE (legacy — agency model)
  if (currentPage === 'intake') {
    if (submitted) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <div className="text-6xl mb-6">✓</div>
            <h1 className="text-3xl font-bold mb-4">You're in.</h1>
            <p className="text-zinc-400 mb-8">We'll review your submission and get back to you within 24 hours.</p>
            <button onClick={() => { setCurrentPage('home'); setSubmitted(false); setFormStep(0); }} className="px-8 py-4 bg-white text-black rounded-full font-semibold hover:bg-zinc-200 transition">
              Back to StickToMusic
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <button onClick={() => setCurrentPage(user ? (user.role === 'artist' ? 'artist-portal' : 'operator') : 'home')} className="text-xl font-bold hover:text-zinc-300 transition">StickToMusic</button>
          </div>

          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between text-xs text-zinc-500 mb-2">
              <span>Step {formStep + 1} of 9</span>
              <span>{Math.round(((formStep + 1) / 9) * 100)}%</span>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-white transition-all duration-300" style={{ width: `${((formStep + 1) / 9) * 100}%` }} />
            </div>
          </div>

          {/* Step 0 */}
          {formStep === 0 && (
            <div>
              <h1 className="text-4xl font-bold mb-4">Let's build your world.</h1>
              <p className="text-xl text-zinc-400 mb-8">Takes about 10 minutes.</p>
              <InputField label="Artist or project name" field="artistName" required />
              <InputField label="Email" field="email" type="email" required />
              <InputField label="Phone (optional)" field="phone" type="tel" />
              <InputField label="Manager or team contact (optional)" field="managerContact" />
              <FormNavButtons canContinue={formData.artistName && formData.email} />
            </div>
          )}

          {/* Step 1 */}
          {formStep === 1 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Where can we find you?</h2>
              <p className="text-zinc-400 mb-8">Links to your current profiles.</p>
              <InputField label="Spotify" field="spotify" type="url" required placeholder="https://open.spotify.com/artist/..." />
              <InputField label="Instagram" field="instagram" type="url" placeholder="https://instagram.com/..." />
              <InputField label="TikTok" field="tiktok" type="url" placeholder="https://tiktok.com/@..." />
              <InputField label="YouTube" field="youtube" type="url" placeholder="https://youtube.com/..." />
              <FormNavButtons canContinue={formData.spotify} />
            </div>
          )}

          {/* Step 2 */}
          {formStep === 2 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">What are you promoting?</h2>
              <p className="text-zinc-400 mb-8">Tell us about the release.</p>
              <InputField label="Project type" field="projectType" required placeholder="Single, EP, Album..." />
              <InputField label="Release date (if scheduled)" field="releaseDate" type="date" />
              <InputField label="Genre / subgenre" field="genre" required placeholder="e.g., Alt R&B, Hyperpop" />
              <TextArea label="Describe the project" field="projectDescription" required placeholder="Sound, story, theme..." />
              <FormNavButtons canContinue={formData.projectType && formData.genre && formData.projectDescription} />
            </div>
          )}

          {/* Step 3 */}
          {formStep === 3 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">What's your vibe?</h2>
              <p className="text-zinc-400 mb-8">This shapes your world pages.</p>
              <TextArea label="Describe your visual aesthetic in 3-5 words" field="aestheticWords" required placeholder="e.g., dark, cinematic, emotional" />
              <CheckboxGroup label="Select vibes that resonate" field="vibes" options={vibeOptions} required />
              <FormNavButtons canContinue={formData.aestheticWords && formData.vibes.length > 0} />
            </div>
          )}

          {/* Step 4 */}
          {formStep === 4 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Who are you reaching?</h2>
              <p className="text-zinc-400 mb-8">Your target audience.</p>
              <TextArea label="3-5 artists whose fans might love you" field="adjacentArtists" required placeholder="e.g., The Weeknd, Frank Ocean" />
              <CheckboxGroup label="Target age range" field="ageRanges" options={['13-17', '18-24', '25-34', '35+']} required />
              <TextArea label="Describe your ideal listener" field="idealListener" required placeholder="What are they into?" />
              <FormNavButtons canContinue={formData.adjacentArtists && formData.ageRanges.length > 0 && formData.idealListener} />
            </div>
          )}

          {/* Step 5 */}
          {formStep === 5 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">What content do you have?</h2>
              <p className="text-zinc-400 mb-8">Existing assets we can work with.</p>
              <CheckboxGroup label="Select all that apply" field="contentAssets" options={assetOptions} required />
              <InputField label="Link to content folder (optional)" field="contentFolder" type="url" placeholder="Google Drive, Dropbox..." />
              <FormNavButtons canContinue={formData.contentAssets.length > 0} />
            </div>
          )}

          {/* Step 6 */}
          {formStep === 6 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Choose your plan</h2>
              <p className="text-zinc-400 mb-8">Page Builder tier + optional Creative Direction.</p>
              <RadioGroup label="Page Builder tier" field="pageTier" required options={[
                { value: 'starter', label: 'Starter — $800/mo', desc: '5 world pages' },
                { value: 'standard', label: 'Standard — $1,500/mo', desc: '15 world pages' },
                { value: 'scale', label: 'Scale — $2,500/mo', desc: '30 world pages' },
                { value: 'sensation', label: 'Sensation — $3,500/mo', desc: '50 world pages' },
                { value: 'discuss', label: 'Not sure yet', desc: "Let's discuss" }
              ]} />
              <RadioGroup label="Add Creative Direction?" field="cdTier" required options={[
                { value: 'none', label: 'No thanks', desc: 'Just world pages' },
                { value: 'lite', label: 'CD Lite — +$2,500/mo', desc: 'Content creation & strategy' },
                { value: 'standard', label: 'CD Standard — +$5,000/mo', desc: 'Full creative direction' },
                { value: 'discuss', label: 'Not sure yet', desc: "Let's discuss" }
              ]} />
              <FormNavButtons canContinue={formData.pageTier && formData.cdTier} />
            </div>
          )}

          {/* Step 7 */}
          {formStep === 7 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Spotify for Artists</h2>
              <p className="text-zinc-400 mb-8">Optional — connect for deeper insights.</p>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
                <h3 className="font-semibold mb-3">What you'd get with Spotify connected:</h3>
                <ul className="space-y-2 text-sm text-zinc-400">
                  <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Monthly listener growth tracking</li>
                  <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Playlist add notifications</li>
                  <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Stream count correlation with posts</li>
                  <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Listener demographics & top cities</li>
                </ul>
              </div>

              <RadioGroup label="Would you like to connect Spotify for Artists?" field="spotifyForArtists" required options={[
                { value: 'yes', label: "Yes, I'll connect it", desc: "We'll send instructions after signup" },
                { value: 'later', label: 'Maybe later', desc: 'You can connect anytime from your dashboard' },
                { value: 'no', label: 'No thanks', desc: 'Dashboard will show world page metrics only' }
              ]} />
              <FormNavButtons canContinue={formData.spotifyForArtists} />
            </div>
          )}

          {/* Step 8 */}
          {formStep === 8 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Timeline</h2>
              <p className="text-zinc-400 mb-8">How long are you thinking?</p>
              <RadioGroup label="Service duration" field="duration" required options={[
                { value: '1month', label: '1 month', desc: 'Minimum' },
                { value: '3months', label: '3 months', desc: '' },
                { value: '6months', label: '6 months', desc: '' },
                { value: '12months', label: '12 months / ongoing', desc: '' },
                { value: 'discuss', label: 'Not sure yet', desc: '' }
              ]} />
              <TextArea label="Anything else? (optional)" field="anythingElse" />
              <FormNavButtons canContinue={formData.duration} isLast />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ ARTIST DASHBOARD (artists + collaborators) ═══
  if (currentPage === 'artist-dashboard') {
    const effectiveArtistId = getEffectiveArtistId(user) || currentArtistId;
    const artistTabChangeHandler = (tab, opts) => {
      if (tab === 'schedule' && opts?.filter) {
        setArtistScheduleFilter(opts.filter);
      } else if (tab !== 'schedule') {
        setArtistScheduleFilter(null);
      }
      setArtistTab(tab);
    };

    return (
      <ThemeProvider>
        <ToastProvider>
        <AppShell
          activeTab={artistTab}
          setActiveTab={artistTabChangeHandler}
          user={user}
          onLogout={handleLogout}
          userRole={user?.role || 'artist'}
          visibleArtists={[firestoreArtists.find(a => a.id === effectiveArtistId)].filter(Boolean)}
          currentArtistId={effectiveArtistId}
          onArtistChange={() => {}}
        >
          {/* Studio — rendered inline inside AppShell so sidebar stays visible */}
          {artistTab === 'studio' ? (
            <VideoStudio
              inline
              db={db}
              onClose={() => { setArtistTab('dashboard'); }}
              artists={[firestoreArtists.find(a => a.id === effectiveArtistId)].filter(Boolean)}
              artistId={effectiveArtistId}
              onArtistChange={() => {}}
              lateAccountIds={derivedLateAccountIds}
              latePages={latePages.filter(p => p.artistId === effectiveArtistId)}
              manualAccounts={manualAccountsByArtist[effectiveArtistId] || []}
              onSchedulePost={(params) => lateApi.schedulePost({ ...params, artistId: effectiveArtistId })}
              onDeleteLatePost={(latePostId) => lateApi.deletePost(latePostId, effectiveArtistId)}
            />
          ) : artistTab === 'schedule' ? (
            <SchedulingPage
              db={db}
              artistId={effectiveArtistId}
              accounts={latePages.filter(p => p.artistId === effectiveArtistId)}
              lateAccountIds={derivedLateAccountIds}
              initialStatusFilter={artistScheduleFilter}
              onSchedulePost={(params) => lateApi.schedulePost({ ...params, artistId: effectiveArtistId })}
              onDeleteLatePost={(latePostId) => lateApi.deletePost(latePostId, effectiveArtistId)}
              onEditDraft={(post) => {
                if (post.editorState) {
                  setArtistTab('studio');
                }
              }}
              onBack={() => setArtistTab('dashboard')}
              visibleArtists={[firestoreArtists.find(a => a.id === effectiveArtistId)].filter(Boolean)}
              onArtistChange={() => {}}
            />
          ) : (
          <div className="w-full overflow-y-auto" style={{ maxHeight: '100%' }}>
            {/* Dashboard Tab */}
            {artistTab === 'dashboard' && (
              <ArtistDashboard
                user={user}
                artistId={effectiveArtistId}
                db={db}
                latePages={latePages.filter(p => p.artistId === effectiveArtistId)}
                socialSetsAllowed={user?.socialSetsAllowed || 0}
                handleGroups={firestoreArtists.find(a => a.id === effectiveArtistId)?.handleGroups}
                manualAccountsByArtist={manualAccountsByArtist}
                onAddManualAccounts={handleAddManualAccounts}
                onRemoveManualAccount={handleRemoveManualAccount}
                onLoadLatePages={loadLatePages}
                onNavigate={artistTabChangeHandler}
              />
            )}

            {/* Analytics Tab */}
            {artistTab === 'analytics' && (
              <AnalyticsDashboard
                artistId={effectiveArtistId}
                artists={[firestoreArtists.find(a => a.id === effectiveArtistId)].filter(Boolean)}
                lateConnected={artistLateConnected}
                onSyncLate={async () => {
                  const result = await lateApi.fetchScheduledPosts(1, effectiveArtistId);
                  if (result.success) {
                    return { success: true, posts: result.posts || [] };
                  }
                  return result;
                }}
              />
            )}

            {/* Settings Tab */}
            {artistTab === 'settings' && (
              <SettingsTab
                user={user}
                onLogout={handleLogout}
                db={db}
                artistId={effectiveArtistId}
                onPhotoUpdated={(url) => setUser(prev => ({ ...prev, photoURL: url }))}
              />
            )}
          </div>
          )}

          {/* Onboarding Wizard (first-run) */}
          {user && !user.onboardingComplete && (
            <OnboardingWizard
              user={user}
              socialSetsAllowed={user?.socialSetsAllowed || 0}
              onComplete={async () => {
                // Mark onboarding complete in Firestore
                try {
                  const userRef = doc(db, 'allowedUsers', user.email.toLowerCase());
                  await updateDoc(userRef, { onboardingComplete: true });
                } catch (err) {
                  console.warn('Could not update onboarding status:', err);
                }
                setUser(prev => prev ? { ...prev, onboardingComplete: true } : prev);
              }}
            />
          )}

          <ToastContainer />
        </AppShell>
        </ToastProvider>
      </ThemeProvider>
    );
  }

  // ARTIST PORTAL PAGE (legacy — redirect to artist-dashboard)
  if (currentPage === 'artist-portal') {
    // Redirect legacy artist-portal to new artist-dashboard
    setCurrentPage('artist-dashboard');
    return null;
  }

  // LEGACY ARTIST PORTAL — removed, redirect to dashboard
  if (currentPage === '__legacy-artist-portal') {
    const activeCampaign = null; // Legacy stub

    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-6">
                <button onClick={() => setCurrentPage(user ? (user.role === 'artist' ? 'artist-portal' : 'operator') : 'home')} className="text-xl font-bold hover:text-zinc-300 transition">StickToMusic</button>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400">Artist Portal</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold">
                    {user?.name?.[0] || 'A'}
                  </div>
                  <span className="text-sm text-zinc-400">{user?.name || 'Artist'}</span>
                </div>
                <button onClick={handleLogout} className="text-sm text-zinc-500 hover:text-white transition">Log out</button>
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Welcome Section */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Welcome back, {user?.name || 'Artist'}</h1>
            <p className="text-zinc-500">Here's how your music is performing across our world pages.</p>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gradient-to-br from-purple-900/50 to-purple-800/30 border border-purple-700/50 rounded-xl p-5">
              <p className="text-purple-300 text-sm mb-1">Total Views</p>
              <p className="text-3xl font-bold">{activeCampaign ? (activeCampaign.achieved.views / 1000).toFixed(0) + 'K' : '0'}</p>
              <p className="text-xs text-purple-400 mt-1">↑ 23% this week</p>
            </div>
            <div className="bg-gradient-to-br from-pink-900/50 to-pink-800/30 border border-pink-700/50 rounded-xl p-5">
              <p className="text-pink-300 text-sm mb-1">New Followers</p>
              <p className="text-3xl font-bold">{activeCampaign ? activeCampaign.achieved.followers.toLocaleString() : '0'}</p>
              <p className="text-xs text-pink-400 mt-1">↑ 18% this week</p>
            </div>
            <div className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border border-blue-700/50 rounded-xl p-5">
              <p className="text-blue-300 text-sm mb-1">Posts Live</p>
              <p className="text-3xl font-bold">{activeCampaign?.postsPublished || 0}</p>
              <p className="text-xs text-blue-400 mt-1">{activeCampaign?.postsScheduled || 0} scheduled</p>
            </div>
            <div className="bg-gradient-to-br from-green-900/50 to-green-800/30 border border-green-700/50 rounded-xl p-5">
              <p className="text-green-300 text-sm mb-1">Engagement Rate</p>
              <p className="text-3xl font-bold">4.7%</p>
              <p className="text-xs text-green-400 mt-1">Above average</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Active Campaign */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-lg font-semibold mb-1">{activeCampaign?.name || 'No Active Campaign'}</h2>
                    <p className="text-sm text-zinc-500">
                      {activeCampaign ? `${new Date(activeCampaign.startDate).toLocaleDateString()} - ${new Date(activeCampaign.endDate).toLocaleDateString()}` : 'Contact your manager to start a campaign'}
                    </p>
                  </div>
                  {activeCampaign && (
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm">Active</span>
                  )}
                </div>

                {activeCampaign && (
                  <>
                    {/* Progress Bars */}
                    <div className="space-y-4 mb-6">
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-zinc-400">Views Progress</span>
                          <span>{Math.round((activeCampaign.achieved.views / activeCampaign.goals.views) * 100)}%</span>
                        </div>
                        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                            style={{ width: `${Math.min((activeCampaign.achieved.views / activeCampaign.goals.views) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-zinc-500 mt-1">
                          {(activeCampaign.achieved.views / 1000).toFixed(0)}K of {(activeCampaign.goals.views / 1000).toFixed(0)}K goal
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-zinc-400">Follower Growth</span>
                          <span>{Math.round((activeCampaign.achieved.followers / activeCampaign.goals.followers) * 100)}%</span>
                        </div>
                        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full"
                            style={{ width: `${Math.min((activeCampaign.achieved.followers / activeCampaign.goals.followers) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-zinc-500 mt-1">
                          {activeCampaign.achieved.followers.toLocaleString()} of {activeCampaign.goals.followers.toLocaleString()} goal
                        </p>
                      </div>
                    </div>

                    {/* Categories */}
                    <div>
                      <p className="text-sm text-zinc-400 mb-2">Active Categories</p>
                      <div className="flex gap-2">
                        {activeCampaign.categories.map(cat => (
                          <span key={cat} className="px-3 py-1.5 bg-zinc-800 rounded-lg text-sm">{cat}</span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Recent Performance Chart Placeholder */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="font-semibold mb-4">Views Over Time</h3>
                <div className="h-48 flex items-end justify-between gap-2">
                  {[35, 42, 38, 55, 48, 62, 58, 75, 68, 82, 78, 95, 88, 102].map((val, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full bg-gradient-to-t from-purple-600 to-purple-400 rounded-t"
                        style={{ height: `${val}%` }}
                      />
                      {i % 2 === 0 && <span className="text-[10px] text-zinc-600">{i + 18}</span>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 text-center mt-2">January 2026</p>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Upcoming Posts - Real Late Data */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">Upcoming Posts</h3>
                  {latePosts.length > 0 && (
                    <span className="text-xs text-zinc-500">{latePosts.filter(p => p.status === 'scheduled').length} scheduled</span>
                  )}
                </div>
                {latePosts.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-zinc-500 mb-3">No posts loaded yet</p>
                    <button
                      onClick={async () => {
                        setSyncing(true);
                        const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
                        setSyncing(false);
                        if (result.success) {
                          setLatePosts(Array.isArray(result.posts) ? result.posts : []);
                        }
                      }}
                      disabled={syncing}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-500 transition disabled:opacity-50"
                    >
                      {syncing ? 'Loading...' : 'Load Posts'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {latePosts
                      .filter(p => p.status === 'scheduled')
                      .sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''))
                      .slice(0, 5)
                      .map((post, i) => {
                        const date = post.scheduledFor ? new Date(post.scheduledFor) : null;
                        const isToday = date && date.toDateString() === new Date().toDateString();
                        const isTomorrow = date && date.toDateString() === new Date(Date.now() + 86400000).toDateString();
                        const timeStr = date ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                        const dayStr = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const platforms = (post.platforms || []).map(p => p.platform || p);

                        return (
                          <div key={post._id || i} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                            <div>
                              <p className="text-sm font-medium truncate max-w-[150px]">{post.content?.slice(0, 30) || 'Scheduled post'}</p>
                              <p className="text-xs text-zinc-500">{dayStr} {timeStr}</p>
                            </div>
                            <div className="flex gap-1">
                              {platforms.includes('tiktok') && <span className="px-2 py-0.5 rounded text-xs bg-pink-500/20 text-pink-400">TT</span>}
                              {platforms.includes('instagram') && <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">IG</span>}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
                {latePosts.length > 0 && (
                  <button
                    onClick={() => setCurrentPage('operator')}
                    className="w-full mt-4 py-2 text-sm text-purple-400 hover:text-purple-300 transition"
                  >
                    View All {latePosts.length} Posts →
                  </button>
                )}
              </div>

              {/* Top Performing Pages */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="font-semibold mb-4">Top Pages</h3>
                <div className="space-y-3">
                  {[
                    { page: '@sarahs.ipodnano', views: '45K', growth: '+12%' },
                    { page: '@neonphoebe', views: '38K', growth: '+8%' },
                    { page: '@2016iscalling', views: '32K', growth: '+15%' },
                  ].map((page, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold">
                          {i + 1}
                        </div>
                        <span className="text-sm">{page.page}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{page.views}</p>
                        <p className="text-xs text-green-400">{page.growth}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                {/* C-09: Removed dead "Download Report", "Contact Manager", "Upload Content" buttons.
                   These had no onClick handlers. Artist actions are available through the operator dashboard. */}
                <h3 className="font-semibold mb-4">Quick Actions</h3>
                <p className="text-sm text-zinc-500">Contact your operator for reports, content uploads, or account management.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══ MAIN DASHBOARD (all authenticated users) ═══
  if (currentPage === 'operator') {
    // Tab change handler — routes Studio/Schedule to VideoStudio modal
    const handleTabChange = (tab) => {
      if (tab === 'studio') {
        setShowVideoEditor(true);
        return;
      }
      setShowVideoEditor(false);
      setOperatorTab(tab);
      if ((tab === 'pages' || tab === 'content') && !loadingLatePages) loadLatePages();
    };

    return (
      <ThemeProvider>
        <ToastProvider>
        <AppShell
          activeTab={showVideoEditor ? 'studio' : operatorTab}
          setActiveTab={handleTabChange}
          user={user}
          onLogout={handleLogout}
          userRole={user?.role || 'operator'}
          visibleArtists={getVisibleArtists()}
          currentArtistId={currentArtistId}
          onArtistChange={handleArtistChange}
        >
        {/* Video Studio — rendered inline inside AppShell so sidebar stays visible */}
        {showVideoEditor ? (
          <VideoStudio
            inline
            db={db}
            onClose={() => { setShowVideoEditor(false); }}
            artists={getVisibleArtists()}
            artistId={currentArtistId}
            onArtistChange={handleArtistChange}
            lateAccountIds={derivedLateAccountIds}
            latePages={latePages.filter(p => p.artistId === currentArtistId)}
            manualAccounts={manualAccountsByArtist[currentArtistId] || []}
            onSchedulePost={(params) => lateApi.schedulePost({ ...params, artistId: currentArtistId })}
            onDeleteLatePost={(latePostId) => lateApi.deletePost(latePostId, currentArtistId)}
          />
        ) : operatorTab === 'schedule' ? null : (
        <div className="w-full overflow-y-auto" style={{ maxHeight: '100%' }}>
          {/* ═══ Pages Tab (new) ═══ */}
          {operatorTab === 'pages' && (
            <PagesTab
              latePages={latePages}
              visibleArtists={getVisibleArtists()}
              unconfiguredLateArtists={unconfiguredLateArtists}
              loadingLatePages={loadingLatePages}
              onLoadLatePages={loadLatePages}
              onConfigureLate={(artistId) => { setCurrentArtistId(artistId); setShowLateConnectModal(true); }}
              user={user}
              socialSetsAllowed={user?.socialSetsAllowed || 0}
              manualAccountsByArtist={manualAccountsByArtist}
              onAddManualAccounts={handleAddManualAccounts}
              onRemoveManualAccount={handleRemoveManualAccount}
            />
          )}

          {/* ═══ Settings Tab (new) ═══ */}
          {operatorTab === 'settings' && (
            <SettingsTab
              user={user}
              onLogout={handleLogout}
              db={db}
              artistId={currentArtistId}
              onPhotoUpdated={(url) => setUser(prev => ({ ...prev, photoURL: url }))}
              allUsers={allowedUsers}
              firestoreArtists={firestoreArtists}
            />
          )}

          {/* ═══ Schedule Tab (standalone — rendered outside max-w wrapper below) ═══ */}

          {/* Artists Tab */}
          {operatorTab === 'artists' && (
            <ArtistsManagement
              artists={(() => {
                let displayArtists = firestoreArtists;
                if (!isConductor(user)) {
                  const currentUserRecord = allowedUsers.find(u => u.email?.toLowerCase() === user?.email?.toLowerCase());
                  const currentUserId = currentUserRecord?.id || null;
                  displayArtists = displayArtists.filter(artist =>
                    currentUserId && artist.ownerOperatorId === currentUserId
                  );
                }
                return displayArtists;
              })()}
              user={user}
              currentArtistId={currentArtistId}
              onArtistChange={handleArtistChange}
              onAddArtist={() => setShowAddArtistModal(true)}
              onEditArtist={(artist) => setEditArtistModal({ show: true, artist, activeSince: artist.activeSince || 'Feb 2026', isSaving: false })}
              onReassignArtist={(artist) => setReassignArtist({ show: true, artist })}
              onDeleteArtist={(artist) => setDeleteArtistConfirm({ show: true, artist, isDeleting: false })}
              isConductor={isConductor(user)}
              latePages={latePages}
              loadingLatePages={loadingLatePages}
            />
          )}



          {/* Content Tab */}
          {operatorTab === 'content' && (() => {
            const groupPosts = (posts) => {
              const grouped = {};
              posts.forEach(post => {
                const key = `${post.page}-${post.scheduledFor}`;
                if (!grouped[key]) {
                  grouped[key] = { ...post, platforms: [post.platform] };
                } else {
                  grouped[key].platforms.push(post.platform);
                }
              });
              const sorted = Object.values(grouped).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
              return contentSortOrder === 'newest' ? sorted.reverse() : sorted;
            };

            const allPosts = groupPosts(contentQueue.filter(c =>
              (contentStatus === 'all' || c.status === contentStatus) &&
              (contentArtist === 'all' || c.artist === contentArtist)
            ));

            const todayStr = new Date().toISOString().split('T')[0];
            const todayPostsCount = contentQueue.filter(c => c.scheduledFor.startsWith(todayStr)).length / 2;

            // Get unique accounts and categories for selected artist (from Late API)
            const artistPages = latePages.filter(p => p.artist === batchForm.artist);
            const uniqueAccounts = artistPages.reduce((acc, p) => {
              const existing = acc.find(a => a.handle === p.handle);
              if (!existing) {
                acc.push({ handle: p.handle, niche: p.niche, postTime: p.postTime });
              }
              return acc;
            }, []);
            const categories = [...new Set(artistPages.map(p => p.niche))];

            // Filter accounts by selected category (must pick specific category)
            const filteredAccounts = uniqueAccounts.filter(a => a.niche === batchForm.category);

            // Calculate required videos with 30/70 split
            const totalSlots = filteredAccounts.length * batchForm.numDays;
            const artistSlotsNeeded = Math.ceil(totalSlots * 0.3);  // 30% artist music
            const adjacentSlotsNeeded = totalSlots - artistSlotsNeeded;  // 70% adjacent music

            // Parse provided videos (split by newlines, commas, or detect URLs)
            const parseUrls = (text) => {
              return text.trim()
                .split(/[\n\r,]+/)
                .map(url => url.trim())
                .filter(url => url.startsWith('http'));
            };
            const artistVideosList = parseUrls(batchForm.artistVideos);
            const adjacentVideosList = parseUrls(batchForm.adjacentVideos);

            // Generate schedule preview - mixing artist and adjacent videos
            const generateSchedule = () => {
              const totalVideos = artistVideosList.length + adjacentVideosList.length;
              if (totalVideos === 0 || !batchForm.weekStart) return [];

              const schedule = [];
              const startDate = new Date(batchForm.weekStart);

              // Create a pool of videos tagged by type
              let artistPool = [...artistVideosList].map((url, i) => ({ url, type: 'artist', num: i + 1 }));
              let adjacentPool = [...adjacentVideosList].map((url, i) => ({ url, type: 'adjacent', num: i + 1 }));

              // For each day
              for (let dayOffset = 0; dayOffset < batchForm.numDays; dayOffset++) {
                const currentDate = new Date(startDate);
                currentDate.setDate(startDate.getDate() + dayOffset);
                const dateStr = currentDate.toISOString().split('T')[0];
                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];

                // Each account gets a video - distribute to maintain ~30% artist ratio
                filteredAccounts.forEach((account, accountIndex) => {
                  // Determine if this slot should be artist or adjacent
                  // Spread artist videos evenly: roughly every 3rd post is artist music
                  const slotIndex = dayOffset * filteredAccounts.length + accountIndex;
                  const shouldBeArtist = (slotIndex % 3 === 0) && artistPool.length > 0;

                  let video;
                  if (shouldBeArtist && artistPool.length > 0) {
                    video = artistPool.shift();
                  } else if (adjacentPool.length > 0) {
                    video = adjacentPool.shift();
                  } else if (artistPool.length > 0) {
                    video = artistPool.shift();
                  }

                  if (video) {
                    // Generate content from banks for this category
                    const content = generatePostContent(account.niche, 'tiktok');

                    schedule.push({
                      date: dateStr,
                      dayName,
                      handle: account.handle,
                      niche: account.niche,
                      time: account.postTime,
                      videoUrl: video.url,
                      videoNum: video.num,
                      videoType: video.type,
                      caption: content.caption,
                      hashtags: content.hashtags,
                      platforms: ['tiktok', 'instagram']
                    });
                  }
                });
              }

              return schedule.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
            };

            const handleGeneratePreview = () => {
              const totalVideos = artistVideosList.length + adjacentVideosList.length;

              // If we have fewer videos than slots, confirm with user
              if (totalVideos < totalSlots && totalVideos > 0) {
                const proceed = window.confirm(
                  `You've uploaded ${totalVideos} video(s) but have ${totalSlots} slots.\n\n` +
                  `Only ${totalVideos} post(s) will be scheduled.\n\n` +
                  `Continue anyway?`
                );
                if (!proceed) return;
              }

              const schedule = generateSchedule();
              setGeneratedSchedule(schedule);
              setBatchForm(prev => ({ ...prev, step: 2 }));
            };

            const handleScheduleSubmit = async () => {
              setSyncing(true);
              setSyncStatus('Scheduling posts...');

              // BUG-008: Capture artist ID at schedule start to prevent cross-artist scheduling
              const schedulingArtistId = currentArtistId;

              let successCount = 0;
              let failCount = 0;
              const errors = [];

              for (const post of generatedSchedule) {
                // BUG-008: Abort if artist changed during scheduling
                if (currentArtistId !== schedulingArtistId) {
                  errors.push('Artist changed during scheduling — aborting remaining posts');
                  failCount += generatedSchedule.length - successCount - failCount;
                  break;
                }
                const scheduledFor = `${post.date}T${post.time}:00`;
                const fullCaption = `${post.caption} ${post.hashtags}`;

                // Get account IDs from latePages (dynamically loaded from Late API)
                const handlePages = latePages.filter(p => p.handle === post.handle);
                if (handlePages.length === 0) {
                  // Fallback to derived account mapping
                  const legacyAccountIds = derivedLateAccountIds[post.handle];
                  if (!legacyAccountIds) {
                    console.error(`No Late account mapping for ${post.handle}`);
                    failCount++;
                    errors.push(`${post.handle}: No account mapping found`);
                    continue;
                  }
                  // Use legacy mapping
                  const platformsPayload = post.platforms
                    .filter(p => legacyAccountIds[p])
                    .map(p => ({ platform: p, accountId: legacyAccountIds[p] }));

                  if (platformsPayload.length === 0) {
                    failCount++;
                    errors.push(`${post.handle}: No platform accounts found`);
                    continue;
                  }

                  const result = await lateApi.schedulePost({
                    platforms: platformsPayload,
                    caption: fullCaption,
                    videoUrl: post.videoUrl,
                    scheduledFor,
                    artistId: schedulingArtistId
                  });

                  if (result.success) {
                    successCount += platformsPayload.length;
                  } else {
                    failCount += platformsPayload.length;
                    errors.push(`${post.handle}: ${result.error}`);
                  }
                  await new Promise(r => setTimeout(r, 200));
                  continue;
                }

                // Build platforms array from latePages (preferred method)
                const platformsPayload = post.platforms
                  .map(p => {
                    const pageForPlatform = handlePages.find(hp => hp.platform === p);
                    return pageForPlatform ? {
                      platform: p,
                      accountId: pageForPlatform.lateAccountId
                    } : null;
                  })
                  .filter(Boolean);

                if (platformsPayload.length === 0) {
                  failCount++;
                  errors.push(`${post.handle}: No platform accounts found`);
                  continue;
                }

                log('Scheduling post:', {
                  handle: post.handle,
                  platforms: platformsPayload,
                  caption: fullCaption,
                  videoUrl: post.videoUrl,
                  scheduledFor
                });

                // Schedule via Late API - both platforms in one call
                const result = await lateApi.schedulePost({
                  platforms: platformsPayload,
                  caption: fullCaption,
                  videoUrl: post.videoUrl,
                  scheduledFor,
                  artistId: schedulingArtistId
                });

                if (result.success) {
                  successCount += platformsPayload.length; // Count each platform
                } else {
                  failCount += platformsPayload.length;
                  errors.push(`${post.handle}: ${result.error}`);
                }

                // Small delay to avoid rate limiting
                await new Promise(r => setTimeout(r, 200));
              }

              setSyncing(false);

              const artistCount = generatedSchedule.filter(p => p.videoType === 'artist').length;
              const adjacentCount = generatedSchedule.filter(p => p.videoType === 'adjacent').length;

              const postWord = (n) => n === 1 ? 'post' : 'posts';

              if (failCount > 0) {
                setSyncStatus(`⚠️ ${successCount} scheduled, ${failCount} failed`);
                console.error('Scheduling errors:', errors);
              } else {
                setSyncStatus(`✓ ${successCount} ${postWord(successCount)} scheduled! (${artistCount} artist / ${adjacentCount} adjacent)`);
              }

              setTimeout(() => setSyncStatus(null), 5000);
              setShowScheduleModal(false);
              setBatchForm({
                artist: 'Boon',
                category: 'Fashion',
                artistVideos: '',
                adjacentVideos: '',
                weekStart: '',
                numDays: 7,
                step: 1
              });
              setGeneratedSchedule([]);
            };

            const handleSync = async () => {
              setSyncing(true);
              setSyncStatus('Syncing...');
              const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
              setSyncing(false);
              if (result.success) {
                const posts = Array.isArray(result.posts) ? result.posts : [];
                // Log full post structure to understand what Late returns
                if (posts.length > 0) {
                  log('📬 Sample Late post structure:', JSON.stringify(posts[0], null, 2));
                  log('📬 All post keys:', Object.keys(posts[0]));
                  // Log platform structure specifically
                  if (posts[0].platforms?.length > 0) {
                    log('📬 Platform entry:', JSON.stringify(posts[0].platforms[0], null, 2));
                  }
                }
                setLatePosts(posts);
                setLastSynced(new Date());
                const postWord = posts.length === 1 ? 'post' : 'posts';
                setSyncStatus(`✓ Synced ${posts.length} ${postWord}`);
                showToast(`Synced ${posts.length} ${postWord}`, 'success');
              } else {
                setSyncStatus(`Error: ${result.error}`);
                showToast(`Sync failed: ${result.error}`, 'error');
              }
              setTimeout(() => setSyncStatus(null), 3000);
            };

            const confirmDeletePost = (postId, caption) => {
              setDeleteConfirmModal({ show: true, postId, caption: caption || 'this post' });
            };

            const handleDeletePost = async (postId) => {
              setDeleteConfirmModal({ show: false, postId: null, caption: '' });
              setDeletingPostId(postId);
              const result = await lateApi.deletePost(postId, currentArtistId);
              setDeletingPostId(null);
              if (result.success) {
                setLatePosts(prev => prev.filter(p => p._id !== postId));
                showToast('Post deleted successfully', 'success');
              } else {
                showToast(`Failed to delete: ${result.error}`, 'error');
              }
            };

            // Get current artist name for display
            const currentArtist = firestoreArtists.find(a => a.id === currentArtistId);
            const artistName = currentArtist?.name || 'this artist';

            return (
              <div>
                {/* Page Header */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h1 className="text-2xl font-bold">Schedule</h1>
                    <p className="text-sm text-zinc-500">
                      {artistLateConnected
                        ? `${latePosts.length} scheduled post${latePosts.length !== 1 ? 's' : ''}`
                        : `Late not connected for ${artistName}`
                      }
                    </p>
                  </div>
                  <div className="flex gap-3">
                    {artistLateConnected ? (
                      <>
                        <button
                          onClick={handleSync}
                          disabled={syncing}
                          className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
                        >
                          {syncing ? 'Syncing...' : '🔄 Sync'}
                        </button>
                        <button
                          onClick={() => setShowScheduleModal(true)}
                          className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
                        >
                          + Batch Schedule
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setShowLateConnectModal(true)}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-500 transition"
                      >
                        🔗 Enable Sync
                      </button>
                    )}
                  </div>
                </div>

                {/* Sync Not Enabled Banner */}
                {!artistLateConnected && !checkingLateStatus && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center mb-6">
                    <div className="text-4xl mb-4">🔗</div>
                    <h3 className="text-xl font-semibold mb-2">Enable Sync for {artistName}</h3>
                    <p className="text-zinc-400 mb-6 max-w-md mx-auto">
                      To schedule and manage posts for {artistName}, enable sync by connecting their posting account.
                    </p>
                    <button
                      onClick={() => setShowLateConnectModal(true)}
                      className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 transition"
                    >
                      Enable Sync
                    </button>
                  </div>
                )}

                {checkingLateStatus && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center mb-6">
                    <div className="animate-spin text-4xl mb-4">⏳</div>
                    <p className="text-zinc-400">Checking sync status...</p>
                  </div>
                )}

                {/* Batch Schedule Modal */}
                {showScheduleModal && (
                  <div
                    className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
                    onClick={() => { setShowScheduleModal(false); setBatchForm(prev => ({ ...prev, step: 1 })); setGeneratedSchedule([]); }}
                  >
                    <div
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col cursor-default"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
                        <div>
                          <h2 className="text-xl font-bold">Batch Schedule</h2>
                          <p className="text-sm text-zinc-500 mt-1">
                            {batchForm.step === 1 ? 'Step 1: Setup' : 'Step 2: Preview & Confirm'}
                          </p>
                        </div>
                        <button
                          onClick={() => { setShowScheduleModal(false); setBatchForm(prev => ({ ...prev, step: 1 })); setGeneratedSchedule([]); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition"
                        >
                          ✕
                        </button>
                      </div>

                      {batchForm.step === 1 ? (
                        <>
                          <div className="p-6 space-y-5 overflow-y-auto flex-1">
                            {/* Artist & Category Row */}
                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Artist</label>
                                <select
                                  value={batchForm.artist}
                                  onChange={(e) => setBatchForm(prev => ({ ...prev, artist: e.target.value }))}
                                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                                >
                                  {getVisibleArtists().map(a => (
                                    <option key={a.id} value={a.name}>{a.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Aesthetic Category</label>
                                <select
                                  value={batchForm.category}
                                  onChange={(e) => setBatchForm(prev => ({ ...prev, category: e.target.value }))}
                                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                                >
                                  {getCategoryNames(contentBanks).map(cat => {
                                    const count = uniqueAccounts.filter(a => a.niche === cat).length;
                                    return <option key={cat} value={cat}>{cat} ({count} accounts)</option>;
                                  })}
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Days</label>
                                <select
                                  value={batchForm.numDays}
                                  onChange={(e) => setBatchForm(prev => ({ ...prev, numDays: parseInt(e.target.value) }))}
                                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                                >
                                  {[1, 2, 3, 4, 5, 6, 7, 14].map(d => (
                                    <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Selected Accounts Preview */}
                            <div className="bg-zinc-800/50 rounded-xl p-4">
                              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{batchForm.category} Accounts ({filteredAccounts.length})</p>
                              <div className="flex flex-wrap gap-2">
                                {filteredAccounts.map(acc => (
                                  <span key={acc.handle} className="px-3 py-1.5 bg-zinc-800 rounded-lg text-sm">
                                    {acc.handle} <span className="text-zinc-500">@ {acc.postTime}</span>
                                  </span>
                                ))}
                                {filteredAccounts.length === 0 && (
                                  <span className="text-zinc-500 text-sm">No accounts in this category</span>
                                )}
                              </div>
                            </div>

                            {/* Start Date */}
                            <div>
                              <label className="block text-sm font-medium text-zinc-400 mb-2">Start Date</label>
                              <input
                                type="date"
                                value={batchForm.weekStart}
                                onChange={(e) => setBatchForm(prev => ({ ...prev, weekStart: e.target.value }))}
                                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                              />
                            </div>

                            {/* Videos Required - 30/70 Split */}
                            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-sm font-medium text-zinc-300">Videos Needed</p>
                                <p className="text-2xl font-bold text-white">{totalSlots}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                                  <p className="text-emerald-400 font-medium">{artistSlotsNeeded} Artist Videos</p>
                                  <p className="text-xs text-zinc-500">~30% {batchForm.artist}'s music</p>
                                </div>
                                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                                  <p className="text-blue-400 font-medium">{adjacentSlotsNeeded} Adjacent Videos</p>
                                  <p className="text-xs text-zinc-500">~70% similar artists</p>
                                </div>
                              </div>
                              <p className="text-xs text-zinc-500 mt-3">
                                {filteredAccounts.length} accounts × {batchForm.numDays} days = {totalSlots} unique videos
                              </p>
                            </div>

                            {/* Two-Column Video Input */}
                            <div className="grid grid-cols-2 gap-4">
                              {/* Artist Videos */}
                              <div>
                                <label className="block text-sm font-medium text-emerald-400 mb-2">
                                  🎵 {batchForm.artist}'s Music ({artistSlotsNeeded} needed)
                                </label>
                                <textarea
                                  value={batchForm.artistVideos}
                                  onChange={(e) => setBatchForm(prev => ({ ...prev, artistVideos: e.target.value }))}
                                  placeholder={`Paste ${artistSlotsNeeded} Google Drive links...\n\nhttps://drive.google.com/...\nhttps://drive.google.com/...`}
                                  rows={5}
                                  className="w-full px-4 py-3 bg-zinc-800 border border-emerald-500/30 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 font-mono text-xs resize-none"
                                />
                                {(() => {
                                  const provided = artistVideosList.length;
                                  const isEnough = provided >= artistSlotsNeeded;
                                  return provided > 0 && (
                                    <p className={`text-xs mt-2 ${isEnough ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {provided} of {artistSlotsNeeded} {isEnough ? '✓' : `— need ${artistSlotsNeeded - provided} more`}
                                    </p>
                                  );
                                })()}
                              </div>

                              {/* Adjacent Videos */}
                              <div>
                                <label className="block text-sm font-medium text-blue-400 mb-2">
                                  🎶 Adjacent Artists ({adjacentSlotsNeeded} needed)
                                </label>
                                <textarea
                                  value={batchForm.adjacentVideos}
                                  onChange={(e) => setBatchForm(prev => ({ ...prev, adjacentVideos: e.target.value }))}
                                  placeholder={`Paste ${adjacentSlotsNeeded} Google Drive links...\n\nhttps://drive.google.com/...\nhttps://drive.google.com/...`}
                                  rows={5}
                                  className="w-full px-4 py-3 bg-zinc-800 border border-blue-500/30 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 font-mono text-xs resize-none"
                                />
                                {(() => {
                                  const provided = adjacentVideosList.length;
                                  const isEnough = provided >= adjacentSlotsNeeded;
                                  return provided > 0 && (
                                    <p className={`text-xs mt-2 ${isEnough ? 'text-blue-400' : 'text-red-400'}`}>
                                      {provided} of {adjacentSlotsNeeded} {isEnough ? '✓' : `— need ${adjacentSlotsNeeded - provided} more`}
                                    </p>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>

                          <div className="p-6 border-t border-zinc-800 shrink-0">
                            <div className="flex justify-between items-center">
                              <p className="text-sm text-zinc-500">
                                {artistVideosList.length + adjacentVideosList.length} of {totalSlots} videos provided
                              </p>
                              <div className="flex gap-3">
                                <button onClick={() => setShowScheduleModal(false)} className="px-4 py-2 text-zinc-400 hover:text-white transition">Cancel</button>
                                <button
                                  onClick={handleGeneratePreview}
                                  disabled={
                                    !batchForm.weekStart ||
                                    filteredAccounts.length === 0 ||
                                    (artistVideosList.length + adjacentVideosList.length) === 0
                                  }
                                  className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Preview Schedule →
                                </button>
                              </div>
                            </div>
                            {/* Helper text for disabled state */}
                            {(!batchForm.weekStart || filteredAccounts.length === 0 || (artistVideosList.length + adjacentVideosList.length) === 0) && (
                              <p className="text-xs text-zinc-500 mt-2 text-right">
                                {!batchForm.weekStart ? 'Select a start date' :
                                 filteredAccounts.length === 0 ? 'No accounts for selected category' :
                                 'Add video URLs above'}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Step 2: Preview */}
                          <div className="p-6 overflow-y-auto flex-1">
                            <div className="mb-4 flex items-center justify-between">
                              <p className="text-sm text-zinc-400">
                                {generatedSchedule.length} {generatedSchedule.length === 1 ? 'post' : 'posts'} to {[...new Set(generatedSchedule.map(p => p.handle))].length} {[...new Set(generatedSchedule.map(p => p.handle))].length === 1 ? 'account' : 'accounts'}
                              </p>
                              <button onClick={() => setBatchForm(prev => ({ ...prev, step: 1 }))} className="text-sm text-zinc-500 hover:text-white">
                                ← Back to Edit
                              </button>
                            </div>

                            {/* Stats Summary */}
                            <div className="grid grid-cols-3 gap-4 mb-4">
                              <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                                <p className="text-2xl font-bold">{generatedSchedule.length}</p>
                                <p className="text-xs text-zinc-500">Total Posts</p>
                              </div>
                              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
                                <p className="text-2xl font-bold text-emerald-400">{generatedSchedule.filter(p => p.videoType === 'artist').length}</p>
                                <p className="text-xs text-zinc-500">Artist Music ({Math.round(generatedSchedule.filter(p => p.videoType === 'artist').length / generatedSchedule.length * 100)}%)</p>
                              </div>
                              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
                                <p className="text-2xl font-bold text-blue-400">{generatedSchedule.filter(p => p.videoType === 'adjacent').length}</p>
                                <p className="text-xs text-zinc-500">Adjacent Artists ({Math.round(generatedSchedule.filter(p => p.videoType === 'adjacent').length / generatedSchedule.length * 100)}%)</p>
                              </div>
                            </div>

                            {/* Schedule Grid */}
                            <div className="bg-zinc-800/50 rounded-xl overflow-x-auto">
                              <table className="w-full text-sm min-w-[500px]">
                                <thead>
                                  <tr className="border-b border-zinc-700">
                                    <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">Day</th>
                                    <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">Account</th>
                                    <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">Time</th>
                                    <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">Type</th>
                                    <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">Caption</th>
                                    <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">Video</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {generatedSchedule.slice(0, 21).map((post, i) => (
                                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                      <td className="p-3 text-zinc-400">{post.dayName} {post.date.slice(5)}</td>
                                      <td className="p-3 font-mono text-sm">{post.handle}</td>
                                      <td className="p-3 text-zinc-400">{post.time}</td>
                                      <td className="p-3">
                                        <span className={`px-2 py-1 rounded text-xs ${
                                          post.videoType === 'artist'
                                            ? 'bg-emerald-500/20 text-emerald-400'
                                            : 'bg-blue-500/20 text-blue-400'
                                        }`}>
                                          {post.videoType === 'artist' ? '🎵' : '🎶'}
                                        </span>
                                      </td>
                                      <td className="p-3 text-zinc-400 text-xs max-w-[150px] truncate" title={`${post.caption} ${post.hashtags}`}>
                                        {post.caption}
                                      </td>
                                      <td className="p-3">
                                        <span className="px-2 py-1 bg-zinc-700 rounded text-xs">
                                          {post.videoType === 'artist' ? 'A' : 'Adj'}-{post.videoNum}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {generatedSchedule.length > 21 && (
                                <p className="text-center py-3 text-sm text-zinc-500">
                                  + {generatedSchedule.length - 21} more posts...
                                </p>
                              )}
                            </div>

                            {/* Sample Post Preview */}
                            {generatedSchedule.length > 0 && (
                              <div className="mt-4 bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4">
                                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Sample Post Content</p>
                                <p className="text-sm text-white mb-1">{generatedSchedule[0].caption}</p>
                                <p className="text-xs text-zinc-500 font-mono">{generatedSchedule[0].hashtags}</p>
                              </div>
                            )}
                          </div>

                          <div className="p-6 border-t border-zinc-800 flex justify-between items-center shrink-0">
                            <p className="text-sm text-zinc-500">
                              Each post goes to both TikTok & Instagram
                            </p>
                            <div className="flex gap-3">
                              <button onClick={() => setBatchForm(prev => ({ ...prev, step: 1 }))} className="px-4 py-2 text-zinc-400 hover:text-white transition">Back</button>
                              <button
                                onClick={handleScheduleSubmit}
                                className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition"
                              >
                                Schedule {generatedSchedule.length * 2} {generatedSchedule.length * 2 === 1 ? 'Post' : 'Posts'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Artist</label>
                      <div className="flex gap-1">
                        <button onClick={() => setContentArtist('all')} className={`px-3 py-1.5 rounded-lg text-sm transition ${contentArtist === 'all' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>All</button>
                        {getVisibleArtists().map(a => (
                          <button key={a.id} onClick={() => setContentArtist(a.name)} className={`px-3 py-1.5 rounded-lg text-sm transition ${contentArtist === a.name ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>{a.name}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Status</label>
                      <div className="flex gap-1">
                        {['all', 'scheduled', 'posted'].map(s => (
                          <button key={s} onClick={() => setContentStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm transition ${contentStatus === s ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Sort</label>
                      <div className="flex gap-1">
                        <button onClick={() => setContentSortOrder('newest')} className={`px-3 py-1.5 rounded-lg text-sm transition ${contentSortOrder === 'newest' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>Newest</button>
                        <button onClick={() => setContentSortOrder('oldest')} className={`px-3 py-1.5 rounded-lg text-sm transition ${contentSortOrder === 'oldest' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>Oldest</button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedPosts.size > 0 && (
                      <button
                        onClick={handleBulkDelete}
                        disabled={bulkDeleting}
                        className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition flex items-center gap-2"
                      >
                        {bulkDeleting ? (
                          <>
                            <span className="animate-spin">⟳</span>
                            Deleting...
                          </>
                        ) : (
                          <>🗑 Delete {selectedPosts.size} selected</>
                        )}
                      </button>
                    )}
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
                        syncing
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      } disabled:cursor-not-allowed`}
                    >
                      {syncing ? (
                        <>
                          <span className="animate-spin">↻</span>
                          Syncing...
                        </>
                      ) : (
                        <>↻ Sync</>
                      )}
                    </button>
                    <button
                      onClick={() => setShowScheduleModal(true)}
                      className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
                    >
                      + Schedule Post
                    </button>
                    <button
                      onClick={fetchLateAccounts}
                      disabled={syncing}
                      className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
                    >
                      View Accounts
                    </button>
                    <button
                      onClick={exportToCSV}
                      disabled={latePosts.length === 0 || isExporting}
                      className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50 flex items-center gap-2"
                    >
                      {isExporting ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          Exporting...
                        </>
                      ) : '↓ Export CSV'}
                    </button>
                  </div>
                </div>

                {/* Connected Accounts Modal */}
                {showLateAccounts && (
                  <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowLateAccounts(false)}>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                      <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                        <h2 className="text-xl font-bold">Connected Accounts</h2>
                        <button onClick={() => setShowLateAccounts(false)} className="text-zinc-500 hover:text-white">✕</button>
                      </div>
                      <div className="p-6 overflow-y-auto max-h-[60vh]">
                        {Object.keys(derivedLateAccountIds).length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-zinc-400 mb-2">No accounts connected yet</p>
                            <button onClick={() => { setShowLateAccounts(false); setOperatorTab('pages'); }} className="text-sm text-blue-400 hover:text-blue-300">Go to Pages</button>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-zinc-500 mb-4">{latePages.length} account{latePages.length !== 1 ? 's' : ''} synced:</p>
                            <div className="space-y-3">
                              {Object.entries(derivedLateAccountIds).map(([handle, ids]) => (
                                <div key={handle} className="bg-zinc-800 rounded-lg p-4">
                                  <p className="font-medium text-white mb-2">{handle}</p>
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    {Object.entries(ids).map(([platform, accountId]) => (
                                      <div key={platform} className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded ${
                                          platform === 'tiktok' ? 'bg-pink-500/20 text-pink-400' :
                                          platform === 'instagram' ? 'bg-purple-500/20 text-purple-400' :
                                          platform === 'youtube' ? 'bg-red-500/20 text-red-400' :
                                          platform === 'facebook' ? 'bg-blue-500/20 text-blue-400' :
                                          'bg-zinc-500/20 text-zinc-400'
                                        }`}>{platform}</span>
                                        <code className="text-zinc-400 truncate max-w-[120px]">{accountId}</code>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 pt-4 border-t border-zinc-700">
                              <p className="text-xs text-zinc-500">Total: {latePages.length} platform connection{latePages.length !== 1 ? 's' : ''} across {Object.keys(derivedLateAccountIds).length} handle{Object.keys(derivedLateAccountIds).length !== 1 ? 's' : ''}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Sync Status */}
                {syncStatus && (
                  <div className="mb-4 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
                    {syncStatus}
                  </div>
                )}

                {/* View Toggle */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-500">View:</span>
                    <div className="flex bg-zinc-800 rounded-lg p-1">
                      <button
                        onClick={() => setContentView('list')}
                        className={`px-3 py-1.5 rounded-md text-sm transition ${contentView === 'list' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >
                        List
                      </button>
                      <button
                        onClick={() => setContentView('calendar')}
                        className={`px-3 py-1.5 rounded-md text-sm transition ${contentView === 'calendar' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >
                        Timeline
                      </button>
                      <button
                        onClick={() => setContentView('month')}
                        className={`px-3 py-1.5 rounded-md text-sm transition ${contentView === 'month' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >
                        Month
                      </button>
                    </div>
                    {latePosts.length === 0 && (
                      <span className="text-xs text-zinc-500 ml-2">Click "Sync" to load posts</span>
                    )}
                  </div>
                  {contentView === 'month' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCalendarMonth(new Date())}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition text-sm"
                      >
                        Today
                      </button>
                      <button
                        onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1))}
                        className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
                      >
                        ←
                      </button>
                      <span className="text-sm font-medium w-32 text-center">
                        {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </span>
                      <button
                        onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1))}
                        className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>

                {/* Search and Filter Bar */}
                {latePosts.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-4">
                    <div className="relative flex-1 min-w-[200px]">
                      <input
                        type="text"
                        value={postSearch}
                        onChange={e => setPostSearch(e.target.value)}
                        placeholder="Search posts by caption..."
                        className="w-full px-4 py-2 pl-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">🔍</span>
                    </div>
                    <div className="flex bg-zinc-800 rounded-lg p-1 flex-wrap">
                      <button
                        onClick={() => setPostPlatformFilter('all')}
                        className={`px-3 py-1.5 rounded-md text-sm transition ${postPlatformFilter === 'all' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >
                        All
                      </button>
                      {getPlatformKeys().map(platform => {
                        const config = getPlatformConfig(platform);
                        return (
                          <button
                            key={platform}
                            onClick={() => setPostPlatformFilter(platform)}
                            className={`px-3 py-1.5 rounded-md text-sm transition ${postPlatformFilter === platform ? `${config.bgColor} ${config.textColor}` : 'text-zinc-400 hover:text-white'}`}
                          >
                            {config.fullName}
                          </button>
                        );
                      })}
                    </div>
                    {/* Account Filter Dropdown */}
                    <select
                      value={postAccountFilter}
                      onChange={e => setPostAccountFilter(e.target.value)}
                      className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="all">All Accounts</option>
                      {getUniqueAccounts(latePosts).map(account => (
                        <option key={account} value={account}>@{account}</option>
                      ))}
                    </select>
                    {(postSearch || postPlatformFilter !== 'all' || contentStatus !== 'all' || postAccountFilter !== 'all') && (
                      <button
                        onClick={() => { setPostSearch(''); setPostPlatformFilter('all'); setContentStatus('all'); setPostAccountFilter('all'); }}
                        className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}

                {/* Stats Cards - with filtered data */}
                {(() => {
                  // Apply the same filtering to stats
                  const filteredStatsData = latePosts.filter(post => {
                    if (postSearch && !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())) return false;
                    if (postPlatformFilter !== 'all') {
                      const platforms = (post.platforms || []).map(p => p.platform || p);
                      if (!platforms.includes(postPlatformFilter)) return false;
                    }
                    if (contentStatus !== 'all') {
                      const postStatus = post.status === 'published' ? 'posted' : post.status;
                      if (postStatus !== contentStatus) return false;
                    }
                    if (postAccountFilter !== 'all') {
                      if (getPostAccount(post) !== postAccountFilter) return false;
                    }
                    return true;
                  });
                  const hasFilters = postSearch || postPlatformFilter !== 'all' || contentStatus !== 'all' || postAccountFilter !== 'all';
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                        <p className="text-zinc-500 text-xs mb-1">{hasFilters ? 'Filtered Posts' : 'Synced Posts'}</p>
                        <p className="text-2xl font-bold text-purple-400">{filteredStatsData.length}{hasFilters && <span className="text-sm text-zinc-500 ml-1">/ {latePosts.length}</span>}</p>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                        <p className="text-zinc-500 text-xs mb-1">Scheduled</p>
                        <p className="text-2xl font-bold">{filteredStatsData.filter(p => p.status === 'scheduled').length}</p>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                        <p className="text-zinc-500 text-xs mb-1">Posted</p>
                        <p className="text-2xl font-bold text-green-400">{filteredStatsData.filter(p => p.status === 'posted' || p.status === 'published').length}</p>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                        <p className="text-zinc-500 text-xs mb-1">Schedule Status</p>
                        <p className="text-sm font-medium text-green-400">● Connected</p>
                        {lastSynced && (
                          <p className="text-xs text-zinc-500 mt-1">
                            Synced {lastSynced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Loading State */}
                {syncing && (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden animate-pulse">
                        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/50">
                          <div className="h-6 bg-zinc-700 rounded w-32"></div>
                        </div>
                        <div className="p-4 space-y-3">
                          <div className="flex items-center gap-4">
                            <div className="h-4 bg-zinc-800 rounded w-16"></div>
                            <div className="h-4 bg-zinc-800 rounded w-48"></div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="h-4 bg-zinc-800 rounded w-16"></div>
                            <div className="h-4 bg-zinc-800 rounded w-64"></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Calendar View */}
                {!syncing && contentView === 'calendar' && (() => {
                  // Filter posts first
                  const filteredLatePosts = latePosts.filter(post => {
                    // Search filter
                    if (postSearch && !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())) {
                      return false;
                    }
                    // Platform filter
                    if (postPlatformFilter !== 'all') {
                      const platforms = (post.platforms || []).map(p => p.platform || p);
                      if (!platforms.includes(postPlatformFilter)) return false;
                    }
                    // Status filter - map 'published' to 'posted' for UI
                    if (contentStatus !== 'all') {
                      const postStatus = post.status === 'published' ? 'posted' : post.status;
                      if (postStatus !== contentStatus) return false;
                    }
                    // Account filter
                    if (postAccountFilter !== 'all') {
                      if (getPostAccount(post) !== postAccountFilter) return false;
                    }
                    return true;
                  });

                  // Group posts by date
                  const postsByDate = filteredLatePosts.reduce((acc, post) => {
                    const date = post.scheduledFor ? post.scheduledFor.split('T')[0] : 'Unknown';
                    if (!acc[date]) acc[date] = [];
                    acc[date].push(post);
                    return acc;
                  }, {});

                  const sortedDates = Object.keys(postsByDate).sort((a, b) => contentSortOrder === 'newest' ? b.localeCompare(a) : a.localeCompare(b));

                  return (
                    <div className="space-y-4">
                      {sortedDates.length === 0 ? (
                        <SharedEmptyState
                          icon="📅"
                          title="No posts scheduled"
                          description={postSearch || postPlatformFilter !== 'all' ? 'No posts match your filters. Try adjusting your search.' : 'Sync your posts to see your scheduled content timeline.'}
                          actionLabel={!postSearch && postPlatformFilter === 'all' ? 'Sync' : undefined}
                          onAction={!postSearch && postPlatformFilter === 'all' ? handleSync : undefined}
                        />
                      ) : (
                        sortedDates.map(date => {
                          const datePosts = postsByDate[date];
                          const dateObj = new Date(date + 'T12:00:00');
                          const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
                          const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                          return (
                            <div key={date} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                              <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/50 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="text-center">
                                    <p className="text-xs text-zinc-500 uppercase">{dayName}</p>
                                    <p className="text-lg font-bold">{monthDay}</p>
                                  </div>
                                  <span className="text-sm text-zinc-500">{datePosts.length} post{datePosts.length === 1 ? '' : 's'}</span>
                                </div>
                              </div>
                              <div className="divide-y divide-zinc-800/50">
                                {datePosts.map(post => (
                                  <div key={post._id} className="p-4 flex items-center justify-between hover:bg-zinc-800/30 transition">
                                    <div className="flex items-center gap-4">
                                      <div className="text-sm text-zinc-400 w-16">
                                        {post.scheduledFor ? new Date(post.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '-'}
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                          {(post.platforms || []).map(p => {
                                            const platformKey = p.platform || p;
                                            const config = getPlatformConfig(platformKey);
                                            return (
                                              <span key={platformKey} className={`px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.textColor}`}>
                                                {config.fullName}
                                              </span>
                                            );
                                          })}
                                        </div>
                                        <p className="text-sm text-zinc-300 mt-1 max-w-md truncate">{post.content || 'No caption'}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {getPostUrls(post).map((pu, idx) => {
                                        const config = getPlatformConfig(pu.platform);
                                        return (
                                          <a
                                            key={idx}
                                            href={pu.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`px-2 py-1 rounded text-xs font-medium transition ${config.bgColor} ${config.textColor} ${config.hoverBg}`}
                                          >
                                            ↗
                                          </a>
                                        );
                                      })}
                                      <button
                                        onClick={() => confirmDeletePost(post._id, post.content?.substring(0, 50))}
                                        disabled={deletingPostId === post._id}
                                        className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition disabled:opacity-50"
                                      >
                                        {deletingPostId === post._id ? 'Deleting...' : 'Delete'}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()}

                {/* Month View */}
                {!syncing && contentView === 'month' && (() => {
                  // Filter posts first
                  const filteredLatePosts = latePosts.filter(post => {
                    // Search filter
                    if (postSearch && !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())) {
                      return false;
                    }
                    // Platform filter
                    if (postPlatformFilter !== 'all') {
                      const platforms = (post.platforms || []).map(p => p.platform || p);
                      if (!platforms.includes(postPlatformFilter)) return false;
                    }
                    // Status filter - map 'published' to 'posted' for UI
                    if (contentStatus !== 'all') {
                      const postStatus = post.status === 'published' ? 'posted' : post.status;
                      if (postStatus !== contentStatus) return false;
                    }
                    // Account filter
                    if (postAccountFilter !== 'all') {
                      if (getPostAccount(post) !== postAccountFilter) return false;
                    }
                    return true;
                  });

                  // Get calendar grid for the month
                  const year = calendarMonth.getFullYear();
                  const month = calendarMonth.getMonth();
                  const firstDay = new Date(year, month, 1);
                  const lastDay = new Date(year, month + 1, 0);
                  const startPadding = firstDay.getDay();
                  const totalDays = lastDay.getDate();

                  // Group posts by date
                  const postsByDate = filteredLatePosts.reduce((acc, post) => {
                    if (!post.scheduledFor) return acc;
                    const date = post.scheduledFor.split('T')[0];
                    if (!acc[date]) acc[date] = [];
                    acc[date].push(post);
                    return acc;
                  }, {});

                  // Generate calendar grid
                  const days = [];
                  for (let i = 0; i < startPadding; i++) {
                    days.push(null);
                  }
                  for (let d = 1; d <= totalDays; d++) {
                    days.push(d);
                  }

                  return (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                      {/* Day headers */}
                      <div className="grid grid-cols-7 border-b border-zinc-800">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                          <div key={day} className="p-3 text-center text-sm font-medium text-zinc-500 border-r border-zinc-800 last:border-r-0">
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* Calendar grid */}
                      <div className="grid grid-cols-7">
                        {days.map((day, i) => {
                          if (day === null) {
                            return <div key={`empty-${i}`} className="min-h-[120px] bg-zinc-950/50 border-r border-b border-zinc-800" />;
                          }

                          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const dayPosts = postsByDate[dateStr] || [];
                          const isToday = new Date().toISOString().split('T')[0] === dateStr;

                          // UI-14: Check if this day is in the current week
                          const today = new Date();
                          const startOfWeek = new Date(today);
                          startOfWeek.setDate(today.getDate() - today.getDay());
                          const endOfWeek = new Date(startOfWeek);
                          endOfWeek.setDate(startOfWeek.getDate() + 6);
                          const dayDate = new Date(year, month, day);
                          const isCurrentWeek = dayDate >= startOfWeek && dayDate <= endOfWeek;

                          return (
                            <div
                              key={day}
                              onClick={() => dayPosts.length > 0 && setDayDetailDrawer({ isOpen: true, date: dateStr, posts: dayPosts })}
                              className={`min-h-[120px] p-2 border-r border-b border-zinc-800 last:border-r-0 transition-colors ${
                                isToday ? 'bg-purple-900/20' :
                                isCurrentWeek ? 'bg-zinc-800/30' : ''
                              } ${dayPosts.length > 0 ? 'cursor-pointer hover:bg-zinc-800/50' : ''}`}
                            >
                              <div className={`text-sm font-medium mb-2 ${isToday ? 'text-purple-400' : 'text-zinc-400'}`}>
                                {day}
                                {dayPosts.length > 0 && (
                                  <span className="ml-2 px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs">
                                    {dayPosts.length}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1 max-h-[80px] overflow-y-auto">
                                {dayPosts.slice(0, 3).map((post, idx) => {
                                  const time = post.scheduledFor ? new Date(post.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                                  const platforms = (post.platforms || []).map(p => p.platform || p);
                                  return (
                                    <div
                                      key={post._id || idx}
                                      className="text-xs p-1.5 bg-zinc-800 rounded truncate hover:bg-zinc-700 cursor-pointer transition"
                                      title={post.content}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDayDetailDrawer({ isOpen: true, date: dateStr, posts: dayPosts });
                                      }}
                                    >
                                      <span className="text-zinc-500">{time}</span>
                                      {' '}
                                      {platforms.includes('tiktok') && <span className="text-pink-400">TT</span>}
                                      {platforms.includes('instagram') && <span className="text-purple-400 ml-1">IG</span>}
                                    </div>
                                  );
                                })}
                                {dayPosts.length > 3 && (
                                  <div className="text-xs text-zinc-500 text-center">
                                    +{dayPosts.length - 3} more
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* List View */}
                {!syncing && contentView === 'list' && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
                    <table className="w-full min-w-[700px]">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">Date & Time</th>
                          <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">Platforms</th>
                          <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">Caption</th>
                          <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">Status</th>
                          <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">View</th>
                          <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const filteredPosts = latePosts
                            .filter(post => {
                              // Search filter
                              if (postSearch && !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())) {
                                return false;
                              }
                              // Platform filter
                              if (postPlatformFilter !== 'all') {
                                const platforms = (post.platforms || []).map(p => p.platform || p);
                                if (!platforms.includes(postPlatformFilter)) return false;
                              }
                              // Status filter - map 'published' to 'posted' for UI
                              if (contentStatus !== 'all') {
                                const postStatus = post.status === 'published' ? 'posted' : post.status;
                                if (postStatus !== contentStatus) return false;
                              }
                              // Account filter
                              if (postAccountFilter !== 'all') {
                                if (getPostAccount(post) !== postAccountFilter) return false;
                              }
                              return true;
                            })
                            .sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));

                          return filteredPosts.length > 0 ? (
                            filteredPosts.map(post => (
                              <tr key={post._id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition">
                                <td className="p-4 text-sm text-zinc-400">
                                  {post.scheduledFor ? new Date(post.scheduledFor).toLocaleString('en-US', {
                                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                                  }) : '-'}
                                </td>
                                <td className="p-4">
                                  <div className="flex gap-1">
                                    {(post.platforms || []).map((p, i) => {
                                      const platformKey = p.platform || p;
                                      const config = getPlatformConfig(platformKey);
                                      return (
                                        <span key={i} className={`px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.textColor}`}>
                                          {config.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="p-4 text-sm max-w-[200px] truncate">{post.content || 'No caption'}</td>
                                <td className="p-4">
                                  <span className={`px-2 py-1 rounded-full text-xs ${
                                    post.status === 'scheduled' ? 'bg-yellow-500/20 text-yellow-400' :
                                    post.status === 'posted' ? 'bg-green-500/20 text-green-400' :
                                    post.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                    'bg-zinc-500/20 text-zinc-400'
                                  }`}>
                                    {post.status || 'unknown'}
                                  </span>
                                </td>
                                <td className="p-4">
                                  <div className="flex gap-2 flex-wrap">
                                    {getPostUrls(post).length > 0 ? (
                                      getPostUrls(post).map((pu, idx) => {
                                        const config = getPlatformConfig(pu.platform);
                                        return (
                                          <a
                                            key={idx}
                                            href={pu.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`px-2 py-1 rounded text-xs font-medium transition ${config.bgColor} ${config.textColor} ${config.hoverBg}`}
                                          >
                                            View {pu.label}
                                          </a>
                                        );
                                      })
                                    ) : (
                                      <span className="text-xs text-zinc-600">—</span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-4">
                                  <button
                                    onClick={() => confirmDeletePost(post._id, post.content?.substring(0, 50))}
                                    disabled={deletingPostId === post._id}
                                    className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition disabled:opacity-50"
                                  >
                                    {deletingPostId === post._id ? '...' : 'Delete'}
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="p-8">
                                <SharedEmptyState
                                  icon="📋"
                                  title="No posts found"
                                  description={postSearch || postPlatformFilter !== 'all' ? 'No posts match your current filters. Try adjusting your search.' : 'Sync your posts to see your scheduled content.'}
                                  actionLabel={!postSearch && postPlatformFilter === 'all' ? 'Sync' : undefined}
                                  onAction={!postSearch && postPlatformFilter === 'all' ? handleSync : undefined}
                                />
                              </td>
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Campaigns Tab — REMOVED */}
          {false && operatorTab === 'campaigns' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-bold">Campaigns</h1>
                  <p className="text-sm text-zinc-500">Track budgets, timelines, and goals for each campaign</p>
                </div>
                <button
                  onClick={() => setShowCampaignModal(true)}
                  className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
                >
                  + New Campaign
                </button>
              </div>

              {/* Campaign Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className={`${t.bgSurface} border ${t.border} rounded-xl p-4`}>
                  <p className={`${t.textSecondary} text-xs mb-1`}>Active Campaigns</p>
                  <p className="text-2xl font-bold text-green-400">{campaigns.filter(c => c.status === 'active').length}</p>
                </div>
                <div className={`${t.bgSurface} border ${t.border} rounded-xl p-4`}>
                  <p className={`${t.textSecondary} text-xs mb-1`}>Total Budget</p>
                  <p className="text-2xl font-bold">${campaigns.reduce((sum, c) => sum + c.budget, 0).toLocaleString()}</p>
                </div>
                <div className={`${t.bgSurface} border ${t.border} rounded-xl p-4`}>
                  <p className={`${t.textSecondary} text-xs mb-1`}>Total Spent</p>
                  <p className="text-2xl font-bold text-purple-400">${campaigns.reduce((sum, c) => sum + c.spent, 0).toLocaleString()}</p>
                </div>
                <div className={`${t.bgSurface} border ${t.border} rounded-xl p-4`}>
                  <p className={`${t.textSecondary} text-xs mb-1`}>Posts Scheduled</p>
                  <p className="text-2xl font-bold">{campaigns.reduce((sum, c) => sum + c.postsScheduled, 0)}</p>
                </div>
              </div>

              {/* Campaign Cards */}
              <div className="grid gap-4">
                {campaigns.length === 0 ? (
                  <SharedEmptyState
                    icon="🎯"
                    title="No campaigns yet"
                    description="Create your first campaign to start tracking budgets, timelines, and performance goals."
                    actionLabel="Create Campaign"
                    onAction={() => setShowCampaignModal(true)}
                  />
                ) : campaigns.map(campaign => {
                  const progress = campaign.budget > 0 ? (campaign.spent / campaign.budget) * 100 : 0;
                  const viewProgress = campaign.goals.views > 0 ? (campaign.achieved.views / campaign.goals.views) * 100 : 0;
                  const followerProgress = campaign.goals.followers > 0 ? (campaign.achieved.followers / campaign.goals.followers) * 100 : 0;

                  return (
                    <div key={campaign.id} className={`${t.bgSurface} border ${t.border} rounded-xl p-6`}>
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-lg font-semibold">{campaign.name}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                              campaign.status === 'active' ? 'bg-green-500/20 text-green-400' :
                              campaign.status === 'planning' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-zinc-500/20 text-zinc-400'
                            }`}>
                              {campaign.status}
                            </span>
                          </div>
                          <p className={`text-sm ${t.textSecondary}`}>
                            {new Date(campaign.startDate).toLocaleDateString()} - {new Date(campaign.endDate).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {campaign.categories.map(cat => (
                            <span key={cat} className={`px-2 py-1 ${t.bgElevated} rounded text-xs`}>{cat}</span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-6">
                        {/* Budget */}
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className={t.textSecondary}>Budget</span>
                            <span>${campaign.spent.toLocaleString()} / ${campaign.budget.toLocaleString()}</span>
                          </div>
                          <div className={`h-2 ${t.bgElevated} rounded-full overflow-hidden`}>
                            <div
                              className="h-full bg-purple-500 rounded-full transition-all"
                              style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Views Goal */}
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className={t.textSecondary}>Views</span>
                            <span>{(campaign.achieved.views / 1000).toFixed(0)}K / {(campaign.goals.views / 1000).toFixed(0)}K</span>
                          </div>
                          <div className={`h-2 ${t.bgElevated} rounded-full overflow-hidden`}>
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${Math.min(viewProgress, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Followers Goal */}
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className={t.textSecondary}>Followers</span>
                            <span>{campaign.achieved.followers.toLocaleString()} / {campaign.goals.followers.toLocaleString()}</span>
                          </div>
                          <div className={`h-2 ${t.bgElevated} rounded-full overflow-hidden`}>
                            <div
                              className="h-full bg-green-500 rounded-full transition-all"
                              style={{ width: `${Math.min(followerProgress, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className={`flex justify-between items-center mt-4 pt-4 border-t ${t.border}`}>
                        <div className="flex gap-4 text-sm">
                          <span className={t.textSecondary}>{campaign.postsScheduled} posts scheduled</span>
                          <span className={t.textSecondary}>{campaign.postsPublished} published</span>
                        </div>
                        {/* L-02: "View Details" removed — was a dead button with no handler */}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* New Campaign Modal */}
              {showCampaignModal && (
                <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowCampaignModal(false)}>
                  <div className={`${t.bgSurface} border ${t.border} rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
                    <div className={`p-4 sm:p-6 border-b ${t.border} flex justify-between items-center sticky top-0 ${t.bgSurface} z-10`}>
                      <h2 className="text-lg sm:text-xl font-bold">New Campaign</h2>
                      <button onClick={() => setShowCampaignModal(false)} className={`${t.textSecondary} ${t.hoverText} text-2xl`}>✕</button>
                    </div>
                    <form onSubmit={handleCreateCampaign} className="p-4 sm:p-6 space-y-4">
                      <div>
                        <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>Campaign Name</label>
                        <input
                          type="text"
                          value={campaignForm.name}
                          onChange={e => setCampaignForm(prev => ({ ...prev, name: e.target.value }))}
                          className={`w-full px-4 py-3 ${t.bgElevated} border ${t.inputBorder} rounded-xl text-white`}
                          placeholder="e.g., Boon February Push"
                          required
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>Start Date</label>
                          <input
                            type="date"
                            value={campaignForm.startDate}
                            onChange={e => setCampaignForm(prev => ({ ...prev, startDate: e.target.value }))}
                            className={`w-full px-4 py-3 ${t.bgElevated} border ${t.inputBorder} rounded-xl text-white`}
                            required
                          />
                        </div>
                        <div>
                          <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>End Date</label>
                          <input
                            type="date"
                            value={campaignForm.endDate}
                            onChange={e => setCampaignForm(prev => ({ ...prev, endDate: e.target.value }))}
                            className={`w-full px-4 py-3 ${t.bgElevated} border ${t.inputBorder} rounded-xl text-white`}
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>Budget ($)</label>
                        <input
                          type="number"
                          value={campaignForm.budget}
                          onChange={e => setCampaignForm(prev => ({ ...prev, budget: e.target.value }))}
                          className={`w-full px-4 py-3 ${t.bgElevated} border ${t.inputBorder} rounded-xl text-white`}
                          placeholder="5000"
                          required
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>Target Categories</label>
                        <div className="grid grid-cols-3 gap-2">
                          {['Fashion', 'Y2K', 'Emo'].map(cat => (
                            <label
                              key={cat}
                              className={`flex items-center justify-center gap-2 p-3 rounded-lg cursor-pointer transition border ${
                                campaignForm.categories.includes(cat)
                                  ? 'bg-purple-500/20 border-purple-500 text-purple-300'
                                  : `${t.bgElevated} ${t.inputBorder} ${t.textSecondary} ${t.hoverBg}`
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={campaignForm.categories.includes(cat)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setCampaignForm(prev => ({ ...prev, categories: [...prev.categories, cat] }));
                                  } else {
                                    setCampaignForm(prev => ({ ...prev, categories: prev.categories.filter(c => c !== cat) }));
                                  }
                                }}
                                className="sr-only"
                              />
                              <span className="text-sm font-medium">{cat}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>Views Goal</label>
                          <input
                            type="number"
                            value={campaignForm.goalViews}
                            onChange={e => setCampaignForm(prev => ({ ...prev, goalViews: e.target.value }))}
                            className={`w-full px-4 py-3 ${t.bgElevated} border ${t.inputBorder} rounded-xl text-white`}
                            placeholder="500000"
                          />
                        </div>
                        <div>
                          <label className={`block text-sm font-medium ${t.textSecondary} mb-2`}>Followers Goal</label>
                          <input
                            type="number"
                            value={campaignForm.goalFollowers}
                            onChange={e => setCampaignForm(prev => ({ ...prev, goalFollowers: e.target.value }))}
                            className={`w-full px-4 py-3 ${t.bgElevated} border ${t.inputBorder} rounded-xl text-white`}
                            placeholder="5000"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={isCreatingCampaign || !campaignForm.name || !campaignForm.startDate || !campaignForm.endDate || !campaignForm.budget || campaignForm.categories.length === 0}
                        className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isCreatingCampaign ? (
                          <>
                            <span className="animate-spin">⟳</span>
                            Creating...
                          </>
                        ) : 'Create Campaign'}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content Banks Tab — REMOVED: Banks are now per-collection in Studio "Captions/Hashtags" tab */}
          {false && operatorTab === 'banks' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-bold">Content Banks</h1>
                  <p className="text-sm text-zinc-500">Hashtags and captions per aesthetic category</p>
                </div>
              </div>

              {Object.entries(contentBanks).map(([category, bank]) => (
                <div key={category} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-zinc-800 bg-zinc-800/50">
                    <h3 className="font-semibold">{category}</h3>
                  </div>
                  <div className="p-4 grid md:grid-cols-2 gap-6">
                    {/* Hashtags */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-3">Hashtags</label>

                      {/* Always Use */}
                      <div className="mb-3">
                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Always Include</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {bank.hashtags.always.map((tag, i) => (
                            <span key={i} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs font-mono">
                              {tag}
                              <button
                                onClick={() => {
                                  setContentBanks(prev => ({
                                    ...prev,
                                    [category]: {
                                      ...prev[category],
                                      hashtags: {
                                        ...prev[category].hashtags,
                                        always: prev[category].hashtags.always.filter((_, idx) => idx !== i)
                                      }
                                    }
                                  }));
                                }}
                                className="ml-1 text-emerald-600 hover:text-emerald-300"
                              >×</button>
                            </span>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Add always-use hashtag..."
                          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              const newTag = e.target.value.trim().startsWith('#') ? e.target.value.trim() : '#' + e.target.value.trim();
                              setContentBanks(prev => ({
                                ...prev,
                                [category]: {
                                  ...prev[category],
                                  hashtags: {
                                    ...prev[category].hashtags,
                                    always: [...prev[category].hashtags.always, newTag]
                                  }
                                }
                              }));
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>

                      {/* Pool */}
                      <div>
                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Random Pool (3-5 selected per post)</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {bank.hashtags.pool.map((tag, i) => (
                            <span key={i} className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded text-xs font-mono">
                              {tag}
                              <button
                                onClick={() => {
                                  setContentBanks(prev => ({
                                    ...prev,
                                    [category]: {
                                      ...prev[category],
                                      hashtags: {
                                        ...prev[category].hashtags,
                                        pool: prev[category].hashtags.pool.filter((_, idx) => idx !== i)
                                      }
                                    }
                                  }));
                                }}
                                className="ml-1 text-zinc-600 hover:text-zinc-300"
                              >×</button>
                            </span>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Add to pool..."
                          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              const newTag = e.target.value.trim().startsWith('#') ? e.target.value.trim() : '#' + e.target.value.trim();
                              setContentBanks(prev => ({
                                ...prev,
                                [category]: {
                                  ...prev[category],
                                  hashtags: {
                                    ...prev[category].hashtags,
                                    pool: [...prev[category].hashtags.pool, newTag]
                                  }
                                }
                              }));
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>
                    </div>

                    {/* Captions */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-3">Captions</label>

                      {/* Always Use */}
                      <div className="mb-3">
                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Always Include</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {bank.captions.always.map((cap, i) => (
                            <span key={i} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                              {cap}
                              <button
                                onClick={() => {
                                  setContentBanks(prev => ({
                                    ...prev,
                                    [category]: {
                                      ...prev[category],
                                      captions: {
                                        ...prev[category].captions,
                                        always: prev[category].captions.always.filter((_, idx) => idx !== i)
                                      }
                                    }
                                  }));
                                }}
                                className="ml-1 text-emerald-600 hover:text-emerald-300"
                              >×</button>
                            </span>
                          ))}
                          {bank.captions.always.length === 0 && (
                            <span className="text-xs text-zinc-600">None</span>
                          )}
                        </div>
                        <input
                          type="text"
                          placeholder="Add always-use caption..."
                          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              setContentBanks(prev => ({
                                ...prev,
                                [category]: {
                                  ...prev[category],
                                  captions: {
                                    ...prev[category].captions,
                                    always: [...prev[category].captions.always, e.target.value.trim()]
                                  }
                                }
                              }));
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>

                      {/* Pool */}
                      <div>
                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Random Pool (1 selected per post)</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {bank.captions.pool.map((cap, i) => (
                            <span key={i} className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded text-xs">
                              {cap}
                              <button
                                onClick={() => {
                                  setContentBanks(prev => ({
                                    ...prev,
                                    [category]: {
                                      ...prev[category],
                                      captions: {
                                        ...prev[category].captions,
                                        pool: prev[category].captions.pool.filter((_, idx) => idx !== i)
                                      }
                                    }
                                  }));
                                }}
                                className="ml-1 text-zinc-600 hover:text-zinc-300"
                              >×</button>
                            </span>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Add to pool..."
                          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              setContentBanks(prev => ({
                                ...prev,
                                [category]: {
                                  ...prev[category],
                                  captions: {
                                    ...prev[category].captions,
                                    pool: [...prev[category].captions.pool, e.target.value.trim()]
                                  }
                                }
                              }));
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Analytics Tab */}
          {operatorTab === 'analytics' && (
            <AnalyticsDashboard
              artistId={currentArtistId}
              artists={getVisibleArtists()}
              lateConnected={artistLateConnected}
              onArtistChange={handleArtistChange}
              onSyncLate={async () => {
                const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
                if (result.success) {
                  setLatePosts(result.posts || []);
                  return { success: true, posts: result.posts || [] };
                }
                return result;
              }}
              latePosts={latePosts}
            />
          )}

          {/* Applications Tab */}
          {operatorTab === 'applications' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h1 className="text-2xl font-bold">Applications</h1>
                  <p className={`text-sm ${t.textSecondary}`}>{applications.filter(a => a.status === 'pending').length} pending review</p>
                </div>
                <div className="flex gap-2">
                  {['all', 'pending', 'approved', 'declined'].map(filter => (
                    <button
                      key={filter}
                      onClick={() => setApplicationFilter && setApplicationFilter(filter)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition ${
                        (!applicationFilter || applicationFilter === 'all') && filter === 'all'
                          ? 'bg-white text-black'
                          : applicationFilter === filter
                            ? 'bg-white text-black'
                            : `${t.textSecondary} ${t.hoverText} ${t.hoverBg}`
                      }`}
                    >
                      {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {applications.length === 0 ? (
                <SharedEmptyState
                  icon="📋"
                  title="No applications yet"
                  description="Applications will appear here when artists submit the intake form."
                  actionLabel="Share Intake Form"
                  onAction={() => {
                    navigator.clipboard.writeText(window.location.origin + '?page=intake');
                    showToast('Intake form link copied!', 'success');
                  }}
                />
              ) : (() => {
                const filteredApps = applications.filter(app => !applicationFilter || applicationFilter === 'all' || app.status === applicationFilter);
                return filteredApps.length === 0 ? (
                  <SharedEmptyState
                    icon="🔍"
                    title={`No ${applicationFilter} applications`}
                    description="Try changing your filter to see more applications."
                    actionLabel="Show All"
                    onAction={() => setApplicationFilter('all')}
                  />
                ) : (
                <div className="space-y-4">
                  {filteredApps.map((app) => (
                    <div key={app.id} className={`${t.bgSurface} border rounded-xl overflow-hidden ${
                      app.status === 'approved' ? 'border-green-500/30' :
                      app.status === 'declined' ? 'border-red-500/30' : t.border
                    }`}>
                      <div className="p-6">
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold">{app.name}</h3>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                app.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                                app.status === 'declined' || app.status === 'denied' ? 'bg-red-500/20 text-red-400' :
                                app.status === 'pending_payment' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>
                                {app.status === 'pending_payment' ? 'Awaiting Payment' :
                                 app.status === 'pending_review' ? 'Pending Review' :
                                 app.status}
                              </span>
                            </div>
                            <p className={`${t.textSecondary} text-sm mb-3`}>{app.email}</p>
                            <div className="flex flex-wrap gap-2 mb-3">
                              <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs">{app.tier}</span>
                              {app.genre && <span className={`px-2 py-1 ${t.bgElevated} ${t.textSecondary} rounded text-xs`}>{app.genre}</span>}
                              {app.vibes && app.vibes.slice(0, 3).map((vibe, i) => (
                                <span key={i} className={`px-2 py-1 ${t.bgElevated} ${t.textMuted} rounded text-xs`}>{vibe}</span>
                              ))}
                            </div>
                            <div className={`text-xs ${t.textMuted}`}>
                              Submitted {app.submitted}
                              {app.spotify && <span className="ml-3">• Has Spotify</span>}
                              {app.adjacentArtists && <span className="ml-3">• Provided adjacent artists</span>}
                            </div>
                          </div>
                          {(app.status === 'pending' || app.status === 'pending_review') && (
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => handleApproveApplication(app)}
                                className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 transition"
                              >
                                ✓ Approve
                              </button>
                              <button
                                onClick={() => handleDenyApplication(app)}
                                className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition"
                              >
                                ✕ Deny
                              </button>
                            </div>
                          )}
                          {app.status === 'pending_payment' && (
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => handleMarkPaymentComplete(app)}
                                className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition"
                              >
                                💳 Mark as Paid
                              </button>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(app.paymentLink || '');
                                  showToast('Payment link copied!', 'success');
                                }}
                                className={`px-4 py-2 ${t.bgElevated} ${t.textSecondary} rounded-lg text-sm font-medium ${t.hoverBg} transition`}
                              >
                                📋 Copy Link
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Expandable details */}
                        {app.projectDescription && (
                          <details className={`mt-4 pt-4 border-t ${t.border}`}>
                            <summary className={`text-sm ${t.textSecondary} cursor-pointer ${t.hoverText}`}>View full application details</summary>
                            <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
                              {app.projectType && (
                                <div>
                                  <span className={t.textSecondary}>Project Type:</span>
                                  <span className={`ml-2 ${t.textPrimary}`}>{app.projectType}</span>
                                </div>
                              )}
                              {app.cdTier && (
                                <div>
                                  <span className={t.textSecondary}>Creative Direction:</span>
                                  <span className={`ml-2 ${t.textPrimary}`}>{app.cdTier}</span>
                                </div>
                              )}
                              {app.duration && (
                                <div>
                                  <span className={t.textSecondary}>Duration:</span>
                                  <span className={`ml-2 ${t.textPrimary}`}>{app.duration}</span>
                                </div>
                              )}
                              {app.aestheticWords && (
                                <div className="md:col-span-2">
                                  <span className={t.textSecondary}>Aesthetic:</span>
                                  <span className={`ml-2 ${t.textPrimary}`}>{app.aestheticWords}</span>
                                </div>
                              )}
                              {app.adjacentArtists && (
                                <div className="md:col-span-2">
                                  <span className={t.textSecondary}>Adjacent Artists:</span>
                                  <span className={`ml-2 ${t.textPrimary}`}>{app.adjacentArtists}</span>
                                </div>
                              )}
                              {app.idealListener && (
                                <div className="md:col-span-2">
                                  <span className={t.textSecondary}>Ideal Listener:</span>
                                  <span className={`ml-2 ${t.textPrimary}`}>{app.idealListener}</span>
                                </div>
                              )}
                              {app.projectDescription && (
                                <div className="md:col-span-2">
                                  <span className={t.textSecondary}>Project Description:</span>
                                  <p className={`mt-1 ${t.textPrimary}`}>{app.projectDescription}</p>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                );
              })()}
            </div>
          )}

        </div>
        )}

        {/* ═══ Schedule Tab — outside max-w wrapper to prevent centering shift ═══ */}
        {!showVideoEditor && operatorTab === 'schedule' && (
          <SchedulingPage
            db={db}
            artistId={currentArtistId}
            accounts={latePages}
            lateAccountIds={derivedLateAccountIds}
            onSchedulePost={(params) => lateApi.schedulePost({ ...params, artistId: currentArtistId })}
            onDeleteLatePost={(latePostId) => lateApi.deletePost(latePostId, currentArtistId)}
            onEditDraft={(post) => {
              if (post.editorState) {
                setShowVideoEditor(true);
              }
            }}
            onBack={() => setOperatorTab('pages')}
            visibleArtists={getVisibleArtists()}
            onArtistChange={handleArtistChange}
          />
        )}

        </AppShell>

        {/* ADD ARTIST MODAL */}
        {showAddArtistModal && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowAddArtistModal(false)}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-xl font-bold">Add New Artist</h2>
                <button onClick={() => setShowAddArtistModal(false)} className="text-zinc-500 hover:text-white">✕</button>
              </div>
              <form onSubmit={handleAddArtist} className="p-6 space-y-4">
                {addArtistForm.error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {addArtistForm.error}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Artist Name</label>
                  <input
                    type="text"
                    value={addArtistForm.name}
                    onChange={e => setAddArtistForm(prev => ({ ...prev, name: e.target.value, error: null }))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                    placeholder="Artist name"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Tier</label>
                  <select
                    value={addArtistForm.tier}
                    onChange={e => setAddArtistForm(prev => ({ ...prev, tier: e.target.value }))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="Scale">Scale</option>
                    <option value="Growth">Growth</option>
                    <option value="Starter">Starter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Artist Email (optional)</label>
                  <input
                    type="email"
                    value={addArtistForm.artistEmail}
                    onChange={e => setAddArtistForm(prev => ({ ...prev, artistEmail: e.target.value }))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                    placeholder="artist@email.com"
                  />
                  <p className="text-xs text-zinc-500 mt-1">If provided, the artist can sign in and see their dashboard</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Social Sets for this artist</label>
                  <select
                    value={addArtistForm.socialSetsForArtist}
                    onChange={e => setAddArtistForm(prev => ({ ...prev, socialSetsForArtist: parseInt(e.target.value) }))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value={5}>5 Social Sets (Starter)</option>
                    <option value={10}>10 Social Sets (Growth)</option>
                    <option value={25}>25 Social Sets (Scale)</option>
                    <option value={50}>50 Social Sets (Sensation)</option>
                  </select>
                  <p className="text-xs text-zinc-500 mt-1">Each Social Set = 4 platform slots (FB + TikTok + Twitter + IG)</p>
                </div>
                {/* Only show operator assignment for conductors - operators auto-assign to themselves */}
                {isConductor(user) ? (
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Assign to Operator</label>
                    <select
                      value={addArtistForm.assignedOperatorId}
                      onChange={e => setAddArtistForm(prev => ({ ...prev, assignedOperatorId: e.target.value }))}
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                    >
                      {allowedUsers
                        .filter(u => u.role === 'operator' && u.status === 'active')
                        .map(op => (
                          <option key={op.id} value={op.id}>{op.name} ({op.email})</option>
                        ))
                      }
                    </select>
                    <p className="text-xs text-zinc-500 mt-1">Select which operator can manage this artist</p>
                  </div>
                ) : (
                  <div className="p-3 bg-violet-500/10 border border-violet-500/30 rounded-xl">
                    <p className="text-sm text-violet-400">This artist will be assigned to your account</p>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddArtistModal(false)}
                    className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addArtistForm.isLoading}
                    className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {addArtistForm.isLoading ? (
                      <>
                        <span className="animate-spin">⟳</span>
                        Creating...
                      </>
                    ) : 'Create Artist'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* DELETE ARTIST CONFIRMATION MODAL */}
        {deleteArtistConfirm.show && deleteArtistConfirm.artist && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false })}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-xl font-bold text-red-400">Delete Artist</h2>
                <button onClick={() => setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false })} className="text-zinc-500 hover:text-white">✕</button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-zinc-300">Are you sure you want to delete <strong>{deleteArtistConfirm.artist.name}</strong>?</p>
                <p className="text-sm text-zinc-500">This will permanently remove this artist for all users. Any content, pages, and data associated with this artist will be lost.</p>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false })}
                    className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteArtist}
                    disabled={deleteArtistConfirm.isDeleting}
                    className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {deleteArtistConfirm.isDeleting ? 'Deleting...' : 'Delete Forever'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* REASSIGN ARTIST MODAL */}
        {reassignArtist.show && reassignArtist.artist && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setReassignArtist({ show: false, artist: null })}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-xl font-bold">Reassign Artist</h2>
                <button onClick={() => setReassignArtist({ show: false, artist: null })} className="text-zinc-500 hover:text-white">✕</button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-zinc-300">Move <strong>{reassignArtist.artist.name}</strong> to a different operator:</p>
                <div className="space-y-2">
                  {/* Unassigned option */}
                  <button
                    onClick={() => handleReassignArtist(reassignArtist.artist.id, null)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition hover:border-zinc-600 ${
                      !reassignArtist.artist.ownerOperatorId ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-800 bg-zinc-800/50'
                    }`}
                  >
                    <span className="text-sm font-medium">Unassigned</span>
                    <span className="text-xs text-zinc-500 ml-2">No operator</span>
                  </button>
                  {/* Conductor + Operators */}
                  {allowedUsers
                    .filter(u => u.role === 'operator' || CONDUCTOR_EMAILS.includes(u.email?.toLowerCase()))
                    .map(op => {
                      const isCond = CONDUCTOR_EMAILS.includes(op.email?.toLowerCase());
                      const isCurrentOwner = reassignArtist.artist.ownerOperatorId === op.id;
                      return (
                        <button
                          key={op.id}
                          onClick={() => handleReassignArtist(reassignArtist.artist.id, op.id)}
                          className={`w-full text-left px-4 py-3 rounded-xl border transition hover:border-zinc-600 ${
                            isCurrentOwner ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-800 bg-zinc-800/50'
                          }`}
                        >
                          <span className="text-sm font-medium">{op.name || op.email}</span>
                          <span className={`text-xs ml-2 ${isCond ? 'text-amber-400' : 'text-zinc-500'}`}>
                            {isCond ? 'Conductor' : 'Operator'}
                          </span>
                          {isCurrentOwner && <span className="text-xs text-violet-400 ml-2">(current)</span>}
                        </button>
                      );
                    })
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {/* EDIT ARTIST MODAL */}
        {editArtistModal.show && editArtistModal.artist && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setEditArtistModal({ show: false, artist: null, activeSince: '', isSaving: false })}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-xl font-bold">Edit Artist</h2>
                <button onClick={() => setEditArtistModal({ show: false, artist: null, activeSince: '', isSaving: false })} className="text-zinc-500 hover:text-white">✕</button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-zinc-400 text-sm">Editing <strong className="text-white">{editArtistModal.artist.name}</strong></p>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Active Since</label>
                  <input
                    type="text"
                    value={editArtistModal.activeSince}
                    onChange={(e) => setEditArtistModal(prev => ({ ...prev, activeSince: e.target.value }))}
                    placeholder="e.g. Nov 2024"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                  <p className="text-xs text-zinc-600 mt-1">Format: Mon YYYY (e.g. Nov 2024, Feb 2026)</p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setEditArtistModal({ show: false, artist: null, activeSince: '', isSaving: false })}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition text-sm"
                  >Cancel</button>
                  <button
                    onClick={handleSaveArtistEdit}
                    disabled={editArtistModal.isSaving}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition text-sm font-medium disabled:opacity-50"
                  >{editArtistModal.isSaving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CONTENT TEMPLATES MODAL */}
        {showTemplatesModal && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => { setShowTemplatesModal(false); setEditingCategory(null); }}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-4 sm:p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold">Content Templates</h2>
                  <p className="text-xs sm:text-sm text-zinc-500 mt-1">Reusable caption & hashtag combos for {firestoreArtists.find(a => a.id === currentArtistId)?.name || 'this artist'}</p>
                </div>
                <button onClick={() => { setShowTemplatesModal(false); setEditingCategory(null); }} className="text-zinc-500 hover:text-white text-2xl">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {!editingCategory ? (
                  // Template List View
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                      <p className="text-zinc-400">{getCategoryNames(contentBanks).length} templates</p>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={async () => {
                            if (confirm('Reset all templates to defaults? This will overwrite your custom templates.')) {
                              try {
                                await resetToDefaults(db, currentArtistId);
                                showToast('Templates reset to defaults', 'success');
                              } catch (error) {
                                showToast('Failed to reset templates', 'error');
                              }
                            }
                          }}
                          className="flex-1 sm:flex-none px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition"
                        >
                          Reset
                        </button>
                        <button
                          onClick={() => {
                            setEditingCategory('__new__');
                            setTemplateForm({ name: '', hashtagsAlways: '', hashtagsPool: '', captionsAlways: '', captionsPool: '' });
                          }}
                          className="flex-1 sm:flex-none px-4 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition"
                        >
                          + Add
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      {getCategoryNames(contentBanks).map(category => {
                        const template = contentBanks[category];
                        return (
                          <div key={category} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 hover:bg-zinc-800 transition">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <h3 className="font-semibold text-lg">{category}</h3>
                                <div className="mt-2 space-y-1">
                                  <p className="text-sm text-zinc-400">
                                    <span className="text-purple-400">{(template.hashtags?.always?.length || 0) + (template.hashtags?.pool?.length || 0)}</span> hashtags
                                    <span className="mx-2 text-zinc-600">•</span>
                                    <span className="text-purple-400">{(template.captions?.always?.length || 0) + (template.captions?.pool?.length || 0)}</span> caption phrases
                                  </p>
                                  <p className="text-xs text-zinc-500 truncate max-w-md">
                                    {(template.hashtags?.always || []).concat(template.hashtags?.pool || []).slice(0, 5).join(' ')}...
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setEditingCategory(category);
                                    setTemplateForm({
                                      name: category,
                                      hashtagsAlways: (template.hashtags?.always || []).join(', '),
                                      hashtagsPool: (template.hashtags?.pool || []).join(', '),
                                      captionsAlways: (template.captions?.always || []).join(', '),
                                      captionsPool: (template.captions?.pool || []).join(', ')
                                    });
                                  }}
                                  className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={async () => {
                                    if (confirm(`Delete "${category}" template?`)) {
                                      try {
                                        await deleteCategory(db, currentArtistId, category);
                                        showToast('Template deleted', 'success');
                                      } catch (error) {
                                        showToast('Failed to delete template', 'error');
                                      }
                                    }
                                  }}
                                  className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  // Edit/Add Template View
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditingCategory(null)}
                        className="text-zinc-400 hover:text-white"
                      >
                        ← Back
                      </button>
                      <h3 className="text-lg font-semibold">
                        {editingCategory === '__new__' ? 'Add New Template' : `Edit: ${editingCategory}`}
                      </h3>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-2">Template Name / Niche</label>
                        <input
                          type="text"
                          value={templateForm.name}
                          onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500"
                          placeholder="e.g., Fashion, EDM, Runway"
                          disabled={editingCategory !== '__new__'}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">
                            Always-Use Hashtags
                            <span className="text-zinc-600 font-normal ml-2">included in every post</span>
                          </label>
                          <textarea
                            value={templateForm.hashtagsAlways}
                            onChange={e => setTemplateForm(prev => ({ ...prev, hashtagsAlways: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none font-mono text-sm"
                            placeholder="#fashion, #style, #aesthetic"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">
                            Hashtag Pool
                            <span className="text-zinc-600 font-normal ml-2">randomly selected</span>
                          </label>
                          <textarea
                            value={templateForm.hashtagsPool}
                            onChange={e => setTemplateForm(prev => ({ ...prev, hashtagsPool: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none font-mono text-sm"
                            placeholder="#ootd, #archive, #vibes, #mood"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">
                            Always-Use Caption Words
                            <span className="text-zinc-600 font-normal ml-2">included in every post</span>
                          </label>
                          <textarea
                            value={templateForm.captionsAlways}
                            onChange={e => setTemplateForm(prev => ({ ...prev, captionsAlways: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none"
                            placeholder="mood, vibe"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">
                            Caption Pool
                            <span className="text-zinc-600 font-normal ml-2">randomly selected</span>
                          </label>
                          <textarea
                            value={templateForm.captionsPool}
                            onChange={e => setTemplateForm(prev => ({ ...prev, captionsPool: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none"
                            placeholder="forever, dreaming, ✨, archive, aesthetic"
                          />
                        </div>
                      </div>

                      <div className="bg-zinc-800/50 rounded-xl p-4">
                        <h4 className="text-sm font-medium text-zinc-400 mb-2">Preview</h4>
                        <p className="text-sm text-zinc-300">
                          {(() => {
                            const preview = generateFromTemplate({
                              hashtags: {
                                always: templateForm.hashtagsAlways.split(',').map(t => t.trim()).filter(Boolean),
                                pool: templateForm.hashtagsPool.split(',').map(t => t.trim()).filter(Boolean)
                              },
                              captions: {
                                always: templateForm.captionsAlways.split(',').map(t => t.trim()).filter(Boolean),
                                pool: templateForm.captionsPool.split(',').map(t => t.trim()).filter(Boolean)
                              }
                            }, 'tiktok');
                            return preview.combined || 'Add some hashtags and captions to see a preview';
                          })()}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => setEditingCategory(null)}
                        className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-semibold hover:bg-zinc-700 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          const categoryName = editingCategory === '__new__' ? templateForm.name.trim() : editingCategory;
                          // BUG-023: Validate category name — non-empty and max 50 chars
                          if (!categoryName) {
                            showToast('Please enter a template name', 'error');
                            return;
                          }
                          if (categoryName.length > 50) {
                            showToast('Template name must be 50 characters or less', 'error');
                            return;
                          }

                          setSavingTemplate(true);
                          try {
                            const template = {
                              hashtags: {
                                always: templateForm.hashtagsAlways.split(',').map(t => t.trim()).filter(Boolean),
                                pool: templateForm.hashtagsPool.split(',').map(t => t.trim()).filter(Boolean)
                              },
                              captions: {
                                always: templateForm.captionsAlways.split(',').map(t => t.trim()).filter(Boolean),
                                pool: templateForm.captionsPool.split(',').map(t => t.trim()).filter(Boolean)
                              }
                            };

                            await saveCategory(db, currentArtistId, categoryName, template);
                            showToast(`Template "${categoryName}" saved!`, 'success');
                            setEditingCategory(null);
                          } catch (error) {
                            console.error('Error saving template:', error);
                            showToast('Failed to save template', 'error');
                          } finally {
                            setSavingTemplate(false);
                          }
                        }}
                        disabled={savingTemplate}
                        className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-500 transition disabled:opacity-50"
                      >
                        {savingTemplate ? 'Saving...' : 'Save Template'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIDEO UPLOAD MODAL */}
        {showVideoUploadModal && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowVideoUploadModal(false)}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-4 sm:p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold">Upload Videos</h2>
                  <p className="text-xs sm:text-sm text-zinc-500 mt-1">Upload videos to use for scheduling</p>
                </div>
                <button onClick={() => setShowVideoUploadModal(false)} className="text-zinc-500 hover:text-white text-2xl">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                {/* Upload Zone */}
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition ${uploadingVideo ? 'border-purple-500 bg-purple-500/10' : 'border-zinc-700 hover:border-zinc-600'}`}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (!file || !file.type.startsWith('video/')) {
                      showToast('Please upload a video file', 'error');
                      return;
                    }
                    setUploadingVideo(true);
                    setUploadProgress(0);
                    try {
                      const result = await uploadFile(file, `videos/${currentArtistId}`, (progress) => {
                        setUploadProgress(progress);
                      });
                      setUploadedVideos(prev => [...prev, {
                        id: Date.now().toString(),
                        name: file.name,
                        url: result.url,
                        path: result.path,
                        uploadedAt: new Date().toISOString(),
                        artistId: currentArtistId
                      }]);
                      showToast('Video uploaded!', 'success');
                    } catch (error) {
                      showToast(`Upload failed: ${error.message}`, 'error');
                    } finally {
                      setUploadingVideo(false);
                      setUploadProgress(0);
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                >
                  {uploadingVideo ? (
                    <div>
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-purple-500 border-t-transparent animate-spin" />
                      <p className="text-purple-400 font-medium">Uploading... {Math.round(uploadProgress)}%</p>
                      <div className="w-48 h-2 bg-zinc-800 rounded-full mx-auto mt-2 overflow-hidden">
                        <div className="h-full bg-purple-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl mb-4">📹</div>
                      <p className="text-zinc-300 font-medium mb-2">Drag & drop video here</p>
                      <p className="text-zinc-500 text-sm mb-4">or click to browse</p>
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        id="video-upload-input"
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          setUploadingVideo(true);
                          setUploadProgress(0);
                          try {
                            const result = await uploadFile(file, `videos/${currentArtistId}`, (progress) => {
                              setUploadProgress(progress);
                            });
                            setUploadedVideos(prev => [...prev, {
                              id: Date.now().toString(),
                              name: file.name,
                              url: result.url,
                              path: result.path,
                              uploadedAt: new Date().toISOString(),
                              artistId: currentArtistId
                            }]);
                            showToast('Video uploaded!', 'success');
                          } catch (error) {
                            showToast(`Upload failed: ${error.message}`, 'error');
                          } finally {
                            setUploadingVideo(false);
                            setUploadProgress(0);
                            e.target.value = '';
                          }
                        }}
                      />
                      <label
                        htmlFor="video-upload-input"
                        className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg cursor-pointer transition"
                      >
                        Browse Files
                      </label>
                      <p className="text-xs text-zinc-600 mt-4">MP4, MOV, WebM up to 500MB</p>
                    </>
                  )}
                </div>

                {/* Uploaded Videos List */}
                {uploadedVideos.filter(v => v.artistId === currentArtistId).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-400 mb-3">Uploaded Videos ({uploadedVideos.filter(v => v.artistId === currentArtistId).length})</h3>
                    <div className="space-y-2">
                      {uploadedVideos.filter(v => v.artistId === currentArtistId).map(video => (
                        <div key={video.id} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-2xl">🎬</span>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{video.name}</p>
                              <p className="text-xs text-zinc-500">{new Date(video.uploadedAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(video.url);
                                showToast('URL copied to clipboard!', 'success');
                              }}
                              className="px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-500/20 rounded-lg transition"
                            >
                              Copy URL
                            </button>
                            <button
                              onClick={() => {
                                setUploadedVideos(prev => prev.filter(v => v.id !== video.id));
                              }}
                              className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick Insert */}
                <div className="bg-zinc-800/50 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-zinc-400 mb-2">Quick Tip</h3>
                  <p className="text-sm text-zinc-500">
                    After uploading, copy the video URL and paste it into the batch scheduler.
                    Each video can be scheduled to multiple accounts at once.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SYNC CONNECT MODAL */}
        {showLateConnectModal && (
          <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => { setShowLateConnectModal(false); setLateApiKeyInput(''); }}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4 sm:p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-lg sm:text-xl font-bold">Enable Sync</h2>
                <button onClick={() => { setShowLateConnectModal(false); setLateApiKeyInput(''); }} className="text-zinc-500 hover:text-white text-2xl">✕</button>
              </div>
              <div className="p-4 sm:p-6 space-y-4">
                <p className="text-zinc-400 text-sm">
                  Enter the API key for <strong className="text-white">{firestoreArtists.find(a => a.id === currentArtistId)?.name || 'this artist'}</strong> to enable social media sync.
                </p>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Sync API Key</label>
                  <input
                    type="password"
                    value={lateApiKeyInput}
                    onChange={e => setLateApiKeyInput(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono"
                    placeholder="Enter API key"
                    autoFocus
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Get your API key from <a href="https://getlate.dev/settings/api" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">your account settings</a>
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowLateConnectModal(false); setLateApiKeyInput(''); }}
                    className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-semibold hover:bg-zinc-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!lateApiKeyInput.trim()) {
                        showToast('Please enter an API key', 'error');
                        return;
                      }
                      setConnectingLate(true);
                      try {
                        // Save the key first
                        await setArtistLateKey(currentArtistId, lateApiKeyInput.trim());
                        // Validate it by fetching accounts — if Late.co rejects (401), the key is bad
                        const validation = await lateApi.fetchAccounts(currentArtistId);
                        if (!validation.success) {
                          // Key rejected by Late.co — remove it so status reverts to unconfigured
                          try { await removeArtistLateKey(currentArtistId); } catch (_) {}
                          showToast('Invalid API key — Late.co rejected it. Please check the key and try again.', 'error');
                          return;
                        }
                        setArtistLateConnected(true);
                        setShowLateConnectModal(false);
                        setLateApiKeyInput('');
                        showToast('Sync enabled successfully!', 'success');
                        // Refresh pages list so PagesTab updates
                        loadLatePages();
                        // Fetch posts after connecting
                        const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
                        if (result.success) {
                          setLatePosts(result.posts || []);
                          setLastSynced(new Date());
                        }
                      } catch (error) {
                        console.error('Error connecting Late:', error);
                        showToast(`Failed to connect: ${error.message}`, 'error');
                      } finally {
                        setConnectingLate(false);
                      }
                    }}
                    disabled={connectingLate || !lateApiKeyInput.trim()}
                    className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-500 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {connectingLate ? (
                      <>
                        <span className="animate-spin">⟳</span>
                        Connecting...
                      </>
                    ) : '🔗 Connect'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Global UI overlays */}
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          confirmVariant={confirmDialog.confirmVariant}
          onConfirm={handleConfirmDialogConfirm}
          onCancel={closeConfirmDialog}
          isLoading={confirmDialog.isLoading}
        />
        <ToastContainer />
        <UndoToast />
        <OnboardingTooltip />
        </ToastProvider>
      </ThemeProvider>
    );
  }

  // DASHBOARD PAGE - Redirect (legacy)
  if (currentPage === 'dashboard') {
    setCurrentPage('operator');
    return null;
  }

  // OLD DASHBOARD PAGE (kept for reference, redirects above)
  if (currentPage === 'old-dashboard-disabled') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Dashboard Header */}
        <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-6">
                <button onClick={() => setCurrentPage(user ? (user.role === 'artist' ? 'artist-portal' : 'operator') : 'home')} className="text-xl font-bold hover:text-zinc-300 transition">StickToMusic</button>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400">Artist Dashboard</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-zinc-400">{artistData.name}</span>
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold">
                  {artistData.name[0]}
                </div>
                <button onClick={() => setCurrentPage('home')} className="text-sm text-zinc-500 hover:text-white transition">Log out</button>
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Welcome + Date Range */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-1">Welcome back, {artistData.name}</h1>
              <p className="text-zinc-400">
                {artistData.totalPages} world pages active • Since {artistData.activeSince || 'Feb 2026'}
              </p>
            </div>
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl p-2">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="bg-transparent border-none text-sm text-zinc-300 focus:outline-none"
              />
              <span className="text-zinc-600">→</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="bg-transparent border-none text-sm text-zinc-300 focus:outline-none"
              />
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-8 border-b border-zinc-800 pb-4">
            {['overview', 'engagement', 'reports'].map(tab => (
              <button
                key={tab}
                onClick={() => setDashboardTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  dashboardTab === tab
                    ? 'bg-white text-black'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {dashboardTab === 'overview' && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard label="Total Views" value={dashboardMetrics.reach.totalViews} change={dashboardMetrics.reach.change} />
                <StatCard label="Total Engagements" value={dashboardMetrics.engagement.likes + dashboardMetrics.engagement.comments + dashboardMetrics.engagement.shares + dashboardMetrics.engagement.saves} change={dashboardMetrics.engagement.change} />
                <StatCard label="Unique Reach" value={dashboardMetrics.reach.uniqueReach} />
                <StatCard label="Engagement Rate" value={dashboardMetrics.engagement.engagementRate} suffix="%" />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-6">Views by Platform</h3>
                  {Object.entries(dashboardMetrics.platforms).map(([platform, data]) => (
                    <PlatformBar
                      key={platform}
                      platform={platform}
                      views={data.views}
                      engagement={data.engagement}
                      maxViews={Math.max(...Object.values(dashboardMetrics.platforms).map(p => p.views))}
                    />
                  ))}
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-6">Reach Stats</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-3 border-b border-zinc-800">
                      <span className="text-zinc-400">Total Impressions</span>
                      <span className="font-semibold">{formatNumber(dashboardMetrics.reach.totalImpressions)}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-zinc-800">
                      <span className="text-zinc-400">Unique Reach</span>
                      <span className="font-semibold">{formatNumber(dashboardMetrics.reach.uniqueReach)}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-zinc-800">
                      <span className="text-zinc-400">Avg. Views per Post</span>
                      <span className="font-semibold">{formatNumber(Math.round(dashboardMetrics.reach.totalViews / 142))}</span>
                    </div>
                    <div className="flex justify-between items-center py-3">
                      <span className="text-zinc-400">Active World Pages</span>
                      <span className="font-semibold">{artistData.totalPages}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Engagement Tab */}
          {dashboardTab === 'engagement' && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard label="Likes" value={dashboardMetrics.engagement.likes} />
                <StatCard label="Comments" value={dashboardMetrics.engagement.comments} />
                <StatCard label="Shares" value={dashboardMetrics.engagement.shares} />
                <StatCard label="Saves" value={dashboardMetrics.engagement.saves} />
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">Engagement Breakdown</h3>
                <p className="text-zinc-400 mb-6">How audiences are interacting with your content across all world pages.</p>

                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">By Action Type</h4>
                    <div className="space-y-4">
                      {[
                        { label: 'Likes', value: dashboardMetrics.engagement.likes, color: 'bg-pink-500' },
                        { label: 'Saves', value: dashboardMetrics.engagement.saves, color: 'bg-yellow-500' },
                        { label: 'Shares', value: dashboardMetrics.engagement.shares, color: 'bg-green-500' },
                        { label: 'Comments', value: dashboardMetrics.engagement.comments, color: 'bg-blue-500' }
                      ].map(item => {
                        const total = dashboardMetrics.engagement.likes + dashboardMetrics.engagement.saves + dashboardMetrics.engagement.shares + dashboardMetrics.engagement.comments;
                        const pct = (item.value / total) * 100;
                        return (
                          <div key={item.label}>
                            <div className="flex justify-between text-sm mb-1">
                              <span>{item.label}</span>
                              <span className="text-zinc-400">{pct.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                              <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">Key Insights</h4>
                    <div className="space-y-3">
                      <div className="p-4 bg-zinc-800/50 rounded-lg">
                        <p className="text-sm"><span className="text-green-400 font-semibold">↑ 41%</span> increase in saves this period</p>
                        <p className="text-xs text-zinc-500 mt-1">Saves indicate strong intent to return</p>
                      </div>
                      <div className="p-4 bg-zinc-800/50 rounded-lg">
                        <p className="text-sm"><span className="font-semibold">4.2%</span> engagement rate</p>
                        <p className="text-xs text-zinc-500 mt-1">Above industry average of 2.5%</p>
                      </div>
                      <div className="p-4 bg-zinc-800/50 rounded-lg">
                        <p className="text-sm"><span className="font-semibold">TikTok</span> driving most shares</p>
                        <p className="text-xs text-zinc-500 mt-1">Content is resonating with discovery behavior</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reports Tab */}
          {dashboardTab === 'reports' && (
            <div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold mb-2">Monthly Reports</h3>
                <p className="text-zinc-400 mb-6">Detailed breakdowns delivered at the end of each month.</p>

                <div className="space-y-3">
                  {monthlyReports.map((report, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-xl">
                      <div>
                        <p className="font-medium">{report.month}</p>
                        <p className="text-sm text-zinc-500">{report.highlights}</p>
                      </div>
                      {report.status === 'current' ? (
                        <span className="px-3 py-1 bg-zinc-700 text-zinc-300 rounded-full text-sm">In Progress</span>
                      ) : (
                        <button className="px-4 py-2 bg-white text-black rounded-full text-sm font-medium hover:bg-zinc-200 transition">
                          Download PDF
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">What's in each report?</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {[
                    "Full performance breakdown by platform",
                    "Top performing content themes",
                    "Audience demographic insights",
                    "Engagement trend analysis",
                    "Recommendations for next month",
                    "World page growth metrics"
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-green-400">✓</span>
                      <span className="text-zinc-300 text-sm">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dashboard Footer */}
        <footer className="border-t border-zinc-800 mt-12">
          <div className="max-w-7xl mx-auto px-6 py-6 flex justify-between items-center">
            <span className="text-zinc-600 text-sm">StickToMusic © 2026</span>
          </div>
        </footer>
      </div>
    );
  }

  // Fallback — should not be reached; redirect to dashboard or landing page
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Private mode warning modal */}
      {showPrivateModeWarning && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#1a1a1a',
            padding: '32px',
            borderRadius: '12px',
            maxWidth: '500px',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Private Browsing Not Supported</h2>
            <p style={{ color: '#999', marginBottom: '24px' }}>
              StickToMusic requires localStorage to function properly. Please use normal browsing mode.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#7c3aed',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )}

      {/* Legacy marketing pages — kept for reference, rarely reached */}

      {/* HOME */}
      {currentPage === 'home' && (
        <div className="min-h-screen flex flex-col justify-center items-center text-center px-6">
          <h1 className="text-5xl md:text-7xl font-bold max-w-4xl leading-tight mb-6">Your music deserves to live in culture.</h1>
          <p className="text-xl md:text-2xl text-zinc-400 max-w-xl mb-12">World pages that seed your sound where fans actually discover music.</p>
          <div className="flex gap-4 flex-wrap justify-center">
            <button onClick={goToIntake} className="px-8 py-4 bg-white text-black rounded-full text-lg font-semibold hover:bg-zinc-200 transition">Apply →</button>
            <button onClick={() => setCurrentPage('how')} className="px-8 py-4 border border-zinc-600 rounded-full text-lg font-semibold hover:bg-zinc-900 transition">How It Works</button>
          </div>
        </div>
      )}

      {/* HOW IT WORKS */}
      {currentPage === 'how' && (
        <div className="min-h-screen pt-28 pb-20 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="mb-16">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">How It Works</h1>
              <p className="text-xl text-zinc-400">The system behind organic music discovery.</p>
            </div>
            <section className="mb-20">
              <h2 className="text-lg font-semibold text-zinc-500 uppercase tracking-wider mb-4">The Problem</h2>
              <div className="border-l-2 border-zinc-700 pl-8">
                <p className="text-2xl md:text-3xl font-semibold leading-relaxed mb-4">The algorithm isn't broken. Your distribution is.</p>
                <p className="text-lg text-zinc-400 leading-relaxed">Posting on your main account and hoping TikTok picks it up isn't a strategy. The artists breaking through are showing up in the feeds of people who haven't heard of them yet. That takes more than one page. It takes an ecosystem.</p>
              </div>
            </section>
            <section className="mb-20">
              <h2 className="text-lg font-semibold text-zinc-500 uppercase tracking-wider mb-4">World Pages</h2>
              <div className="border-l-2 border-zinc-700 pl-8">
                <p className="text-2xl md:text-3xl font-semibold leading-relaxed mb-4">Niche accounts that plant your music where fans already live.</p>
                <p className="text-lg text-zinc-400 leading-relaxed mb-8">A world page is a niche aesthetic account—fashion edits, cinematic clips, mood content—that builds its own audience. Your music gets seeded naturally.</p>
                <div className="grid md:grid-cols-3 gap-4">
                  {[
                    { title: "Organic Reach", desc: "Shows up in feeds without feeling like a promotion." },
                    { title: "Cultural Grafting", desc: "Your sound attached to visuals fans already love." },
                    { title: "Compounding Growth", desc: "The ecosystem expands with every post." }
                  ].map((item, i) => (
                    <div key={i} className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
                      <h3 className="font-semibold mb-2">{item.title}</h3>
                      <p className="text-zinc-500 text-sm">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="mb-16">
              <h2 className="text-lg font-semibold text-zinc-500 uppercase tracking-wider mb-4">The Process</h2>
              <div className="border-l-2 border-zinc-700 pl-8 space-y-8">
                {[
                  { num: "01", title: "Intake", desc: "Tell us about your sound, aesthetic, and target audience." },
                  { num: "02", title: "World Building", desc: "We identify and build niche pages aligned with your music." },
                  { num: "03", title: "Content Seeding", desc: "Your music woven into content across TikTok, Instagram, Facebook, and YouTube." },
                  { num: "04", title: "Growth", desc: "Watch your reach expand with monthly performance data." }
                ].map((step, i) => (
                  <div key={i} className="flex gap-6">
                    <span className="text-3xl font-bold text-zinc-700">{step.num}</span>
                    <div>
                      <h3 className="text-lg font-semibold mb-1">{step.title}</h3>
                      <p className="text-zinc-400">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <div className="text-center pt-8 border-t border-zinc-800">
              <button onClick={() => setCurrentPage('pricing')} className="px-8 py-4 bg-white text-black rounded-full text-lg font-semibold hover:bg-zinc-200 transition">See Pricing →</button>
            </div>
          </div>
        </div>
      )}

      {/* PRICING */}
      {currentPage === 'pricing' && (
        <div className="min-h-screen pt-28 pb-20 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">Pricing</h1>
              <p className="text-xl text-zinc-400">World page packages and creative direction add-ons</p>
            </div>
            <div className="mb-12">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Page Builder Tiers</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                {tiers.map((tier) => (
                  <div key={tier.name} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="mb-3">
                      <h3 className="text-xl font-bold">{tier.name}</h3>
                      <p className="text-zinc-500 text-sm">{tier.description}</p>
                    </div>
                    <div className="mb-3">
                      <span className="text-3xl font-bold">${tier.price.toLocaleString()}</span>
                      <span className="text-zinc-500">/mo</span>
                    </div>
                    <div className="text-3xl font-bold text-zinc-600 mb-3">{tier.pages} pages</div>
                    <p className="text-sm text-zinc-500 mb-4">{tier.detail}</p>
                    <ul className="space-y-1">
                      {tier.features.map((f, i) => (<li key={i} className="text-xs text-zinc-400">• {f}</li>))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <div className="mb-12">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Creative Direction Add-Ons</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {cdTiers.map((cd) => (
                  <div key={cd.name} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold">{cd.name}</h3>
                        <p className="text-zinc-500 text-sm">{cd.description}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold">+${cd.price.toLocaleString()}</span>
                        <span className="text-zinc-500">/mo</span>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {cd.features.map((f, i) => (<li key={i} className="text-sm text-zinc-400 flex items-center gap-2"><span className="text-green-400">✓</span>{f}</li>))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            {/* Feature Comparison Table */}
            <div className="mb-16 overflow-x-auto">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Feature Comparison</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-4 px-4 text-zinc-400 font-medium">Feature</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Starter</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Standard</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Scale</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Sensation</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: 'World Pages', starter: '5', standard: '15', scale: '30', sensation: '50' },
                    { feature: 'Posts per Week', starter: '10', standard: '30', scale: '60', sensation: '100+' },
                    { feature: 'Aesthetic Categories', starter: '1', standard: '2', scale: '3', sensation: 'All' },
                    { feature: 'Artist Dashboard', starter: true, standard: true, scale: true, sensation: true },
                    { feature: 'Real-time Analytics', starter: true, standard: true, scale: true, sensation: true },
                    { feature: 'Dedicated Manager', starter: false, standard: true, scale: true, sensation: true },
                    { feature: 'Priority Support', starter: false, standard: false, scale: true, sensation: true },
                    { feature: 'Custom Strategy Call', starter: false, standard: false, scale: true, sensation: true },
                    { feature: 'Performance Reports', starter: 'Monthly', standard: 'Bi-weekly', scale: 'Weekly', sensation: 'Daily' },
                    { feature: 'Adjacent Artist Mix', starter: '70/30', standard: '70/30', scale: '60/40', sensation: 'Custom' },
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-zinc-800/50">
                      <td className="py-3 px-4 text-zinc-300">{row.feature}</td>
                      {['starter', 'standard', 'scale', 'sensation'].map(tier => (
                        <td key={tier} className="py-3 px-2 text-center">
                          {typeof row[tier] === 'boolean' ? (
                            row[tier] ? (
                              <span className="text-green-400">✓</span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )
                          ) : (
                            <span className="text-zinc-400">{row[tier]}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-center mb-16">
              <button onClick={goToIntake} className="px-8 py-4 bg-white text-black rounded-full text-lg font-semibold hover:bg-zinc-200 transition">Apply Now →</button>
              <p className="text-zinc-500 text-sm mt-3">You'll select your preferred tier in the application</p>
            </div>
            <div className="max-w-3xl mx-auto">
              <h2 className="text-xl font-bold mb-6 text-center">Questions</h2>
              <div className="space-y-2">
                {faqs.map((faq, i) => (
                  <div key={i} className="border border-zinc-800 rounded-xl overflow-hidden">
                    <button className="w-full p-4 text-left flex justify-between items-center hover:bg-zinc-900 transition" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                      <span className="font-medium text-sm">{faq.q}</span>
                      <span className="text-zinc-500">{openFaq === i ? '−' : '+'}</span>
                    </button>
                    {openFaq === i && (<div className="px-4 pb-4 text-zinc-400 text-sm">{faq.a}</div>)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="py-8 px-6 border-t border-zinc-900">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <button
            onClick={() => {
              if (user) {
                setCurrentPage(user.role === 'artist' ? 'artist-portal' : 'operator');
              } else {
                setCurrentPage('home');
              }
            }}
            className="font-bold hover:text-zinc-300 transition cursor-pointer"
          >
            StickToMusic
          </button>
          <span className="text-zinc-600 text-sm">© 2026</span>
        </div>
      </footer>

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/80 flex items-start md:items-center justify-center z-50 p-4 pt-16 md:pt-4 overflow-y-auto" onClick={() => setShowLoginModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md my-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg md:text-xl font-bold">Welcome Back</h2>
              <button onClick={() => setShowLoginModal(false)} className="text-zinc-500 hover:text-white p-2 -mr-2" aria-label="Close modal">✕</button>
            </div>
            <form onSubmit={handleLogin} className="p-4 md:p-6 space-y-4">
              {loginForm.error && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {loginForm.error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Email</label>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm(prev => ({ ...prev, email: e.target.value, error: null }))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={loginForm.password}
                  onChange={e => setLoginForm(prev => ({ ...prev, password: e.target.value, error: null }))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoggingIn ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    Logging in...
                  </>
                ) : 'Log In'}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-700"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-zinc-900 text-zinc-500">or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoggingIn}
                className="w-full py-3 bg-zinc-800 border border-zinc-700 text-white rounded-xl font-semibold hover:bg-zinc-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              <p className="text-center text-sm text-zinc-500">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setShowLoginModal(false); setShowSignupModal(true); }}
                  className="text-purple-400 hover:text-purple-300"
                >
                  Sign up
                </button>
              </p>
              <div className="pt-4 border-t border-zinc-800">
                <p className="text-xs text-zinc-500 text-center">
                  💡 Quick start: Use Google Sign-in above
                </p>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SIGNUP MODAL */}
      {showSignupModal && (
        <div className="fixed inset-0 bg-black/80 flex items-start md:items-center justify-center z-50 p-4 pt-8 md:pt-4 overflow-y-auto" onClick={() => setShowSignupModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md my-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg md:text-xl font-bold">Create Account</h2>
              <button onClick={() => setShowSignupModal(false)} className="text-zinc-500 hover:text-white p-2 -mr-2" aria-label="Close modal">✕</button>
            </div>
            <form onSubmit={handleSignup} className="p-4 md:p-6 space-y-3 md:space-y-4">
              {signupForm.error && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {signupForm.error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Name</label>
                <input
                  type="text"
                  value={signupForm.name}
                  onChange={e => setSignupForm(prev => ({ ...prev, name: e.target.value, error: null }))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                  placeholder="Your name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Email</label>
                <input
                  type="email"
                  value={signupForm.email}
                  onChange={e => setSignupForm(prev => ({ ...prev, email: e.target.value, error: null }))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={signupForm.password}
                  onChange={e => setSignupForm(prev => ({ ...prev, password: e.target.value, error: null }))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Account Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSignupForm(prev => ({ ...prev, role: 'artist' }))}
                    className={`p-3 rounded-xl border transition ${signupForm.role === 'artist' ? 'border-purple-500 bg-purple-500/20' : 'border-zinc-700 bg-zinc-800'}`}
                  >
                    <span className="block font-medium">Artist</span>
                    <span className="text-xs text-zinc-500">View your dashboard</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignupForm(prev => ({ ...prev, role: 'operator' }))}
                    className={`p-3 rounded-xl border transition ${signupForm.role === 'operator' ? 'border-purple-500 bg-purple-500/20' : 'border-zinc-700 bg-zinc-800'}`}
                  >
                    <span className="block font-medium">Operator</span>
                    <span className="text-xs text-zinc-500">Manage all artists</span>
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isSigningUp}
                className="w-full py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSigningUp ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    Creating account...
                  </>
                ) : 'Create Account'}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-700"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-zinc-900 text-zinc-500">or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSigningUp}
                className="w-full py-3 bg-zinc-800 border border-zinc-700 text-white rounded-xl font-semibold hover:bg-zinc-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              <p className="text-center text-sm text-zinc-500">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setShowSignupModal(false); setShowLoginModal(true); }}
                  className="text-purple-400 hover:text-purple-300"
                >
                  Log in
                </button>
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Payment Link Modal */}
      {showPaymentModal && selectedApplication && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowPaymentModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold">Send Payment Link</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-zinc-500 hover:text-white">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-sm text-zinc-400 mb-1">Applicant</p>
                <p className="text-white font-medium">{selectedApplication.name}</p>
                <p className="text-zinc-400 text-sm">{selectedApplication.email}</p>
                <p className="text-purple-400 text-sm mt-2">{selectedApplication.tier}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Stripe Payment Link</label>
                <input
                  type="url"
                  id="paymentLinkInput"
                  placeholder="https://buy.stripe.com/your-link"
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Create a payment link in <a href="https://dashboard.stripe.com/payment-links" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">Stripe Dashboard</a> for this tier's price
                </p>
              </div>

              <button
                onClick={() => {
                  const link = document.getElementById('paymentLinkInput')?.value;
                  if (link) {
                    handleSendPaymentLink(selectedApplication, link);
                  } else {
                    showToast('Please enter a payment link', 'error');
                  }
                }}
                disabled={paymentLinkLoading}
                className="w-full py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {paymentLinkLoading ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    Processing...
                  </>
                ) : (
                  <>
                    📋 Copy Link & Approve
                  </>
                )}
              </button>

              <p className="text-xs text-zinc-500 text-center">
                The payment link will be copied to your clipboard. Send it to the applicant via email.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Search Modal (Cmd+K) */}
      {showQuickSearch && (
        <div className="fixed inset-0 bg-black/80 flex items-start justify-center pt-[20vh] z-[60] p-4" onClick={() => setShowQuickSearch(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center gap-3 border-b border-zinc-800">
              <span className="text-zinc-500">🔍</span>
              <input
                ref={quickSearchRef}
                type="text"
                value={quickSearchQuery}
                onChange={e => setQuickSearchQuery(e.target.value)}
                placeholder="Quick navigation..."
                className="flex-1 bg-transparent text-lg text-white placeholder-zinc-500 focus:outline-none"
              />
              <kbd className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded text-xs">esc</kbd>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto">
              {/* Quick navigation */}
              {[
                { label: 'Home', action: () => { setCurrentPage('home'); setShowQuickSearch(false); }, icon: '🏠', category: 'Pages' },
                { label: 'Pricing', action: () => { setCurrentPage('pricing'); setShowQuickSearch(false); }, icon: '💰', category: 'Pages' },
                { label: 'How It Works', action: () => { setCurrentPage('how-it-works'); setShowQuickSearch(false); }, icon: '📖', category: 'Pages' },
                { label: 'Apply / Intake Form', action: () => { setCurrentPage('intake'); setShowQuickSearch(false); }, icon: '📝', category: 'Pages' },
                { label: isConductor(user) ? 'Conductor Dashboard' : 'Operator Dashboard', action: () => { setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '⚙️', category: 'Dashboards' },
                { label: 'Artist Portal', action: () => { setCurrentPage('artist-portal'); setShowQuickSearch(false); }, icon: '🎵', category: 'Dashboards' },
                { label: 'Artists Tab', action: () => { setOperatorTab('artists'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '👥', category: 'Operator' },
                { label: 'Pages Tab', action: () => { setOperatorTab('pages'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📱', category: 'Operator' },
                { label: 'Content / Schedule', action: () => { setOperatorTab('content'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📅', category: 'Operator' },
                { label: 'Applications', action: () => { setOperatorTab('applications'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📋', category: 'Operator' },
                { label: 'New Schedule', action: () => { setShowScheduleModal(true); setCurrentPage('operator'); setOperatorTab('content'); setShowQuickSearch(false); }, icon: '➕', category: 'Actions' },
                { label: 'Login', action: () => { setShowLoginModal(true); setShowQuickSearch(false); }, icon: '🔑', category: 'Actions' },
              ].filter(item =>
                !quickSearchQuery || item.label.toLowerCase().includes(quickSearchQuery.toLowerCase())
              ).map((item, i) => (
                <button
                  key={i}
                  onClick={item.action}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 rounded-lg transition text-left"
                >
                  <span>{item.icon}</span>
                  <span className="text-zinc-200">{item.label}</span>
                  <span className="ml-auto text-xs text-zinc-600">{item.category}</span>
                </button>
              ))}
              {quickSearchQuery && [].filter(item =>
                item.label.toLowerCase().includes(quickSearchQuery.toLowerCase())
              ).length === 0 && (
                <div className="px-4 py-3 text-sm text-zinc-500 text-center">
                  No results for "{quickSearchQuery}"
                </div>
              )}
            </div>
            <div className="p-3 border-t border-zinc-800 text-xs text-zinc-600 text-center">
              Press <kbd className="px-1 py-0.5 bg-zinc-800 rounded">⌘</kbd> + <kbd className="px-1 py-0.5 bg-zinc-800 rounded">K</kbd> anywhere to open
            </div>
          </div>
        </div>
      )}

      {/* UI-12/13: Day Detail Drawer for Calendar View */}
      {dayDetailDrawer.isOpen && (() => {
        const dateObj = dayDetailDrawer.date ? new Date(dayDetailDrawer.date + 'T12:00:00') : new Date();
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        // ESC handler via effect would be ideal, but inline works for drawer
        const closeDrawer = () => setDayDetailDrawer({ isOpen: false, date: null, posts: [] });

        return (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex justify-end"
            onClick={closeDrawer}
            onKeyDown={(e) => e.key === 'Escape' && closeDrawer()}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="w-full max-w-md bg-zinc-900 border-l border-zinc-800 h-full overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{dayName}</h2>
                  <p className="text-sm text-zinc-500">{formattedDate}</p>
                </div>
                <button
                  onClick={closeDrawer}
                  className="p-2 hover:bg-zinc-800 rounded-lg transition text-zinc-400 hover:text-white"
                  aria-label="Close drawer"
                >
                  ✕
                </button>
              </div>

              {/* Drawer Content */}
              <div className="p-4 space-y-3">
                <p className="text-sm text-zinc-500">{dayDetailDrawer.posts.length} post{dayDetailDrawer.posts.length === 1 ? '' : 's'} scheduled</p>

                {dayDetailDrawer.posts.map((post) => {
                  const time = post.scheduledFor ? new Date(post.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                  const platforms = (post.platforms || []).map(p => p.platform || p);

                  return (
                    <div key={post._id} className="bg-zinc-800 rounded-xl p-4">
                      {/* Time & Platforms */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-zinc-300">{time}</span>
                        <div className="flex gap-1">
                          {platforms.map(p => {
                            const config = getPlatformConfig(p);
                            return (
                              <span key={p} className={`px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.textColor}`}>
                                {config.fullName}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Caption */}
                      <p className="text-sm text-zinc-400 mb-3 line-clamp-3">{post.content || 'No caption'}</p>

                      {/* Status & Actions */}
                      <div className="flex items-center justify-between">
                        <StatusPill status={post.status || 'scheduled'} />
                        <div className="flex gap-2 flex-wrap">
                          {getPostUrls(post).map((pu, idx) => {
                            const config = getPlatformConfig(pu.platform);
                            return (
                              <a
                                key={idx}
                                href={pu.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`px-2 py-1 rounded text-xs font-medium transition ${config.bgColor} ${config.textColor} ${config.hoverBg}`}
                              >
                                View ↗
                              </a>
                            );
                          })}
                          <button
                            onClick={() => {
                              closeDrawer();
                              confirmDeletePost(post._id, post.content?.substring(0, 50));
                            }}
                            className="px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 rounded transition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Modal - P0 Compliant */}
      {deleteConfirmModal.show && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4"
          onClick={() => setDeleteConfirmModal({ show: false, postId: null, caption: '' })}
          onKeyDown={(e) => e.key === 'Escape' && setDeleteConfirmModal({ show: false, postId: null, caption: '' })}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <div className="flex justify-end p-2">
              <button
                onClick={() => setDeleteConfirmModal({ show: false, postId: null, caption: '' })}
                className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 pb-6">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mb-4 mx-auto">
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h2 id="delete-modal-title" className="text-xl font-bold text-center mb-2">Delete Post?</h2>
              <p className="text-zinc-400 text-center text-sm mb-2">This will remove the post from the schedule.</p>
              {deleteConfirmModal.caption && (
                <p className="text-zinc-500 text-center text-xs mb-4 truncate">
                  "{deleteConfirmModal.caption}..."
                </p>
              )}
              <p className="text-red-400 text-center text-sm mb-6">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmModal({ show: false, postId: null, caption: '' })}
                  className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition"
                  autoFocus
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeletePost(deleteConfirmModal.postId)}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition"
                >
                  Delete Post
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generic Confirm Dialog - for other destructive actions */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant={confirmDialog.confirmVariant}
        onConfirm={handleConfirmDialogConfirm}
        onCancel={closeConfirmDialog}
        isLoading={confirmDialog.isLoading}
      />

      {/* Toast Notifications */}
      <ToastContainer />
      <UndoToast />
      <OnboardingTooltip />

      {/* Dev Environment Banner — helps QA agents identify which server they're on */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '28px',
          backgroundColor: '#0ea5e9',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          zIndex: 99999,
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}>
          {`◆ DEV — localhost:${window.location.port || '3000'} ◆`}
        </div>
      )}
    </div>
  );
};

export default StickToMusic;
