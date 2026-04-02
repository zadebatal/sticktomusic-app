import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Shared UI Components
import {
  LoadingSpinner,
  EmptyState as SharedEmptyState,
  ConfirmDialog,
  ToastProvider,
} from './components/ui';

// Route-level lazy imports for code splitting
const VideoStudio = React.lazy(() => import('./components/VideoEditor/VideoStudio'));
const SchedulingPage = React.lazy(() => import('./components/VideoEditor/SchedulingPage'));
const AnalyticsDashboard = React.lazy(() => import('./components/Analytics/AnalyticsDashboard'));
const LandingPage = React.lazy(() => import('./components/LandingPage'));
const TermsPage = React.lazy(() => import('./components/TermsPage'));
const PrivacyPage = React.lazy(() => import('./components/PrivacyPage'));
const PagesTab = React.lazy(() => import('./components/tabs/PagesTab'));
const SettingsTab = React.lazy(() => import('./components/tabs/SettingsTab'));
const ArtistDashboard = React.lazy(() => import('./components/tabs/ArtistDashboard'));
const ArtistsManagement = React.lazy(() => import('./components/tabs/ArtistsManagement'));
const OnboardingWizard = React.lazy(() => import('./components/OnboardingWizard'));

// Non-lazy imports (needed at app shell level)
import AppShell from './components/AppShell';
import ContentTab from './components/tabs/ContentTab';
import ApplicationsTab from './components/tabs/ApplicationsTab';
import CommandPalette from './components/CommandPalette';
import IntakeForm from './components/IntakeForm';
import ArtistModals from './components/ArtistModals';
import ContentTemplatesModal from './components/ContentTemplatesModal';
import VideoUploadModal from './components/VideoUploadModal';
import LateConnectModal from './components/LateConnectModal';
import { LegacyMarketingPages } from './components/LegacyMarketingPages';
import DesktopOnboarding from './components/DesktopOnboarding';
import { isElectronApp, isOnboardingComplete } from './services/localMediaService';
import { getContentQueue } from './data/contentQueue';

// Theme system
import { ThemeProvider, THEMES } from './contexts/ThemeContext';

// Domain enforcement utilities
import { isUserOperator, isArtistOrCollaborator, getEffectiveArtistId } from './utils/roles';

// Subscription service

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
  updateArtist,
} from './services/artistService';

// Late Service - for per-artist Late connection status
import { getArtistLateKeyStatus, removeArtistLateKey } from './services/lateService';

// Content Template Service - reusable caption/hashtag templates
import { subscribeToTemplates, DEFAULT_TEMPLATES } from './services/contentTemplateService';

// Storage quota tracking
import { DEFAULT_QUOTA_BYTES, migrateExistingUsersQuota } from './services/storageQuotaService';

// Firebase (centralized init)
import { auth, db, googleProvider, getFirebaseToken } from './config/firebase';

// Platform config (centralized)
import { PLATFORMS, getPlatformConfig, getPlatformUrl } from './config/platforms';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { collection, getDocs, setDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { toast as sonnerToast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import log from './utils/logger';
import { loadSettings, saveSettings, clearSettingsCache } from './services/settingsService';
import lateApi from './services/lateApiService';

// Zustand stores (sync pattern — App.jsx keeps useState, syncs to stores for child access)
import useUIStore from './stores/useUIStore';
import useArtistStore from './stores/useArtistStore';
import useContentStore from './stores/useContentStore';

// Module-level constants (avoid re-allocation in render)
const NOOP = () => {};
const EMPTY_ARRAY = [];

// Stripe Configuration - loaded from environment variable for security
const STRIPE_PUBLISHABLE_KEY = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;

// Conductor emails (these users get full conductor/super-admin access)
// Can be overridden via REACT_APP_CONDUCTOR_EMAILS environment variable (comma-separated)
// Conductors can see ALL artists and onboard operators
// Operators (added via allowedUsers) can only see their assigned artists
const CONDUCTOR_EMAILS = (process.env.REACT_APP_CONDUCTOR_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

// App-level session persistence
const APP_SESSION_KEY = 'stm_app_session';

const loadAppSession = () => {
  try {
    const saved = localStorage.getItem(APP_SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed;
    }
  } catch (e) {
    log.warn('Failed to load app session:', e);
  }
  return null;
};

const saveAppSession = (state) => {
  try {
    // Only save authenticated pages (not landing/marketing pages)
    if (
      ['operator', 'artist-portal', 'artist-dashboard', 'dashboard'].includes(state.currentPage)
    ) {
      localStorage.setItem(APP_SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    }
  } catch (e) {
    log.warn('Failed to save app session:', e);
  }
};

// Static data arrays (moved from inside component to avoid re-allocation)
const onboardingSteps = [
  {
    title: 'Welcome to StickToMusic! 🎵',
    description: "Let's take a quick tour of your operator dashboard.",
    target: null,
  },
  {
    title: 'Artists Tab',
    description: 'View and manage all your artists here. See their stats and pages.',
    target: 'artists',
  },
  {
    title: 'Content Tab',
    description: 'Schedule and manage posts across all world pages. Sync to see scheduled content.',
    target: 'content',
  },
  {
    title: 'Applications Tab',
    description: 'Review new artist applications, approve them, and send payment links.',
    target: 'applications',
  },
  {
    title: "You're all set! 🚀",
    description: 'Start by clicking "Sync" in the Content tab to load your scheduled posts.',
    target: null,
  },
];

// ── Module-scope sub-components (moved out of render to avoid re-creation) ──

const UndoToast = ({ undoAction, onDismiss }) =>
  undoAction && (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] bg-zinc-800 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-4 animate-slide-up">
      <span className="text-sm">{undoAction.message}</span>
      <button
        onClick={() => {
          undoAction.onUndo();
          onDismiss();
        }}
        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium transition"
      >
        Undo
      </button>
      <button onClick={onDismiss} className="text-zinc-500 hover:text-white">
        ✕
      </button>
    </div>
  );

const OnboardingTooltip = ({
  showOnboarding,
  steps,
  currentStep,
  onNext,
  onComplete,
  onSetTab,
}) => {
  if (!showOnboarding) return null;
  const step = steps[currentStep];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-md mx-4 shadow-xl animate-slide-up">
        <div className="text-center mb-4">
          <h3 className="text-xl font-bold mb-2">{step.title}</h3>
          <p className="text-zinc-400">{step.description}</p>
        </div>

        <div className="flex items-center justify-between mt-6">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition ${i === currentStep ? 'bg-purple-500' : 'bg-zinc-700'}`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onComplete}
              className="px-4 py-2 text-zinc-400 hover:text-white text-sm transition"
            >
              Skip
            </button>
            {currentStep < steps.length - 1 ? (
              <button
                onClick={() => {
                  onNext();
                  if (steps[currentStep + 1]?.target) {
                    onSetTab(steps[currentStep + 1].target);
                  }
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition"
              >
                Next
              </button>
            ) : (
              <button
                onClick={onComplete}
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

const StickToMusicInner = () => {
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
      log.error('[App] Private mode detected or localStorage disabled');
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
    const handleOnline = () => log('[App] Back online');
    const handleOffline = () => log.warn('[App] Offline mode');
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

  // Initialize Zustand stores with URL/session state (runs once synchronously)
  useState(() => {
    useUIStore.setState({
      currentPage: initialState.page,
      operatorTab: initialState.tab,
      artistTab: 'dashboard',
    });
  });

  // Load saved page - but only use it after auth is confirmed
  const savedAppSession = loadAppSession();
  const currentPage = useUIStore((s) => s.currentPage);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const [pendingPage, setPendingPage] = useState(savedAppSession?.currentPage || null);
  const [pendingOperatorTab, setPendingOperatorTab] = useState(
    savedAppSession?.operatorTab || null,
  );
  const [pendingShowVideoEditor, setPendingShowVideoEditor] = useState(false); // Never restore from session (ephemeral)
  const [sessionRestoreComplete, setSessionRestoreComplete] = useState(!savedAppSession); // Skip if no saved session
  const operatorTab = useUIStore((s) => s.operatorTab);
  const setOperatorTab = useUIStore((s) => s.setOperatorTab);
  const [showVideoEditor, setShowVideoEditor] = useState(initialState.showStudio); // Moved up for restore effect
  const artistTab = useUIStore((s) => s.artistTab);
  const setArtistTab = useUIStore((s) => s.setArtistTab);
  const [artistScheduleFilter, setArtistScheduleFilter] = useState(null); // Filter for artist schedule tab
  const [pendingEditDraft, setPendingEditDraft] = useState(null); // Operator: Schedule → Studio draft edit
  const [artistPendingEditDraft, setArtistPendingEditDraft] = useState(null); // Artist: Schedule → Studio draft edit
  // ═══ Theme bridge: since ThemeProvider wraps return JSX, we listen for changes via custom event ═══
  const [appThemeId, setAppThemeId] = useState(() => {
    try {
      return localStorage.getItem('stm_theme') || 'dark';
    } catch {
      return 'dark';
    }
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
      if (
        currentPage !== 'home' &&
        currentPage !== 'artist-dashboard' &&
        currentPage !== 'operator'
      ) {
        setCurrentPage('home');
      }
    }
  }, [location.pathname]);

  // Authentication state
  const [user, setUser] = useState(null); // { email, role, name, artistId }
  const [currentAuthUser, setCurrentAuthUser] = useState(null); // Firebase auth user object
  const [authChecked, setAuthChecked] = useState(false); // True once initial auth check completes
  const showLoginModal = useUIStore((s) => s.showLoginModal);
  const setShowLoginModal = useUIStore((s) => s.setShowLoginModal);
  const [loginForm, setLoginForm] = useState({ email: '', password: '', error: null });
  const showSignupModal = useUIStore((s) => s.showSignupModal);
  const setShowSignupModal = useUIStore((s) => s.setShowSignupModal);
  const [signupForm, setSignupForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'artist',
    error: null,
  });
  const [authError, setAuthError] = useState(null);

  // Artist modals (Add/Edit/Delete/Reassign) — handled by ArtistModals component via ref
  const artistModalsRef = useRef(null);

  // Firestore data - allowed users loaded from database
  const [allowedUsers, setAllowedUsers] = useState([]);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);

  // Multi-artist state — Zustand (initialized with last-selected artist)
  useState(() => {
    useArtistStore.setState({ currentArtistId: getLastArtistId() || null });
  });
  const firestoreArtists = useArtistStore((s) => s.firestoreArtists);
  const setFirestoreArtists = useArtistStore((s) => s.setFirestoreArtists);
  const currentArtistId = useArtistStore((s) => s.currentArtistId);
  const setCurrentArtistId = useArtistStore((s) => s.setCurrentArtistId);
  const artistsLoaded = useArtistStore((s) => s.artistsLoaded);
  const setArtistsLoaded = useArtistStore((s) => s.setArtistsLoaded);

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
        const rawUsers = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Deduplicate by email, keeping highest-privilege role (conductor > operator > artist)
        const roleOrder = { conductor: 3, operator: 2, artist: 1 };
        const userMap = new Map();
        rawUsers.forEach((user) => {
          const email = user.email?.toLowerCase();
          if (!email) return;

          const existing = userMap.get(email);
          const currentPriority = roleOrder[user.role] || 0;
          const existingPriority = existing ? roleOrder[existing.role] || 0 : -1;

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
        log.error('❌ Error loading allowed users:', error);
        // Authenticated but still failed — real permissions issue, proceed anyway
        setFirestoreLoaded(true);
      },
    );
    return () => unsubscribe();
  }, [authChecked, currentAuthUser]);

  // Track if we've already initialized Boon artist (prevents double-calls)
  const boonInitializedRef = useRef(false);
  const quotaMigrationRef = useRef(false);

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

    // One-time: migrate existing users to storage quota system (conductor only)
    if (!quotaMigrationRef.current && isCond) {
      quotaMigrationRef.current = true;
      migrateExistingUsersQuota(db).catch((err) =>
        log.warn('Quota migration skipped:', err.message),
      );
    }

    // Only ensure Boon exists for conductor users — Boon is the conductor's default artist.
    // Non-conductors must only see their assigned artists, never Boon.
    if (!boonInitializedRef.current && isCond) {
      boonInitializedRef.current = true;
      ensureBoonArtistExists(db)
        .then((boonArtist) => {
          if (boonArtist && !currentArtistId) {
            log('🎵 Setting default artist to Boon:', boonArtist.id);
            setCurrentArtistId(boonArtist.id);
            setLastArtistId(boonArtist.id);
          }
        })
        .catch((err) => {
          log.warn('Could not ensure Boon exists:', err.message);
        });
    }

    // Determine the user's role and linked artist from allowedUsers
    const userRecord = allowedUsers.find(
      (u) => u.email?.toLowerCase() === currentAuthUser?.email?.toLowerCase(),
    );
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
        log('✅ Loaded linked artist:', artists.length, artists.map((a) => a.name).join(', '));
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
        log('✅ Loaded artists:', artists.length, artists.map((a) => a.name).join(', '));
        setFirestoreArtists(artists);
        setArtistsLoaded(true);

        if (artists.length > 0) {
          const userId = userRecord?.id || null;
          const visibleArtists = isUserConductor
            ? artists
            : artists.filter((a) => userId && a.ownerOperatorId === userId);

          log('🔐 Artist isolation check:', {
            email: currentAuthUser?.email,
            isUserConductor,
            userId,
            visibleCount: visibleArtists.length,
            currentArtistId,
          });

          const currentIsValid =
            currentArtistId && visibleArtists.find((a) => a.id === currentArtistId);
          if (!currentIsValid) {
            if (visibleArtists.length > 0) {
              const lastId = getLastArtistId();
              const artistToSelect =
                lastId && visibleArtists.find((a) => a.id === lastId)
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
    setSelectedPosts(new Set());
    setDayDetailDrawer({ isOpen: false, date: null, posts: [] });

    // Reset content filters and modals so stale state doesn't carry across artists
    setPostSearch('');
    setPostPlatformFilter('all');
    setContentStatus('all');
    setShowLateAccounts(false);
    setShowLateConnectModal(false);
    setShowScheduleModal(false);
    setArtistScheduleFilter(null);

    // BUG-010: Clear settings cache for previous artist, load new artist's settings
    if (currentArtistId) clearSettingsCache(currentArtistId);
    loadSettings(db, newArtistId)
      .then((settings) => {
        log('[App] Loaded settings for artist:', newArtistId, settings);
      })
      .catch(() => {});

    // Check if new artist has Late connected
    const hasLate = await checkArtistLateStatus(newArtistId);

    // If artist has Late connected, fetch their posts
    if (hasLate) {
      try {
        const result = await lateApi.fetchScheduledPosts(1, newArtistId);
        if (result.success) {
          setLatePosts(result.posts || []);
        } else if (result.error && result.error.includes('401')) {
          // Stale key — auto-remove to stop future 401s
          try {
            await removeArtistLateKey(newArtistId);
          } catch (_) {}
          setArtistLateConnected(false);
        }
      } catch (error) {
        log.warn('Error fetching Late posts for new artist:', error.message);
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
    const artistsToLoad = firestoreArtists.filter((a) => visibleArtists.some((v) => v.id === a.id));
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
                log.warn(
                  `[Late] Skipping account without ID for ${artist.name}:`,
                  JSON.stringify(account),
                );
                return;
              }
              const platform = (account.platform || account.type || '').toLowerCase();
              allPages.push({
                id: `${artist.id}-${realId}`,
                handle: account.username
                  ? `@${account.username.replace('@', '')}`
                  : account.handle || account.name || 'Unknown',
                platform: platform === 'tik_tok' ? 'tiktok' : platform,
                artist: artist.name,
                artistId: artist.id,
                niche: artist.niche || 'General',
                followers: account.followers_count || account.followers || 0,
                views: account.total_views || account.views || 0,
                status: account.is_active !== false ? 'active' : 'inactive',
                profileImage: account.profile_image || account.avatar,
                lateAccountId: String(realId),
              });
            });
          } else if (!result.success && result.error && result.error.includes('401')) {
            // Key is stale or revoked — auto-remove it to stop future 401s
            try {
              await removeArtistLateKey(artist.id);
            } catch (_) {}
            unconfigured.push({ id: artist.id, name: artist.name });
          }
        } catch (artistError) {
          // If we get a 403 or other error for this artist, treat as unconfigured
          log.warn(`Late API error for ${artist.name}:`, artistError.message);
          unconfigured.push({ id: artist.id, name: artist.name });
        }
      }

      setLatePages(allPages);
      setUnconfiguredLateArtists(unconfigured);
      log(
        '📱 Loaded',
        allPages.length,
        'Late pages from',
        artistsToLoad.length,
        'artists,',
        unconfigured.length,
        'unconfigured',
      );
    } catch (error) {
      log.error('Error loading Late pages:', error);
    } finally {
      setLoadingLatePages(false);
    }
  };

  // ═══ Manual Account Entry ═══
  // Save manual accounts to Firestore artist doc, returns status array for UI feedback
  const handleAddManualAccounts = async (artistId, accounts) => {
    if (!db || !artistId || !accounts.length) return [];

    const artist = firestoreArtists.find((a) => a.id === artistId);
    const existing = artist?.manualAccounts || [];

    // Dedup: skip if same handle+platform already exists
    const newAccounts = accounts
      .filter(
        (acc) =>
          !existing.some(
            (e) =>
              e.handle?.replace('@', '').toLowerCase() ===
                acc.handle?.replace('@', '').toLowerCase() && e.platform === acc.platform,
          ),
      )
      .map((acc) => ({
        ...acc,
        addedAt: new Date().toISOString(),
        addedBy: user?.email || 'unknown',
      }));

    if (newAccounts.length === 0) {
      showToast('All accounts already exist', 'info');
      return accounts.map((a) => ({ ...a, status: 'duplicate' }));
    }

    const merged = [...existing, ...newAccounts];

    try {
      await updateArtist(db, artistId, { manualAccounts: merged });
      log('✅ Added', newAccounts.length, 'manual accounts for artist', artistId);
      showToast(
        `Added ${newAccounts.length} account${newAccounts.length !== 1 ? 's' : ''}`,
        'success',
      );
      return newAccounts.map((a) => ({ ...a, status: 'saved' }));
    } catch (err) {
      log.error('Failed to save manual accounts:', err);
      showToast('Failed to save accounts', 'error');
      return accounts.map((a) => ({ ...a, status: 'error' }));
    }
  };

  // Remove a single manual account by index
  const handleRemoveManualAccount = async (artistId, index) => {
    if (!db || !artistId) return;
    const artist = firestoreArtists.find((a) => a.id === artistId);
    const existing = [...(artist?.manualAccounts || [])];
    if (index >= 0 && index < existing.length) {
      existing.splice(index, 1);
      try {
        await updateArtist(db, artistId, { manualAccounts: existing });
        showToast('Account removed', 'success');
      } catch (err) {
        log.error('Failed to remove manual account:', err);
        showToast('Failed to remove account', 'error');
      }
    }
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
        providerData: currentAuthUser.providerData,
      });

      // Check if user is a conductor (super-admin with full access)
      if (CONDUCTOR_EMAILS.includes(email?.toLowerCase())) {
        const condUserData = allowedUsers.find(
          (u) => u.email?.toLowerCase() === email?.toLowerCase(),
        );
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
        // Only update user if fields actually changed (avoids unnecessary re-renders)
        setUser((prev) => {
          if (
            prev &&
            prev.email === newUser.email &&
            prev.role === newUser.role &&
            prev.name === newUser.name &&
            prev.photoURL === newUser.photoURL
          )
            return prev;
          log('👑 Setting conductor user:', newUser);
          return newUser;
        });
      } else if (
        allowedUsers.some(
          (u) => u.email?.toLowerCase() === email?.toLowerCase() && u.status === 'active',
        )
      ) {
        const userData = allowedUsers.find((u) => u.email?.toLowerCase() === email?.toLowerCase());
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
          // Storage quota fields
          storageQuotaBytes:
            userData?.storageQuotaBytes !== undefined ? userData.storageQuotaBytes : null,
          storageUsedBytes: userData?.storageUsedBytes || 0,
        };
        // Only update user if fields actually changed (avoids unnecessary re-renders)
        setUser((prev) => {
          if (
            prev &&
            prev.email === newUser.email &&
            prev.role === newUser.role &&
            prev.name === newUser.name &&
            prev.photoURL === newUser.photoURL &&
            prev.artistId === newUser.artistId &&
            prev.onboardingComplete === newUser.onboardingComplete &&
            prev.paymentExempt === newUser.paymentExempt
          )
            return prev;
          log('🎨 Setting allowed user:', newUser);
          return newUser;
        });
      } else {
        log('🚫 User not in allowed list:', email);
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, [authChecked, firestoreLoaded, currentAuthUser, allowedUsers]);

  // Sync Firebase Auth photoURLs to allowedUsers docs (once per session)
  const photoSyncedRef = useRef(false);
  useEffect(() => {
    if (photoSyncedRef.current || !currentAuthUser || !db || !allowedUsers.length) return;
    photoSyncedRef.current = true;

    // Sync current user's photo client-side
    if (currentAuthUser.photoURL) {
      const userEmail = currentAuthUser.email?.toLowerCase();
      const existingDoc = allowedUsers.find((u) => u.email?.toLowerCase() === userEmail);
      if (existingDoc && existingDoc.photoURL !== currentAuthUser.photoURL) {
        updateDoc(doc(db, 'allowedUsers', userEmail), { photoURL: currentAuthUser.photoURL }).catch(
          () => {},
        );
      }
    }

    // Conductors: server-side sync ALL users' photos from Firebase Auth
    if (CONDUCTOR_EMAILS.includes(currentAuthUser.email?.toLowerCase())) {
      currentAuthUser
        .getIdToken()
        .then((token) =>
          fetch('/api/sync-photos', { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json())
            .then((data) => {
              if (data.synced > 0) log(`Synced ${data.synced} user photos`);
            })
            .catch(() => {}),
        )
        .catch(() => {});
    }
  }, [currentAuthUser, allowedUsers]);

  // Restore saved page after user is authenticated (once only)
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (user && pendingPage && !sessionRestoredRef.current) {
      sessionRestoredRef.current = true;
      // Verify user has access to the pending page
      if (pendingPage === 'operator' && (user.role === 'operator' || user.role === 'conductor')) {
        log.debug(
          '[App Session] Restoring operator page, tab:',
          pendingOperatorTab,
          'editor:',
          pendingShowVideoEditor,
        );
        setCurrentPage('operator');
        if (pendingOperatorTab) {
          setOperatorTab(pendingOperatorTab);
          setPendingOperatorTab(null);
        }
        if (pendingShowVideoEditor) {
          setShowVideoEditor(true);
          setPendingShowVideoEditor(false);
        }
      } else if (
        (pendingPage === 'artist-dashboard' || pendingPage === 'artist-portal') &&
        isArtistOrCollaborator(user)
      ) {
        log.debug('[App Session] Restoring artist-dashboard page');
        setCurrentPage('artist-dashboard');
      } else if (
        pendingPage === 'operator' ||
        pendingPage === 'artist-portal' ||
        pendingPage === 'artist-dashboard'
      ) {
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
      setShowVideoEditor(false);
      setShowScheduleModal(false);
      setShowLateConnectModal(false);
      setShowLateAccounts(false);
    } else if (!isArtistOrCollaborator(user) && path.startsWith('/artist/')) {
      log('🔒 Operator on artist URL — redirecting to operator dashboard');
      setCurrentPage('operator');
    }
  }, [user, authChecked, location.pathname]);

  // Save session state when navigation changes
  useEffect(() => {
    saveAppSession({ currentPage, operatorTab });
  }, [currentPage, operatorTab]);

  // Load applications from Firestore for operators
  useEffect(() => {
    if (user?.role === 'operator') {
      const unsubscribe = onSnapshot(
        collection(db, 'applications'),
        (snapshot) => {
          const apps = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          // Sort by submitted date, newest first
          apps.sort((a, b) => new Date(b.submitted) - new Date(a.submitted));
          setApplications(apps);
          log('Loaded applications from Firestore:', apps.length);
        },
        (error) => {
          log.error('Error loading applications:', error);
        },
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
    return allowedUsers.some(
      (u) => u.email?.toLowerCase() === normalizedEmail && u.status === 'active',
    );
  };

  // Helper to get user data from Firestore
  const getAllowedUserData = (email) => {
    const normalizedEmail = email?.toLowerCase();
    return allowedUsers.find((u) => u.email?.toLowerCase() === normalizedEmail);
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

  // Helper to get artist info from Firestore
  const getArtistInfo = (email) => {
    const userData = getAllowedUserData(email);
    if (userData) {
      return {
        artistId: userData.artistId || null,
        name: userData.name || email?.split('@')[0],
      };
    }
    return null;
  };

  const [applicationFilter, setApplicationFilter] = useState('all'); // 'all', 'pending', 'approved', 'declined'

  // Toast notification state
  const showToast = (message, type = 'success') => {
    if (type === 'success') sonnerToast.success(message);
    else if (type === 'error') sonnerToast.error(message);
    else if (type === 'info') sonnerToast.info(message);
    else sonnerToast(message);
  };

  // Undo Toast state
  const [undoAction, setUndoAction] = useState(null);

  // Show undo toast
  const showUndoToast = (message, onUndo, duration = 5000) => {
    const id = Date.now();
    setUndoAction({ id, message, onUndo });
    setTimeout(() => {
      setUndoAction((prev) => (prev?.id === id ? null : prev));
    }, duration);
  };

  // Confirm Dialog state (P0-UI-05: Destructive Action Confirmation)
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    confirmVariant: 'primary',
    onConfirm: null,
    isLoading: false,
  });

  const showConfirmDialog = ({
    title,
    message,
    confirmLabel,
    confirmVariant = 'destructive',
    onConfirm,
  }) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmLabel,
      confirmVariant,
      onConfirm,
      isLoading: false,
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  };

  const handleConfirmDialogConfirm = async () => {
    if (confirmDialog.onConfirm) {
      setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
      await confirmDialog.onConfirm();
      setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
    }
  };

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Desktop onboarding (Electron first-run setup)
  const [showDesktopOnboarding, setShowDesktopOnboarding] = useState(false);

  // Desktop onboarding — check if Electron first-run setup is needed
  useEffect(() => {
    if (isElectronApp()) {
      isOnboardingComplete().then((complete) => {
        if (!complete) setShowDesktopOnboarding(true);
      });
    }
  }, []);

  // Check if first time user — check both localStorage and Firestore-backed settings
  useEffect(() => {
    if (user && user.role === 'operator') {
      const hasSeenOnboarding = localStorage.getItem('stm_onboarding_complete');
      if (hasSeenOnboarding) return; // Already dismissed — don't show
      // Also check Firestore settings (handles cross-device persistence)
      if (db && currentArtistId) {
        loadSettings(db, currentArtistId)
          .then((settings) => {
            if (settings?.onboarding?.completed) {
              localStorage.setItem('stm_onboarding_complete', 'true'); // Sync to localStorage
            } else {
              setShowOnboarding(true);
            }
          })
          .catch(() => setShowOnboarding(true));
      } else {
        setShowOnboarding(true);
      }
    }
  }, [user, db, currentArtistId]);

  // Onboarding steps
  // onboardingSteps moved to module scope

  const completeOnboarding = () => {
    localStorage.setItem('stm_onboarding_complete', 'true');
    // BUG-010: Persist onboarding completion to Firestore
    saveSettings(db, currentArtistId, {
      onboarding: { completed: true, completedAt: new Date().toISOString() },
    });
    setShowOnboarding(false);
    setOnboardingStep(0);
  };

  // Operator dashboard — content filters from Zustand
  const contentArtist = useContentStore((s) => s.contentArtist);
  const setContentArtist = useContentStore((s) => s.setContentArtist);
  const contentStatus = useContentStore((s) => s.contentStatus);
  const setContentStatus = useContentStore((s) => s.setContentStatus);
  const contentSortOrder = useContentStore((s) => s.contentSortOrder);
  const setContentSortOrder = useContentStore((s) => s.setContentSortOrder);
  const setPostSearch = useContentStore((s) => s.setPostSearch);
  const setPostPlatformFilter = useContentStore((s) => s.setPostPlatformFilter);

  // Batch Schedule modal state
  const showScheduleModal = useUIStore((s) => s.showScheduleModal);
  const setShowScheduleModal = useUIStore((s) => s.setShowScheduleModal);
  const batchForm = useContentStore((s) => s.batchForm);
  const setBatchForm = useContentStore((s) => s.setBatchForm);
  const generatedSchedule = useContentStore((s) => s.generatedSchedule);
  const setGeneratedSchedule = useContentStore((s) => s.setGeneratedSchedule);
  const syncing = useContentStore((s) => s.syncing);
  const setSyncing = useContentStore((s) => s.setSyncing);
  const syncStatus = useContentStore((s) => s.syncStatus);
  const setSyncStatus = useContentStore((s) => s.setSyncStatus);
  const showLateAccounts = useUIStore((s) => s.showLateAccounts);
  const setShowLateAccounts = useUIStore((s) => s.setShowLateAccounts);
  const latePosts = useContentStore((s) => s.latePosts);
  const setLatePosts = useContentStore((s) => s.setLatePosts);
  const [artistLateConnected, setArtistLateConnected] = useState(false); // Track if current artist has Late connected
  const [checkingLateStatus, setCheckingLateStatus] = useState(false);
  const latePages = useContentStore((s) => s.latePages);
  const setLatePages = useContentStore((s) => s.setLatePages);
  const [loadingLatePages, setLoadingLatePages] = useState(false);
  const [unconfiguredLateArtists, setUnconfiguredLateArtists] = useState([]); // Artists without Late API keys
  const showLateConnectModal = useUIStore((s) => s.showLateConnectModal);
  const setShowLateConnectModal = useUIStore((s) => s.setShowLateConnectModal);

  // Derive lateAccountIds mapping from live latePages data (replaces old hardcoded constant)
  // Shape: { '@handle': { tiktok: 'accountId', instagram: 'accountId', ... } }
  const derivedLateAccountIds = useMemo(() => {
    const mapping = {};
    latePages.forEach((page) => {
      if (!mapping[page.handle]) mapping[page.handle] = {};
      mapping[page.handle][page.platform] = page.lateAccountId;
    });
    return mapping;
  }, [latePages]);

  // Build stable photoURL lookup: artistId → photoURL from allowedUsers, Auth, or Late pages
  const artistPhotoMap = useMemo(() => {
    const map = {};
    for (const u of allowedUsers) {
      if (!u.photoURL) continue;
      if (u.linkedArtistId) map[u.linkedArtistId] = u.photoURL;
      if (u.artistId) map[u.artistId] = u.photoURL;
    }
    if (currentAuthUser?.photoURL) {
      const rec = allowedUsers.find(
        (u) => u.email?.toLowerCase() === currentAuthUser.email?.toLowerCase(),
      );
      if (rec?.artistId && !map[rec.artistId]) map[rec.artistId] = currentAuthUser.photoURL;
      if (rec?.linkedArtistId && !map[rec.linkedArtistId])
        map[rec.linkedArtistId] = currentAuthUser.photoURL;
    }
    for (const page of latePages) {
      if (!page.profileImage || !page.artistId) continue;
      if (!map[page.artistId]) map[page.artistId] = page.profileImage;
    }
    return map;
  }, [allowedUsers, currentAuthUser, latePages]);

  const enrichArtist = useCallback(
    (a) => {
      const photoURL = a.photoURL || artistPhotoMap[a.id] || null;
      return { id: a.id, name: a.name, ownerOperatorId: a.ownerOperatorId || null, photoURL };
    },
    [artistPhotoMap],
  );

  // Memoized visible artists — operators only see artists they own (ownerOperatorId)
  const visibleArtists = useMemo(() => {
    const allArtists = firestoreArtists.map(enrichArtist);
    if (isConductor(user)) return allArtists;
    if (isArtistOrCollaborator(user)) {
      const effectiveId = getEffectiveArtistId(user);
      return effectiveId ? allArtists.filter((a) => a.id === effectiveId) : [];
    }
    const currentUserRecord = allowedUsers.find(
      (u) => u.email?.toLowerCase() === user?.email?.toLowerCase(),
    );
    const currentUserId = currentUserRecord?.id || null;
    if (!currentUserId) return [];
    return allArtists.filter((a) => a.ownerOperatorId === currentUserId);
  }, [firestoreArtists, enrichArtist, user, allowedUsers]);

  // Derive manual accounts from artist docs (auto-updates via onSnapshot)
  const manualAccountsByArtist = useMemo(() => {
    const map = {};
    firestoreArtists.forEach((a) => {
      if (a.manualAccounts?.length) map[a.id] = a.manualAccounts;
    });
    return map;
  }, [firestoreArtists]);

  // Video Upload state
  const [showVideoUploadModal, setShowVideoUploadModal] = useState(false);

  // Bulk selection state
  const [selectedPosts, setSelectedPosts] = useState(new Set());

  // UI-12/13: Day detail drawer state
  const [dayDetailDrawer, setDayDetailDrawer] = useState({ isOpen: false, date: null, posts: [] });
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Mobile menu state

  // Settings state
  const [settings, setSettings] = useState({
    notifications: true,
    emailAlerts: true,
    autoSync: false,
    syncInterval: 30,
    theme: 'dark',
    timezone: 'America/Los_Angeles',
  });

  // Bulk delete posts — H-01: uses ConfirmDialog instead of window.confirm
  const handleBulkDelete = () => {
    if (selectedPosts.size === 0) return;

    showConfirmDialog({
      title: `Delete ${selectedPosts.size} post${selectedPosts.size > 1 ? 's' : ''}?`,
      message: 'This will permanently remove the selected posts. This action cannot be undone.',
      confirmLabel: `Delete ${selectedPosts.size}`,
      confirmVariant: 'destructive',
      onConfirm: () => executeBulkDelete(),
    });
  };

  const executeBulkDelete = async () => {
    setBulkDeleting(true);
    const deletedPosts = latePosts.filter((p) => selectedPosts.has(p.id));
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
      showUndoToast(`Deleted ${successCount} post(s)`, () => {
        // Undo is complex for bulk - just show message
        showToast('Please sync to restore', 'info');
      });
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
  const isExporting = useContentStore((s) => s.isExporting);
  const setIsExporting = useContentStore((s) => s.setIsExporting);
  // Delete confirmation modal
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({
    show: false,
    postId: null,
    caption: '',
  });

  // Quick search modal (Cmd+K)
  const [showQuickSearch, setShowQuickSearch] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K or Ctrl+K to open quick search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowQuickSearch(true);
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

  // NOTE: Auth state listener has been consolidated into the master auth listener above (around line 193)
  // The user state is now set by the useEffect at line 238 which handles auth + Firestore data together

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
      // Now authenticated — read allowedUsers directly from Firestore
      const snapshot = await getDocs(collection(db, 'allowedUsers'));
      const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const userEmail = loginForm.email.toLowerCase();
      const isCond = CONDUCTOR_EMAILS.includes(userEmail);
      const allowed =
        isCond || users.some((u) => u.email?.toLowerCase() === userEmail && u.status === 'active');
      if (!allowed) {
        await signOut(auth);
        setLoginForm((prev) => ({
          ...prev,
          error: 'Access denied. Please contact us to get access.',
        }));
        setIsLoggingIn(false);
        return;
      }
      // User is allowed — reactive effects will set full user state
      setShowLoginModal(false);
      setLoginForm({ email: '', password: '', error: null });
      showToast(`Welcome back!`, 'success');
      // Role-aware redirect
      const loginUserData = users.find((u) => u.email?.toLowerCase() === userEmail);
      const loginRole = loginUserData?.role || (isCond ? 'conductor' : 'artist');
      setCurrentPage(
        loginRole === 'artist' || loginRole === 'collaborator' ? 'artist-dashboard' : 'operator',
      );
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
      setLoginForm((prev) => ({ ...prev, error: errorMessage }));
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
      const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const userEmail = email.toLowerCase();
      const isCond = CONDUCTOR_EMAILS.includes(userEmail);
      const allowed =
        isCond || users.some((u) => u.email?.toLowerCase() === userEmail && u.status === 'active');
      if (!allowed) {
        await signOut(auth);
        setAuthError('Access denied. Please contact us to get access.');
        setIsLoggingIn(false);
        return;
      }
      // User is allowed — reactive effects will set full user state
      const googleUserData = users.find((u) => u.email?.toLowerCase() === userEmail);
      const googleRole = googleUserData?.role || (isCond ? 'conductor' : 'artist');
      setCurrentPage(
        googleRole === 'artist' || googleRole === 'collaborator' ? 'artist-dashboard' : 'operator',
      );
      showToast(`Welcome, ${result.user.displayName || 'there'}!`, 'success');
    } catch (error) {
      log.error('Google sign-in error:', error);
      let errorMessage = 'Google sign-in failed';
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'Sign-in cancelled';
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage = 'Popup blocked. Please allow popups for this site';
      }
      setLoginForm((prev) => ({ ...prev, error: errorMessage }));
    }
    setIsLoggingIn(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setIsSigningUp(true);

    // Check whitelist before creating account
    if (!isEmailAllowed(signupForm.email)) {
      setSignupForm((prev) => ({
        ...prev,
        error:
          'Access denied. Please contact us to get access or use Google Sign-in if you already have access.',
      }));
      setIsSigningUp(false);
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        signupForm.email,
        signupForm.password,
      );
      const email = userCredential.user.email;
      const role = getUserRole(email); // Use role based on email, not form selection
      const artistInfo = getArtistInfo(email);

      setUser({
        email: email,
        role: role,
        name: signupForm.name || userCredential.user.displayName || email.split('@')[0],
        photoURL: userCredential.user.photoURL || null,
        artistId: artistInfo?.artistId || null,
      });
      setShowSignupModal(false);
      setSignupForm({ email: '', password: '', name: '', role: 'artist', error: null });
      showToast(
        `Welcome to StickToMusic, ${signupForm.name || userCredential.user.displayName || email.split('@')[0]}!`,
        'success',
      );

      setCurrentPage(
        role === 'artist' || role === 'collaborator' ? 'artist-dashboard' : 'operator',
      );
    } catch (error) {
      let errorMessage = 'Signup failed';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Email already exists. Try logging in instead';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      }
      setSignupForm((prev) => ({ ...prev, error: errorMessage }));
    }
    setIsSigningUp(false);
  };

  const handleLogout = async () => {
    try {
      // Clear settings cache before signing out
      if (currentArtistId) clearSettingsCache(currentArtistId);
      await signOut(auth);
      setUser(null);
      setCurrentArtistId(null); // Clear artist selection so next user gets their own
      try {
        localStorage.removeItem('stm_last_artist_id');
      } catch {} // Clear persisted artist
      setCurrentPage('home');
      showToast('Logged out successfully', 'success');
    } catch (error) {
      log.error('Logout error:', error);
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
      const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const userEmail = email.toLowerCase();
      const isCond = CONDUCTOR_EMAILS.includes(userEmail);
      const allowed =
        isCond || users.some((u) => u.email?.toLowerCase() === userEmail && u.status === 'active');
      if (!allowed) {
        await signOut(auth);
        setAuthError('Access denied. Please contact us to get access.');
        setIsLoggingIn(false);
        return;
      }
      // User is allowed — the onAuthStateChanged + allowedUsers subscription
      // will handle setting the full user state reactively. Just navigate.
      const landingUserData = users.find((u) => u.email?.toLowerCase() === userEmail);
      const landingRole = landingUserData?.role || (isCond ? 'conductor' : 'artist');
      setCurrentPage(
        landingRole === 'artist' || landingRole === 'collaborator'
          ? 'artist-dashboard'
          : 'operator',
      );
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
        artistId: artistInfo?.artistId || null,
      });
      setCurrentPage(
        role === 'artist' || role === 'collaborator' ? 'artist-dashboard' : 'operator',
      );
      showToast(
        `Welcome, ${name || userCredential.user.displayName || userEmail.split('@')[0]}!`,
        'success',
      );
    } catch (error) {
      let msg = 'Signup failed';
      if (error.code === 'auth/email-already-in-use') msg = 'Email already exists. Try logging in';
      else if (error.code === 'auth/weak-password')
        msg = 'Password should be at least 6 characters';
      setAuthError(msg);
    }
    setIsSigningUp(false);
  };

  // Export to CSV function
  const exportToCSV = async () => {
    if (latePosts.length === 0) return;
    setIsExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const headers = ['Date', 'Time', 'Platforms', 'Caption', 'Status'];
    const rows = latePosts.map((post) => {
      const date = post.scheduledFor ? new Date(post.scheduledFor) : null;
      return [
        date ? date.toLocaleDateString() : '',
        date ? date.toLocaleTimeString() : '',
        (post.platforms || []).map((p) => p.platform || p).join(', '),
        `"${(post.content || '').replace(/"/g, '""')}"`,
        post.status || '',
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
      setShowLateAccounts(true);
      setSyncStatus(`Found ${accounts.length} accounts`);
    } else {
      setSyncStatus(`Error: ${result.error}`);
    }
    setTimeout(() => setSyncStatus(null), 3000);
  };

  // Content Banks - hashtags and captions per aesthetic category (loaded from Firestore)
  const [contentBanks, setContentBanks] = useState(DEFAULT_TEMPLATES);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  // Subscribe to templates when artist changes (after auth is verified)
  useEffect(() => {
    if (!authChecked || !currentAuthUser || !currentArtistId || !db) return;

    const unsubscribe = subscribeToTemplates(db, currentArtistId, (templates) => {
      setContentBanks(templates);
    });

    return () => unsubscribe();
  }, [authChecked, currentAuthUser, currentArtistId]);

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
    const caption =
      captions.length > 0 ? captions[Math.floor(Math.random() * captions.length)] : '';

    return { hashtags: finalHashtags, caption };
  };

  const contentQueue = useMemo(() => getContentQueue(), []);

  // Applications state - stores intake form submissions (starts empty)
  const [applications, setApplications] = useState([]);

  // Handle application approval - shows payment modal
  const handleApproveApplication = async (app) => {
    // Use new approve-application API that handles Stripe checkout + emails
    try {
      const token = await getFirebaseToken();
      const response = await fetch('/api/approve-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
      log.error('Approve error:', err);
      showToast('Failed to approve application', 'error');
    }
  };

  const handleDenyApplication = async (app) => {
    if (
      !window.confirm(
        `Deny application from ${app.name} (${app.email})? They will be notified by email.`,
      )
    )
      return;
    try {
      const token = await getFirebaseToken();
      const response = await fetch('/api/approve-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ applicationId: app.id, action: 'deny' }),
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Denied application from ${app.name}`, 'info');
      } else {
        showToast(data.error || 'Failed to deny', 'error');
      }
    } catch (err) {
      log.error('Deny error:', err);
      showToast('Failed to deny application', 'error');
    }
  };

  // Add user to Firestore allowedUsers (called after payment confirmed)
  // Also creates full artist profile with application data
  const addUserToAllowed = async (
    email,
    name,
    role = 'artist',
    artistId = null,
    applicationData = null,
  ) => {
    try {
      // Build artist profile from application data
      const artistProfile = {
        email: email.toLowerCase(),
        name: name,
        role: role,
        artistId: artistId || name.toLowerCase().replace(/\s+/g, '-'),
        status: 'active',
        createdAt: new Date().toISOString(),
        storageQuotaBytes: DEFAULT_QUOTA_BYTES,
        storageUsedBytes: 0,
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
      log.error('Error adding user:', error);
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
          approvedAt: new Date().toISOString(),
        });
      } catch (error) {
        log.error('Error updating application status:', error);
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
    posts.forEach((post) => {
      const account = getPostAccount(post);
      if (account) accounts.add(account);
    });
    return Array.from(accounts).sort();
  };

  // Helper to get post thumbnail
  // Helper to get social media URLs for posts (supports all platforms via PLATFORMS config)
  const getPostUrls = (post) => {
    const urls = [];
    const platforms = post.platforms || [];

    platforms.forEach((p) => {
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
          isActualPost: true,
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
            urls.push({
              platform: 'tiktok',
              url: `https://www.tiktok.com/@${username}/video/${videoId}`,
              label: 'TikTok',
              isActualPost: true,
            });
            return;
          }
        } else if (platform === 'instagram') {
          urls.push({
            platform: 'instagram',
            url: `https://www.instagram.com/reel/${p.platformPostId}/`,
            label: 'IG',
            isActualPost: true,
          });
          return;
        } else if (platform === 'youtube') {
          urls.push({
            platform: 'youtube',
            url: `https://www.youtube.com/watch?v=${p.platformPostId}`,
            label: 'YT',
            isActualPost: true,
          });
          return;
        } else if (platform === 'facebook') {
          urls.push({
            platform: 'facebook',
            url: `https://www.facebook.com/${username}/videos/${p.platformPostId}`,
            label: 'FB',
            isActualPost: true,
          });
          return;
        }
      }

      // Priority 3: Link to profile if we have username (using centralized config)
      if (username) {
        urls.push({
          platform,
          url: getPlatformUrl(platform, username),
          label: config.label,
          isActualPost: false,
        });
        return;
      }

      // Priority 4: Fallback to our local account ID mapping (legacy support)
      const accountIdStr = typeof p.accountId === 'string' ? p.accountId : p.accountId?._id;
      const handleEntry = Object.entries(derivedLateAccountIds).find(([handle, ids]) =>
        Object.values(ids).includes(accountIdStr),
      );
      if (handleEntry) {
        const handle = handleEntry[0].replace('@', '');
        urls.push({
          platform,
          url: getPlatformUrl(platform, handle),
          label: config.label,
          isActualPost: false,
        });
      }
    });

    return urls;
  };

  const goToIntake = () => {
    setCurrentPage('intake');
  };

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

  // ═══ Legal pages — accessible without auth ═══
  if (location.pathname === '/terms') {
    return (
      <ThemeProvider>
        <Suspense fallback={<LoadingSpinner />}>
          <TermsPage />
        </Suspense>
      </ThemeProvider>
    );
  }
  if (location.pathname === '/privacy') {
    return (
      <ThemeProvider>
        <Suspense fallback={<LoadingSpinner />}>
          <PrivacyPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  // ═══ NEW ROUTING: Non-authenticated users → Landing Page ═══
  if (!user) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <Suspense fallback={<LoadingSpinner />}>
            <LandingPage
              onLogin={handleLandingLogin}
              onSignup={handleLandingSignup}
              onGoogleAuth={handleGoogleSignIn}
              authError={authError}
              authLoading={isLoggingIn || isSigningUp}
            />
          </Suspense>
        </ToastProvider>
      </ThemeProvider>
    );
  }

  // INTAKE FORM PAGE (legacy — agency model)
  if (currentPage === 'intake') {
    return (
      <IntakeForm
        db={db}
        user={user}
        onBack={() =>
          setCurrentPage(user ? (user.role === 'artist' ? 'artist-portal' : 'operator') : 'home')
        }
        onSubmitSuccess={(newApp) => {
          setApplications((prev) => [newApp, ...prev]);
          showToast('Application submitted!', 'success');
        }}
      />
    );
  }

  // ═══ ARTIST DASHBOARD (artists + collaborators) ═══
  if (currentPage === 'artist-dashboard') {
    const effectiveArtistId = getEffectiveArtistId(user) || currentArtistId;
    const artistAsList = [firestoreArtists.find((a) => a.id === effectiveArtistId)]
      .filter(Boolean)
      .map(enrichArtist);
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
            visibleArtists={artistAsList}
            currentArtistId={effectiveArtistId}
            onArtistChange={NOOP}
          >
            <Suspense fallback={<LoadingSpinner />}>
              {/* Studio — rendered inline inside AppShell so sidebar stays visible */}
              {artistTab === 'studio' ? (
                <VideoStudio
                  inline
                  db={db}
                  user={user}
                  onClose={() => {
                    setArtistTab('dashboard');
                    setArtistPendingEditDraft(null);
                  }}
                  artists={artistAsList}
                  artistId={effectiveArtistId}
                  onArtistChange={NOOP}
                  lateAccountIds={derivedLateAccountIds}
                  latePages={latePages.filter((p) => p.artistId === effectiveArtistId)}
                  manualAccounts={manualAccountsByArtist[effectiveArtistId] || EMPTY_ARRAY}
                  onSchedulePost={(params) =>
                    lateApi.schedulePost({ ...params, artistId: effectiveArtistId })
                  }
                  onDeleteLatePost={(latePostId) =>
                    lateApi.deletePost(latePostId, effectiveArtistId)
                  }
                  pendingEditDraft={artistPendingEditDraft}
                  onClearPendingEditDraft={() => setArtistPendingEditDraft(null)}
                />
              ) : artistTab === 'schedule' ? (
                <SchedulingPage
                  db={db}
                  artistId={effectiveArtistId}
                  accounts={latePages.filter((p) => p.artistId === effectiveArtistId)}
                  lateAccountIds={derivedLateAccountIds}
                  initialStatusFilter={artistScheduleFilter}
                  onSchedulePost={(params) =>
                    lateApi.schedulePost({ ...params, artistId: effectiveArtistId })
                  }
                  onDeleteLatePost={(latePostId) =>
                    lateApi.deletePost(latePostId, effectiveArtistId)
                  }
                  onEditDraft={(post) => {
                    if (post.editorState) {
                      setArtistPendingEditDraft({ post });
                      setArtistTab('studio');
                    }
                  }}
                  onBack={() => setArtistTab('dashboard')}
                  visibleArtists={artistAsList}
                  onArtistChange={NOOP}
                />
              ) : (
                <div className="w-full overflow-y-auto" style={{ maxHeight: '100%' }}>
                  {/* Dashboard Tab */}
                  {artistTab === 'dashboard' && (
                    <ArtistDashboard
                      user={user}
                      artistId={effectiveArtistId}
                      db={db}
                      latePages={latePages.filter((p) => p.artistId === effectiveArtistId)}
                      socialSetsAllowed={user?.socialSetsAllowed || 0}
                      handleGroups={
                        firestoreArtists.find((a) => a.id === effectiveArtistId)?.handleGroups
                      }
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
                      artists={[firestoreArtists.find((a) => a.id === effectiveArtistId)]
                        .filter(Boolean)
                        .map(enrichArtist)}
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
                      onPhotoUpdated={(url) => setUser((prev) => ({ ...prev, photoURL: url }))}
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
                      log.warn('Could not update onboarding status:', err);
                    }
                    setUser((prev) => (prev ? { ...prev, onboardingComplete: true } : prev));
                  }}
                />
              )}
            </Suspense>
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

  // ═══ MAIN DASHBOARD (all authenticated users) ═══
  if (currentPage === 'operator') {
    // Tab change handler — routes Studio/Schedule to VideoStudio modal
    const handleTabChange = (tab) => {
      if (tab === 'studio') {
        setShowVideoEditor(true);
        return;
      }
      setShowVideoEditor(false);
      setPendingEditDraft(null);
      setShowScheduleModal(false);
      setShowLateConnectModal(false);
      setShowLateAccounts(false);
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
            visibleArtists={visibleArtists}
            currentArtistId={currentArtistId}
            onArtistChange={handleArtistChange}
          >
            <Suspense fallback={<LoadingSpinner />}>
              {/* Video Studio — rendered inline inside AppShell so sidebar stays visible */}
              {showVideoEditor ? (
                <VideoStudio
                  inline
                  db={db}
                  user={user}
                  onClose={() => {
                    setShowVideoEditor(false);
                    setPendingEditDraft(null);
                  }}
                  artists={visibleArtists}
                  artistId={currentArtistId}
                  onArtistChange={handleArtistChange}
                  lateAccountIds={derivedLateAccountIds}
                  latePages={latePages.filter((p) => p.artistId === currentArtistId)}
                  manualAccounts={manualAccountsByArtist[currentArtistId] || EMPTY_ARRAY}
                  onSchedulePost={(params) =>
                    lateApi.schedulePost({ ...params, artistId: currentArtistId })
                  }
                  onDeleteLatePost={(latePostId) => lateApi.deletePost(latePostId, currentArtistId)}
                  pendingEditDraft={pendingEditDraft}
                  onClearPendingEditDraft={() => setPendingEditDraft(null)}
                />
              ) : operatorTab === 'schedule' ? null : (
                <div className="w-full overflow-y-auto" style={{ maxHeight: '100%' }}>
                  {/* ═══ Pages Tab (new) ═══ */}
                  {operatorTab === 'pages' && (
                    <PagesTab
                      latePages={latePages}
                      visibleArtists={visibleArtists}
                      unconfiguredLateArtists={unconfiguredLateArtists}
                      loadingLatePages={loadingLatePages}
                      onLoadLatePages={loadLatePages}
                      onConfigureLate={(artistId) => {
                        setCurrentArtistId(artistId);
                        setShowLateConnectModal(true);
                      }}
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
                      onPhotoUpdated={(url) => setUser((prev) => ({ ...prev, photoURL: url }))}
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
                          const currentUserRecord = allowedUsers.find(
                            (u) => u.email?.toLowerCase() === user?.email?.toLowerCase(),
                          );
                          const currentUserId = currentUserRecord?.id || null;
                          displayArtists = displayArtists.filter(
                            (artist) => currentUserId && artist.ownerOperatorId === currentUserId,
                          );
                        }
                        return displayArtists.map(enrichArtist);
                      })()}
                      user={user}
                      currentArtistId={currentArtistId}
                      onArtistChange={handleArtistChange}
                      onAddArtist={() => artistModalsRef.current?.openAdd()}
                      onEditArtist={(artist) => artistModalsRef.current?.openEdit(artist)}
                      onReassignArtist={(artist) => artistModalsRef.current?.openReassign(artist)}
                      onDeleteArtist={(artist) => artistModalsRef.current?.openDelete(artist)}
                      isConductor={isConductor(user)}
                      latePages={latePages}
                      loadingLatePages={loadingLatePages}
                    />
                  )}

                  {/* Content Tab */}
                  {operatorTab === 'content' && (
                    <ContentTab
                      contentQueue={contentQueue}
                      visibleArtists={visibleArtists}
                      artistLateConnected={artistLateConnected}
                      checkingLateStatus={checkingLateStatus}
                      derivedLateAccountIds={derivedLateAccountIds}
                      generatePostContent={generatePostContent}
                      handleBulkDelete={handleBulkDelete}
                      fetchLateAccounts={fetchLateAccounts}
                      exportToCSV={exportToCSV}
                      contentBanks={contentBanks}
                      selectedPosts={selectedPosts}
                      bulkDeleting={bulkDeleting}
                      dayDetailDrawer={dayDetailDrawer}
                      setDayDetailDrawer={setDayDetailDrawer}
                      deleteConfirmModal={deleteConfirmModal}
                      setDeleteConfirmModal={setDeleteConfirmModal}
                      getPostAccount={getPostAccount}
                      getUniqueAccounts={getUniqueAccounts}
                      getPostUrls={getPostUrls}
                    />
                  )}

                  {/* Analytics Tab */}
                  {operatorTab === 'analytics' && (
                    <AnalyticsDashboard
                      artistId={currentArtistId}
                      artists={visibleArtists}
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
                    <ApplicationsTab
                      applications={applications}
                      applicationFilter={applicationFilter}
                      setApplicationFilter={setApplicationFilter}
                      onApprove={handleApproveApplication}
                      onDeny={handleDenyApplication}
                      onMarkPaymentComplete={handleMarkPaymentComplete}
                      onShareIntakeLink={() => {
                        navigator.clipboard.writeText(window.location.origin + '?page=intake');
                        showToast('Intake form link copied!', 'success');
                      }}
                      showToast={showToast}
                    />
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
                  onSchedulePost={(params) =>
                    lateApi.schedulePost({ ...params, artistId: currentArtistId })
                  }
                  onDeleteLatePost={(latePostId) => lateApi.deletePost(latePostId, currentArtistId)}
                  onEditDraft={(post) => {
                    if (post.editorState) {
                      setPendingEditDraft({ post });
                      setShowVideoEditor(true);
                    }
                  }}
                  onBack={() => setOperatorTab('pages')}
                  visibleArtists={visibleArtists}
                  onArtistChange={handleArtistChange}
                />
              )}
            </Suspense>
          </AppShell>

          <ArtistModals
            ref={artistModalsRef}
            db={db}
            user={user}
            firestoreArtists={firestoreArtists}
            currentArtistId={currentArtistId}
            setCurrentArtistId={setCurrentArtistId}
            allowedUsers={allowedUsers}
            showToast={showToast}
            isConductor={isConductor(user)}
            currentUserRecord={allowedUsers.find(
              (u) => u.email?.toLowerCase() === user?.email?.toLowerCase(),
            )}
          />

          <ContentTemplatesModal
            isOpen={showTemplatesModal}
            onClose={() => setShowTemplatesModal(false)}
            artistName={firestoreArtists.find((a) => a.id === currentArtistId)?.name}
            contentBanks={contentBanks}
            currentArtistId={currentArtistId}
            db={db}
            showToast={showToast}
          />

          <VideoUploadModal
            isOpen={showVideoUploadModal}
            onClose={() => setShowVideoUploadModal(false)}
            currentArtistId={currentArtistId}
            showToast={showToast}
          />

          <LateConnectModal
            isOpen={showLateConnectModal}
            onClose={() => {
              setShowLateConnectModal(false);
            }}
            artistName={firestoreArtists.find((a) => a.id === currentArtistId)?.name}
            currentArtistId={currentArtistId}
            onConnected={async () => {
              setArtistLateConnected(true);
              loadLatePages();
              const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
              if (result.success) {
                setLatePosts(result.posts || []);
              }
            }}
            showToast={showToast}
          />

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
          <UndoToast undoAction={undoAction} onDismiss={() => setUndoAction(null)} />
          <OnboardingTooltip
            showOnboarding={showOnboarding}
            steps={onboardingSteps}
            currentStep={onboardingStep}
            onNext={() => setOnboardingStep((prev) => prev + 1)}
            onComplete={completeOnboarding}
            onSetTab={setOperatorTab}
          />
        </ToastProvider>
      </ThemeProvider>
    );
  }

  // DASHBOARD PAGE - Redirect (legacy)
  if (currentPage === 'dashboard') {
    setCurrentPage('operator');
    return null;
  }

  // Fallback — should not be reached; redirect to dashboard or landing page
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Private mode warning modal */}
      {showPrivateModeWarning && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[10000]">
          <div className="bg-[#1a1a1a] p-8 rounded-xl max-w-[500px] text-center">
            <h2 className="text-2xl font-bold mb-4">Private Browsing Not Supported</h2>
            <p className="text-[#999] mb-6">
              StickToMusic requires localStorage to function properly. Please use normal browsing
              mode.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-violet-600 text-white px-6 py-3 rounded-lg border-none cursor-pointer font-semibold"
            >
              Reload Page
            </button>
          </div>
        </div>
      )}

      <LegacyMarketingPages
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        goToIntake={goToIntake}
        user={user}
        showPrivateModeWarning={showPrivateModeWarning}
      />

      {/* LOGIN MODAL */}
      <AnimatePresence>
        {showLoginModal && (
          <motion.div
            className="fixed inset-0 bg-black/80 flex items-start md:items-center justify-center z-50 p-4 pt-16 md:pt-4 overflow-y-auto"
            onClick={() => setShowLoginModal(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md my-auto"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-lg md:text-xl font-bold">Welcome Back</h2>
                <button
                  onClick={() => setShowLoginModal(false)}
                  className="text-zinc-500 hover:text-white p-2 -mr-2"
                  aria-label="Close modal"
                >
                  ✕
                </button>
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
                    onChange={(e) =>
                      setLoginForm((prev) => ({ ...prev, email: e.target.value, error: null }))
                    }
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
                    onChange={(e) =>
                      setLoginForm((prev) => ({ ...prev, password: e.target.value, error: null }))
                    }
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
                  ) : (
                    'Log In'
                  )}
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
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <p className="text-center text-sm text-zinc-500">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setShowLoginModal(false);
                      setShowSignupModal(true);
                    }}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SIGNUP MODAL */}
      <AnimatePresence>
        {showSignupModal && (
          <motion.div
            className="fixed inset-0 bg-black/80 flex items-start md:items-center justify-center z-50 p-4 pt-8 md:pt-4 overflow-y-auto"
            onClick={() => setShowSignupModal(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md my-auto"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
            >
              <div className="p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-lg md:text-xl font-bold">Create Account</h2>
                <button
                  onClick={() => setShowSignupModal(false)}
                  className="text-zinc-500 hover:text-white p-2 -mr-2"
                  aria-label="Close modal"
                >
                  ✕
                </button>
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
                    onChange={(e) =>
                      setSignupForm((prev) => ({ ...prev, name: e.target.value, error: null }))
                    }
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
                    onChange={(e) =>
                      setSignupForm((prev) => ({ ...prev, email: e.target.value, error: null }))
                    }
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
                    onChange={(e) =>
                      setSignupForm((prev) => ({ ...prev, password: e.target.value, error: null }))
                    }
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Account Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSignupForm((prev) => ({ ...prev, role: 'artist' }))}
                      className={`p-3 rounded-xl border transition ${signupForm.role === 'artist' ? 'border-purple-500 bg-purple-500/20' : 'border-zinc-700 bg-zinc-800'}`}
                    >
                      <span className="block font-medium">Artist</span>
                      <span className="text-xs text-zinc-500">View your dashboard</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignupForm((prev) => ({ ...prev, role: 'operator' }))}
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
                  ) : (
                    'Create Account'
                  )}
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
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <p className="text-center text-sm text-zinc-500">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setShowSignupModal(false);
                      setShowLoginModal(true);
                    }}
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Log in
                  </button>
                </p>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={showQuickSearch}
        onClose={() => setShowQuickSearch(false)}
        items={[
          { label: 'Home', action: () => setCurrentPage('home'), icon: '🏠', category: 'Pages' },
          {
            label: 'Pricing',
            action: () => setCurrentPage('pricing'),
            icon: '💰',
            category: 'Pages',
          },
          {
            label: 'How It Works',
            action: () => setCurrentPage('how-it-works'),
            icon: '📖',
            category: 'Pages',
          },
          {
            label: 'Apply / Intake Form',
            action: () => setCurrentPage('intake'),
            icon: '📝',
            category: 'Pages',
          },
          {
            label: isConductor(user) ? 'Conductor Dashboard' : 'Operator Dashboard',
            action: () => setCurrentPage('operator'),
            icon: '⚙️',
            category: 'Dashboards',
          },
          {
            label: 'Artist Portal',
            action: () => setCurrentPage('artist-portal'),
            icon: '🎵',
            category: 'Dashboards',
          },
          {
            label: 'Artists Tab',
            action: () => {
              setOperatorTab('artists');
              setCurrentPage('operator');
            },
            icon: '👥',
            category: 'Operator',
            shortcut: '⌘1',
          },
          {
            label: 'Pages Tab',
            action: () => {
              setOperatorTab('pages');
              setCurrentPage('operator');
            },
            icon: '📱',
            category: 'Operator',
            shortcut: '⌘2',
          },
          {
            label: 'Content / Schedule',
            action: () => {
              setOperatorTab('content');
              setCurrentPage('operator');
            },
            icon: '📅',
            category: 'Operator',
            shortcut: '⌘3',
          },
          {
            label: 'Applications',
            action: () => {
              setOperatorTab('applications');
              setCurrentPage('operator');
            },
            icon: '📋',
            category: 'Operator',
          },
          {
            label: 'New Schedule',
            action: () => {
              setShowScheduleModal(true);
              setCurrentPage('operator');
              setOperatorTab('content');
            },
            icon: '➕',
            category: 'Actions',
          },
          {
            label: 'Login',
            action: () => setShowLoginModal(true),
            icon: '🔑',
            category: 'Actions',
          },
        ]}
      />

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
      <UndoToast undoAction={undoAction} onDismiss={() => setUndoAction(null)} />
      <OnboardingTooltip
        showOnboarding={showOnboarding}
        steps={onboardingSteps}
        currentStep={onboardingStep}
        onNext={() => setOnboardingStep((prev) => prev + 1)}
        onComplete={completeOnboarding}
        onSetTab={setOperatorTab}
      />

      {/* Desktop Onboarding (Electron first-run setup) */}
      {showDesktopOnboarding && (
        <DesktopOnboarding
          db={db}
          artists={firestoreArtists || []}
          onComplete={() => setShowDesktopOnboarding(false)}
        />
      )}

      {/* Dev Environment Banner — helps QA agents identify which server they're on */}
      {process.env.NODE_ENV === 'development' && (
        <div
          style={{
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
          }}
        >
          {`◆ DEV — localhost:${window.location.port || '3000'} ◆`}
        </div>
      )}
    </div>
  );
};

const StickToMusic = () => {
  return <StickToMusicInner />;
};

export default StickToMusic;
