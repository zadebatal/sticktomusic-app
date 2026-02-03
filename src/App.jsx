import React, { useState, useEffect, useRef } from 'react';

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
  HelperText
} from './components/ui';

// Video Studio - Flowstage-inspired workflow
import { VideoStudio } from './components/VideoEditor';

// Domain enforcement utilities
import { isUserOperator } from './utils/roles';

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
  updateDoc,
  doc,
  onSnapshot
} from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDIw9xCnMVpDHW36vyxsNtwvmOfVlIHa0Y",
  authDomain: "sticktomusic-c8b23.firebaseapp.com",
  projectId: "sticktomusic-c8b23",
  storageBucket: "sticktomusic-c8b23.firebasestorage.app",
  messagingSenderId: "621559911733",
  appId: "1:621559911733:web:4fe5066433967245ada87c"
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

// Stripe Configuration
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51SwClT6Yzynsfn3ImqR6SMOHy1EgQoTeQ7o7i3iMBRWSTTaYo2WrIq6G5ZpOMrhGCmEwuKc9mpKFMZXKFn9TLfUv00lfBRoJyl';

// Operator emails (these users get operator access)
// Can be overridden via REACT_APP_OPERATOR_EMAILS environment variable (comma-separated)
const OPERATOR_EMAILS = (process.env.REACT_APP_OPERATOR_EMAILS || 'zade@sticktomusic.com,zadebatal@gmail.com')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

// Late API Configuration - API key is now stored securely in Vercel environment variables
// The /api/late serverless function proxies requests with the key
const LATE_API_PROXY = '/api/late';

// Late Account ID Mapping (handle -> { tiktok: id, instagram: id })
const LATE_ACCOUNT_IDS = {
  '@sarahs.ipodnano': { tiktok: '697b3cac77637c5c857cc26b', instagram: '697b3d2477637c5c857cc272' },
  '@margiela.mommy': { tiktok: '697b3dbb77637c5c857cc279', instagram: '697b3e2a77637c5c857cc284' },
  '@yumabestfriend': { tiktok: '697b3ea177637c5c857cc2c0', instagram: '697b448877637c5c857cc458' },
  '@hedislimanerickowens': { tiktok: '697b3f8f77637c5c857cc332', instagram: '697b400977637c5c857cc35d' },
  '@princessvamp2016': { tiktok: '697b40e677637c5c857cc37a', instagram: '697b413c77637c5c857cc384' },
  '@2016iscalling': { tiktok: '697b41dc77637c5c857cc38a', instagram: '697b421c77637c5c857cc38b' },
  '@xxshadowskiesxx': { tiktok: '697b42b377637c5c857cc3ad', instagram: '697b42f277637c5c857cc3c9' },
  '@neonphoebe': { tiktok: '697b43be77637c5c857cc41c', instagram: '697b442777637c5c857cc447' }
};

// Late API Functions - now using secure serverless proxy
const lateApi = {
  async fetchAccounts() {
    try {
      const response = await fetch(`${LATE_API_PROXY}?action=accounts`);
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      const data = await response.json();
      // Handle different response formats
      const accounts = data.accounts || data.data || (Array.isArray(data) ? data : []);
      return { success: true, accounts };
    } catch (error) {
      console.error('Late API error:', error);
      return { success: false, error: error.message };
    }
  },

  async schedulePost({ platforms, caption, videoUrl, scheduledFor }) {
    try {
      // Format matches Late's expected structure - both platforms in one call
      const payload = {
        action: 'posts',
        content: caption,
        mediaItems: [{ type: 'video', url: videoUrl }],
        platforms: platforms.map(p => ({
          platform: p.platform,
          accountId: p.accountId,
          customContent: caption,
          scheduledFor
        })),
        scheduledFor,
        timezone: 'America/Los_Angeles'
      };

      console.log('Sending to Late:', JSON.stringify(payload, null, 2));

      const response = await fetch(LATE_API_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed: ${response.status}`);
      }
      return { success: true, post: await response.json() };
    } catch (error) {
      console.error('Late API error:', error);
      return { success: false, error: error.message };
    }
  },

  async fetchScheduledPosts() {
    try {
      // Fetch all pages of posts
      let allPosts = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(`${LATE_API_PROXY}?action=posts&page=${page}`);
        if (!response.ok) throw new Error(`Failed: ${response.status}`);
        const data = await response.json();
        const posts = data.posts || data || [];

        if (Array.isArray(posts) && posts.length > 0) {
          allPosts = [...allPosts, ...posts];
          page++;
          // Stop if we got fewer than the limit (last page)
          if (posts.length < 50) hasMore = false;
        } else {
          hasMore = false;
        }

        // Safety limit to prevent infinite loops
        if (page > 20) hasMore = false;
      }

      return { success: true, posts: allPosts };
    } catch (error) {
      console.error('Late API error:', error);
      return { success: false, error: error.message };
    }
  },

  async deletePost(postId) {
    try {
      const response = await fetch(`${LATE_API_PROXY}?action=delete&postId=${postId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${response.status}`);
      }
      return { success: true };
    } catch (error) {
      console.error('Late API error:', error);
      return { success: false, error: error.message };
    }
  }
};

// Campaign data structure - starts empty, campaigns are created via the UI
const CAMPAIGNS_DATA = [];

const StickToMusic = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [openFaq, setOpenFaq] = useState(null);

  // Authentication state
  const [user, setUser] = useState(null); // { email, role, name, artistId }
  const [currentAuthUser, setCurrentAuthUser] = useState(null); // Firebase auth user object
  const [authChecked, setAuthChecked] = useState(false); // True once initial auth check completes
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '', error: null });
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupForm, setSignupForm] = useState({ email: '', password: '', name: '', role: 'artist', error: null });

  // Firestore data - allowed users loaded from database
  const [allowedUsers, setAllowedUsers] = useState([]);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);

  // Master auth listener - tracks Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      console.log('🔐 Auth state changed:', firebaseUser?.email || 'null');
      setCurrentAuthUser(firebaseUser);
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  // Load allowed users from Firestore (ONLY when authenticated)
  useEffect(() => {
    // Don't subscribe to Firestore until auth is checked
    if (!authChecked) {
      console.log('⏳ Waiting for auth check...');
      return;
    }

    // If not authenticated, set loaded and clear users
    if (!currentAuthUser) {
      console.log('👤 No auth user, skipping Firestore load');
      setFirestoreLoaded(true);
      setAllowedUsers([]);
      return;
    }

    console.log('📥 Loading allowedUsers from Firestore for:', currentAuthUser.email);
    const unsubscribe = onSnapshot(
      collection(db, 'allowedUsers'),
      (snapshot) => {
        const users = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAllowedUsers(users);
        setFirestoreLoaded(true);
        console.log('✅ Loaded allowed users:', users.length);
      },
      (error) => {
        console.error('❌ Error loading allowed users:', error);
        setFirestoreLoaded(true); // Still set loaded to prevent infinite loading
      }
    );
    return () => unsubscribe();
  }, [authChecked, currentAuthUser]);

  // Set the app-level user state based on currentAuthUser and allowedUsers
  useEffect(() => {
    if (!authChecked || !firestoreLoaded) return;

    if (currentAuthUser) {
      const email = currentAuthUser.email;

      // Check if user is allowed (operators always allowed)
      if (OPERATOR_EMAILS.includes(email?.toLowerCase())) {
        const newUser = {
          email: email,
          role: 'operator',
          name: currentAuthUser.displayName || email.split('@')[0],
          artistId: null
        };
        console.log('👑 Setting operator user:', newUser);
        setUser(newUser);
      } else if (allowedUsers.some(u => u.email?.toLowerCase() === email?.toLowerCase() && u.status === 'active')) {
        const userData = allowedUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
        const newUser = {
          email: email,
          role: userData?.role || 'artist',
          name: userData?.name || currentAuthUser.displayName || email.split('@')[0],
          artistId: userData?.artistId || null
        };
        console.log('🎨 Setting allowed user:', newUser);
        setUser(newUser);
      } else {
        console.log('🚫 User not in allowed list:', email);
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, [authChecked, firestoreLoaded, currentAuthUser, allowedUsers]);

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
          console.log('Loaded applications from Firestore:', apps.length);
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
    if (OPERATOR_EMAILS.includes(normalizedEmail)) {
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
    if (OPERATOR_EMAILS.includes(email?.toLowerCase())) return 'operator';
    return 'artist';
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

  // Campaign management state
  const [campaigns, setCampaigns] = useState(CAMPAIGNS_DATA);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    startDate: '',
    endDate: '',
    budget: '',
    categories: [],
    goalViews: '',
    goalFollowers: ''
  });

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
      description: 'View and manage all your artists here. See their stats, pages, and campaign progress.',
      target: 'artists'
    },
    {
      title: 'Content Tab',
      description: 'Schedule and manage posts across all world pages. Sync with Late to see scheduled content.',
      target: 'content'
    },
    {
      title: 'Applications Tab',
      description: 'Review new artist applications, approve them, and send payment links.',
      target: 'applications'
    },
    {
      title: 'You\'re all set! 🚀',
      description: 'Start by clicking "Sync from Late" in the Content tab to load your scheduled posts.',
      target: null
    }
  ];

  const completeOnboarding = () => {
    localStorage.setItem('stm_onboarding_complete', 'true');
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

  // Operator dashboard state
  const [operatorTab, setOperatorTab] = useState('artists');
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState('all');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [contentArtist, setContentArtist] = useState('all');
  const [contentStatus, setContentStatus] = useState('all');

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
  const [contentView, setContentView] = useState('list'); // 'list' or 'calendar'
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);

  // Bulk selection state
  const [selectedPosts, setSelectedPosts] = useState(new Set());

  // UI-12/13: Day detail drawer state
  const [dayDetailDrawer, setDayDetailDrawer] = useState({ isOpen: false, date: null, posts: [] });
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  // Bulk delete posts
  const handleBulkDelete = async () => {
    if (selectedPosts.size === 0) return;

    const confirmDelete = window.confirm(`Delete ${selectedPosts.size} selected post(s)?`);
    if (!confirmDelete) return;

    setBulkDeleting(true);
    const deletedPosts = latePosts.filter(p => selectedPosts.has(p.id));
    let successCount = 0;
    let failCount = 0;

    for (const postId of selectedPosts) {
      const result = await lateApi.deletePost(postId);
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
          showToast('Please sync from Late to restore', 'info');
        }
      );
    }

    // Refresh posts
    const result = await lateApi.fetchScheduledPosts();
    if (result.success) {
      setLatePosts(result.posts || []);
    }
  };

  // Loading states for better UX
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

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
      const userCredential = await signInWithEmailAndPassword(
        auth,
        loginForm.email,
        loginForm.password
      );
      const email = userCredential.user.email;

      // Check whitelist
      if (!isEmailAllowed(email)) {
        await signOut(auth);
        setLoginForm(prev => ({ ...prev, error: 'Access denied. Please contact us to get access.' }));
        setIsLoggingIn(false);
        return;
      }

      const role = getUserRole(email);
      const artistInfo = getArtistInfo(email);

      setUser({
        email: email,
        role: role,
        name: userCredential.user.displayName || artistInfo?.name || email.split('@')[0],
        artistId: artistInfo?.artistId || null
      });
      setShowLoginModal(false);
      setLoginForm({ email: '', password: '', error: null });
      showToast(`Welcome back!`, 'success');

      // Redirect based on role
      if (role === 'artist') {
        setCurrentPage('artist-portal');
      } else {
        setCurrentPage('operator');
      }
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

      // Check whitelist
      if (!isEmailAllowed(email)) {
        await signOut(auth);
        setLoginForm(prev => ({ ...prev, error: 'Access denied. Please contact us to get access.' }));
        setShowLoginModal(true);
        setShowSignupModal(false);
        setIsLoggingIn(false);
        return;
      }

      const role = getUserRole(email);
      const artistInfo = getArtistInfo(email);

      setUser({
        email: email,
        role: role,
        name: result.user.displayName || email.split('@')[0],
        artistId: artistInfo?.artistId || null
      });
      setShowLoginModal(false);
      setShowSignupModal(false);
      showToast(`Welcome, ${result.user.displayName || 'there'}!`, 'success');

      if (role === 'artist') {
        setCurrentPage('artist-portal');
      } else {
        setCurrentPage('operator');
      }
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
        name: artistInfo?.name || signupForm.name,
        artistId: artistInfo?.artistId || null
      });
      setShowSignupModal(false);
      setSignupForm({ email: '', password: '', name: '', role: 'artist', error: null });
      showToast(`Welcome to StickToMusic, ${artistInfo?.name || signupForm.name}!`, 'success');

      if (role === 'artist') {
        setCurrentPage('artist-portal');
      } else {
        setCurrentPage('operator');
      }
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
      setCurrentPage('home');
      showToast('Logged out successfully', 'success');
    } catch (error) {
      console.error('Logout error:', error);
      showToast('Logout failed', 'error');
    }
  };

  // Campaign functions
  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    setIsCreatingCampaign(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    const newCampaign = {
      id: `camp-${Date.now()}`,
      artistId: user?.artistId || 'boon',
      name: campaignForm.name,
      status: 'planning',
      startDate: campaignForm.startDate,
      endDate: campaignForm.endDate,
      budget: parseFloat(campaignForm.budget) || 0,
      spent: 0,
      postsScheduled: 0,
      postsPublished: 0,
      categories: campaignForm.categories,
      goals: {
        views: parseInt(campaignForm.goalViews) || 0,
        followers: parseInt(campaignForm.goalFollowers) || 0
      },
      achieved: { views: 0, followers: 0 }
    };
    setCampaigns(prev => [...prev, newCampaign]);
    setShowCampaignModal(false);
    setCampaignForm({ name: '', startDate: '', endDate: '', budget: '', categories: [], goalViews: '', goalFollowers: '' });
    showToast('Campaign created successfully!', 'success');
    setIsCreatingCampaign(false);
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
    setSyncStatus('Fetching Late accounts...');
    const result = await lateApi.fetchAccounts();
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
      detail: "Perfect for indie artists or anyone wanting to test the world page approach before committing to a larger campaign.",
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
      description: "Major campaigns",
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
        "Rollout planning & campaign calendar",
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
    { month: "November 2024", status: "available", highlights: "Campaign launch" }
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

  const worldPages = [
    // Boon - 8 real accounts
    { id: 1, handle: "@sarahs.ipodnano", platform: "tiktok", artist: "Boon", niche: "Fashion", followers: 42000, views: 890000, status: "active", postTime: "14:00" },
    { id: 2, handle: "@sarahs.ipodnano", platform: "instagram", artist: "Boon", niche: "Fashion", followers: 38000, views: 340000, status: "active", postTime: "14:00" },
    { id: 3, handle: "@margiela.mommy", platform: "tiktok", artist: "Boon", niche: "Fashion", followers: 67000, views: 1200000, status: "active", postTime: "15:00" },
    { id: 4, handle: "@margiela.mommy", platform: "instagram", artist: "Boon", niche: "Fashion", followers: 53000, views: 980000, status: "active", postTime: "15:00" },
    { id: 5, handle: "@yumabestfriend", platform: "tiktok", artist: "Boon", niche: "EDM", followers: 38000, views: 620000, status: "active", postTime: "16:00" },
    { id: 6, handle: "@yumabestfriend", platform: "instagram", artist: "Boon", niche: "EDM", followers: 24000, views: 290000, status: "active", postTime: "16:00" },
    { id: 7, handle: "@hedislimanerickowens", platform: "tiktok", artist: "Boon", niche: "Runway", followers: 71000, views: 1450000, status: "active", postTime: "17:00" },
    { id: 8, handle: "@hedislimanerickowens", platform: "instagram", artist: "Boon", niche: "Runway", followers: 45000, views: 870000, status: "active", postTime: "17:00" },
    { id: 9, handle: "@princessvamp2016", platform: "tiktok", artist: "Boon", niche: "Fashion", followers: 31000, views: 410000, status: "active", postTime: "18:00" },
    { id: 10, handle: "@princessvamp2016", platform: "instagram", artist: "Boon", niche: "Fashion", followers: 28000, views: 380000, status: "active", postTime: "18:00" },
    { id: 11, handle: "@2016iscalling", platform: "tiktok", artist: "Boon", niche: "Fashion", followers: 58000, views: 1100000, status: "active", postTime: "19:00" },
    { id: 12, handle: "@2016iscalling", platform: "instagram", artist: "Boon", niche: "Fashion", followers: 44000, views: 720000, status: "active", postTime: "19:00" },
    { id: 13, handle: "@xxshadowskiesxx", platform: "tiktok", artist: "Boon", niche: "EDM", followers: 89000, views: 2100000, status: "active", postTime: "20:00" },
    { id: 14, handle: "@xxshadowskiesxx", platform: "instagram", artist: "Boon", niche: "EDM", followers: 62000, views: 1400000, status: "active", postTime: "20:00" },
    { id: 15, handle: "@neonphoebe", platform: "tiktok", artist: "Boon", niche: "Fashion", followers: 112000, views: 3400000, status: "active", postTime: "21:00" },
    { id: 16, handle: "@neonphoebe", platform: "instagram", artist: "Boon", niche: "Fashion", followers: 78000, views: 1800000, status: "active", postTime: "21:00" },
  ];

  // Content Banks - hashtags and captions per aesthetic category
  const [contentBanks, setContentBanks] = useState({
    Fashion: {
      hashtags: {
        always: ['#fashion', '#style', '#aesthetic'],
        pool: ['#ootd', '#archive', '#vibes', '#mood', '#runway', '#designer', '#vintage', '#y2k', '#grunge', '#minimalist', '#streetwear', '#haute']
      },
      captions: {
        always: [],
        pool: ['mood', 'vibe', 'forever', 'dreaming', '✨', 'archive', 'aesthetic', 'core', 'obsessed', 'iconic', 'serving', 'the blueprint']
      }
    },
    EDM: {
      hashtags: {
        always: ['#edm', '#music', '#electronic'],
        pool: ['#rave', '#bass', '#dubstep', '#house', '#techno', '#festival', '#dj', '#beats', '#wub', '#plur', '#underground']
      },
      captions: {
        always: [],
        pool: ['wub', 'wub wub', '<3', 'dancedancedance', 'bass drop', 'feel it', '🖤', 'lost in sound', 'the drop', 'vibrations']
      }
    },
    Runway: {
      hashtags: {
        always: ['#runway', '#fashion', '#couture'],
        pool: ['#highfashion', '#model', '#designer', '#fashionweek', '#avantgarde', '#editorial', '#vogue', '#luxury', '#catwalk', '#style']
      },
      captions: {
        always: [],
        pool: ['walk', 'serve', 'iconic', 'the moment', 'couture', 'editorial', 'pretty', 'elegance', 'grace', 'timeless']
      }
    },
    'Romantic/Soft': {
      hashtags: {
        always: ['#aesthetic', '#dreamy', '#soft'],
        pool: ['#romantic', '#ethereal', '#gentle', '#pastel', '#love', '#tender', '#serene', '#delicate', '#whimsical']
      },
      captions: {
        always: [],
        pool: ['dreaming', 'soft', 'gentle', '🤍', 'floating', 'whisper', 'tender', 'in bloom', 'softly', 'daydream']
      }
    },
    'Ethereal/Dreamy': {
      hashtags: {
        always: ['#ethereal', '#dreamy', '#aesthetic'],
        pool: ['#celestial', '#mystical', '#fairycore', '#angelic', '#heavenly', '#magical', '#otherworldly', '#fantasy']
      },
      captions: {
        always: [],
        pool: ['floating', 'celestial', 'otherworldly', '✧', 'dreamscape', 'beyond', 'transcend', 'ethereal', 'magic']
      }
    }
  });

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

  const contentQueue = [
    // Boon - Jan 31 posts
    { id: 1, artist: "Boon", page: "@sarahs.ipodnano", platform: "tiktok", type: "Video", song: "Late", caption: "4:3, winter mood ✨", scheduledFor: "2026-01-31 14:00", status: "scheduled" },
    { id: 2, artist: "Boon", page: "@sarahs.ipodnano", platform: "instagram", type: "Reel", song: "Late", caption: "4:3, winter mood ✨", scheduledFor: "2026-01-31 14:00", status: "scheduled" },
    { id: 3, artist: "Boon", page: "@margiela.mommy", platform: "tiktok", type: "Video", song: "Late", caption: "we're forever.", scheduledFor: "2026-01-31 15:00", status: "scheduled" },
    { id: 4, artist: "Boon", page: "@margiela.mommy", platform: "instagram", type: "Reel", song: "Late", caption: "we're forever.", scheduledFor: "2026-01-31 15:00", status: "scheduled" },
    { id: 5, artist: "Boon", page: "@yumabestfriend", platform: "tiktok", type: "Video", song: "Late", caption: "wub 🖤", scheduledFor: "2026-01-31 16:00", status: "scheduled" },
    { id: 6, artist: "Boon", page: "@yumabestfriend", platform: "instagram", type: "Reel", song: "Late", caption: "wub 🖤", scheduledFor: "2026-01-31 16:00", status: "scheduled" },
    { id: 7, artist: "Boon", page: "@hedislimanerickowens", platform: "tiktok", type: "Video", song: "Late", caption: "electroclash clean girl", scheduledFor: "2026-01-31 17:00", status: "scheduled" },
    { id: 8, artist: "Boon", page: "@hedislimanerickowens", platform: "instagram", type: "Reel", song: "Late", caption: "electroclash clean girl", scheduledFor: "2026-01-31 17:00", status: "scheduled" },
    { id: 9, artist: "Boon", page: "@princessvamp2016", platform: "tiktok", type: "Video", song: "Late", caption: "mood", scheduledFor: "2026-01-31 18:00", status: "scheduled" },
    { id: 10, artist: "Boon", page: "@princessvamp2016", platform: "instagram", type: "Reel", song: "Late", caption: "mood", scheduledFor: "2026-01-31 18:00", status: "scheduled" },
    { id: 11, artist: "Boon", page: "@2016iscalling", platform: "tiktok", type: "Video", song: "Late", caption: "archive", scheduledFor: "2026-01-31 19:00", status: "scheduled" },
    { id: 12, artist: "Boon", page: "@2016iscalling", platform: "instagram", type: "Reel", song: "Late", caption: "archive", scheduledFor: "2026-01-31 19:00", status: "scheduled" },
    { id: 13, artist: "Boon", page: "@xxshadowskiesxx", platform: "tiktok", type: "Video", song: "Late", caption: "dancedancedance <3", scheduledFor: "2026-01-31 20:00", status: "scheduled" },
    { id: 14, artist: "Boon", page: "@xxshadowskiesxx", platform: "instagram", type: "Reel", song: "Late", caption: "dancedancedance <3", scheduledFor: "2026-01-31 20:00", status: "scheduled" },
    { id: 15, artist: "Boon", page: "@neonphoebe", platform: "tiktok", type: "Video", song: "Late", caption: "vibe ✨", scheduledFor: "2026-01-31 21:00", status: "scheduled" },
    { id: 16, artist: "Boon", page: "@neonphoebe", platform: "instagram", type: "Reel", song: "Late", caption: "vibe ✨", scheduledFor: "2026-01-31 21:00", status: "scheduled" },
    // Feb 1 posts
    { id: 17, artist: "Boon", page: "@sarahs.ipodnano", platform: "tiktok", type: "Video", song: "Late", caption: "aesthetic", scheduledFor: "2026-02-01 14:00", status: "scheduled" },
    { id: 18, artist: "Boon", page: "@sarahs.ipodnano", platform: "instagram", type: "Reel", song: "Late", caption: "aesthetic", scheduledFor: "2026-02-01 14:00", status: "scheduled" },
    { id: 19, artist: "Boon", page: "@margiela.mommy", platform: "tiktok", type: "Video", song: "Late", caption: "forever", scheduledFor: "2026-02-01 15:00", status: "scheduled" },
    { id: 20, artist: "Boon", page: "@margiela.mommy", platform: "instagram", type: "Reel", song: "Late", caption: "forever", scheduledFor: "2026-02-01 15:00", status: "scheduled" },
    { id: 21, artist: "Boon", page: "@yumabestfriend", platform: "tiktok", type: "Video", song: "Late", caption: "wub wub", scheduledFor: "2026-02-01 16:00", status: "scheduled" },
    { id: 22, artist: "Boon", page: "@yumabestfriend", platform: "instagram", type: "Reel", song: "Late", caption: "wub wub", scheduledFor: "2026-02-01 16:00", status: "scheduled" },
    { id: 23, artist: "Boon", page: "@hedislimanerickowens", platform: "tiktok", type: "Video", song: "Late", caption: "pretty", scheduledFor: "2026-02-01 17:00", status: "scheduled" },
    { id: 24, artist: "Boon", page: "@hedislimanerickowens", platform: "instagram", type: "Reel", song: "Late", caption: "pretty", scheduledFor: "2026-02-01 17:00", status: "scheduled" },
    { id: 25, artist: "Boon", page: "@princessvamp2016", platform: "tiktok", type: "Video", song: "Late", caption: "dreaming", scheduledFor: "2026-02-01 18:00", status: "scheduled" },
    { id: 26, artist: "Boon", page: "@princessvamp2016", platform: "instagram", type: "Reel", song: "Late", caption: "dreaming", scheduledFor: "2026-02-01 18:00", status: "scheduled" },
    { id: 27, artist: "Boon", page: "@2016iscalling", platform: "tiktok", type: "Video", song: "Late", caption: "core", scheduledFor: "2026-02-01 19:00", status: "scheduled" },
    { id: 28, artist: "Boon", page: "@2016iscalling", platform: "instagram", type: "Reel", song: "Late", caption: "core", scheduledFor: "2026-02-01 19:00", status: "scheduled" },
    { id: 29, artist: "Boon", page: "@xxshadowskiesxx", platform: "tiktok", type: "Video", song: "Late", caption: "<3", scheduledFor: "2026-02-01 20:00", status: "scheduled" },
    { id: 30, artist: "Boon", page: "@xxshadowskiesxx", platform: "instagram", type: "Reel", song: "Late", caption: "<3", scheduledFor: "2026-02-01 20:00", status: "scheduled" },
    { id: 31, artist: "Boon", page: "@neonphoebe", platform: "tiktok", type: "Video", song: "Late", caption: "inspo", scheduledFor: "2026-02-01 21:00", status: "scheduled" },
    { id: 32, artist: "Boon", page: "@neonphoebe", platform: "instagram", type: "Reel", song: "Late", caption: "inspo", scheduledFor: "2026-02-01 21:00", status: "scheduled" },
  ];

  // Applications state - stores intake form submissions (starts empty)
  const [applications, setApplications] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);

  // Stripe Payment Link - You can create this in Stripe Dashboard
  // Go to: Stripe Dashboard > Products > + Add Product > Create a Payment Link
  const STRIPE_PAYMENT_LINK_BASE = 'https://buy.stripe.com/'; // Add your payment link here

  // Handle application approval - shows payment modal
  const handleApproveApplication = (app) => {
    setSelectedApplication(app);
    setShowPaymentModal(true);
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

      await addDoc(collection(db, 'allowedUsers'), artistProfile);
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

  // Helper to get social media URLs for posts
  const getPostUrls = (post) => {
    const urls = [];
    const platforms = post.platforms || [];

    platforms.forEach(p => {
      const platform = p.platform || p;
      // Get username from accountId object (Late API returns accountId as object with username)
      const username = p.accountId?.username || p.accountId?.displayName;

      // Priority 1: Direct post URL from Late (Instagram has this for published posts)
      if (p.platformPostUrl) {
        urls.push({
          platform,
          url: p.platformPostUrl,
          label: platform === 'tiktok' ? 'TikTok' : 'IG',
          isActualPost: true
        });
        return;
      }

      // Priority 2: Construct URL from platformPostId + username
      if (p.platformPostId && username && p.status === 'published') {
        if (platform === 'tiktok') {
          // Late returns TikTok IDs like "v_pub_url~v2-1.7602051149071468575"
          // Extract the numeric video ID after the last dot or use as-is if numeric
          let videoId = p.platformPostId;
          if (videoId.includes('.')) {
            videoId = videoId.split('.').pop();
          }
          // Only use if it looks like a valid TikTok video ID (numeric, 19 digits)
          if (/^\d{15,}$/.test(videoId)) {
            urls.push({
              platform: 'tiktok',
              url: `https://www.tiktok.com/@${username}/video/${videoId}`,
              label: 'TikTok',
              isActualPost: true
            });
            return;
          }
        } else if (platform === 'instagram') {
          urls.push({
            platform: 'instagram',
            url: `https://www.instagram.com/reel/${p.platformPostId}/`,
            label: 'IG',
            isActualPost: true
          });
          return;
        }
      }

      // Priority 3: Link to profile if we have username
      if (username) {
        if (platform === 'tiktok') {
          urls.push({ platform: 'tiktok', url: `https://tiktok.com/@${username}`, label: 'TT', isActualPost: false });
        } else if (platform === 'instagram') {
          urls.push({ platform: 'instagram', url: `https://instagram.com/${username}`, label: 'IG', isActualPost: false });
        }
        return;
      }

      // Priority 4: Fallback to our local account ID mapping
      const accountIdStr = typeof p.accountId === 'string' ? p.accountId : p.accountId?._id;
      const handleEntry = Object.entries(LATE_ACCOUNT_IDS).find(([handle, ids]) =>
        ids.tiktok === accountIdStr || ids.instagram === accountIdStr
      );
      if (handleEntry) {
        const handle = handleEntry[0].replace('@', '');
        if (platform === 'tiktok') {
          urls.push({ platform: 'tiktok', url: `https://tiktok.com/@${handle}`, label: 'TT', isActualPost: false });
        } else if (platform === 'instagram') {
          urls.push({ platform: 'instagram', url: `https://instagram.com/${handle}`, label: 'IG', isActualPost: false });
        }
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
    console.log('Form submitted:', formData);
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

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
                <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
                  {user.name[0]}
                </div>
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
              className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold"
            >
              {user.name[0]}
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

  // INTAKE FORM PAGE
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
                  <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Stream count correlation with campaigns</li>
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
              <RadioGroup label="Campaign duration" field="duration" required options={[
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

  // ARTIST PORTAL PAGE
  if (currentPage === 'artist-portal') {
    const artistCampaigns = campaigns.filter(c => c.artistId === user?.artistId || c.artistId === 'boon');
    const activeCampaign = artistCampaigns.find(c => c.status === 'active') || artistCampaigns[0];

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
                        const result = await lateApi.fetchScheduledPosts();
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
                <h3 className="font-semibold mb-4">Quick Actions</h3>
                <div className="space-y-2">
                  <button className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-left transition">
                    📊 Download Report
                  </button>
                  <button className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-left transition">
                    📧 Contact Manager
                  </button>
                  <button className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-left transition">
                    📁 Upload Content
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // OPERATOR DASHBOARD PAGE
  // P0 SECURITY: Guard against non-operators accessing this page
  if (currentPage === 'operator') {
    // INVARIANT: Operator page requires operator role
    if (!isUserOperator(user)) {
      console.warn('[ROLE VIOLATION] Non-operator attempted to access operator dashboard');
      // Redirect to appropriate page
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
            <p className="text-zinc-400 mb-6">This page is only accessible to operators.</p>
            <button
              onClick={() => setCurrentPage(user?.role === 'artist' ? 'artist-portal' : 'home')}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg transition"
            >
              Go Back
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-6">
                <button onClick={() => setCurrentPage(user ? (user.role === 'artist' ? 'artist-portal' : 'operator') : 'home')} className="text-xl font-bold hover:text-zinc-300 transition">StickToMusic</button>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400">Operator Dashboard</span>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setOperatorTab('settings')}
                  className="p-2 text-zinc-500 hover:text-white transition rounded-lg hover:bg-zinc-800"
                  aria-label="Settings"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-sm font-bold">
                    {user?.name?.[0] || 'O'}
                  </div>
                  <span className="text-sm text-zinc-400 hidden md:inline">{user?.name || 'Operator'}</span>
                </div>
                <button onClick={handleLogout} className="text-sm text-zinc-500 hover:text-white transition">Log out</button>
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
          {/* Tab Navigation */}
          <div className="flex gap-2 mb-8 border-b border-zinc-800 pb-4 overflow-x-auto">
            {['artists', 'pages', 'content', 'campaigns', 'banks'].map(tab => (
              <button
                key={tab}
                onClick={() => setOperatorTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  operatorTab === tab ? 'bg-white text-black' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            {/* Video Editor - opens modal */}
            <button
              onClick={() => setShowVideoEditor(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap text-zinc-400 hover:text-white hover:bg-zinc-900"
            >
              Video Editor
            </button>
            {['applications', 'settings'].map(tab => (
              <button
                key={tab}
                onClick={() => setOperatorTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  operatorTab === tab ? 'bg-white text-black' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                {tab === 'settings' ? '⚙️ Settings' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Artists Tab */}
          {operatorTab === 'artists' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-bold">Artists</h1>
                  <p className="text-sm text-zinc-500">{operatorArtists.length} active artist{operatorArtists.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {operatorArtists.length === 0 ? (
                <SharedEmptyState
                  icon="🎵"
                  title="No artists yet"
                  description="Artists will appear here once they're onboarded to the platform."
                  actionLabel="Review Applications"
                  onAction={() => setOperatorTab('applications')}
                />
              ) : operatorArtists.map((artist) => (
                <div key={artist.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-lg font-bold">
                        {artist.name[0]}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">{artist.name}</h3>
                        <div className="flex gap-2 text-sm text-zinc-500">
                          <span>{artist.tier}</span>
                          {artist.cdTier && <><span>•</span><span>{artist.cdTier}</span></>}
                          <span>•</span>
                          <span>Since {artist.activeSince}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">{artist.totalPages}</p>
                        <p className="text-xs text-zinc-500">Pages</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{formatNumber(artist.metrics.views)}</p>
                        <p className="text-xs text-zinc-500">Views</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{artist.metrics.rate}%</p>
                        <p className="text-xs text-zinc-500">Eng. Rate</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs ${getStatusColor(artist.status)}`}>
                        {artist.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pages Tab */}
          {operatorTab === 'pages' && (() => {
            const filteredPages = worldPages.filter(p =>
              (selectedArtist === 'all' || p.artist === selectedArtist) &&
              (selectedPlatform === 'all' || p.platform === selectedPlatform)
            );
            // Group by artist for display
            const artistsWithPages = operatorArtists.filter(a =>
              selectedArtist === 'all' || a.name === selectedArtist
            );

            return (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h1 className="text-2xl font-bold">Pages</h1>
                    <p className="text-sm text-zinc-500">{filteredPages.length} connected page{filteredPages.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex gap-4 mb-6">
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Artist</label>
                    <div className="flex gap-1">
                      <button onClick={() => setSelectedArtist('all')} className={`px-3 py-1.5 rounded-lg text-sm transition ${selectedArtist === 'all' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>All</button>
                      {operatorArtists.map(a => (
                        <button key={a.id} onClick={() => setSelectedArtist(a.name)} className={`px-3 py-1.5 rounded-lg text-sm transition ${selectedArtist === a.name ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>{a.name}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Platform</label>
                    <div className="flex gap-1">
                      {['all', 'tiktok', 'instagram'].map(p => (
                        <button key={p} onClick={() => setSelectedPlatform(p)} className={`px-3 py-1.5 rounded-lg text-sm transition ${selectedPlatform === p ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}>{p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {filteredPages.length === 0 ? (
                    <SharedEmptyState
                      icon="📱"
                      title="No pages found"
                      description={selectedArtist !== 'all' || selectedPlatform !== 'all'
                        ? "No pages match your current filters. Try adjusting your selection."
                        : "No social pages have been connected yet."}
                      actionLabel={selectedArtist !== 'all' || selectedPlatform !== 'all' ? "Clear Filters" : null}
                      onAction={selectedArtist !== 'all' || selectedPlatform !== 'all' ? () => { setSelectedArtist('all'); setSelectedPlatform('all'); } : null}
                    />
                  ) : artistsWithPages.map(artist => {
                    const artistPages = filteredPages.filter(p => p.artist === artist.name);
                    if (artistPages.length === 0) return null;
                    // Group by handle
                    const grouped = {};
                    artistPages.forEach(page => {
                      if (!grouped[page.handle]) {
                        grouped[page.handle] = { ...page, platforms: [page.platform], totalFollowers: page.followers, totalViews: page.views };
                      } else {
                        grouped[page.handle].platforms.push(page.platform);
                        grouped[page.handle].totalFollowers += page.followers;
                        grouped[page.handle].totalViews += page.views;
                      }
                    });
                    const uniquePages = Object.values(grouped);

                    return (
                      <div key={artist.id}>
                        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">{artist.name}</h3>
                        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-zinc-800">
                                <th className="text-left p-4 text-sm font-medium text-zinc-500">Handle</th>
                                <th className="text-left p-4 text-sm font-medium text-zinc-500">Platforms</th>
                                <th className="text-left p-4 text-sm font-medium text-zinc-500">Niche</th>
                                <th className="text-left p-4 text-sm font-medium text-zinc-500">Followers</th>
                                <th className="text-left p-4 text-sm font-medium text-zinc-500">Views</th>
                                <th className="text-left p-4 text-sm font-medium text-zinc-500">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {uniquePages.map((page) => (
                                <tr key={page.handle} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition">
                                  <td className="p-4 font-mono text-sm">{page.handle}</td>
                                  <td className="p-4">
                                    <div className="flex gap-1">
                                      {page.platforms.map(p => (
                                        <span key={p} className={`px-2 py-0.5 rounded text-xs ${p === 'tiktok' ? 'bg-pink-500/20 text-pink-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                          {p === 'tiktok' ? 'TT' : 'IG'}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="p-4 text-zinc-500 text-sm">{page.niche}</td>
                                  <td className="p-4 text-zinc-300">{formatNumber(page.totalFollowers)}</td>
                                  <td className="p-4 text-zinc-300">{formatNumber(page.totalViews)}</td>
                                  <td className="p-4">
                                    <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(page.status)}`}>{page.status}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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
              return Object.values(grouped).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
            };

            const allPosts = groupPosts(contentQueue.filter(c =>
              (contentStatus === 'all' || c.status === contentStatus) &&
              (contentArtist === 'all' || c.artist === contentArtist)
            ));

            const todayPostsCount = contentQueue.filter(c => c.scheduledFor.startsWith('2026-01-31')).length / 2;

            // Get unique accounts and categories for selected artist
            const artistPages = worldPages.filter(p => p.artist === batchForm.artist);
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
              setSyncStatus('Scheduling posts to Late...');

              let successCount = 0;
              let failCount = 0;
              const errors = [];

              for (const post of generatedSchedule) {
                const scheduledFor = `${post.date}T${post.time}:00`;
                const fullCaption = `${post.caption} ${post.hashtags}`;

                // Get account IDs for this handle
                const accountIds = LATE_ACCOUNT_IDS[post.handle];
                if (!accountIds) {
                  console.error(`No Late account mapping for ${post.handle}`);
                  failCount++;
                  errors.push(`${post.handle}: No account mapping found`);
                  continue;
                }

                // Build platforms array with both TikTok and Instagram
                const platformsPayload = post.platforms
                  .filter(p => accountIds[p]) // Only include platforms that have account IDs
                  .map(p => ({
                    platform: p,
                    accountId: accountIds[p]
                  }));

                if (platformsPayload.length === 0) {
                  failCount++;
                  errors.push(`${post.handle}: No platform accounts found`);
                  continue;
                }

                console.log('Scheduling post:', {
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
                  scheduledFor
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
                alert(`Scheduled ${successCount} ${postWord(successCount)}, ${failCount} failed.\n\nErrors:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`);
              } else {
                setSyncStatus(`✓ ${successCount} ${postWord(successCount)} scheduled!`);
                alert(`${successCount} ${postWord(successCount)} scheduled to Late!\n\n${batchForm.category} category:\n• ${artistCount} artist music ${postWord(artistCount)} (${Math.round(artistCount/generatedSchedule.length*100)}%)\n• ${adjacentCount} adjacent artist ${postWord(adjacentCount)} (${Math.round(adjacentCount/generatedSchedule.length*100)}%)`);
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
              setSyncStatus('Syncing with Late...');
              const result = await lateApi.fetchScheduledPosts();
              setSyncing(false);
              if (result.success) {
                const posts = Array.isArray(result.posts) ? result.posts : [];
                // Log full post structure to understand what Late returns
                if (posts.length > 0) {
                  console.log('📬 Sample Late post structure:', JSON.stringify(posts[0], null, 2));
                  console.log('📬 All post keys:', Object.keys(posts[0]));
                  // Log platform structure specifically
                  if (posts[0].platforms?.length > 0) {
                    console.log('📬 Platform entry:', JSON.stringify(posts[0].platforms[0], null, 2));
                  }
                }
                setLatePosts(posts);
                setLastSynced(new Date());
                const postWord = posts.length === 1 ? 'post' : 'posts';
                setSyncStatus(`✓ Synced ${posts.length} ${postWord} from Late`);
                showToast(`Synced ${posts.length} ${postWord} from Late`, 'success');
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
              const result = await lateApi.deletePost(postId);
              setDeletingPostId(null);
              if (result.success) {
                setLatePosts(prev => prev.filter(p => p._id !== postId));
                showToast('Post deleted successfully', 'success');
              } else {
                showToast(`Failed to delete: ${result.error}`, 'error');
              }
            };

            return (
              <div>
                {/* Page Header */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h1 className="text-2xl font-bold">Schedule</h1>
                    <p className="text-sm text-zinc-500">{latePosts.length} scheduled post{latePosts.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
                    >
                      {syncing ? 'Syncing...' : '🔄 Sync from Late'}
                    </button>
                    <button
                      onClick={() => setShowScheduleModal(true)}
                      className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
                    >
                      + Batch Schedule
                    </button>
                  </div>
                </div>

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
                                  {operatorArtists.map(a => (
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
                                  {categories.map(cat => {
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
                            <div className="bg-zinc-800/50 rounded-xl overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-zinc-700">
                                    <th className="text-left p-3 text-zinc-500 font-medium">Day</th>
                                    <th className="text-left p-3 text-zinc-500 font-medium">Account</th>
                                    <th className="text-left p-3 text-zinc-500 font-medium">Time</th>
                                    <th className="text-left p-3 text-zinc-500 font-medium">Type</th>
                                    <th className="text-left p-3 text-zinc-500 font-medium">Caption</th>
                                    <th className="text-left p-3 text-zinc-500 font-medium">Video</th>
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
                                Schedule {generatedSchedule.length * 2} {generatedSchedule.length * 2 === 1 ? 'Post' : 'Posts'} to Late
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
                        {operatorArtists.map(a => (
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
                        <>↻ Sync from Late</>
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

                {/* Late Accounts Modal */}
                {showLateAccounts && (
                  <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowLateAccounts(false)}>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                      <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                        <h2 className="text-xl font-bold">Connected Accounts</h2>
                        <button onClick={() => setShowLateAccounts(false)} className="text-zinc-500 hover:text-white">✕</button>
                      </div>
                      <div className="p-6 overflow-y-auto max-h-[60vh]">
                        <p className="text-sm text-zinc-500 mb-4">8 accounts connected via Late API:</p>
                        <div className="space-y-3">
                          {Object.entries(LATE_ACCOUNT_IDS).map(([handle, ids]) => (
                            <div key={handle} className="bg-zinc-800 rounded-lg p-4">
                              <p className="font-medium text-white mb-2">{handle}</p>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 bg-pink-500/20 text-pink-400 rounded">TikTok</span>
                                  <code className="text-zinc-400 truncate">{ids.tiktok}</code>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">Instagram</span>
                                  <code className="text-zinc-400 truncate">{ids.instagram}</code>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 pt-4 border-t border-zinc-700">
                          <p className="text-xs text-zinc-500">Total: 16 platform connections (8 TikTok + 8 Instagram)</p>
                        </div>
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
                      <span className="text-xs text-zinc-500 ml-2">Click "Sync from Late" to load posts</span>
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
                    <div className="flex bg-zinc-800 rounded-lg p-1">
                      {['all', 'tiktok', 'instagram'].map(platform => (
                        <button
                          key={platform}
                          onClick={() => setPostPlatformFilter(platform)}
                          className={`px-3 py-1.5 rounded-md text-sm transition ${
                            postPlatformFilter === platform
                              ? platform === 'tiktok' ? 'bg-pink-500/20 text-pink-400'
                              : platform === 'instagram' ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-zinc-700 text-white'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {platform === 'all' ? 'All' : platform === 'tiktok' ? 'TikTok' : 'Instagram'}
                        </button>
                      ))}
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
                        <p className="text-zinc-500 text-xs mb-1">{hasFilters ? 'Filtered Posts' : 'From Late API'}</p>
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
                        <p className="text-zinc-500 text-xs mb-1">Late Status</p>
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

                  const sortedDates = Object.keys(postsByDate).sort();

                  return (
                    <div className="space-y-4">
                      {sortedDates.length === 0 ? (
                        <SharedEmptyState
                          icon="📅"
                          title="No posts scheduled"
                          description={postSearch || postPlatformFilter !== 'all' ? 'No posts match your filters. Try adjusting your search.' : 'Sync your posts from Late to see your scheduled content timeline.'}
                          actionLabel={!postSearch && postPlatformFilter === 'all' ? 'Sync from Late' : undefined}
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
                                          {(post.platforms || []).map(p => (
                                            <span key={p.platform || p} className={`px-2 py-0.5 rounded text-xs ${(p.platform || p) === 'tiktok' ? 'bg-pink-500/20 text-pink-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                              {(p.platform || p) === 'tiktok' ? 'TikTok' : 'Instagram'}
                                            </span>
                                          ))}
                                        </div>
                                        <p className="text-sm text-zinc-300 mt-1 max-w-md truncate">{post.content || 'No caption'}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {getPostUrls(post).map((pu, idx) => (
                                        <a
                                          key={idx}
                                          href={pu.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`px-2 py-1 rounded text-xs font-medium transition ${
                                            pu.platform === 'tiktok'
                                              ? 'bg-pink-500/20 text-pink-400 hover:bg-pink-500/30'
                                              : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                                          }`}
                                        >
                                          ↗
                                        </a>
                                      ))}
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
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left p-4 text-sm font-medium text-zinc-500">Date & Time</th>
                          <th className="text-left p-4 text-sm font-medium text-zinc-500">Platforms</th>
                          <th className="text-left p-4 text-sm font-medium text-zinc-500">Caption</th>
                          <th className="text-left p-4 text-sm font-medium text-zinc-500">Status</th>
                          <th className="text-left p-4 text-sm font-medium text-zinc-500">View</th>
                          <th className="text-left p-4 text-sm font-medium text-zinc-500">Actions</th>
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
                                    {(post.platforms || []).map((p, i) => (
                                      <span key={i} className={`px-2 py-0.5 rounded text-xs ${(p.platform || p) === 'tiktok' ? 'bg-pink-500/20 text-pink-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                        {(p.platform || p) === 'tiktok' ? 'TT' : 'IG'}
                                      </span>
                                    ))}
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
                                  <div className="flex gap-2">
                                    {getPostUrls(post).length > 0 ? (
                                      getPostUrls(post).map((pu, idx) => (
                                        <a
                                          key={idx}
                                          href={pu.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`px-2 py-1 rounded text-xs font-medium transition ${
                                            pu.platform === 'tiktok'
                                              ? 'bg-pink-500/20 text-pink-400 hover:bg-pink-500/30'
                                              : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                                          }`}
                                        >
                                          View {pu.label}
                                        </a>
                                      ))
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
                                  description={postSearch || postPlatformFilter !== 'all' ? 'No posts match your current filters. Try adjusting your search.' : 'Sync your posts from Late to see your scheduled content.'}
                                  actionLabel={!postSearch && postPlatformFilter === 'all' ? 'Sync from Late' : undefined}
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

          {/* Campaigns Tab */}
          {operatorTab === 'campaigns' && (
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
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-zinc-500 text-xs mb-1">Active Campaigns</p>
                  <p className="text-2xl font-bold text-green-400">{campaigns.filter(c => c.status === 'active').length}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-zinc-500 text-xs mb-1">Total Budget</p>
                  <p className="text-2xl font-bold">${campaigns.reduce((sum, c) => sum + c.budget, 0).toLocaleString()}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-zinc-500 text-xs mb-1">Total Spent</p>
                  <p className="text-2xl font-bold text-purple-400">${campaigns.reduce((sum, c) => sum + c.spent, 0).toLocaleString()}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-zinc-500 text-xs mb-1">Posts Scheduled</p>
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
                    <div key={campaign.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
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
                          <p className="text-sm text-zinc-500">
                            {new Date(campaign.startDate).toLocaleDateString()} - {new Date(campaign.endDate).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {campaign.categories.map(cat => (
                            <span key={cat} className="px-2 py-1 bg-zinc-800 rounded text-xs">{cat}</span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-6">
                        {/* Budget */}
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-zinc-500">Budget</span>
                            <span>${campaign.spent.toLocaleString()} / ${campaign.budget.toLocaleString()}</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full transition-all"
                              style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Views Goal */}
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-zinc-500">Views</span>
                            <span>{(campaign.achieved.views / 1000).toFixed(0)}K / {(campaign.goals.views / 1000).toFixed(0)}K</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${Math.min(viewProgress, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Followers Goal */}
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-zinc-500">Followers</span>
                            <span>{campaign.achieved.followers.toLocaleString()} / {campaign.goals.followers.toLocaleString()}</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full transition-all"
                              style={{ width: `${Math.min(followerProgress, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-between items-center mt-4 pt-4 border-t border-zinc-800">
                        <div className="flex gap-4 text-sm">
                          <span className="text-zinc-500">{campaign.postsScheduled} posts scheduled</span>
                          <span className="text-zinc-500">{campaign.postsPublished} published</span>
                        </div>
                        <button className="text-sm text-purple-400 hover:text-purple-300">View Details →</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* New Campaign Modal */}
              {showCampaignModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowCampaignModal(false)}>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                      <h2 className="text-xl font-bold">New Campaign</h2>
                      <button onClick={() => setShowCampaignModal(false)} className="text-zinc-500 hover:text-white">✕</button>
                    </div>
                    <form onSubmit={handleCreateCampaign} className="p-6 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-2">Campaign Name</label>
                        <input
                          type="text"
                          value={campaignForm.name}
                          onChange={e => setCampaignForm(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                          placeholder="e.g., Boon February Push"
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">Start Date</label>
                          <input
                            type="date"
                            value={campaignForm.startDate}
                            onChange={e => setCampaignForm(prev => ({ ...prev, startDate: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">End Date</label>
                          <input
                            type="date"
                            value={campaignForm.endDate}
                            onChange={e => setCampaignForm(prev => ({ ...prev, endDate: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-2">Budget ($)</label>
                        <input
                          type="number"
                          value={campaignForm.budget}
                          onChange={e => setCampaignForm(prev => ({ ...prev, budget: e.target.value }))}
                          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                          placeholder="5000"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-2">Target Categories</label>
                        <div className="grid grid-cols-3 gap-2">
                          {['Fashion', 'Y2K', 'Emo'].map(cat => (
                            <label
                              key={cat}
                              className={`flex items-center justify-center gap-2 p-3 rounded-lg cursor-pointer transition border ${
                                campaignForm.categories.includes(cat)
                                  ? 'bg-purple-500/20 border-purple-500 text-purple-300'
                                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
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
                          <label className="block text-sm font-medium text-zinc-400 mb-2">Views Goal</label>
                          <input
                            type="number"
                            value={campaignForm.goalViews}
                            onChange={e => setCampaignForm(prev => ({ ...prev, goalViews: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
                            placeholder="500000"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-2">Followers Goal</label>
                          <input
                            type="number"
                            value={campaignForm.goalFollowers}
                            onChange={e => setCampaignForm(prev => ({ ...prev, goalFollowers: e.target.value }))}
                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white"
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

          {/* Content Banks Tab */}
          {operatorTab === 'banks' && (
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

          {/* Applications Tab */}
          {operatorTab === 'applications' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h1 className="text-2xl font-bold">Applications</h1>
                  <p className="text-sm text-zinc-500">{applications.filter(a => a.status === 'pending').length} pending review</p>
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
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
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
                    <div key={app.id} className={`bg-zinc-900 border rounded-xl overflow-hidden ${
                      app.status === 'approved' ? 'border-green-500/30' :
                      app.status === 'declined' ? 'border-red-500/30' : 'border-zinc-800'
                    }`}>
                      <div className="p-6">
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold">{app.name}</h3>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                app.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                                app.status === 'declined' ? 'bg-red-500/20 text-red-400' :
                                app.status === 'pending_payment' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>
                                {app.status === 'pending_payment' ? 'Awaiting Payment' : app.status}
                              </span>
                            </div>
                            <p className="text-zinc-400 text-sm mb-3">{app.email}</p>
                            <div className="flex flex-wrap gap-2 mb-3">
                              <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs">{app.tier}</span>
                              {app.genre && <span className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded text-xs">{app.genre}</span>}
                              {app.vibes && app.vibes.slice(0, 3).map((vibe, i) => (
                                <span key={i} className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded text-xs">{vibe}</span>
                              ))}
                            </div>
                            <div className="text-xs text-zinc-500">
                              Submitted {app.submitted}
                              {app.spotify && <span className="ml-3">• Has Spotify</span>}
                              {app.adjacentArtists && <span className="ml-3">• Provided adjacent artists</span>}
                            </div>
                          </div>
                          {app.status === 'pending' && (
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => handleApproveApplication(app)}
                                className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 transition"
                              >
                                ✓ Approve & Send Payment
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    const appRef = doc(db, 'applications', app.id);
                                    await updateDoc(appRef, {
                                      status: 'declined',
                                      declinedAt: new Date().toISOString()
                                    });
                                    showToast(`${app.name} declined`, 'info');
                                  } catch (error) {
                                    console.error('Error declining application:', error);
                                    // Fallback to local update
                                    setApplications(prev => prev.map(a =>
                                      a.id === app.id ? { ...a, status: 'declined' } : a
                                    ));
                                    showToast(`${app.name} declined`, 'info');
                                  }
                                }}
                                className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition"
                              >
                                ✕ Decline
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
                                className="px-4 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm font-medium hover:bg-zinc-700 transition"
                              >
                                📋 Copy Link
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Expandable details */}
                        {app.projectDescription && (
                          <details className="mt-4 pt-4 border-t border-zinc-800">
                            <summary className="text-sm text-zinc-400 cursor-pointer hover:text-white">View full application details</summary>
                            <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
                              {app.projectType && (
                                <div>
                                  <span className="text-zinc-500">Project Type:</span>
                                  <span className="ml-2 text-zinc-300">{app.projectType}</span>
                                </div>
                              )}
                              {app.cdTier && (
                                <div>
                                  <span className="text-zinc-500">Creative Direction:</span>
                                  <span className="ml-2 text-zinc-300">{app.cdTier}</span>
                                </div>
                              )}
                              {app.duration && (
                                <div>
                                  <span className="text-zinc-500">Duration:</span>
                                  <span className="ml-2 text-zinc-300">{app.duration}</span>
                                </div>
                              )}
                              {app.aestheticWords && (
                                <div className="md:col-span-2">
                                  <span className="text-zinc-500">Aesthetic:</span>
                                  <span className="ml-2 text-zinc-300">{app.aestheticWords}</span>
                                </div>
                              )}
                              {app.adjacentArtists && (
                                <div className="md:col-span-2">
                                  <span className="text-zinc-500">Adjacent Artists:</span>
                                  <span className="ml-2 text-zinc-300">{app.adjacentArtists}</span>
                                </div>
                              )}
                              {app.idealListener && (
                                <div className="md:col-span-2">
                                  <span className="text-zinc-500">Ideal Listener:</span>
                                  <span className="ml-2 text-zinc-300">{app.idealListener}</span>
                                </div>
                              )}
                              {app.projectDescription && (
                                <div className="md:col-span-2">
                                  <span className="text-zinc-500">Project Description:</span>
                                  <p className="mt-1 text-zinc-300">{app.projectDescription}</p>
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

          {/* Settings Tab */}
          {operatorTab === 'settings' && (
            <div className="max-w-2xl">
              <div className="mb-6">
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-sm text-zinc-500">Manage your account and preferences</p>
              </div>

              <div className="space-y-6">
                {/* Account Section */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Account</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-zinc-800">
                      <div>
                        <p className="font-medium">Email</p>
                        <p className="text-sm text-zinc-500">{currentAuthUser?.email || user?.email || 'Loading...'}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-zinc-800">
                      <div>
                        <p className="font-medium">Role</p>
                        <p className="text-sm text-zinc-500 capitalize">{user?.role || 'operator'}</p>
                      </div>
                      <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full text-sm">
                        {user?.role === 'operator' ? 'Admin' : user?.role === 'artist' ? 'Artist' : 'Admin'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notifications Section */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Notifications</h3>
                  <div className="space-y-4">
                    <label className="flex items-center justify-between py-3 border-b border-zinc-800 cursor-pointer">
                      <div>
                        <p className="font-medium">Push Notifications</p>
                        <p className="text-sm text-zinc-500">Get notified about new applications</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.notifications}
                        onChange={(e) => setSettings(prev => ({ ...prev, notifications: e.target.checked }))}
                        className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 text-purple-600 focus:ring-purple-500"
                      />
                    </label>
                    <label className="flex items-center justify-between py-3 border-b border-zinc-800 cursor-pointer">
                      <div>
                        <p className="font-medium">Email Alerts</p>
                        <p className="text-sm text-zinc-500">Receive email for important updates</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.emailAlerts}
                        onChange={(e) => setSettings(prev => ({ ...prev, emailAlerts: e.target.checked }))}
                        className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 text-purple-600 focus:ring-purple-500"
                      />
                    </label>
                  </div>
                </div>

                {/* Late Integration Section */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Late Integration</h3>
                  <div className="space-y-4">
                    <label className="flex items-center justify-between py-3 border-b border-zinc-800 cursor-pointer">
                      <div>
                        <p className="font-medium">Auto-Sync</p>
                        <p className="text-sm text-zinc-500">Automatically sync with Late every hour</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.autoSync}
                        onChange={(e) => setSettings(prev => ({ ...prev, autoSync: e.target.checked }))}
                        className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 text-purple-600 focus:ring-purple-500"
                      />
                    </label>
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium">Connected Accounts</p>
                        <p className="text-sm text-zinc-500">8 accounts connected via Late API</p>
                      </div>
                      <button
                        onClick={() => setShowLateAccounts(true)}
                        className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition"
                      >
                        View Accounts
                      </button>
                    </div>
                  </div>
                </div>

                {/* Timezone Section */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Preferences</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium">Timezone</p>
                        <p className="text-sm text-zinc-500">Used for scheduling posts</p>
                      </div>
                      <select
                        value={settings.timezone}
                        onChange={(e) => setSettings(prev => ({ ...prev, timezone: e.target.value }))}
                        className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
                      >
                        <option value="America/Los_Angeles">Pacific Time (PT)</option>
                        <option value="America/Denver">Mountain Time (MT)</option>
                        <option value="America/Chicago">Central Time (CT)</option>
                        <option value="America/New_York">Eastern Time (ET)</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* User Management Section */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">User Management</h3>
                  <div className="space-y-4">
                    {/* Add New User Form */}
                    <div className="border-b border-zinc-800 pb-4 mb-4">
                      <p className="font-medium mb-3">Add New User</p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const formData = new FormData(e.target);
                          const email = formData.get('newUserEmail')?.trim();
                          const name = formData.get('newUserName')?.trim();
                          if (email && name) {
                            const success = await addUserToAllowed(email, name, 'artist');
                            if (success) {
                              e.target.reset();
                            }
                          } else {
                            showToast('Please enter both email and name', 'error');
                          }
                        }}
                        className="flex flex-col sm:flex-row gap-3"
                      >
                        <input
                          type="email"
                          name="newUserEmail"
                          placeholder="artist@email.com"
                          className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                          required
                        />
                        <input
                          type="text"
                          name="newUserName"
                          placeholder="Artist Name"
                          className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                          required
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition whitespace-nowrap"
                        >
                          Add User
                        </button>
                      </form>
                    </div>

                    {/* User List */}
                    <div>
                      <p className="font-medium mb-3">Allowed Users ({allowedUsers.length})</p>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {allowedUsers.length === 0 ? (
                          <p className="text-sm text-zinc-500 py-2">No users yet. Add one above or wait for Stripe payments.</p>
                        ) : (
                          allowedUsers.map((u) => (
                            <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-zinc-800 rounded-lg">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{u.name}</p>
                                <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                              </div>
                              <div className="flex items-center gap-2 ml-3">
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  u.status === 'active' ? 'bg-green-500/20 text-green-400' :
                                  u.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-zinc-700 text-zinc-400'
                                }`}>
                                  {u.status || 'active'}
                                </span>
                                <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                                  {u.role || 'artist'}
                                </span>
                                {!OPERATOR_EMAILS.includes(u.email?.toLowerCase()) && (
                                  <button
                                    onClick={async () => {
                                      if (window.confirm(`Remove ${u.name} from allowed users?`)) {
                                        try {
                                          const userRef = doc(db, 'allowedUsers', u.id);
                                          await updateDoc(userRef, { status: 'inactive' });
                                          showToast(`${u.name} deactivated`, 'success');
                                        } catch (error) {
                                          console.error('Error deactivating user:', error);
                                          showToast('Failed to deactivate user', 'error');
                                        }
                                      }
                                    }}
                                    className="p-1 text-zinc-500 hover:text-red-400 transition"
                                    title="Deactivate user"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4 text-red-400">Danger Zone</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium">Delete Account</p>
                        <p className="text-sm text-zinc-500">Permanently delete your account and all data</p>
                      </div>
                      <button
                        className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30 transition"
                        onClick={() => showToast('Contact support to delete account', 'info')}
                      >
                        Delete Account
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-zinc-800 mt-12">
          <div className="max-w-7xl mx-auto px-6 py-6 flex justify-between items-center">
            <span className="text-zinc-600 text-sm">StickToMusic Operator © 2025</span>
          </div>
        </footer>

        {/* Video Studio Modal - Flowstage-inspired workflow */}
        {showVideoEditor && (
          <VideoStudio
            onClose={() => setShowVideoEditor(false)}
            artists={operatorArtists.map(a => ({ id: a.id, name: a.name }))}
            lateAccountIds={LATE_ACCOUNT_IDS}
            onSchedulePost={lateApi.schedulePost}
          />
        )}
      </div>
    );
  }

  // DASHBOARD PAGE - Redirect to Artist Portal
  if (currentPage === 'dashboard') {
    // Auto-login as demo artist if not logged in
    if (!user) {
      setUser({ email: 'boon@artist.com', role: 'artist', name: 'Boon', artistId: 'boon' });
    }
    setCurrentPage('artist-portal');
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
                {artistData.tier} plan • {artistData.totalPages} world pages active • Since {artistData.activeSince}
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
            <span className="text-zinc-600 text-sm">StickToMusic © 2025</span>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <Nav />

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
                    { feature: 'Campaign Reports', starter: 'Monthly', standard: 'Bi-weekly', scale: 'Weekly', sensation: 'Daily' },
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
                    <span className="text-xs text-zinc-500">View your campaigns</span>
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
                { label: 'Operator Dashboard', action: () => { setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '⚙️', category: 'Dashboards' },
                { label: 'Artist Portal', action: () => { setCurrentPage('artist-portal'); setShowQuickSearch(false); }, icon: '🎵', category: 'Dashboards' },
                { label: 'Artists Tab', action: () => { setOperatorTab('artists'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '👥', category: 'Operator' },
                { label: 'Pages Tab', action: () => { setOperatorTab('pages'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📱', category: 'Operator' },
                { label: 'Content / Schedule', action: () => { setOperatorTab('content'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📅', category: 'Operator' },
                { label: 'Campaigns', action: () => { setOperatorTab('campaigns'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '🎯', category: 'Operator' },
                { label: 'Content Banks', action: () => { setOperatorTab('banks'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📦', category: 'Operator' },
                { label: 'Applications', action: () => { setOperatorTab('applications'); setCurrentPage('operator'); setShowQuickSearch(false); }, icon: '📋', category: 'Operator' },
                { label: 'New Campaign', action: () => { setShowCampaignModal(true); setCurrentPage('operator'); setOperatorTab('campaigns'); setShowQuickSearch(false); }, icon: '➕', category: 'Actions' },
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
                          {platforms.map(p => (
                            <span key={p} className={`px-2 py-0.5 rounded text-xs ${p === 'tiktok' ? 'bg-pink-500/20 text-pink-400' : 'bg-purple-500/20 text-purple-400'}`}>
                              {p === 'tiktok' ? 'TikTok' : 'Instagram'}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Caption */}
                      <p className="text-sm text-zinc-400 mb-3 line-clamp-3">{post.content || 'No caption'}</p>

                      {/* Status & Actions */}
                      <div className="flex items-center justify-between">
                        <StatusPill status={post.status || 'scheduled'} />
                        <div className="flex gap-2">
                          {getPostUrls(post).map((pu, idx) => (
                            <a
                              key={idx}
                              href={pu.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`px-2 py-1 rounded text-xs font-medium transition ${
                                pu.platform === 'tiktok'
                                  ? 'bg-pink-500/20 text-pink-400 hover:bg-pink-500/30'
                                  : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                              }`}
                            >
                              View ↗
                            </a>
                          ))}
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
              <p className="text-zinc-400 text-center text-sm mb-2">This will remove the post from Late's schedule.</p>
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
    </div>
  );
};

export default StickToMusic;
