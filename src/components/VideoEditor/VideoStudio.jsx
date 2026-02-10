import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AestheticHome from './AestheticHome';
import StudioHome from './StudioHome';
import ContentLibrary from './ContentLibrary';
import VideoEditorModal from './VideoEditorModal';
import BatchPipeline from './BatchPipeline';
import SlideshowEditor from './SlideshowEditor';
import SchedulingPage from './SchedulingPage';
// OnboardingModal removed - auto-setup Music Artist template instead
import { uploadFile, deleteFile, getMediaDuration, generateThumbnail } from '../../services/firebaseStorage';
import {
  saveCategories, loadCategories, savePresets, loadPresets, cleanupStorage,
  saveArtistCategories, loadArtistCategories, saveArtistPresets, loadArtistPresets,
  setLastArtistId, hasLegacyData, migrateToArtistStorage
} from '../../services/storageService';
import {
  getOnboardingStatus,
  completeOnboarding,
  getLibrary,
  getCreatedContent,
  saveCreatedContent,
  addCreatedVideo,
  updateCreatedVideo,
  deleteCreatedVideo,
  addCreatedSlideshow,
  updateCreatedSlideshow,
  deleteCreatedSlideshow,
  addCreatedSlideshowAsync,
  deleteCreatedSlideshowAsync,
  loadCreatedContentAsync,
  saveCreatedContentAsync,
  addLyricsAsync,
  updateLyricsAsync,
  deleteLyricsAsync,
  MEDIA_TYPES,
  STARTER_TEMPLATES
} from '../../services/libraryService';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { updateScheduledPost, deletePostsByContentId } from '../../services/scheduledPostsService';
import { VIDEO_STATUS } from '../../utils/status';
import { useToast, ConfirmDialog } from '../ui';
import log from '../../utils/logger';
import { useTheme } from '../../contexts/ThemeContext';

// Firestore sync helpers for categories - ensures cross-device access
const FIRESTORE_CATEGORY_DOC = 'studioData';

async function saveCategoriesToFirestore(db, artistId, categories) {
  if (!db || !artistId) return;
  try {
    // Strip non-serializable fields (file objects, blob URLs, thumbnails)
    const cleanCategories = categories.map(cat => ({
      id: cat.id,
      artistId: cat.artistId || artistId,
      name: cat.name || '',
      description: cat.description || '',
      accountHandle: cat.accountHandle || '',
      videos: (cat.videos || [])
        .filter(v => v.url && !v.url.startsWith('blob:'))
        .map(({ file, localUrl, thumbnail, ...rest }) => rest),
      audio: (cat.audio || [])
        .filter(a => a.url && !a.url.startsWith('blob:'))
        .map(({ file, localUrl, ...rest }) => rest),
      createdVideos: (cat.createdVideos || []).map(v => ({
        ...v,
        clips: (v.clips || []).map(({ file, localUrl, thumbnail, ...rest }) => rest)
      })),
      imagesA: (cat.imagesA || []).filter(img => img.url && !img.url.startsWith('blob:')),
      imagesB: (cat.imagesB || []).filter(img => img.url && !img.url.startsWith('blob:')),
      slideshows: cat.slideshows || [],
      lyrics: cat.lyrics || [],
      defaultPreset: cat.defaultPreset || null,
      captionTemplate: cat.captionTemplate || '',
      defaultHashtags: cat.defaultHashtags || ''
    }));

    const docRef = doc(db, 'artists', artistId, 'studio', FIRESTORE_CATEGORY_DOC);
    await setDoc(docRef, { categories: cleanCategories, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (error) {
    console.warn('[VideoStudio] Failed to save categories to Firestore:', error.message);
  }
}

async function loadCategoriesFromFirestore(db, artistId) {
  if (!db || !artistId) return null;
  try {
    const docRef = doc(db, 'artists', artistId, 'studio', FIRESTORE_CATEGORY_DOC);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return snapshot.data().categories || null;
    }
    return null;
  } catch (error) {
    console.warn('[VideoStudio] Failed to load categories from Firestore:', error.message);
    return null;
  }
}

// Feature flag: Set to true to use new Library/Collections system
const USE_LIBRARY_SYSTEM = true;

/**
 * ErrorBoundary - Catches errors in VideoEditorModal to prevent blank page crashes
 */
class EditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('VideoEditorModal Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#1a1a2e',
            padding: '32px',
            borderRadius: '12px',
            maxWidth: '500px',
            textAlign: 'center'
          }}>
            <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>Something went wrong</h2>
            <p style={{ color: '#9ca3af', marginBottom: '24px' }}>
              The video editor encountered an error. Please try again.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onClose?.();
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Close Editor
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * VideoStudio - Main container for the Flowstage-inspired video creation workflow
 *
 * Flow:
 * 1. Aesthetic Home - View/manage content banks (videos, audio) per category
 * 2. Content Library - View all created videos, edit them anytime
 * 3. Editor Modal - Create/edit videos with presets and sync tools
 */

// Session persistence key
const SESSION_KEY = 'stm_studio_session';

// Helper to load session state
const loadSessionState = () => {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      log('[Session] Loaded:', parsed);
      return parsed;
    }
  } catch (e) {
    console.warn('Failed to load session state:', e);
  }
  return null;
};

// Helper to save session state
const saveSessionState = (state) => {
  try {
    const toSave = {
      ...state,
      savedAt: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(toSave));
    log('[Session] Saved:', toSave);
  } catch (e) {
    console.warn('Failed to save session state:', e);
  }
};

/**
 * DraftsView — Tabbed view that swaps between video drafts and slideshow drafts
 */
const DraftsView = (props) => {
  const [draftsTab, setDraftsTab] = useState('videos');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Tab toggle */}
      <div style={{
        display: 'flex', gap: '0', padding: '0 16px', backgroundColor: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0
      }}>
        {['videos', 'slideshows'].map(tab => (
          <button
            key={tab}
            onClick={() => setDraftsTab(tab)}
            style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer',
              backgroundColor: draftsTab === tab ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: draftsTab === tab ? '#a5b4fc' : '#6b7280',
              fontSize: '13px', fontWeight: '600',
              borderBottom: draftsTab === tab ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'all 0.15s'
            }}
          >
            {tab === 'videos' ? 'Video Drafts' : 'Slideshow Drafts'}
          </button>
        ))}
      </div>
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ContentLibrary
          category={props.category}
          contentType={draftsTab}
          isDraftsView={true}
          onBack={props.onBack}
          onMakeVideo={props.onMakeVideo}
          onEditVideo={props.onEditVideo}
          onDeleteVideo={props.onDeleteVideo}
          onApproveVideo={props.onApproveVideo}
          onUpdateVideo={props.onUpdateVideo}
          onMakeSlideshow={props.onMakeSlideshow}
          onEditSlideshow={props.onEditSlideshow}
          onDeleteSlideshow={props.onDeleteSlideshow}
          onSchedulePost={props.onSchedulePost}
          onViewScheduling={props.onViewScheduling}
          onShowBatchPipeline={props.onShowBatchPipeline}
          db={props.db}
          accounts={props.accounts}
          lateAccountIds={props.lateAccountIds}
          artistId={props.artistId}
        />
      </div>
    </div>
  );
};

const VideoStudio = ({
  db = null, // Firestore instance for cross-device sync
  onClose,
  artists = [],
  artistId: initialArtistId = null,
  lateAccountIds = {},
  onSchedulePost,
  onArtistChange = null // Callback when artist selection changes
}) => {
  // BUG-034: Toast notifications instead of alert()
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const styles = getStyles(theme);

  // Mobile responsive detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Current artist ID - used for namespaced storage
  const [currentArtistId, setCurrentArtistId] = useState(initialArtistId);
  // Track previous artist ID to detect actual changes (not just re-renders)
  const prevArtistIdRef = useRef(initialArtistId);

  // Sync with parent when initialArtistId changes (e.g., from null to valid ID after login)
  useEffect(() => {
    if (initialArtistId && initialArtistId !== currentArtistId) {
      log('[VideoStudio] Syncing artistId from parent:', initialArtistId);
      setCurrentArtistId(initialArtistId);
      prevArtistIdRef.current = initialArtistId;
    }
  }, [initialArtistId]);

  // Update parent when artist changes
  const handleArtistIdChange = (newArtistId) => {
    if (newArtistId === currentArtistId) return; // No change

    log('[VideoStudio] Artist switching from', currentArtistId, 'to', newArtistId);
    setCurrentArtistId(newArtistId);
    setLastArtistId(newArtistId);

    // Also update selectedArtist to match
    const newArtist = artists.find(a => a.id === newArtistId);
    if (newArtist) {
      setSelectedArtist(newArtist);
    }

    if (onArtistChange) {
      onArtistChange(newArtistId);
    }
  };
  // React Router hooks for URL-based navigation within studio
  const navigate = useNavigate();
  const location = useLocation();

  // Parse initial view from URL
  const getInitialViewFromUrl = () => {
    const path = location.pathname;
    if (path.includes('/studio/library')) return 'library';
    if (path.includes('/studio/slideshows')) return 'slideshows';
    if (path.includes('/studio/drafts')) return 'drafts';
    if (path.includes('/studio/scheduling')) return 'scheduling';
    return 'home';
  };

  // Load saved session for initial state
  const savedSession = useMemo(() => loadSessionState(), []);

  // Navigation state - restore from session if available, or use URL
  const [currentView, setCurrentViewState] = useState(getInitialViewFromUrl() || savedSession?.currentView || 'home');

  // Wrap setCurrentView to also update URL
  const setCurrentView = useCallback((view) => {
    setCurrentViewState(view);
    // Update URL based on view
    let targetPath = '/operator/studio';
    if (view === 'library') targetPath = '/operator/studio/library';
    else if (view === 'slideshows') targetPath = '/operator/studio/slideshows';
    else if (view === 'drafts') targetPath = '/operator/studio/drafts';
    else if (view === 'scheduling') targetPath = '/operator/studio/scheduling';
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: false });
    }
  }, [navigate, location.pathname]);

  // Handle browser back/forward within studio
  useEffect(() => {
    const path = location.pathname;
    if (path.includes('/studio/scheduling') && currentView !== 'scheduling') {
      setCurrentViewState('scheduling');
    } else if (path.includes('/studio/drafts') && currentView !== 'drafts') {
      setCurrentViewState('drafts');
    } else if (path.includes('/studio/library') && currentView !== 'library') {
      setCurrentViewState('library');
    } else if (path.includes('/studio/slideshows') && currentView !== 'slideshows') {
      setCurrentViewState('slideshows');
    } else if (path === '/operator/studio' && currentView !== 'home') {
      setCurrentViewState('home');
    }
  }, [location.pathname, currentView]);
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [createdContentVersion, setCreatedContentVersion] = useState(0); // Bump to refresh library dashboard
  const [firestoreContentLoaded, setFirestoreContentLoaded] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // Track upload progress
  const [sessionRestored, setSessionRestored] = useState(false);

  // Derive accounts array from lateAccountIds for PostingModule
  const accounts = useMemo(() => {
    return Object.entries(lateAccountIds).map(([handle, ids]) => ({
      handle,
      tiktokId: ids.tiktok,
      instagramId: ids.instagram
    }));
  }, [lateAccountIds]);

  // Synthetic category for library-mode ContentLibrary (dashboard)
  // createdContentVersion triggers re-computation after add/delete/approve/update
  const libraryCategory = useMemo(() => {
    if (!USE_LIBRARY_SYSTEM || !currentArtistId) return null;
    const content = getCreatedContent(currentArtistId);
    return {
      id: 'library-created',
      name: 'Created Content',
      createdVideos: content.videos || [],
      slideshows: content.slideshows || [],
    };
  }, [currentArtistId, createdContentVersion]);

  // Load created content from Firestore on mount (ensures drafts persist across refreshes)
  useEffect(() => {
    if (firestoreContentLoaded || !db || !currentArtistId) return;
    loadCreatedContentAsync(db, currentArtistId).then(content => {
      // loadCreatedContentAsync already saves Firestore data to localStorage
      // Just bump version to trigger useMemo recompute so UI shows the loaded data
      if (content && (content.slideshows?.length > 0 || content.videos?.length > 0)) {
        log('[VideoStudio] Loaded created content from Firestore:', content.slideshows?.length, 'slideshows,', content.videos?.length, 'videos');
      }
      setCreatedContentVersion(v => v + 1);
      setFirestoreContentLoaded(true);
    }).catch(err => {
      console.warn('[VideoStudio] Failed to load created content from Firestore:', err);
      setFirestoreContentLoaded(true);
    });
  // eslint-disable-next-line
  }, [db, currentArtistId, firestoreContentLoaded]);

  // Default categories for fresh installs
  // accountHandle links category to Late.co account for auto-scheduling
  // defaultPreset contains text style and cut settings for batch generation
  // captionTemplate uses {title}, {hashtags}, {index} placeholders
  const defaultCategories = [
    {
      id: 'boon-runway',
      artistId: 'boon',
      name: 'Runway',
      description: 'High fashion editorial content',
      accountHandle: '@margiela.mommy', // Linked Late.co account
      thumbnail: null,
      // Video mode banks
      videos: [],
      audio: [],
      createdVideos: [],
      // Slideshow mode banks (separate from video)
      imagesA: [], // Image A bank for slideshows
      imagesB: [], // Image B bank for slideshows
      slideshows: [], // Created slideshows
      // Shared: Lyric bank (accessible in both modes)
      lyrics: [], // { id, title, content, createdAt }
      // New: Category defaults for batch generation
      defaultPreset: {
        textStyle: {
          fontSize: 48,
          fontFamily: "'Playfair Display', serif",
          fontWeight: '300',
          color: '#ffffff',
          outline: true,
          outlineColor: 'rgba(0,0,0,0.3)',
          textCase: 'upper'
        },
        cutStyle: 'beat',
        beatsPerCut: 2
      },
      captionTemplate: '{title} ✨ #fashion #runway {hashtags}',
      defaultHashtags: '#aesthetic #fyp #style #viral'
    },
    {
      id: 'boon-edm',
      artistId: 'boon',
      name: 'EDM',
      description: 'High energy electronic visuals',
      accountHandle: '@neonphoebe', // Linked Late.co account
      thumbnail: null,
      // Video mode banks
      videos: [],
      audio: [],
      createdVideos: [],
      // Slideshow mode banks (separate from video)
      imagesA: [], // Image A bank for slideshows
      imagesB: [], // Image B bank for slideshows
      slideshows: [], // Created slideshows
      // Shared: Lyric bank (accessible in both modes)
      lyrics: [], // { id, title, content, createdAt }
      // New: Category defaults for batch generation
      defaultPreset: {
        textStyle: {
          fontSize: 72,
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: '900',
          color: '#00ff88',
          outline: true,
          outlineColor: '#000000',
          textCase: 'upper'
        },
        cutStyle: 'beat',
        beatsPerCut: 1
      },
      captionTemplate: '{title} 🔥 #edm #rave {hashtags}',
      defaultHashtags: '#dj #electronic #music #fyp'
    }
  ];

  const defaultPresets = [
    {
      id: 'preset-fashion-minimal',
      name: 'Fashion Minimal',
      categoryId: 'boon-runway',
      settings: {
        fontSize: 48,
        fontFamily: "'Playfair Display', serif",
        fontWeight: '300',
        color: '#ffffff',
        outline: true,
        outlineColor: 'rgba(0,0,0,0.3)',
        textCase: 'upper',
        letterSpacing: '0.2em',
        displayMode: 'word',
        beatsPerCut: 2
      }
    },
    {
      id: 'preset-edm-bold',
      name: 'EDM Bold',
      categoryId: 'boon-edm',
      settings: {
        fontSize: 72,
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: '900',
        color: '#00ff88',
        outline: true,
        outlineColor: '#000000',
        textCase: 'upper',
        letterSpacing: '0',
        displayMode: 'word',
        beatsPerCut: 1
      }
    }
  ];

  // Load from artist-namespaced localStorage or use defaults
  const [categories, setCategories] = useState(() => {
    // If we have an artistId, use namespaced storage
    if (initialArtistId) {
      // Check if migration is needed
      if (hasLegacyData()) {
        migrateToArtistStorage(initialArtistId);
      }
      const saved = loadArtistCategories(initialArtistId);
      return saved.length > 0 ? saved : defaultCategories;
    }
    // Fallback to global storage for backwards compatibility
    const saved = loadCategories();
    return saved.length > 0 ? saved : defaultCategories;
  });

  const [presets, setPresets] = useState(() => {
    if (initialArtistId) {
      const saved = loadArtistPresets(initialArtistId);
      return saved.length > 0 ? saved : defaultPresets;
    }
    const saved = loadPresets();
    return saved.length > 0 ? saved : defaultPresets;
  });

  // Editor state - restore showEditor from session if they were in the editor
  const [editingVideo, setEditingVideo] = useState(null);
  const [showEditor, setShowEditor] = useState(savedSession?.showEditor || false);
  const [showBatchPipeline, setShowBatchPipeline] = useState(false);
  // Batch lyric settings passed from editor (words and textStyle to apply to all batch videos)
  const [batchLyricSettings, setBatchLyricSettings] = useState(null);

  // Slideshow editor state
  const [showSlideshowEditor, setShowSlideshowEditor] = useState(false);
  const [editingSlideshow, setEditingSlideshow] = useState(null);

  // Scheduler edit mode — when editing a post from the scheduler, save goes back to scheduler
  const [schedulerEditPostId, setSchedulerEditPostId] = useState(null);

  // Wave 4: Save draft prompt dialog state
  const [draftDialog, setDraftDialog] = useState({ isOpen: false, pendingAction: null });

  /**
   * navigateWithDraftCheck — wraps navigation to prompt "Save draft?" when
   * leaving an editor with potentially unsaved work (Wave 4).
   * @param {Function} action — The navigation callback to execute
   */
  const navigateWithDraftCheck = useCallback((action) => {
    const inEditor = showEditor || showSlideshowEditor;
    if (!inEditor) {
      action();
      return;
    }
    setDraftDialog({
      isOpen: true,
      pendingAction: action
    });
  }, [showEditor, showSlideshowEditor]);

  const handleDraftDialogDiscard = useCallback(() => {
    const action = draftDialog.pendingAction;
    setDraftDialog({ isOpen: false, pendingAction: null });
    if (action) action();
  }, [draftDialog.pendingAction]);

  const handleDraftDialogCancel = useCallback(() => {
    setDraftDialog({ isOpen: false, pendingAction: null });
  }, []);

  // Studio mode (lifted from AestheticHome for breadcrumb visibility)
  // null = mode selection, 'videos' = video mode, 'slideshows' = slideshow mode
  const [studioMode, setStudioMode] = useState(null);

  // Library system state (new system)
  const [libraryMedia, setLibraryMedia] = useState({ videos: [], audio: [], images: [] });
  const [selectedLibraryMedia, setSelectedLibraryMedia] = useState({ videos: [], audio: null, images: [], lyrics: [] });
  const [pullFromCollection, setPullFromCollection] = useState(null);

  // On mount: try loading categories from Firestore (may have newer data than localStorage)
  useEffect(() => {
    if (db && initialArtistId) {
      loadCategoriesFromFirestore(db, initialArtistId).then(firestoreCats => {
        if (firestoreCats && firestoreCats.length > 0) {
          log('[VideoStudio] Initial load: found', firestoreCats.length, 'categories in Firestore');
          setCategories(firestoreCats);
          // Sync to localStorage
          saveArtistCategories(initialArtistId, firestoreCats);
        }
      });
    }
  // eslint-disable-next-line
  }, []); // Only run once on mount

  // Auto-setup Music Artist template if onboarding not completed (no modal)
  useEffect(() => {
    if (USE_LIBRARY_SYSTEM && currentArtistId) {
      const status = getOnboardingStatus(currentArtistId);
      if (!status.completed) {
        // Auto-complete with Music Artist template
        completeOnboarding(currentArtistId, STARTER_TEMPLATES.MUSIC_ARTIST.id);
        log('[Studio] Auto-completed onboarding with Music Artist template');
      }
    }
  }, [currentArtistId]);

  // Save to localStorage + Firestore when categories change
  useEffect(() => {
    // Don't save if artist just changed - wait for load effect to run first
    if (currentArtistId && currentArtistId !== prevArtistIdRef.current) {
      return;
    }

    // Use artist-namespaced storage if we have an artistId
    const saveFn = currentArtistId
      ? (cats) => saveArtistCategories(currentArtistId, cats)
      : saveCategories;

    const success = saveFn(categories);
    if (!success) {
      // Storage quota exceeded - try cleanup and retry
      console.warn('Storage save failed, attempting cleanup...');
      cleanupStorage();
      // Retry save after cleanup
      saveFn(categories);
    }

    // Also sync to Firestore for cross-device access (debounced via effect)
    if (db && currentArtistId) {
      saveCategoriesToFirestore(db, currentArtistId, categories);
    }
  }, [categories, currentArtistId, db]);

  // Save to localStorage when presets change
  useEffect(() => {
    // Don't save if artist just changed - wait for load effect to run first
    if (currentArtistId && currentArtistId !== prevArtistIdRef.current) {
      return;
    }

    if (currentArtistId) {
      saveArtistPresets(currentArtistId, presets);
    } else {
      savePresets(presets);
    }
  }, [presets, currentArtistId]);

  // Reload data when artist changes
  useEffect(() => {
    // Only reload if artist actually changed (compare against ref, not prop)
    if (currentArtistId && currentArtistId !== prevArtistIdRef.current) {
      log('[VideoStudio] Artist changed from', prevArtistIdRef.current, 'to', currentArtistId);

      // Load categories: try Firestore first (cross-device), then localStorage
      const loadCats = async () => {
        let loaded = false;

        // Try Firestore first for cross-device sync
        if (db) {
          const firestoreCategories = await loadCategoriesFromFirestore(db, currentArtistId);
          if (firestoreCategories && firestoreCategories.length > 0) {
            log('[VideoStudio] Loaded', firestoreCategories.length, 'categories from Firestore for', currentArtistId);
            setCategories(firestoreCategories);
            // Also update localStorage for faster next load
            saveArtistCategories(currentArtistId, firestoreCategories);
            loaded = true;
          }
        }

        if (!loaded) {
          // Fall back to localStorage
          const artistCategories = loadArtistCategories(currentArtistId);
          if (artistCategories.length > 0) {
            log('[VideoStudio] Loaded', artistCategories.length, 'categories from localStorage for', currentArtistId);
            setCategories(artistCategories);
          } else {
            log('[VideoStudio] No categories found, using defaults for', currentArtistId);
            setCategories(defaultCategories);
          }
        }
      };

      loadCats();

      // Load presets for new artist
      const artistPresets = loadArtistPresets(currentArtistId);
      if (artistPresets.length > 0) {
        setPresets(artistPresets);
      } else {
        setPresets(defaultPresets);
      }

      // Clear selections
      setSelectedCategory(null);
      setStudioMode(null);

      // Update ref to current artist
      prevArtistIdRef.current = currentArtistId;
    }
  }, [currentArtistId, db]);

  // Initialize with first artist and restore session
  useEffect(() => {
    if (artists.length > 0 && !selectedArtist) {
      setSelectedArtist(artists[0]);
    }
  }, [artists, selectedArtist]);

  // Restore full session state after categories are loaded
  useEffect(() => {
    if (sessionRestored || categories.length === 0) return;

    const saved = loadSessionState();
    if (saved && saved.categoryId) {
      // Find the saved category
      const category = categories.find(c => c.id === saved.categoryId);
      if (category) {
        log('[Session] Restoring:', saved.currentView, category.name, 'editor:', saved.showEditor, 'mode:', saved.studioMode);
        setSelectedCategory(category);
        setCurrentView(saved.currentView || 'home');
        if (saved.studioMode) {
          setStudioMode(saved.studioMode);
        }
        // showEditor is already set from initial state
      }
    }
    setSessionRestored(true);
  }, [categories, sessionRestored]);

  // Save session state when navigation changes
  useEffect(() => {
    if (!sessionRestored) return; // Don't save during initial restore

    saveSessionState({
      currentView,
      categoryId: selectedCategory?.id || null,
      artistId: selectedArtist?.id || null,
      showEditor,
      studioMode
    });
  }, [currentView, selectedCategory?.id, selectedArtist?.id, showEditor, studioMode, sessionRestored]);

  // Get categories for selected artist
  const artistCategories = categories.filter(c =>
    c.artistId === selectedArtist?.id || c.artistId === null
  );

  // Handlers
  const handleSelectCategory = useCallback((category) => {
    setSelectedCategory(category);
    // Reset studio mode when selecting a new category
    if (!category) {
      setStudioMode(null);
    }
  }, []);

  const handleCreateContent = useCallback(() => {
    setCurrentView('library');
  }, []);

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const handleMakeVideo = useCallback((existingVideo = null) => {
    setEditingVideo(existingVideo);
    setShowEditor(true);
    setStudioMode('videos'); // Ensure studioMode is set for breadcrumb
    // Show template picker only for new videos (not re-edits or session restores)
    setShowTemplatePicker(!existingVideo);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setShowEditor(false);
    setEditingVideo(null);
    // Clear library selection so stale clips don't appear next time
    setSelectedLibraryMedia({ videos: [], audio: null, images: [], lyrics: [] });
    setPullFromCollection(null);
  }, []);

  const handleSaveVideo = useCallback(async (videoData) => {
    // Scheduler edit mode: update the scheduledPost directly and return to scheduler
    if (schedulerEditPostId) {
      try {
        await updateScheduledPost(db, currentArtistId, schedulerEditPostId, {
          editorState: videoData,
          contentName: videoData.name || videoData.id || 'Edited Video',
          thumbnail: videoData.thumbnail || null
        });
        log('[VideoStudio] Updated scheduledPost from editor:', schedulerEditPostId);
      } catch (err) {
        console.error('[VideoStudio] Failed to update scheduledPost:', err);
      }
      setShowEditor(false);
      setEditingVideo(null);
      setSchedulerEditPostId(null);
      setSelectedLibraryMedia({ videos: [], audio: null, images: [], lyrics: [] });
      setPullFromCollection(null);
      setCurrentView('scheduling');
      return;
    }

    // Library mode: save via libraryService when no category is selected
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        const savedVideo = addCreatedVideo(currentArtistId, {
          ...videoData,
          id: videoData.id || `video_${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: VIDEO_STATUS.DRAFT
        });
        log('[VideoStudio] Saved video via library system:', savedVideo.id);
        setCreatedContentVersion(v => v + 1);
        setShowEditor(false);
        setEditingVideo(null);
        setSelectedLibraryMedia({ videos: [], audio: null, images: [], lyrics: [] });
        setPullFromCollection(null);
        setCurrentView('library');
        setStudioMode('videos');
      }
      return;
    }

    // Category mode: save to category (legacy flow)
    const updateCategory = (cat) => {
      if (cat.id !== selectedCategory.id) return cat;

      const existingIndex = cat.createdVideos.findIndex(v => v.id === videoData.id);
      if (existingIndex >= 0) {
        // Update existing
        const newVideos = [...cat.createdVideos];
        newVideos[existingIndex] = { ...videoData, updatedAt: new Date().toISOString() };
        return { ...cat, createdVideos: newVideos };
      } else {
        // Add new
        return {
          ...cat,
          createdVideos: [...cat.createdVideos, {
            ...videoData,
            id: `video_${Date.now()}`,
            createdAt: new Date().toISOString(),
            status: VIDEO_STATUS.DRAFT
          }]
        };
      }
    };

    // Update categories
    setCategories(prev => prev.map(updateCategory));

    // Update selected category with the same logic (avoids stale closure)
    setSelectedCategory(prev => {
      if (!prev) return prev;
      return updateCategory(prev);
    });

    setShowEditor(false);
    setEditingVideo(null);
    // Navigate to content library after saving
    setCurrentView('library');
    setStudioMode('videos');
  }, [selectedCategory, currentArtistId, schedulerEditPostId, db]);

  const handleUploadVideos = useCallback(async (files) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'video', current: 0, total: files.length });

    const uploadedVideos = [];
    const failedUploads = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      log(`Starting upload ${i + 1}/${files.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      try {
        setUploadProgress({ type: 'video', current: i + 1, total: files.length, name: file.name, progress: 0 });

        // Upload to Firebase Storage
        const { url, path } = await uploadFile(file, 'videos', (progress) => {
          setUploadProgress(prev => ({ ...prev, progress }));
        });

        log(`Upload complete for ${file.name}, getting metadata...`);

        // Get duration and thumbnail from local blob (more reliable than Firebase URL due to CORS)
        let duration = 0;
        let thumbnail = null;
        const localBlobUrl = URL.createObjectURL(file);

        try {
          duration = await getMediaDuration(localBlobUrl, 'video');
        } catch (e) {
          console.warn('Could not get video duration:', file.name, e.message);
        }

        try {
          thumbnail = await generateThumbnail(localBlobUrl);
        } catch (e) {
          console.warn('Could not generate thumbnail:', file.name, e.message);
        }

        // Keep blob URL for current session playback (avoids CORS issues)
        // Note: Don't revoke - we need it for video preview in current session
        // URL.revokeObjectURL(localBlobUrl); // Commented out to keep for playback

        uploadedVideos.push({
          id: `clip_${Date.now()}_${i}`,
          name: file.name,
          url,
          localUrl: localBlobUrl, // Local blob URL for current session (no CORS issues)
          storagePath: path,
          duration,
          thumbnail,
          createdAt: new Date().toISOString()
        });

        log('✓ Video uploaded successfully:', file.name);

        // Small delay between uploads to avoid rate limiting
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error('✗ Failed to upload video:', file.name, error.message || error);
        failedUploads.push({ name: file.name, error: error.message || 'Unknown error' });
        // Continue with other files
      }
    }

    // Log summary
    log(`Upload summary: ${uploadedVideos.length} succeeded, ${failedUploads.length} failed`);
    if (failedUploads.length > 0) {
      console.warn('Failed uploads:', failedUploads);
    }

    log('Upload complete. Videos to add:', uploadedVideos.length);

    if (uploadedVideos.length > 0) {
      setCategories(prev => {
        const updated = prev.map(cat =>
          cat.id === selectedCategory.id
            ? { ...cat, videos: [...cat.videos, ...uploadedVideos] }
            : cat
        );
        log('Categories updated, total videos in category:', updated.find(c => c.id === selectedCategory.id)?.videos.length);
        return updated;
      });

      setSelectedCategory(prev => {
        if (!prev) return prev;
        const updated = { ...prev, videos: [...prev.videos, ...uploadedVideos] };
        log('Selected category updated, videos:', updated.videos.length);
        return updated;
      });
    } else {
      console.warn('No videos were successfully uploaded');
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  const handleUploadAudio = useCallback(async (files, trimData = null, customName = null) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'audio', current: 0, total: files.length });

    const uploadedAudio = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const displayName = customName || file.name;
        setUploadProgress({ type: 'audio', current: i + 1, total: files.length, name: displayName });

        // Upload to Firebase Storage
        const { url, path } = await uploadFile(file, 'audio', (progress) => {
          setUploadProgress(prev => ({ ...prev, progress }));
        });

        // Create local blob URL for reliable metadata access and beat detection (avoids CORS)
        const localBlobUrl = URL.createObjectURL(file);

        // Get duration from local blob (more reliable than Firebase URL due to CORS)
        let fullDuration = 0;
        try {
          fullDuration = await getMediaDuration(localBlobUrl, 'audio');
        } catch (e) {
          console.warn('Could not get audio duration:', displayName, e.message);
          // Try from Firebase URL as fallback
          fullDuration = await getMediaDuration(url, 'audio').catch(() => 0);
        }

        // Use trim data if provided, otherwise use full duration
        const audioData = {
          id: `audio_${Date.now()}_${i}`,
          name: displayName,
          url,
          localUrl: localBlobUrl, // Local blob URL for beat detection and playback (no CORS)
          file: file, // Keep original file for beat detection
          storagePath: path,
          fullDuration, // Store the full duration for reference
          duration: trimData?.clipDuration || fullDuration, // Use trimmed duration if provided
          createdAt: new Date().toISOString()
        };

        // Add trim boundaries if trim data was provided
        if (trimData) {
          audioData.startTime = trimData.startTime;
          audioData.endTime = trimData.endTime;
          audioData.isTrimmed = true;
          log(`Audio uploaded with trim: ${trimData.startTime.toFixed(1)}s - ${trimData.endTime.toFixed(1)}s`);
        }

        uploadedAudio.push(audioData);
      } catch (error) {
        console.error('Failed to upload audio:', file.name, error);
        // Continue with other files
      }
    }

    if (uploadedAudio.length > 0) {
      setCategories(prev => prev.map(cat =>
        cat.id === selectedCategory.id
          ? { ...cat, audio: [...cat.audio, ...uploadedAudio] }
          : cat
      ));

      setSelectedCategory(prev => prev ? { ...prev, audio: [...prev.audio, ...uploadedAudio] } : prev);
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  // Save a trimmed audio clip to the library for reuse
  const handleSaveAudioClip = useCallback(async (clipData) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'audio', current: 1, total: 1, name: clipData.name });

    try {
      // Upload the original file to Firebase Storage
      const { url, path } = await uploadFile(clipData.file, 'audio', (progress) => {
        setUploadProgress(prev => ({ ...prev, progress }));
      });

      // Create local blob URL for reliable playback (avoids CORS)
      const localBlobUrl = URL.createObjectURL(clipData.file);

      // Create the saved clip with trim info
      const savedClip = {
        id: `audioclip_${Date.now()}`,
        name: clipData.name,
        url,
        localUrl: localBlobUrl, // Local blob URL for current session (no CORS)
        file: clipData.file, // Keep file reference for beat detection
        storagePath: path,
        duration: clipData.clipDuration,
        // Store trim info so we can restore the selection
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        isClip: true, // Flag to identify saved clips
        autoSaved: clipData.autoSaved || false, // Was this auto-saved from "Use this clip"?
        savedLyrics: [], // Initialize empty lyrics array
        createdAt: new Date().toISOString()
      };

      setCategories(prev => prev.map(cat =>
        cat.id === selectedCategory.id
          ? { ...cat, audio: [...cat.audio, savedClip] }
          : cat
      ));

      setSelectedCategory(prev => prev ? { ...prev, audio: [...prev.audio, savedClip] } : prev);
    } catch (error) {
      console.error('Failed to save audio clip:', error);
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  // Save lyrics template to an audio track
  const handleSaveLyricsToAudio = useCallback((audioId, lyricsData) => {
    if (!selectedCategory) {
      // Library mode: log but don't crash — lyrics-to-audio is a category feature
      log('[VideoStudio] Skipping lyrics-to-audio save (library mode)');
      return;
    }

    const lyricsEntry = {
      id: `lyrics_${Date.now()}`,
      name: lyricsData.name || 'Untitled Lyrics',
      words: lyricsData.words || [],
      createdAt: new Date().toISOString()
    };

    const updateCategory = (cat) => {
      if (cat.id !== selectedCategory.id) return cat;
      return {
        ...cat,
        audio: cat.audio.map(audio =>
          audio.id === audioId
            ? {
                ...audio,
                savedLyrics: [...(audio.savedLyrics || []), lyricsEntry]
              }
            : audio
        )
      };
    };

    setCategories(prev => prev.map(updateCategory));
    setSelectedCategory(prev => prev ? updateCategory(prev) : prev);

    log('[Lyrics] Saved lyrics to audio:', audioId, lyricsEntry);
  }, [selectedCategory]);

  const handleDeleteVideo = useCallback(async (videoId) => {
    // Library mode: delete via libraryService
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        const content = getCreatedContent(currentArtistId);
        const video = content.videos.find(v => v.id === videoId);
        if (video?.storagePath) await deleteFile(video.storagePath);
        if (video?.thumbnailPath) await deleteFile(video.thumbnailPath);
        deleteCreatedVideo(currentArtistId, videoId);
        setCreatedContentVersion(v => v + 1);
        // Cascade: remove any scheduled posts referencing this draft
        if (db && currentArtistId) {
          deletePostsByContentId(db, currentArtistId, videoId).catch(err =>
            console.warn('[VideoStudio] Cascade delete for video failed:', err)
          );
        }
      }
      return;
    }

    // Category mode: find the video to get its storage path
    const video = selectedCategory.createdVideos.find(v => v.id === videoId);

    // Delete from Firebase Storage if there's a storage path
    if (video?.storagePath) {
      await deleteFile(video.storagePath);
    }
    // Also try to delete thumbnail if it has a storage path
    if (video?.thumbnailPath) {
      await deleteFile(video.thumbnailPath);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, createdVideos: cat.createdVideos.filter(v => v.id !== videoId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.filter(v => v.id !== videoId)
    } : prev);

    // Cascade: remove any scheduled posts referencing this draft
    if (db && currentArtistId) {
      deletePostsByContentId(db, currentArtistId, videoId).catch(err =>
        console.warn('[VideoStudio] Cascade delete for video failed:', err)
      );
    }
  }, [selectedCategory, currentArtistId, db]);

  // Delete a video clip from the bank (source videos)
  const handleDeleteBankVideo = useCallback(async (videoId) => {
    if (!selectedCategory) return;

    // Find the video to get its storage path
    const video = selectedCategory.videos.find(v => v.id === videoId);

    // Delete from Firebase Storage if there's a storage path
    if (video?.storagePath) {
      const result = await deleteFile(video.storagePath);
      log('Deleted video from storage:', result);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, videos: cat.videos.filter(v => v.id !== videoId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      videos: prev.videos.filter(v => v.id !== videoId)
    } : prev);
  }, [selectedCategory]);

  // Delete an audio track from the bank
  const handleDeleteBankAudio = useCallback(async (audioId) => {
    if (!selectedCategory) return;

    // Find the audio to get its storage path
    const audio = selectedCategory.audio.find(a => a.id === audioId);

    // Delete from Firebase Storage if there's a storage path
    if (audio?.storagePath) {
      const result = await deleteFile(audio.storagePath);
      log('Deleted audio from storage:', result);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, audio: cat.audio.filter(a => a.id !== audioId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      audio: prev.audio.filter(a => a.id !== audioId)
    } : prev);
  }, [selectedCategory]);

  // Rename a video clip in the bank
  const handleRenameBankVideo = useCallback((videoId, newName) => {
    if (!selectedCategory || !newName.trim()) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, videos: cat.videos.map(v => v.id === videoId ? { ...v, name: newName.trim() } : v) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      videos: prev.videos.map(v => v.id === videoId ? { ...v, name: newName.trim() } : v)
    } : prev);
  }, [selectedCategory]);

  // Rename an audio track in the bank
  const handleRenameBankAudio = useCallback((audioId, newName) => {
    if (!selectedCategory || !newName.trim()) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, audio: cat.audio.map(a => a.id === audioId ? { ...a, name: newName.trim() } : a) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      audio: prev.audio.map(a => a.id === audioId ? { ...a, name: newName.trim() } : a)
    } : prev);
  }, [selectedCategory]);

  // Edit/re-trim an existing audio track
  const handleEditAudio = useCallback((audioId, trimData) => {
    if (!selectedCategory) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            audio: cat.audio.map(a => a.id === audioId ? {
              ...a,
              startTime: trimData.startTime,
              endTime: trimData.endTime,
              duration: trimData.duration
            } : a)
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      audio: prev.audio.map(a => a.id === audioId ? {
        ...a,
        startTime: trimData.startTime,
        endTime: trimData.endTime,
        duration: trimData.duration
      } : a)
    } : prev);
  }, [selectedCategory]);

  const handleApproveVideo = useCallback((videoId) => {
    // Library mode: toggle approve via libraryService
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        const content = getCreatedContent(currentArtistId);
        const video = content.videos.find(v => v.id === videoId);
        const newStatus = video?.status === VIDEO_STATUS.APPROVED ? VIDEO_STATUS.DRAFT : VIDEO_STATUS.APPROVED;
        updateCreatedVideo(currentArtistId, videoId, { status: newStatus });
        setCreatedContentVersion(v => v + 1);
      }
      return;
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            createdVideos: cat.createdVideos.map(v =>
              v.id === videoId ? { ...v, status: v.status === VIDEO_STATUS.APPROVED ? VIDEO_STATUS.DRAFT : VIDEO_STATUS.APPROVED } : v
            )
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.map(v =>
        v.id === videoId ? { ...v, status: v.status === VIDEO_STATUS.APPROVED ? VIDEO_STATUS.DRAFT : VIDEO_STATUS.APPROVED } : v
      )
    } : prev);
  }, [selectedCategory, currentArtistId]);

  // Update a video with new fields (used after rendering)
  const handleUpdateVideo = useCallback((videoId, updates) => {
    // Library mode: update via libraryService
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        updateCreatedVideo(currentArtistId, videoId, updates);
        setCreatedContentVersion(v => v + 1);
      }
      return;
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            createdVideos: cat.createdVideos.map(v =>
              v.id === videoId ? { ...v, ...updates } : v
            )
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.map(v =>
        v.id === videoId ? { ...v, ...updates } : v
      )
    } : prev);
  }, [selectedCategory, currentArtistId]);

  const handleCreateCategory = useCallback((categoryData) => {
    const newCategory = {
      id: `cat_${Date.now()}`,
      artistId: selectedArtist?.id,
      // Video mode banks
      videos: [],
      audio: [],
      createdVideos: [],
      // Slideshow mode banks
      imagesA: [],
      imagesB: [],
      slideshows: [],
      // Shared
      lyrics: [],
      ...categoryData
    };
    setCategories(prev => [...prev, newCategory]);
    setSelectedCategory(newCategory);
  }, [selectedArtist]);

  const handleSavePreset = useCallback((presetData) => {
    const newPreset = {
      id: `preset_${Date.now()}`,
      categoryId: selectedCategory?.id,
      ...presetData
    };
    setPresets(prev => [...prev, newPreset]);
  }, [selectedCategory]);

  // Slideshow handlers
  // Batch slideshow mode state
  const [slideshowBatchMode, setSlideshowBatchMode] = useState(false);

  const handleMakeSlideshow = useCallback((options = null) => {
    if (options?.batch) {
      // Batch mode - create 10 separate slideshows instantly (like video batch)
      if (!selectedCategory) {
        // Library mode: batch slideshows not supported
        toastError('Batch slideshows require a category. Please select one or use manual creation.');
        return;
      }

      const imagesA = selectedCategory.imagesA || [];
      const imagesB = selectedCategory.imagesB || [];

      if (imagesA.length === 0 || imagesB.length === 0) {
        toastError('Please add images to both Image A and Image B banks first');
        return;
      }

      const batchSlideshows = [];

      for (let i = 0; i < 10; i++) {
        // Each slideshow has exactly 2 slides: Slide 1 from Image A, Slide 2 from Image B
        const imageA = imagesA[Math.floor(Math.random() * imagesA.length)];
        const imageB = imagesB[Math.floor(Math.random() * imagesB.length)];

        const slides = [
          {
            id: `slide_${Date.now()}_${i}_0`,
            index: 0,
            backgroundImage: imageA.url || imageA.localUrl,
            thumbnail: imageA.url || imageA.localUrl,
            sourceBank: 'imageA',
            sourceImageId: imageA.id,
            textOverlays: [],
            duration: 3
          },
          {
            id: `slide_${Date.now()}_${i}_1`,
            index: 1,
            backgroundImage: imageB.url || imageB.localUrl,
            thumbnail: imageB.url || imageB.localUrl,
            sourceBank: 'imageB',
            sourceImageId: imageB.id,
            textOverlays: [],
            duration: 3
          }
        ];

        batchSlideshows.push({
          id: `slideshow_batch_${Date.now()}_${i}`,
          name: `${selectedCategory.name} Slideshow ${i + 1}`,
          aspectRatio: '9:16',
          slides,
          audio: null,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      // Save all slideshows to category
      if (batchSlideshows.length > 0) {
        const updateCategory = (cat) => {
          if (cat.id !== selectedCategory.id) return cat;
          return {
            ...cat,
            slideshows: [...(cat.slideshows || []), ...batchSlideshows]
          };
        };

        setCategories(prev => prev.map(updateCategory));
        setSelectedCategory(prev => prev ? updateCategory(prev) : prev);

        // Navigate to slideshow library view to see created slideshows
        // We signal AestheticHome to show the library via a special option
        toastSuccess(`Created ${batchSlideshows.length} slideshows!`);
        // Return a signal to open the library (handled by AestheticHome)
        return { openLibrary: true, count: batchSlideshows.length };
      }
    } else {
      // Single slideshow or edit existing
      setSlideshowBatchMode(false);
      setEditingSlideshow(options);
      setShowSlideshowEditor(true);
      setStudioMode('slideshows'); // Ensure studioMode is set for breadcrumb
    }
  }, [selectedCategory, currentArtistId, setCategories, setSelectedCategory, setCurrentView]);

  const handleCloseSlideshowEditor = useCallback(() => {
    setShowSlideshowEditor(false);
    setEditingSlideshow(null);
    // Clear selected images so they don't persist into next editor session
    setSelectedLibraryMedia(prev => ({ ...prev, images: [] }));
  }, []);

  const handleSaveSlideshow = useCallback(async (slideshowData) => {
    // Scheduler edit mode: update the scheduledPost directly and return to scheduler
    if (schedulerEditPostId) {
      try {
        const firstSlide = slideshowData.slides?.[0];
        await updateScheduledPost(db, currentArtistId, schedulerEditPostId, {
          editorState: slideshowData,
          contentName: slideshowData.name || 'Edited Slideshow',
          thumbnail: firstSlide?.backgroundImage || firstSlide?.thumbnail || null
        });
        log('[VideoStudio] Updated scheduledPost (slideshow) from editor:', schedulerEditPostId);
      } catch (err) {
        console.error('[VideoStudio] Failed to update scheduledPost:', err);
      }
      setShowSlideshowEditor(false);
      setEditingSlideshow(null);
      setSchedulerEditPostId(null);
      setSelectedLibraryMedia(prev => ({ ...prev, images: [] }));
      setCurrentView('scheduling');
      return;
    }

    // Library mode: save via libraryService (with Firestore sync)
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        const data = {
          ...slideshowData,
          id: slideshowData.id || `slideshow_${Date.now()}`,
          createdAt: slideshowData.createdAt || new Date().toISOString(),
          status: slideshowData.status || 'draft'
        };
        const savedSlideshow = addCreatedSlideshow(currentArtistId, data);
        // Sync to Firestore for persistence across refreshes/devices
        if (db) {
          addCreatedSlideshowAsync(db, currentArtistId, data).catch(console.error);
        }
        log('[VideoStudio] Saved slideshow via library system:', savedSlideshow.id);
        setCreatedContentVersion(v => v + 1);
        setShowSlideshowEditor(false);
        setEditingSlideshow(null);
        setCurrentView('slideshows');
        setStudioMode('slideshows');
      }
      return;
    }

    const updateCategory = (cat) => {
      if (cat.id !== selectedCategory.id) return cat;

      // Initialize slideshows array if needed
      const slideshows = cat.slideshows || [];
      const existingIndex = slideshows.findIndex(s => s.id === slideshowData.id);

      if (existingIndex >= 0) {
        // Update existing
        const newSlideshows = [...slideshows];
        newSlideshows[existingIndex] = { ...slideshowData, updatedAt: new Date().toISOString() };
        return { ...cat, slideshows: newSlideshows };
      } else {
        // Add new
        return {
          ...cat,
          slideshows: [...slideshows, {
            ...slideshowData,
            id: `slideshow_${Date.now()}`,
            createdAt: new Date().toISOString(),
            status: 'draft'
          }]
        };
      }
    };

    setCategories(prev => prev.map(updateCategory));
    setSelectedCategory(prev => prev ? updateCategory(prev) : prev);

    setShowSlideshowEditor(false);
    setEditingSlideshow(null);
  }, [selectedCategory, currentArtistId, schedulerEditPostId, db]);

  // ============================================
  // IMAGE BANK HANDLERS (for Slideshow mode)
  // ============================================

  // Upload images to Image A or Image B bank
  const handleUploadImages = useCallback(async (files, bank = 'A') => {
    if (!selectedCategory) return;

    const bankKey = bank === 'A' ? 'imagesA' : 'imagesB';
    setUploadProgress({ type: 'image', current: 0, total: files.length });

    const uploadedImages = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        setUploadProgress({ type: 'image', current: i + 1, total: files.length, name: file.name, progress: 0 });

        // Upload to Firebase Storage
        const { url, path } = await uploadFile(file, 'images', (progress) => {
          setUploadProgress(prev => ({ ...prev, progress }));
        });

        // Create local blob for preview
        const localUrl = URL.createObjectURL(file);

        uploadedImages.push({
          id: `img_${Date.now()}_${i}`,
          name: file.name,
          url,
          localUrl,
          storagePath: path,
          width: 0, // Could detect with Image() if needed
          height: 0,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Failed to upload image:', file.name, error);
      }
    }

    if (uploadedImages.length > 0) {
      setCategories(prev => prev.map(cat =>
        cat.id === selectedCategory.id
          ? { ...cat, [bankKey]: [...(cat[bankKey] || []), ...uploadedImages] }
          : cat
      ));

      setSelectedCategory(prev => prev ? {
        ...prev,
        [bankKey]: [...(prev[bankKey] || []), ...uploadedImages]
      } : prev);
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  // Delete image from bank
  const handleDeleteBankImage = useCallback(async (imageId, bank = 'A') => {
    if (!selectedCategory) return;

    const bankKey = bank === 'A' ? 'imagesA' : 'imagesB';
    const images = selectedCategory[bankKey] || [];
    const image = images.find(img => img.id === imageId);

    if (image?.storagePath) {
      await deleteFile(image.storagePath);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, [bankKey]: (cat[bankKey] || []).filter(img => img.id !== imageId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      [bankKey]: (prev[bankKey] || []).filter(img => img.id !== imageId)
    } : prev);
  }, [selectedCategory]);

  // Delete a slideshow
  const handleDeleteSlideshow = useCallback((slideshowId) => {
    // Library mode: delete via libraryService (with Firestore sync)
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        deleteCreatedSlideshow(currentArtistId, slideshowId);
        if (db) {
          deleteCreatedSlideshowAsync(db, currentArtistId, slideshowId).catch(console.error);
        }
        setCreatedContentVersion(v => v + 1);
        // Cascade: remove any scheduled posts referencing this draft
        if (db && currentArtistId) {
          deletePostsByContentId(db, currentArtistId, slideshowId).catch(err =>
            console.warn('[VideoStudio] Cascade delete for slideshow failed:', err)
          );
        }
      }
      return;
    }

    // Category mode
    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, slideshows: (cat.slideshows || []).filter(s => s.id !== slideshowId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      slideshows: (prev.slideshows || []).filter(s => s.id !== slideshowId)
    } : prev);

    // Cascade: remove any scheduled posts referencing this draft
    if (db && currentArtistId) {
      deletePostsByContentId(db, currentArtistId, slideshowId).catch(err =>
        console.warn('[VideoStudio] Cascade delete for slideshow failed:', err)
      );
    }
  }, [selectedCategory, currentArtistId, db]);

  // ============================================
  // LYRIC BANK HANDLERS (shared between modes)
  // ============================================

  // Add lyrics to the bank
  const handleAddLyrics = useCallback(async (lyricsData) => {
    // Library mode: save via libraryService (Firestore + localStorage)
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        return addLyricsAsync(db, currentArtistId, {
          title: lyricsData.title || 'Untitled Lyrics',
          content: lyricsData.content || '',
          words: lyricsData.words || null
        });
      }
      return;
    }

    // Category mode
    const newLyrics = {
      id: `lyrics_${Date.now()}`,
      title: lyricsData.title || 'Untitled Lyrics',
      content: lyricsData.content || '',
      words: lyricsData.words || null,
      createdAt: new Date().toISOString()
    };

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, lyrics: [...(cat.lyrics || []), newLyrics] }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      lyrics: [...(prev.lyrics || []), newLyrics]
    } : prev);

    return newLyrics;
  }, [selectedCategory, currentArtistId, db]);

  // Update lyrics
  const handleUpdateLyrics = useCallback(async (lyricsId, updates) => {
    // Library mode
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        await updateLyricsAsync(db, currentArtistId, lyricsId, updates);
      }
      return;
    }

    // Category mode
    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            lyrics: (cat.lyrics || []).map(l =>
              l.id === lyricsId ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l
            )
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      lyrics: (prev.lyrics || []).map(l =>
        l.id === lyricsId ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l
      )
    } : prev);
  }, [selectedCategory, currentArtistId, db]);

  // Delete lyrics from bank
  const handleDeleteLyrics = useCallback(async (lyricsId) => {
    // Library mode
    if (!selectedCategory) {
      if (USE_LIBRARY_SYSTEM && currentArtistId) {
        await deleteLyricsAsync(db, currentArtistId, lyricsId);
      }
      return;
    }

    // Category mode
    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, lyrics: (cat.lyrics || []).filter(l => l.id !== lyricsId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      lyrics: (prev.lyrics || []).filter(l => l.id !== lyricsId)
    } : prev);
  }, [selectedCategory, currentArtistId, db]);

  const categoryPresets = presets.filter(p =>
    p.categoryId === selectedCategory?.id || p.categoryId === null || !p.categoryId
  );

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={{
        ...styles.header,
        ...(isMobile ? { padding: '10px 12px', flexWrap: 'wrap', gap: '8px' } : {})
      }}>
        <div style={{
          ...styles.headerLeft,
          ...(isMobile ? { minWidth: 0 } : {})
        }}>
          <button
            onClick={() => { setCurrentView('home'); setSelectedCategory(null); setStudioMode(null); }}
            style={styles.logoButton}
            title="Back to categories"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,3 19,12 5,21" fill="currentColor"/>
            </svg>
            {!isMobile && <span style={styles.logoText}>Studio</span>}
          </button>

          {/* Single artist indicator - hide on mobile (only when 1 artist) */}
          {!isMobile && artists.length === 1 && currentArtistId && (
            <span style={styles.singleArtistLabel}>
              {artists[0]?.name}
            </span>
          )}
        </div>

        <div style={{
          ...styles.headerCenter,
          ...(isMobile ? { flex: '1 1 auto', order: 3, width: '100%', justifyContent: 'flex-start' } : {})
        }}>
          {/* Comprehensive Breadcrumb Navigation */}
          <div style={{
            ...styles.breadcrumb,
            ...(isMobile ? { fontSize: '11px', padding: '4px 8px', overflowX: 'auto', maxWidth: '100%' } : {})
          }}>
            {/* CATEGORY-BASED MODE: When selectedCategory exists */}
            {selectedCategory && (
              <>
                {/* Root: Categories */}
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...((!showEditor && !showSlideshowEditor) ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => {
                    setCurrentView('home');
                    setSelectedCategory(null);
                    setStudioMode(null);
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  }}
                >
                  Categories
                </button>

                {/* Category Name */}
                <span style={styles.breadcrumbSep}>/</span>
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...((currentView === 'home' && !studioMode && !showEditor && !showSlideshowEditor) ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => {
                    setCurrentView('home');
                    setStudioMode(null);
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  }}
                >
                  {selectedCategory.name}
                </button>

                {/* Mode: Videos or Slideshows */}
                {(studioMode || currentView === 'library' || currentView === 'slideshows' || showEditor || showSlideshowEditor) && (
                  <>
                    <span style={styles.breadcrumbSep}>/</span>
                    <button
                      style={{
                        ...styles.breadcrumbLink,
                        ...((currentView === 'home' && studioMode && !showEditor && !showSlideshowEditor) ? styles.breadcrumbCurrent : {})
                      }}
                      onClick={() => {
                        setCurrentView('home');
                        // Keep studioMode, determine from context
                        const mode = studioMode || (currentView === 'slideshows' || showSlideshowEditor ? 'slideshows' : 'videos');
                        setStudioMode(mode);
                        setShowEditor(false);
                        setShowSlideshowEditor(false);
                      }}
                    >
                      {(studioMode === 'slideshows' || currentView === 'slideshows' || showSlideshowEditor) ? 'Slideshows' : 'Videos'}
                    </button>
                  </>
                )}

                {/* Dashboard (Content Library) */}
                {(currentView === 'library' || currentView === 'slideshows' || showEditor || showSlideshowEditor) && (
                  <>
                    <span style={styles.breadcrumbSep}>/</span>
                    <button
                      style={{
                        ...styles.breadcrumbLink,
                        ...(!showEditor && !showSlideshowEditor ? styles.breadcrumbCurrent : {})
                      }}
                      onClick={() => {
                        const targetView = studioMode === 'slideshows' || currentView === 'slideshows' || showSlideshowEditor ? 'slideshows' : 'library';
                        setCurrentView(targetView);
                        setShowEditor(false);
                        setShowSlideshowEditor(false);
                      }}
                    >
                      Dashboard
                    </button>
                  </>
                )}

                {/* Editor */}
                {(showEditor || showSlideshowEditor) && (
                  <>
                    <span style={styles.breadcrumbSep}>/</span>
                    <span style={styles.breadcrumbCurrent}>Editor</span>
                  </>
                )}
              </>
            )}

            {/* LIBRARY-BASED MODE: Linear breadcrumb trail (Wave 4 v2) */}
            {/* Dashboard > Studio > Videos > Slideshows > Drafts > Schedule */}
            {USE_LIBRARY_SYSTEM && !selectedCategory && (
              <>
                {/* 1. Dashboard */}
                <button
                  style={styles.breadcrumbLink}
                  onClick={() => navigateWithDraftCheck(onClose)}
                >
                  Dashboard
                </button>
                <span style={styles.breadcrumbSep}>/</span>

                {/* 2. Studio */}
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...(currentView === 'home' && !showEditor && !showSlideshowEditor ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => navigateWithDraftCheck(() => {
                    setCurrentView('home');
                    setStudioMode(null);
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  })}
                >
                  Studio
                </button>
                <span style={styles.breadcrumbSep}>/</span>

                {/* 3. Videos (Video Studio) */}
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...((currentView === 'home' && studioMode === 'videos') || (showEditor && studioMode !== 'slideshows') ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => navigateWithDraftCheck(() => {
                    setCurrentView('home');
                    setStudioMode('videos');
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  })}
                >
                  Videos
                </button>
                <span style={styles.breadcrumbSep}>/</span>

                {/* 4. Slideshows (Slideshow Studio) */}
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...((currentView === 'home' && studioMode === 'slideshows') || showSlideshowEditor ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => navigateWithDraftCheck(() => {
                    setCurrentView('home');
                    setStudioMode('slideshows');
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  })}
                >
                  Slideshows
                </button>
                <span style={styles.breadcrumbSep}>/</span>

                {/* 5. Drafts (swap between video drafts and slideshow drafts) */}
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...(currentView === 'drafts' ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => navigateWithDraftCheck(() => {
                    setCurrentView('drafts');
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  })}
                >
                  Drafts
                </button>
                <span style={styles.breadcrumbSep}>/</span>

                {/* 6. Schedule */}
                <button
                  style={{
                    ...styles.breadcrumbLink,
                    ...(currentView === 'scheduling' ? styles.breadcrumbCurrent : {})
                  }}
                  onClick={() => navigateWithDraftCheck(() => {
                    setCurrentView('scheduling');
                    setShowEditor(false);
                    setShowSlideshowEditor(false);
                  })}
                >
                  Schedule
                </button>

                {/* Editor context (when inside an editor) */}
                {(showEditor || showSlideshowEditor) && (
                  <>
                    <span style={styles.breadcrumbSep}>/</span>
                    <span style={styles.breadcrumbCurrent}>
                      {showSlideshowEditor ? 'Slideshow Editor' : 'Video Editor'}
                    </span>
                  </>
                )}
              </>
            )}
          </div>

        </div>

        <div style={{
          ...styles.headerRight,
          ...(isMobile ? { order: 2, marginLeft: 'auto' } : {})
        }}>
          <button
            onClick={() => {
              // Navigate back within studio before exiting entirely
              if (showEditor || showSlideshowEditor) {
                // Close editor, go back to content library / dashboard
                setShowEditor(false);
                setShowSlideshowEditor(false);
                const targetView = studioMode === 'slideshows' ? 'slideshows' : 'library';
                setCurrentView(targetView);
              } else if (currentView === 'library' || currentView === 'slideshows') {
                // Go back to studio home
                setCurrentView('home');
                setStudioMode(null);
              } else if (studioMode) {
                // Go back to studio home
                setCurrentView('home');
                setStudioMode(null);
              } else {
                // Already at home, actually close the studio
                onClose();
              }
            }}
            style={{
              ...styles.closeButton,
              ...(isMobile ? {
                width: '44px',
                height: '44px',
                minWidth: '44px',
                minHeight: '44px',
                zIndex: 10
              } : {})
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Artist Selector Bar — centered between header and content */}
      {artists.length > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '6px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select
              value={currentArtistId || ''}
              onChange={(e) => handleArtistIdChange(e.target.value)}
              style={{
                appearance: 'none',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                color: '#e4e4e7',
                fontSize: '14px',
                fontWeight: '600',
                padding: '6px 32px 6px 14px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {artists.map(artist => (
                <option key={artist.id} value={artist.id} style={{ background: '#18181b' }}>
                  {artist.name}
                </option>
              ))}
            </select>
            <svg style={{ position: 'absolute', right: '10px', pointerEvents: 'none', color: '#71717a' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main style={styles.main}>
        {currentView === 'home' && USE_LIBRARY_SYSTEM && !selectedCategory && (
          <StudioHome
            db={db}
            artistId={currentArtistId}
            artists={artists}
            studioMode={studioMode}
            onSetStudioMode={setStudioMode}
            onMakeVideo={(options) => {
              // If coming from library system, create a temporary category-like structure
              if (options?.libraryVideos || options?.libraryAudio) {
                setSelectedLibraryMedia({
                  videos: options.libraryVideos || [],
                  audio: options.libraryAudio || null,
                  images: [],
                  lyrics: options.libraryLyrics || []
                });
                setPullFromCollection(options.pullFromCollection);
              }
              handleMakeVideo(options?.existingVideo || null);
            }}
            onMakeSlideshow={(options) => {
              if (options?.libraryImages || options?.libraryAudio || options?.libraryLyrics) {
                setSelectedLibraryMedia(prev => ({
                  ...prev,
                  images: options.libraryImages || prev.images,
                  audio: options.libraryAudio || prev.audio,
                  lyrics: options.libraryLyrics || prev.lyrics,
                  selectedBanks: options.selectedBanks || prev.selectedBanks || null
                }));
              }
              if (options?.collectionId) {
                setPullFromCollection(options.collectionId);
              }
              handleMakeSlideshow(options?.existingSlideshow || null);
            }}
            onViewContent={(options) => {
              // For now, create a default category to view content
              const isSlideshows = options?.type === 'slideshows';
              setCurrentView(isSlideshows ? 'slideshows' : 'library');
              setStudioMode(isSlideshows ? 'slideshows' : 'videos');
              // Select first category if none selected
              if (!selectedCategory && artistCategories.length > 0) {
                setSelectedCategory(artistCategories[0]);
              }
            }}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            onAddLyrics={handleAddLyrics}
            onUpdateLyrics={handleUpdateLyrics}
            onDeleteLyrics={handleDeleteLyrics}
            onViewScheduling={() => setCurrentView('scheduling')}
          />
        )}

        {currentView === 'home' && (!USE_LIBRARY_SYSTEM || selectedCategory) && (
          <AestheticHome
            artists={artists}
            selectedArtist={selectedArtist}
            onSelectArtist={setSelectedArtist}
            categories={artistCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            onCreateCategory={handleCreateCategory}
            // Studio mode (lifted for breadcrumb)
            studioMode={studioMode}
            onSetStudioMode={setStudioMode}
            // Video banks
            onUploadVideos={handleUploadVideos}
            onUploadAudio={handleUploadAudio}
            onSaveAudioClip={handleSaveAudioClip}
            onEditAudio={handleEditAudio}
            onDeleteBankVideo={handleDeleteBankVideo}
            onDeleteBankAudio={handleDeleteBankAudio}
            onRenameBankVideo={handleRenameBankVideo}
            onRenameBankAudio={handleRenameBankAudio}
            // Image banks (for slideshows)
            onUploadImages={handleUploadImages}
            onDeleteBankImage={handleDeleteBankImage}
            // Lyric bank (shared)
            onAddLyrics={handleAddLyrics}
            onUpdateLyrics={handleUpdateLyrics}
            onDeleteLyrics={handleDeleteLyrics}
            // Actions
            onCreateContent={handleCreateContent}
            onMakeVideo={handleMakeVideo}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            onViewContent={() => {
              setCurrentView('drafts');
              setShowEditor(false);
              setShowSlideshowEditor(false);
            }}
            onMakeSlideshow={handleMakeSlideshow}
            onEditSlideshow={(slideshow) => handleMakeSlideshow(slideshow)}
            onDeleteSlideshow={handleDeleteSlideshow}
          />
        )}

        {currentView === 'library' && (selectedCategory || (USE_LIBRARY_SYSTEM && libraryCategory)) && (
          <ContentLibrary
            category={selectedCategory || libraryCategory}
            contentType="videos"
            onBack={() => setCurrentView('home')}
            onMakeVideo={handleMakeVideo}
            onEditVideo={handleMakeVideo}
            onDeleteVideo={handleDeleteVideo}
            onApproveVideo={handleApproveVideo}
            onUpdateVideo={handleUpdateVideo}
            onSchedulePost={onSchedulePost}
            onViewScheduling={() => setCurrentView('scheduling')}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            db={db}
            accounts={accounts}
            lateAccountIds={lateAccountIds}
            artistId={currentArtistId}
          />
        )}

        {currentView === 'slideshows' && (selectedCategory || (USE_LIBRARY_SYSTEM && libraryCategory)) && (
          <ContentLibrary
            category={selectedCategory || libraryCategory}
            contentType="slideshows"
            onBack={() => setCurrentView('home')}
            onMakeSlideshow={handleMakeSlideshow}
            onEditSlideshow={(slideshow) => handleMakeSlideshow(slideshow)}
            onDeleteSlideshow={handleDeleteSlideshow}
            onSchedulePost={onSchedulePost}
            onViewScheduling={() => setCurrentView('scheduling')}
            onShowBatchPipeline={() => {
              handleMakeSlideshow({ batch: true });
            }}
            db={db}
            accounts={accounts}
            lateAccountIds={lateAccountIds}
            artistId={currentArtistId}
          />
        )}

        {/* Drafts View — swap between video and slideshow drafts */}
        {currentView === 'drafts' && (selectedCategory || (USE_LIBRARY_SYSTEM && libraryCategory)) && (
          <DraftsView
            category={selectedCategory || libraryCategory}
            onBack={() => setCurrentView('home')}
            onMakeVideo={handleMakeVideo}
            onEditVideo={handleMakeVideo}
            onDeleteVideo={handleDeleteVideo}
            onApproveVideo={handleApproveVideo}
            onUpdateVideo={handleUpdateVideo}
            onMakeSlideshow={handleMakeSlideshow}
            onEditSlideshow={(slideshow) => handleMakeSlideshow(slideshow)}
            onDeleteSlideshow={handleDeleteSlideshow}
            onSchedulePost={onSchedulePost}
            onViewScheduling={() => setCurrentView('scheduling')}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            db={db}
            accounts={accounts}
            lateAccountIds={lateAccountIds}
            artistId={currentArtistId}
          />
        )}

        {currentView === 'scheduling' && (
          <SchedulingPage
            db={db}
            artistId={currentArtistId}
            accounts={accounts}
            lateAccountIds={lateAccountIds}
            onSchedulePost={onSchedulePost}
            onEditDraft={(post) => {
              if (post.editorState) {
                setSchedulerEditPostId(post.id); // Track which scheduledPost we're editing
                if (post.contentType === 'slideshow') {
                  handleMakeSlideshow(post.editorState);
                } else {
                  handleMakeVideo(post.editorState);
                }
              }
            }}
            onBack={() => setCurrentView('home')}
          />
        )}

        {/* Drafts bar removed — replaced by View Drafts buttons in StudioHome action bars and dashboard */}
      </main>

      {/* Editor Modal with ErrorBoundary to prevent blank page crashes */}
      {showEditor && (selectedCategory || USE_LIBRARY_SYSTEM) && (
        <EditorErrorBoundary onClose={handleCloseEditor}>
          <VideoEditorModal
            category={selectedCategory || {
              id: 'library-session',
              name: 'Library',
              videos: selectedLibraryMedia.videos.map(v => ({
                ...v,
                src: v.url,
                localUrl: v.localUrl || v.url,
                thumbnail: v.thumbnail || null,
                name: v.name || v.metadata?.originalName || 'Clip'
              })),
              audio: selectedLibraryMedia.audio ? [{
                ...selectedLibraryMedia.audio,
                src: selectedLibraryMedia.audio.url,
                localUrl: selectedLibraryMedia.audio.localUrl || selectedLibraryMedia.audio.url,
                savedLyrics: []
              }] : [],
              lyrics: selectedLibraryMedia.lyrics || [],
              createdVideos: [],
              defaultPreset: null,
              captionTemplate: '',
              defaultHashtags: ''
            }}
            existingVideo={editingVideo}
            presets={categoryPresets}
            onSave={handleSaveVideo}
            onSavePreset={handleSavePreset}
            onSaveLyrics={handleSaveLyricsToAudio}
            onAddLyrics={handleAddLyrics}
            onUpdateLyrics={handleUpdateLyrics}
            onDeleteLyrics={handleDeleteLyrics}
            onShowBatchPipeline={schedulerEditPostId ? null : (settings) => {
              setBatchLyricSettings(settings || null);
              setShowBatchPipeline(true);
            }}
            onClose={() => { handleCloseEditor(); setSchedulerEditPostId(null); }}
            artistId={currentArtistId}
            db={db}
            showTemplatePicker={schedulerEditPostId ? false : showTemplatePicker}
            schedulerEditMode={!!schedulerEditPostId}
          />
        </EditorErrorBoundary>
      )}

      {/* Slideshow Editor Modal */}
      {showSlideshowEditor && (selectedCategory || (USE_LIBRARY_SYSTEM && currentArtistId)) && (
        <SlideshowEditor
          db={db}
          artistId={currentArtistId}
          category={selectedCategory || {
            id: 'library-session',
            name: 'Library',
            imagesA: [],
            imagesB: [],
            slideshows: []
          }}
          existingSlideshow={editingSlideshow}
          initialImages={selectedLibraryMedia?.images || []}
          initialAudio={selectedLibraryMedia?.audio || null}
          initialLyrics={selectedLibraryMedia?.lyrics || []}
          initialSelectedBanks={selectedLibraryMedia?.selectedBanks || null}
          batchMode={slideshowBatchMode}
          onSave={handleSaveSlideshow}
          onClose={() => { handleCloseSlideshowEditor(); setSchedulerEditPostId(null); }}
          onSchedulePost={schedulerEditPostId ? null : onSchedulePost}
          onAddLyrics={handleAddLyrics}
          onImportToBank={handleUploadImages}
          lateAccountIds={lateAccountIds}
          schedulerEditMode={!!schedulerEditPostId}
        />
      )}

      {/* Batch Pipeline - Streamlined batch create & schedule */}
      {showBatchPipeline && selectedCategory && (
        <BatchPipeline
          category={selectedCategory}
          lateAccountIds={lateAccountIds}
          onSchedulePost={onSchedulePost}
          initialWords={batchLyricSettings?.words}
          initialTextStyle={batchLyricSettings?.textStyle}
          onClose={() => {
            setShowBatchPipeline(false);
            setBatchLyricSettings(null); // Clear settings when closing
          }}
          onSaveLyrics={(audioId, lyricsData) => handleSaveLyricsToAudio(audioId, lyricsData)}
          onVideosCreated={(videos) => {
            // Add created videos to category
            setCategories(prev => prev.map(cat =>
              cat.id === selectedCategory.id
                ? { ...cat, createdVideos: [...cat.createdVideos, ...videos] }
                : cat
            ));
            setSelectedCategory(prev => prev ? {
              ...prev,
              createdVideos: [...prev.createdVideos, ...videos]
            } : prev);
          }}
          onEditVideo={(video) => {
            // Open video in full editor
            setShowBatchPipeline(false);
            handleMakeVideo(video);
          }}
          onNavigateToLibrary={() => {
            // Navigate to content library to view drafts
            setShowBatchPipeline(false);
            setCurrentView('library');
            setStudioMode('videos');
          }}
        />
      )}

      {/* Wave 4: Save Draft Prompt */}
      <ConfirmDialog
        isOpen={draftDialog.isOpen}
        title="Unsaved Changes"
        message="You have unsaved work in the editor. Do you want to discard your changes and navigate away?"
        variant="destructive"
        confirmText="Discard"
        onConfirm={handleDraftDialogDiscard}
        onCancel={handleDraftDialogCancel}
      />

      {/* UI-20: Upload Progress Overlay */}
      {uploadProgress && (
        <div style={styles.uploadOverlay}>
          <div style={styles.uploadModal}>
            <div style={styles.uploadIcon}>
              {uploadProgress.type === 'video' ? '🎬' : uploadProgress.type === 'image' ? '🖼️' : '🎵'}
            </div>
            <h3 style={styles.uploadTitle}>
              Uploading {uploadProgress.type === 'video' ? 'Videos' : uploadProgress.type === 'image' ? 'Images' : 'Audio'}
            </h3>
            <p style={styles.uploadStatus}>
              {uploadProgress.current} of {uploadProgress.total}
              {uploadProgress.name && ` — ${uploadProgress.name}`}
            </p>
            <div style={styles.uploadProgressBar}>
              <div
                style={{
                  ...styles.uploadProgressFill,
                  width: `${uploadProgress.progress || 0}%`,
                  backgroundColor: uploadProgress.type === 'image' ? '#14b8a6' : '#7c3aed'
                }}
              />
            </div>
            <p style={styles.uploadPercent}>
              {Math.round(uploadProgress.progress || 0)}%
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme) => ({
  container: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: theme.bg.page,
    backdropFilter: 'blur(8px)',
    color: theme.text.primary,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 0 60px rgba(0, 0, 0, 0.8)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    backgroundColor: theme.bg.surface,
    borderBottom: `1px solid ${theme.border.subtle}`
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    minWidth: '180px'
  },
  headerCenter: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    minWidth: '180px',
    justifyContent: 'flex-end'
  },
  logoButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.primary,
    cursor: 'pointer',
    borderRadius: '8px'
  },
  logoText: {
    fontSize: '15px',
    fontWeight: '600'
  },
  artistSelector: {
    position: 'relative',
    marginLeft: '12px',
    paddingLeft: '12px',
    borderLeft: '1px solid #2a2a3e'
  },
  artistSelect: {
    appearance: 'none',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: `1px solid ${theme.border.default}`,
    borderRadius: '6px',
    padding: '6px 28px 6px 10px',
    color: theme.text.primary,
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    outline: 'none'
  },
  artistSelectIcon: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
    color: '#9ca3af'
  },
  singleArtistLabel: {
    marginLeft: '12px',
    paddingLeft: '12px',
    borderLeft: '1px solid #2a2a3e',
    fontSize: '13px',
    fontWeight: '500',
    color: '#9ca3af'
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: '6px 12px',
    borderRadius: '6px'
  },
  breadcrumbLink: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    transition: 'color 0.2s, background-color 0.2s'
  },
  breadcrumbSep: {
    color: '#4b5563'
  },
  breadcrumbCurrent: {
    color: '#fff',
    fontWeight: '500',
    cursor: 'default'
  },
  // Wave 4: Quick-nav breadcrumb links (always visible)
  breadcrumbQuickLink: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    transition: 'color 0.15s, background-color 0.15s'
  },
  breadcrumbQuickLinkActive: {
    color: '#a5b4fc',
    backgroundColor: 'rgba(99, 102, 241, 0.15)'
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '8px'
  },
  main: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  // UI-20: Upload progress overlay styles
  uploadOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  },
  uploadModal: {
    backgroundColor: theme.bg.surface,
    borderRadius: '16px',
    padding: '32px 48px',
    textAlign: 'center',
    minWidth: '300px'
  },
  uploadIcon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  uploadTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: theme.text.primary,
    margin: '0 0 8px 0'
  },
  uploadStatus: {
    fontSize: '13px',
    color: theme.text.secondary,
    margin: '0 0 20px 0'
  },
  uploadProgressBar: {
    width: '100%',
    height: '6px',
    backgroundColor: theme.bg.elevated,
    borderRadius: '3px',
    overflow: 'hidden'
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: theme.accent.primary,
    borderRadius: '3px',
    transition: 'width 0.3s ease'
  },
  uploadPercent: {
    fontSize: '24px',
    fontWeight: '700',
    color: theme.accent.primary,
    margin: '16px 0 0 0'
  }
});

export default VideoStudio;
