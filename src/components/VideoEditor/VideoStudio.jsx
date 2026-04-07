import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import useIsMobile from '../../hooks/useIsMobile';
import { convertImageFilesIfNeeded } from '../../utils/imageConverter';
import StudioHome from './StudioHome';
import ContentLibrary from './ContentLibrary';
import ProjectLanding from './ProjectLanding';
import ProjectWorkspace from './ProjectWorkspace';

// Lazy-load heavy editor/page components (only one visible at a time)
const VideoEditorModal = React.lazy(() => import('./VideoEditorModal'));
const BatchPipeline = React.lazy(() => import('./BatchPipeline'));
const SlideshowEditor = React.lazy(() => import('./SlideshowEditor'));
const SchedulingPage = React.lazy(() => import('./SchedulingPage'));
const StudioLibrary = React.lazy(() => import('./StudioLibrary'));
const ProjectWizard = React.lazy(() => import('./ProjectWizard'));
// OnboardingModal removed - auto-setup Music Artist template instead
import {
  uploadFile,
  uploadFileWithQuota,
  deleteFile,
  getMediaDuration,
  generateThumbnail,
} from '../../services/firebaseStorage';
import { decrementStorageUsed } from '../../services/storageQuotaService';
import { generateSlideThumbnail } from '../../services/slideshowExportService';
import {
  saveCategories,
  loadCategories,
  savePresets,
  loadPresets,
  cleanupStorage,
  saveArtistCategories,
  loadArtistCategories,
  saveArtistPresets,
  loadArtistPresets,
  setLastArtistId,
  getLastArtistId,
  hasLegacyData,
  migrateToArtistStorage,
} from '../../services/storageService';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { FeatherX } from '@subframe/core';
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
  softDeleteCreatedVideoAsync,
  restoreCreatedContentAsync,
  getDeletedContentAsync,
  permanentlyDeleteContentAsync,
  loadCreatedContentAsync,
  saveCreatedContentAsync,
  addLyricsAsync,
  updateLyricsAsync,
  deleteLyricsAsync,
  MEDIA_TYPES,
  STARTER_TEMPLATES,
  FORMAT_TEMPLATES,
  migrateToProjects,
  migrateDraftsToNiches,
  saveClipperSession,
  getPipelineBankLabel,
  migrateCollectionBanks,
  subscribeToCreatedContent,
  removeFromLibraryAsync,
  getUserCollections,
  subscribeToLibrary,
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
    const cleanCategories = categories.map((cat) => ({
      id: cat.id,
      artistId: cat.artistId || artistId,
      name: cat.name || '',
      description: cat.description || '',
      accountHandle: cat.accountHandle || '',
      videos: (cat.videos || [])
        .filter((v) => v.url && !v.url.startsWith('blob:'))
        .map(({ file, localUrl, thumbnail, ...rest }) => rest),
      audio: (cat.audio || [])
        .filter((a) => a.url && !a.url.startsWith('blob:'))
        .map(({ file, localUrl, ...rest }) => rest),
      createdVideos: (cat.createdVideos || []).map((v) => ({
        ...v,
        clips: (v.clips || []).map(({ file, localUrl, thumbnail, ...rest }) => rest),
      })),
      imagesA: (cat.imagesA || []).filter((img) => img.url && !img.url.startsWith('blob:')),
      imagesB: (cat.imagesB || []).filter((img) => img.url && !img.url.startsWith('blob:')),
      slideshows: cat.slideshows || [],
      lyrics: cat.lyrics || [],
      defaultPreset: cat.defaultPreset || null,
      captionTemplate: cat.captionTemplate || '',
      defaultHashtags: cat.defaultHashtags || '',
    }));

    const docRef = doc(db, 'artists', artistId, 'studio', FIRESTORE_CATEGORY_DOC);
    await setDoc(
      docRef,
      { categories: cleanCategories, updatedAt: new Date().toISOString() },
      { merge: true },
    );
  } catch (error) {
    log.warn('[VideoStudio] Failed to save categories to Firestore:', error.message);
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
    log.warn('[VideoStudio] Failed to load categories from Firestore:', error.message);
    return null;
  }
}

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
    log.error('VideoEditorModal Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: '#1a1a2e',
              padding: '32px',
              borderRadius: '12px',
              maxWidth: '500px',
              textAlign: 'center',
            }}
          >
            <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>Something went wrong</h2>
            <p style={{ color: '#9ca3af', marginBottom: '24px' }}>
              The video editor encountered an error. Please try again.
            </p>
            <button
              onClick={() => {
                // Reset error state BEFORE closing so the boundary is clean for next use
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
                fontSize: '14px',
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
      log.debug('[Session] Loaded:', parsed);
      return parsed;
    }
  } catch (e) {
    log.warn('Failed to load session state:', e);
  }
  return null;
};

// Helper to save session state
const saveSessionState = (state) => {
  try {
    const toSave = {
      ...state,
      savedAt: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(toSave));
    log.debug('[Session] Saved:', toSave);
  } catch (e) {
    log.warn('Failed to save session state:', e);
  }
};

/**
 * DraftsView — Tabbed view that swaps between video drafts and slideshow drafts
 */
const DraftsView = (props) => {
  const [draftsTab, setDraftsTab] = useState('videos');
  const { theme } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ContentLibrary
          category={props.category}
          contentType={draftsTab}
          isDraftsView={true}
          collectionFilter={props.collectionFilter}
          onBack={props.onBack}
          onMakeVideo={props.onMakeVideo}
          onEditVideo={props.onEditVideo}
          onDeleteVideo={props.onDeleteVideo}
          onApproveVideo={props.onApproveVideo}
          onUpdateVideo={props.onUpdateVideo}
          onMakeSlideshow={props.onMakeSlideshow}
          onEditSlideshow={props.onEditSlideshow}
          onEditMultipleSlideshows={props.onEditMultipleSlideshows}
          onDeleteSlideshow={props.onDeleteSlideshow}
          onSchedulePost={props.onSchedulePost}
          onViewScheduling={props.onViewScheduling}
          onShowBatchPipeline={props.onShowBatchPipeline}
          db={props.db}
          accounts={props.accounts}
          lateAccountIds={props.lateAccountIds}
          artistId={props.artistId}
          onRestoreContent={props.onRestoreContent}
          onPermanentDelete={props.onPermanentDelete}
          onGetDeletedContent={props.onGetDeletedContent}
          onRemixDraft={props.onRemixDraft}
          draftsTab={draftsTab}
          onDraftsTabChange={setDraftsTab}
        />
      </div>
    </div>
  );
};

/**
 * AllMediaView — Three-column layout: Photos, Videos, Audio
 * Supports click-to-select, shift-click range select, batch delete, individual delete
 */
const AllMediaView = ({ db, artistId, onBack }) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [library, setLibrary] = useState(() => (artistId ? getLibrary(artistId) : []));
  const [selected, setSelected] = useState(new Set());
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const lastClickedRef = useRef(null);

  useEffect(() => {
    if (!artistId) return;
    setLibrary(getLibrary(artistId));
    setSelected(new Set());
  }, [artistId]);

  // Re-read library after deletes
  const refreshLibrary = useCallback(() => {
    if (artistId) setLibrary(getLibrary(artistId));
  }, [artistId]);

  const photos = useMemo(() => library.filter((m) => m.type === MEDIA_TYPES.IMAGE), [library]);
  const videos = useMemo(() => library.filter((m) => m.type === MEDIA_TYPES.VIDEO), [library]);
  const audio = useMemo(() => library.filter((m) => m.type === MEDIA_TYPES.AUDIO), [library]);

  const getThumb = (item) => {
    if (item.thumbnailUrl) return item.thumbnailUrl;
    if (item.type !== MEDIA_TYPES.VIDEO) return item.url || item.localUrl;
    return null; // Videos without thumbnails get a placeholder
  };

  // Click handler with shift-range support
  const handleItemClick = useCallback((id, items, e) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedRef.current) {
        // Range select within the same column
        const lastIdx = items.findIndex((i) => i.id === lastClickedRef.current);
        const curIdx = items.findIndex((i) => i.id === id);
        if (lastIdx >= 0 && curIdx >= 0) {
          const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
          for (let i = start; i <= end; i++) next.add(items[i].id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedRef.current = id;
  }, []);

  // Delete single item
  const handleDelete = useCallback(
    (item) => {
      setConfirmDialog({
        isOpen: true,
        title: 'Delete Media',
        message: `Delete "${item.name || 'this item'}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: async () => {
          try {
            await removeFromLibraryAsync(db, artistId, item.id);
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
            });
            refreshLibrary();
            toastSuccess('Media deleted');
          } catch (err) {
            log.error('[AllMedia] Delete failed:', err);
            toastError('Failed to delete');
          }
          setConfirmDialog({ isOpen: false });
        },
      });
    },
    [db, artistId, refreshLibrary, toastSuccess, toastError],
  );

  // Batch delete
  const handleDeleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Selected',
      message: `Delete ${selected.size} item${selected.size !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete All',
      isLoading: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
        let deleted = 0;
        for (const id of selected) {
          try {
            await removeFromLibraryAsync(db, artistId, id);
            deleted++;
          } catch (err) {
            log.error('[AllMedia] Batch delete failed:', id, err);
          }
        }
        setSelected(new Set());
        refreshLibrary();
        if (deleted > 0) toastSuccess(`Deleted ${deleted} item${deleted !== 1 ? 's' : ''}`);
        setConfirmDialog({ isOpen: false });
      },
    });
  }, [selected, db, artistId, refreshLibrary, toastSuccess, toastError]);

  const selectAll = useCallback(() => {
    setSelected(new Set(library.map((i) => i.id)));
  }, [library]);

  const Column = ({ title, items, type }) => (
    <div className="flex flex-1 flex-col items-start gap-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-body-bold font-body-bold text-[#ffffffff]">{title}</span>
        <span className="text-caption font-caption text-neutral-500">{items.length}</span>
      </div>
      <div
        className="flex flex-col gap-2 w-full overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 220px)' }}
      >
        {items.length === 0 && (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-[#1a1a1aff] px-4 py-8">
            <span className="text-caption font-caption text-neutral-500">
              No {title.toLowerCase()}
            </span>
          </div>
        )}
        {type === 'audio' ? (
          items.map((item) => {
            const isSelected = selected.has(item.id);
            return (
              <div
                key={item.id}
                className={`group flex items-center gap-3 rounded-lg border border-solid px-3 py-2.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-neutral-200 bg-[#1a1a1aff] hover:bg-neutral-100/20'
                }`}
                onClick={(e) => handleItemClick(item.id, items, e)}
              >
                <div
                  className={`flex h-9 w-9 flex-none items-center justify-center rounded-md ${isSelected ? 'bg-indigo-500/30' : 'bg-indigo-500/10'}`}
                >
                  {isSelected ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth="2"
                    >
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  )}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-caption font-caption text-neutral-200 truncate">
                    {item.name || 'Untitled'}
                  </span>
                  {item.duration && (
                    <span className="text-caption font-caption text-neutral-500">
                      {Math.round(item.duration)}s
                    </span>
                  )}
                </div>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded bg-transparent border-none cursor-pointer text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item);
                  }}
                  title="Delete"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })
        ) : (
          <div className="grid grid-cols-3 gap-2 w-full">
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              const thumb = getThumb(item);
              return (
                <div
                  key={item.id}
                  className={`group flex flex-col rounded-lg border border-solid overflow-hidden cursor-pointer transition-colors ${
                    isSelected ? 'border-indigo-500' : 'border-neutral-200 hover:border-neutral-100'
                  }`}
                  style={{ background: '#1a1a1a' }}
                  onClick={(e) => handleItemClick(item.id, items, e)}
                >
                  <div className="w-full aspect-square bg-[#171717] relative">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#525252"
                          strokeWidth="1.5"
                        >
                          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                          <line x1="10" y1="8" x2="10" y2="16" />
                          <polygon points="15 12 10 8 10 16 15 12" />
                        </svg>
                      </div>
                    )}
                    {type === 'video' && item.duration && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
                        {Math.round(item.duration)}s
                      </span>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-indigo-500/25 flex items-center justify-center pointer-events-none">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                    <button
                      className="absolute top-1 right-1 z-[4] flex h-6 w-6 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      title="Delete"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                  <div className="px-2 py-1.5">
                    <span className="text-caption font-caption text-neutral-300 truncate block">
                      {item.name || 'Untitled'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="flex w-full flex-col items-start bg-black px-8 py-8 overflow-hidden"
      style={{ maxHeight: '100%' }}
    >
      <div className="flex w-full items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">All Media</span>
          <span className="text-caption font-caption text-neutral-500">{library.length} items</span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-caption font-caption text-indigo-400">
                {selected.size} selected
              </span>
              <button
                className="flex items-center gap-1.5 rounded-md bg-red-500/15 border border-red-500/30 px-3 py-1.5 text-caption font-caption text-red-400 cursor-pointer hover:bg-red-500/25 transition-colors"
                onClick={handleDeleteSelected}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete ({selected.size})
              </button>
              <button
                className="rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-caption font-caption text-neutral-400 cursor-pointer hover:text-white transition-colors"
                onClick={() => setSelected(new Set())}
              >
                Deselect
              </button>
            </>
          )}
          {selected.size === 0 && library.length > 0 && (
            <button
              className="rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-caption font-caption text-neutral-400 cursor-pointer hover:text-white transition-colors"
              onClick={selectAll}
            >
              Select All
            </button>
          )}
        </div>
      </div>
      <div className="flex w-full gap-6 flex-1 min-h-0">
        <Column title="Photos" items={photos} type="image" />
        <Column title="Videos" items={videos} type="video" />
        <Column title="Audio" items={audio} type="audio" />
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant="destructive"
        isLoading={confirmDialog.isLoading}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false })}
      />
    </div>
  );
};

// Module-level constants (avoid re-allocation on every render)
const defaultCategories = [
  {
    id: 'boon-runway',
    artistId: 'boon',
    name: 'Runway',
    description: 'High fashion editorial content',
    accountHandle: '@margiela.mommy',
    thumbnail: null,
    videos: [],
    audio: [],
    createdVideos: [],
    imagesA: [],
    imagesB: [],
    slideshows: [],
    lyrics: [],
    defaultPreset: {
      textStyle: {
        fontSize: 48,
        fontFamily: "'Playfair Display', serif",
        fontWeight: '300',
        color: '#ffffff',
        outline: true,
        outlineColor: 'rgba(0,0,0,0.3)',
        textCase: 'upper',
      },
      cutStyle: 'beat',
      beatsPerCut: 2,
    },
    captionTemplate: '{title} \u2728 #fashion #runway {hashtags}',
    defaultHashtags: '#aesthetic #fyp #style #viral',
  },
  {
    id: 'boon-edm',
    artistId: 'boon',
    name: 'EDM',
    description: 'High energy electronic visuals',
    accountHandle: '@neonphoebe',
    thumbnail: null,
    videos: [],
    audio: [],
    createdVideos: [],
    imagesA: [],
    imagesB: [],
    slideshows: [],
    lyrics: [],
    defaultPreset: {
      textStyle: {
        fontSize: 72,
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: '900',
        color: '#00ff88',
        outline: true,
        outlineColor: '#000000',
        textCase: 'upper',
      },
      cutStyle: 'beat',
      beatsPerCut: 1,
    },
    captionTemplate: '{title} \ud83d\udd25 #edm #rave {hashtags}',
    defaultHashtags: '#dj #electronic #music #fyp',
  },
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
      beatsPerCut: 2,
    },
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
      beatsPerCut: 1,
    },
  },
];

const VideoStudio = ({
  db = null, // Firestore instance for cross-device sync
  user = null, // Current user (for storage quota)
  onClose,
  artists = [],
  artistId: initialArtistId = null,
  lateAccountIds = {},
  latePages = [],
  manualAccounts = [],
  onSchedulePost,
  onDeleteLatePost,
  onArtistChange = null, // Callback when artist selection changes
  inline = false, // When true, renders inside AppShell instead of fixed overlay
  pendingEditDraft = null, // { post } from App.jsx Schedule tab "Edit in Studio"
  onClearPendingEditDraft = null, // Callback to clear after consuming
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme, inline), [theme, inline]);

  // Mobile responsive detection
  const { isMobile } = useIsMobile();

  // Current artist ID - used for namespaced storage
  const [currentArtistId, setCurrentArtistId] = useState(initialArtistId);
  // Track previous artist ID to detect actual changes (not just re-renders)
  const prevArtistIdRef = useRef(initialArtistId);

  // Sync with parent when initialArtistId changes (e.g., from null to valid ID after login)
  // NOTE: Do NOT set prevArtistIdRef here — let the artist change effect (below) detect it and reset state
  useEffect(() => {
    if (initialArtistId && initialArtistId !== currentArtistId) {
      log('[VideoStudio] Syncing artistId from parent:', initialArtistId);
      setCurrentArtistId(initialArtistId);
    }
  }, [initialArtistId]);

  // Update parent when artist changes
  const handleArtistIdChange = (newArtistId) => {
    if (newArtistId === currentArtistId) return; // No change

    log('[VideoStudio] Artist switching from', currentArtistId, 'to', newArtistId);
    setCurrentArtistId(newArtistId);
    setLastArtistId(newArtistId);
    setHomeTab('production'); // Reset to production on artist switch

    // Reset navigation state so stale project IDs don't persist
    setCurrentViewState('home');
    setActiveProjectId(null);
    setActiveProjectNicheId(null);
    setSelectedCategory(null);
    setStudioMode(null);

    // Also update selectedArtist to match
    const newArtist = artists.find((a) => a.id === newArtistId);
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
    if (path.includes('/studio/media')) return 'media';
    if (path.includes('/studio/scheduling')) return 'scheduling';
    if (path.includes('/studio/project')) return 'project';
    if (path.includes('/studio/wizard')) return 'project-wizard';
    return 'home';
  };

  // Read project/niche IDs from URL query params (survives browser refresh)
  const getProjectIdsFromUrl = () => {
    const params = new URLSearchParams(location.search);
    return {
      projectId: params.get('projectId') || null,
      nicheId: params.get('nicheId') || null,
    };
  };

  // Load saved session for initial state
  const savedSession = useMemo(() => loadSessionState(), []);

  // Navigation state - restore from session if available, or use URL
  const [currentView, setCurrentViewState] = useState(
    getInitialViewFromUrl() || savedSession?.currentView || 'home',
  );
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [activePipelineIdForEditor, setActivePipelineIdForEditor] = useState(null);
  const [activePipelineObjectForEditor, setActivePipelineObjectForEditor] = useState(null);
  const [pipelineCategoryVersion, setPipelineCategoryVersion] = useState(0);
  const [selectedMediaBankIds, setSelectedMediaBankIds] = useState(null); // array of bank IDs for filtering
  const [selectedClipIds, setSelectedClipIds] = useState(null); // array of specific clip IDs pre-selected from niche previewer
  const [crossNicheIds, setCrossNicheIds] = useState(null); // array of additional niche IDs for cross-niche sourcing
  // Firestore-backed library — survives localStorage quota exceeded
  const [firestoreLibrary, setFirestoreLibrary] = useState(() => getLibrary(currentArtistId));
  useEffect(() => {
    if (!db || !currentArtistId) return;
    // Seed from localStorage (may be empty if quota exceeded)
    setFirestoreLibrary(getLibrary(currentArtistId));
    return subscribeToLibrary(db, currentArtistId, (items) => {
      setFirestoreLibrary(items);
    });
  }, [db, currentArtistId]);
  const [homeTab, setHomeTab] = useState(savedSession?.homeTab || 'production');

  // Project system state — URL query params are source of truth, localStorage fallback
  const urlProjectIds = getProjectIdsFromUrl();
  const [activeProjectId, setActiveProjectId] = useState(
    urlProjectIds.projectId || savedSession?.activeProjectId || null,
  );
  const [activeProjectNicheId, setActiveProjectNicheId] = useState(
    urlProjectIds.nicheId || savedSession?.activeProjectNicheId || null,
  );

  // Wrap setCurrentView to also update URL
  const setCurrentView = useCallback(
    (view, { projectId, nicheId } = {}) => {
      setCurrentViewState(view);
      // Determine base path from current URL (artist vs operator)
      const base = location.pathname.startsWith('/artist/') ? '/artist/studio' : '/operator/studio';
      // Update URL based on view
      let targetPath = base;
      if (view === 'library') targetPath = `${base}/library`;
      else if (view === 'slideshows') targetPath = `${base}/slideshows`;
      else if (view === 'drafts') targetPath = `${base}/drafts`;
      else if (view === 'media') targetPath = `${base}/media`;
      else if (view === 'scheduling') targetPath = `${base}/scheduling`;
      else if (view === 'project') {
        targetPath = `${base}/project`;
        // Encode project/niche IDs as query params so refresh works
        const params = new URLSearchParams();
        if (projectId) params.set('projectId', projectId);
        if (nicheId) params.set('nicheId', nicheId);
        const qs = params.toString();
        if (qs) targetPath += `?${qs}`;
      } else if (view === 'project-wizard') targetPath = `${base}/wizard`;
      if (`${location.pathname}${location.search}` !== targetPath) {
        navigate(targetPath, { replace: false });
      }
    },
    [navigate, location.pathname, location.search],
  );

  // Handle browser back/forward within studio
  // Uses a ref to track the last path we handled, so we only respond to actual
  // URL changes (browser back/forward), not re-renders from programmatic navigation.
  const lastHandledUrlRef = useRef(`${location.pathname}${location.search}`);
  useEffect(() => {
    const fullUrl = `${location.pathname}${location.search}`;
    if (fullUrl === lastHandledUrlRef.current) return;
    lastHandledUrlRef.current = fullUrl;
    const path = location.pathname;
    if (path.includes('/studio/wizard')) setCurrentViewState('project-wizard');
    else if (path.includes('/studio/project')) {
      setCurrentViewState('project');
      // Restore project/niche IDs from query params on back/forward
      const params = new URLSearchParams(location.search);
      const pid = params.get('projectId');
      const nid = params.get('nicheId');
      if (pid) setActiveProjectId(pid);
      if (nid) setActiveProjectNicheId(nid);
    } else if (path.includes('/studio/scheduling')) setCurrentViewState('scheduling');
    else if (path.includes('/studio/drafts')) setCurrentViewState('drafts');
    else if (path.includes('/studio/media')) setCurrentViewState('media');
    else if (path.includes('/studio/library')) setCurrentViewState('library');
    else if (path.includes('/studio/slideshows')) setCurrentViewState('slideshows');
    else if (path === '/operator/studio' || path === '/artist/studio') {
      setCurrentViewState('home');
      // Clear editor + project state so stale session doesn't show blank editor
      setShowEditor(false);
      setShowSlideshowEditor(false);
      setStudioMode(null);
      setSelectedCategory(null);
      setActiveProjectId(null);
      setActiveProjectNicheId(null);
    }
    // Clear project state when navigating away from project view via browser back
    if (!path.includes('/studio/project')) {
      setActiveProjectId(null);
      setActiveProjectNicheId(null);
    }
  }, [location.pathname, location.search, currentView]);
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [createdContentVersion, setCreatedContentVersion] = useState(0); // Bump to refresh library dashboard
  const [createdContentState, setCreatedContentState] = useState(() =>
    currentArtistId ? getCreatedContent(currentArtistId) : { videos: [], slideshows: [] },
  );
  const [draftsCollectionFilter, setDraftsCollectionFilter] = useState(null); // Collection filter for drafts view
  const [firestoreContentLoaded, setFirestoreContentLoaded] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // Track upload progress
  const [sessionRestored, setSessionRestored] = useState(false);

  // Derive accounts array from lateAccountIds for PostingModule
  const accounts = useMemo(() => {
    return Object.entries(lateAccountIds).map(([handle, ids]) => ({
      handle,
      tiktokId: ids.tiktok,
      instagramId: ids.instagram,
    }));
  }, [lateAccountIds]);

  // Synthetic category for library-mode ContentLibrary (dashboard)
  // Uses createdContentState (from Firestore subscription) instead of localStorage
  const libraryCategory = useMemo(() => {
    if (!currentArtistId) return null;
    return {
      id: 'library-created',
      name: 'Created Content',
      createdVideos: createdContentState.videos || [],
      slideshows: createdContentState.slideshows || [],
    };
  }, [currentArtistId, createdContentState]);

  // Pipeline category for video editor when opened from a pipeline
  const pipelineCategory = useMemo(() => {
    void pipelineCategoryVersion; // dep used to force recompute when editor opens
    if (!activePipelineIdForEditor || !currentArtistId) return null;
    const cols = getUserCollections(currentArtistId);
    const pipeline =
      cols.find((c) => c.id === activePipelineIdForEditor) || activePipelineObjectForEditor; // Fallback: use the niche object passed directly from ProjectWorkspace
    if (!pipeline) return null;
    const lib = firestoreLibrary;

    // Parse mediaBanks early (needed for both allMediaIds merge and bank filtering)
    let parsedMediaBanks = pipeline.mediaBanks;
    if (typeof parsedMediaBanks === 'string') {
      try {
        parsedMediaBanks = JSON.parse(parsedMediaBanks);
      } catch {
        parsedMediaBanks = null;
      }
    }

    // Collect all media IDs: top-level mediaIds + mediaBanks for the current niche
    const allMediaIds = new Set(pipeline.mediaIds || []);
    if (Array.isArray(parsedMediaBanks)) {
      for (const bank of parsedMediaBanks) {
        if (Array.isArray(bank.mediaIds)) {
          for (const id of bank.mediaIds) allMediaIds.add(id);
        }
      }
    }
    // Cross-niche sourcing: merge media from additional niches
    if (crossNicheIds?.length > 0) {
      for (const nicheId of crossNicheIds) {
        const otherNiche = cols.find((c) => c.id === nicheId);
        if (otherNiche) {
          (otherNiche.mediaIds || []).forEach((id) => allMediaIds.add(id));
          if (otherNiche.mediaBanks) {
            otherNiche.mediaBanks.forEach((bank) =>
              (bank.mediaIds || []).forEach((id) => allMediaIds.add(id)),
            );
          }
        }
      }
    }
    let pipelineMedia = lib.filter((item) => allMediaIds.has(item.id));
    if (selectedMediaBankIds && Array.isArray(parsedMediaBanks)) {
      const selectedBankSet = new Set(selectedMediaBankIds);
      const allowedIds = new Set();
      parsedMediaBanks.forEach((bank) => {
        if (selectedBankSet.has(bank.id)) {
          (bank.mediaIds || []).forEach((id) => allowedIds.add(id));
        }
      });
      // Audio is always included (not in media banks)
      pipelineMedia = pipelineMedia.filter(
        (item) => item.type === MEDIA_TYPES.AUDIO || allowedIds.has(item.id),
      );
    }

    // Per-clip filtering: if user selected specific clips in the niche previewer,
    // only those clips go into the timeline. All clips remain in the sidebar for adding later.
    if (selectedClipIds && selectedClipIds.length > 0) {
      const clipSet = new Set(selectedClipIds);
      pipelineMedia = pipelineMedia.filter(
        (item) => item.type === MEDIA_TYPES.AUDIO || clipSet.has(item.id),
      );
    }

    // textBanks = slideshow text banks (array of arrays), videoTextBank1/2 = video niche text banks
    // Check length to avoid empty-array short-circuit ([] is truthy in JS)
    const nicheTextBanks =
      Array.isArray(pipeline.textBanks) && pipeline.textBanks.length > 0
        ? pipeline.textBanks
        : pipeline.videoTextBank1?.length > 0 || pipeline.videoTextBank2?.length > 0
          ? [pipeline.videoTextBank1 || [], pipeline.videoTextBank2 || []]
          : null;
    return {
      id: pipeline.id,
      name: pipeline.name,
      projectId: pipeline.projectId || null,
      banks: pipeline.banks || [],
      videos: pipelineMedia
        .filter((v) => v.type === MEDIA_TYPES.VIDEO)
        .map((v) => ({
          ...v,
          src: v.url,
          localUrl: v.localUrl || v.url,
          thumbnail: v.thumbnail || null,
          name: v.name || 'Clip',
        })),
      images: pipelineMedia
        .filter((i) => i.type === MEDIA_TYPES.IMAGE)
        .map((i) => ({
          ...i,
          src: i.url,
          localUrl: i.localUrl || i.url,
          thumbnail: i.thumbnailUrl || i.thumbnail || null,
        })),
      audio: pipelineMedia
        .filter((a) => a.type === MEDIA_TYPES.AUDIO)
        .map((a) => ({ ...a, src: a.url, localUrl: a.localUrl || a.url, savedLyrics: [] })),
      lyrics: [],
      createdVideos: [],
      defaultPreset: null,
      captionTemplate: '',
      defaultHashtags: '',
      nicheTextBanks,
      textBanks: nicheTextBanks,
      mediaBanks: parsedMediaBanks || null,
    };
  }, [
    activePipelineIdForEditor,
    activePipelineObjectForEditor,
    currentArtistId,
    pipelineCategoryVersion,
    selectedMediaBankIds,
    selectedClipIds,
    crossNicheIds,
    firestoreLibrary,
  ]);

  // Project niches for clipper destination picker (all niches in same project, excluding current)
  const clipperProjectNiches = useMemo(() => {
    void pipelineCategoryVersion; // re-compute when editor opens / collections update
    if (!activePipelineIdForEditor || !currentArtistId) return [];
    const cols = getUserCollections(currentArtistId);
    const current =
      cols.find((c) => c.id === activePipelineIdForEditor) || activePipelineObjectForEditor;
    if (!current?.projectId) return [];
    return cols
      .filter(
        (c) =>
          c.projectId === current.projectId && c.id !== activePipelineIdForEditor && c.isPipeline,
      )
      .map((c) => ({ id: c.id, name: c.name, contentType: c.contentType || c.formats?.[0]?.id }));
  }, [
    activePipelineIdForEditor,
    activePipelineObjectForEditor,
    currentArtistId,
    pipelineCategoryVersion,
  ]);

  // Subscribe to created content from Firestore (real-time, no localStorage dependency)
  useEffect(() => {
    if (!db || !currentArtistId) return;
    const unsub = subscribeToCreatedContent(db, currentArtistId, (content) => {
      setCreatedContentState(content);
      setCreatedContentVersion((v) => v + 1);
      setFirestoreContentLoaded(true);
    });
    return () => unsub && unsub();
  }, [db, currentArtistId]);

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

  // Editor state — never restore showEditor from session (ephemeral UI state)
  const [editingVideo, setEditingVideo] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
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
  const navigateWithDraftCheck = useCallback(
    (action) => {
      const inEditor = showEditor || showSlideshowEditor;
      if (!inEditor) {
        action();
        return;
      }
      setDraftDialog({
        isOpen: true,
        pendingAction: action,
      });
    },
    [showEditor, showSlideshowEditor],
  );

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
  const [selectedLibraryMedia, setSelectedLibraryMedia] = useState({
    videos: [],
    audio: null,
    images: [],
    lyrics: [],
  });
  const [pullFromCollection, setPullFromCollection] = useState(null);
  const [clipperSourceVideos, setClipperSourceVideos] = useState([]);
  const [clipperSession, setClipperSession] = useState(null);
  const [clipperBankLabels, setClipperBankLabels] = useState(null);

  // On mount: try loading categories from Firestore (may have newer data than localStorage)
  useEffect(() => {
    if (db && initialArtistId) {
      loadCategoriesFromFirestore(db, initialArtistId)
        .then((firestoreCats) => {
          if (firestoreCats && firestoreCats.length > 0) {
            log(
              '[VideoStudio] Initial load: found',
              firestoreCats.length,
              'categories in Firestore',
            );
            setCategories(firestoreCats);
            // Sync to localStorage
            saveArtistCategories(initialArtistId, firestoreCats);
          }
        })
        .catch((err) => log.error('[VideoStudio] Failed to load categories from Firestore:', err));
    }
    // eslint-disable-next-line
  }, []); // Only run once on mount

  // Auto-setup Music Artist template if onboarding not completed (no modal)
  // Also run idempotent pipeline→project migration
  useEffect(() => {
    if (currentArtistId) {
      const status = getOnboardingStatus(currentArtistId);
      if (!status.completed) {
        // Auto-complete with Music Artist template
        completeOnboarding(currentArtistId, STARTER_TEMPLATES.MUSIC_ARTIST.id, db);
        log('[Studio] Auto-completed onboarding with Music Artist template');
      }
      // Migrate existing pipelines to projects, then assign unassigned drafts to niches
      migrateToProjects(currentArtistId, db)
        .then(() => {
          migrateDraftsToNiches(currentArtistId, db);
        })
        .catch((err) => log.error('[VideoStudio] Project migration failed:', err));
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
      log.warn('Storage save failed, attempting cleanup...');
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
            log(
              '[VideoStudio] Loaded',
              firestoreCategories.length,
              'categories from Firestore for',
              currentArtistId,
            );
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
            log(
              '[VideoStudio] Loaded',
              artistCategories.length,
              'categories from localStorage for',
              currentArtistId,
            );
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

      // Clear all selections and reset view to home
      setSelectedCategory(null);
      setStudioMode(null);
      setActiveProjectId(null);
      setActiveProjectNicheId(null);
      setActivePipelineId(null);
      setActivePipelineIdForEditor(null);
      setSelectedMediaBankIds(null);
      setShowEditor(false);
      setShowSlideshowEditor(false);
      setCurrentViewState('home');

      // Update ref to current artist
      prevArtistIdRef.current = currentArtistId;
    }
  }, [currentArtistId, db]);

  // Initialize with saved artist (session → localStorage → first in list)
  useEffect(() => {
    if (artists.length > 0 && !selectedArtist) {
      const savedId = savedSession?.artistId || getLastArtistId();
      const restored = savedId && artists.find((a) => a.id === savedId);
      setSelectedArtist(restored || artists[0]);
    }
  }, [artists, selectedArtist, savedSession]);

  // Restore full session state after categories are loaded
  useEffect(() => {
    if (sessionRestored || categories.length === 0) return;

    const saved = loadSessionState();
    if (saved && (!saved.artistId || saved.artistId === currentArtistId)) {
      // NOTE: Intentionally NOT restoring `selectedCategory` / legacy aesthetic
      // home state. The Projects/Niches refactor replaced category-based
      // navigation; restoring a stale `categoryId` would land the user on the
      // dead AestheticHome view (whose upload handlers write to orphan
      // `categories[]` state and don't feed the modern library). All users now
      // land on ProjectLanding via the default `currentView === 'home' &&
      // !selectedCategory` branch.
      // Restore project context only.
      if (saved.activeProjectId) setActiveProjectId(saved.activeProjectId);
      if (saved.activeProjectNicheId) setActiveProjectNicheId(saved.activeProjectNicheId);
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
      studioMode,
      homeTab,
      activeProjectId,
      activeProjectNicheId,
    });
  }, [
    currentView,
    selectedCategory?.id,
    selectedArtist?.id,
    studioMode,
    homeTab,
    activeProjectId,
    activeProjectNicheId,
    sessionRestored,
  ]);

  // Get categories for selected artist
  const artistCategories = useMemo(
    () => categories.filter((c) => c.artistId === selectedArtist?.id || c.artistId === null),
    [categories, selectedArtist?.id],
  );

  // Handlers
  const handleCreateContent = useCallback(() => {
    setCurrentView('library');
  }, []);

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [initialEditorMode, setInitialEditorMode] = useState(null);

  const handleMakeVideo = useCallback((existingVideo = null, editorMode = null) => {
    setEditingVideo(existingVideo);
    setShowEditor(true);
    setStudioMode('videos'); // Ensure studioMode is set for breadcrumb
    // Show template picker only for new videos (not re-edits or session restores)
    setShowTemplatePicker(!existingVideo && !editorMode);
    setInitialEditorMode(editorMode);
  }, []);

  // Format-based routing: legacy → format picker, slideshow → workspace, video → editor
  const FORMAT_TO_EDITOR = {
    montage: 'montage',
    solo_clip: 'solo-clip',
    multi_clip: 'multi-clip',
    photo_montage: 'photo-montage',
    clipper: 'clipper',
  };

  // Remix: create a new draft with one dimension swapped
  const handleRemixDraft = useCallback(
    (draft, remixType) => {
      if (!draft) return;
      const remixedDraft = {
        ...draft,
        id: `remix_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: `${draft.name || 'Draft'} (${remixType})`,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isRemix: true,
        remixSourceId: draft.id,
        remixType,
      };
      // Route to editor with the remixed draft
      const editorMode = draft.editorMode
        ? FORMAT_TO_EDITOR[draft.editorMode] || draft.editorMode
        : null;
      if (draft.collectionId) {
        setActivePipelineIdForEditor(draft.collectionId);
        setPipelineCategoryVersion((v) => v + 1);
      }
      handleMakeVideo(remixedDraft, editorMode);
    },
    [handleMakeVideo],
  );

  // Project system — open a project workspace
  const handleOpenProject = useCallback(
    (projectId, nicheId = null) => {
      setActiveProjectId(projectId);
      setActiveProjectNicheId(nicheId);
      setCurrentView('project', { projectId, nicheId });
    },
    [setCurrentView],
  );

  const handleCloseEditor = useCallback(() => {
    try {
      setShowEditor(false);
      setEditingVideo(null);
      setInitialEditorMode(null);
      setShowTemplatePicker(false);
      setSchedulerEditPostId(null);
      // Clear library selection so stale clips don't appear next time
      setSelectedLibraryMedia({ videos: [], audio: null, images: [], lyrics: [] });
      setPullFromCollection(null);
      setClipperSourceVideos([]);
      setClipperSession(null);
      setClipperBankLabels(null);
      setSelectedMediaBankIds(null);
      // If opened from pipeline, go back to pipeline list or project view
      if (activePipelineIdForEditor) {
        const nicheId = activePipelineIdForEditor;
        setActivePipelineIdForEditor(null);
        setActivePipelineObjectForEditor(null);
        setActivePipelineId(null);
        // Check if niche belongs to a project — return to project view
        if (activeProjectId) {
          setActiveProjectNicheId(nicheId);
          setCurrentView('project', { projectId: activeProjectId, nicheId });
        } else {
          setCurrentView('home');
        }
      }
    } catch (err) {
      console.warn('Editor close cleanup error:', err);
      // Force editor closed even if cleanup fails
      setShowEditor(false);
    }
  }, [activePipelineIdForEditor, activeProjectId]);

  // Clipper session save callback
  const handleSaveClipperSession = useCallback(
    (sessionData) => {
      if (!currentArtistId || !activePipelineIdForEditor) return;
      saveClipperSession(currentArtistId, activePipelineIdForEditor, sessionData, db);
    },
    [currentArtistId, activePipelineIdForEditor, db],
  );

  const handleSaveVideo = useCallback(
    async (videoData) => {
      // Clipper sessions are saved separately — don't create drafts
      if (videoData.editorMode === 'clipper') return;
      // Upload audio to Firebase Storage if it has a blob URL (prevents stale blob URLs in saved drafts)
      let data = { ...videoData };
      if (
        data.audio &&
        (data.audio.file ||
          data.audio.url?.startsWith('blob:') ||
          data.audio.localUrl?.startsWith('blob:'))
      ) {
        try {
          const audioFile = data.audio.file;
          if (audioFile) {
            const { url: firebaseUrl } = await uploadFile(audioFile, 'audio');
            data = { ...data, audio: { ...data.audio, url: firebaseUrl } };
            log('[VideoStudio] Uploaded video audio to Firebase:', firebaseUrl);
          } else if (
            data.audio.url?.startsWith('blob:') ||
            data.audio.localUrl?.startsWith('blob:')
          ) {
            // No file object — try to find cloud URL in library
            const libAudio = firestoreLibrary.find(
              (a) => a.id === data.audio.id && a.type === 'audio',
            );
            if (libAudio?.url && !libAudio.url.startsWith('blob:')) {
              data = { ...data, audio: { ...data.audio, url: libAudio.url } };
              log(
                '[VideoStudio] Replaced blob URL with library URL for video audio:',
                libAudio.name,
              );
            } else {
              log.warn(
                '[VideoStudio] Video audio has blob URL but not found in library:',
                data.audio.id,
              );
            }
          }
        } catch (err) {
          log.error('[VideoStudio] Failed to upload video audio:', err);
        }
      }
      // Clean audio object for Firestore (remove non-serializable fields)
      if (data.audio) {
        const { file, localUrl, ...cleanAudio } = data.audio;
        data = { ...data, audio: cleanAudio };
      }
      // Clean clip objects: replace blob URLs with cloud URLs from library
      if (data.clips?.length > 0) {
        data = {
          ...data,
          clips: data.clips.map((clip) => {
            if (clip.url?.startsWith('blob:') || clip.localUrl?.startsWith('blob:')) {
              const libItem = firestoreLibrary.find((m) => m.id === clip.sourceId);
              const cloudUrl =
                libItem?.url && !libItem.url.startsWith('blob:') ? libItem.url : clip.url;
              const { localUrl: _lu, ...cleanClip } = clip;
              return { ...cleanClip, url: cloudUrl };
            }
            const { localUrl: _lu, ...cleanClip } = clip;
            return cleanClip;
          }),
        };
      }

      // Scheduler edit mode: update the scheduledPost directly and return to scheduler
      if (schedulerEditPostId) {
        try {
          await updateScheduledPost(db, currentArtistId, schedulerEditPostId, {
            editorState: data,
            contentName: data.name || data.id || 'Edited Video',
            thumbnail: data.thumbnail || null,
          });
          log('[VideoStudio] Updated scheduledPost from editor:', schedulerEditPostId);
        } catch (err) {
          log.error('[VideoStudio] Failed to update scheduledPost:', err);
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
        if (currentArtistId) {
          const savedVideo = addCreatedVideo(currentArtistId, {
            ...data,
            id: data.id || `video_${Date.now()}`,
            collectionId: data.collectionId || pullFromCollection || null,
            createdAt: new Date().toISOString(),
            status: VIDEO_STATUS.DRAFT,
          });
          log('[VideoStudio] Saved video via library system:', savedVideo.id);

          // Sync to Firestore for cross-device access
          if (db && currentArtistId) {
            const content = getCreatedContent(currentArtistId);
            saveCreatedContentAsync(db, currentArtistId, content).catch((err) =>
              log.error('[VideoStudio] Failed to sync video to Firestore:', err),
            );
          }

          setCreatedContentVersion((v) => v + 1);
          setShowEditor(false);
          setEditingVideo(null);
          setSelectedLibraryMedia({ videos: [], audio: null, images: [], lyrics: [] });
          setPullFromCollection(null);
          setCurrentView('drafts');
          setStudioMode('videos');
        }
        return;
      }

      // Category mode: persist to created content system (Firestore + localStorage)
      if (currentArtistId) {
        const videoData = {
          ...data,
          id: data.id || `video_${Date.now()}`,
          collectionId: data.collectionId || selectedCategory?.id || null,
          createdAt: data.createdAt || new Date().toISOString(),
          status: data.status || VIDEO_STATUS.DRAFT,
        };
        addCreatedVideo(currentArtistId, videoData);
        if (db) {
          const content = getCreatedContent(currentArtistId);
          saveCreatedContentAsync(db, currentArtistId, content).catch((err) =>
            log.error('[VideoStudio] Failed to sync video to Firestore:', err),
          );
        }
        setCreatedContentVersion((v) => v + 1);
      }

      // Also update category state for the current session
      const updateCategory = (cat) => {
        if (cat.id !== selectedCategory.id) return cat;

        const existingIndex = cat.createdVideos.findIndex((v) => v.id === data.id);
        if (existingIndex >= 0) {
          const newVideos = [...cat.createdVideos];
          newVideos[existingIndex] = { ...data, updatedAt: new Date().toISOString() };
          return { ...cat, createdVideos: newVideos };
        } else {
          return {
            ...cat,
            createdVideos: [
              ...cat.createdVideos,
              {
                ...data,
                id: `video_${Date.now()}`,
                createdAt: new Date().toISOString(),
                status: VIDEO_STATUS.DRAFT,
              },
            ],
          };
        }
      };

      setCategories((prev) => prev.map(updateCategory));
      setSelectedCategory((prev) => (prev ? updateCategory(prev) : prev));

      setShowEditor(false);
      setEditingVideo(null);
      setCurrentView('drafts');
      setStudioMode('videos');
    },
    [selectedCategory, currentArtistId, schedulerEditPostId, db, libraryMedia.audio],
  );

  // Save lyrics template to an audio track
  const handleSaveLyricsToAudio = useCallback(
    (audioId, lyricsData) => {
      if (!selectedCategory) {
        // Library mode: log but don't crash — lyrics-to-audio is a category feature
        log('[VideoStudio] Skipping lyrics-to-audio save (library mode)');
        return;
      }

      const lyricsEntry = {
        id: `lyrics_${Date.now()}`,
        name: lyricsData.name || 'Untitled Lyrics',
        words: lyricsData.words || [],
        createdAt: new Date().toISOString(),
      };

      const updateCategory = (cat) => {
        if (cat.id !== selectedCategory.id) return cat;
        return {
          ...cat,
          audio: cat.audio.map((audio) =>
            audio.id === audioId
              ? {
                  ...audio,
                  savedLyrics: [...(audio.savedLyrics || []), lyricsEntry],
                }
              : audio,
          ),
        };
      };

      setCategories((prev) => prev.map(updateCategory));
      setSelectedCategory((prev) => (prev ? updateCategory(prev) : prev));

      log('[Lyrics] Saved lyrics to audio:', audioId, lyricsEntry);
    },
    [selectedCategory],
  );

  const handleDeleteVideo = useCallback(
    async (videoId) => {
      // Library mode: soft-delete via libraryService
      if (!selectedCategory) {
        if (currentArtistId) {
          if (db) {
            softDeleteCreatedVideoAsync(db, currentArtistId, videoId).catch((err) =>
              log.warn('[VideoStudio] Firestore video soft-delete failed:', err),
            );
          } else {
            deleteCreatedVideo(currentArtistId, videoId);
          }
          setCreatedContentVersion((v) => v + 1);
          // Cascade: remove any scheduled posts referencing this draft
          if (db && currentArtistId) {
            deletePostsByContentId(db, currentArtistId, videoId).catch((err) => {
              log.warn('[VideoStudio] Cascade delete for video failed:', err);
              toastError('Failed to clean up scheduled posts');
            });
          }
        }
        return;
      }

      // Category mode: find the video to get its storage path
      const video = selectedCategory.createdVideos.find((v) => v.id === videoId);

      // Delete from Firebase Storage if there's a storage path
      if (video?.storagePath) {
        await deleteFile(video.storagePath);
        if (video.size && user?.email)
          decrementStorageUsed(db, user.email, video.size).catch(() => {});
      }
      // Also try to delete thumbnail if it has a storage path
      if (video?.thumbnailPath) {
        await deleteFile(video.thumbnailPath);
      }

      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === selectedCategory.id
            ? { ...cat, createdVideos: cat.createdVideos.filter((v) => v.id !== videoId) }
            : cat,
        ),
      );

      setSelectedCategory((prev) =>
        prev
          ? {
              ...prev,
              createdVideos: prev.createdVideos.filter((v) => v.id !== videoId),
            }
          : prev,
      );

      // Cascade: remove any scheduled posts referencing this draft
      if (db && currentArtistId) {
        deletePostsByContentId(db, currentArtistId, videoId).catch((err) => {
          log.warn('[VideoStudio] Cascade delete for video failed:', err);
          toastError('Failed to clean up scheduled posts');
        });
      }
    },
    [selectedCategory, currentArtistId, db, toastError],
  );

  // Restore a soft-deleted content item from trash
  const handleRestoreContent = useCallback(
    async (itemId) => {
      if (!db || !currentArtistId || !itemId) return;
      const success = await restoreCreatedContentAsync(db, currentArtistId, itemId);
      if (success) {
        setCreatedContentVersion((v) => v + 1);
      }
      return success;
    },
    [db, currentArtistId],
  );

  // Permanently delete a content item from trash
  const handlePermanentDelete = useCallback(
    async (itemId) => {
      if (!db || !currentArtistId || !itemId) return;
      // Also delete storage files
      const deleted = await getDeletedContentAsync(db, currentArtistId);
      const item = [...deleted.videos, ...deleted.slideshows].find((i) => i.id === itemId);
      if (item?.storagePath) await deleteFile(item.storagePath);
      if (item?.thumbnailPath) await deleteFile(item.thumbnailPath);
      return permanentlyDeleteContentAsync(db, currentArtistId, itemId);
    },
    [db, currentArtistId],
  );

  // Get deleted (trash) content
  const handleGetDeletedContent = useCallback(async () => {
    if (!db || !currentArtistId) return { videos: [], slideshows: [] };
    return getDeletedContentAsync(db, currentArtistId);
  }, [db, currentArtistId]);

  // Delete a video clip from the bank (source videos)
  const handleApproveVideo = useCallback(
    (videoId) => {
      // Library mode: toggle approve via libraryService
      if (!selectedCategory) {
        if (currentArtistId) {
          const content = getCreatedContent(currentArtistId);
          const video = content.videos.find((v) => v.id === videoId);
          const newStatus =
            video?.status === VIDEO_STATUS.APPROVED ? VIDEO_STATUS.DRAFT : VIDEO_STATUS.APPROVED;
          updateCreatedVideo(currentArtistId, videoId, { status: newStatus });
          setCreatedContentVersion((v) => v + 1);
        }
        return;
      }

      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === selectedCategory.id
            ? {
                ...cat,
                createdVideos: cat.createdVideos.map((v) =>
                  v.id === videoId
                    ? {
                        ...v,
                        status:
                          v.status === VIDEO_STATUS.APPROVED
                            ? VIDEO_STATUS.DRAFT
                            : VIDEO_STATUS.APPROVED,
                      }
                    : v,
                ),
              }
            : cat,
        ),
      );

      setSelectedCategory((prev) =>
        prev
          ? {
              ...prev,
              createdVideos: prev.createdVideos.map((v) =>
                v.id === videoId
                  ? {
                      ...v,
                      status:
                        v.status === VIDEO_STATUS.APPROVED
                          ? VIDEO_STATUS.DRAFT
                          : VIDEO_STATUS.APPROVED,
                    }
                  : v,
              ),
            }
          : prev,
      );
    },
    [selectedCategory, currentArtistId],
  );

  // Update a video with new fields (used after rendering)
  const handleUpdateVideo = useCallback(
    (videoId, updates) => {
      // Library mode: update via libraryService
      if (!selectedCategory) {
        if (currentArtistId) {
          updateCreatedVideo(currentArtistId, videoId, updates);
          setCreatedContentVersion((v) => v + 1);
        }
        return;
      }

      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === selectedCategory.id
            ? {
                ...cat,
                createdVideos: cat.createdVideos.map((v) =>
                  v.id === videoId ? { ...v, ...updates } : v,
                ),
              }
            : cat,
        ),
      );

      setSelectedCategory((prev) =>
        prev
          ? {
              ...prev,
              createdVideos: prev.createdVideos.map((v) =>
                v.id === videoId ? { ...v, ...updates } : v,
              ),
            }
          : prev,
      );
    },
    [selectedCategory, currentArtistId],
  );

  const handleSavePreset = useCallback(
    (presetData) => {
      const newPreset = {
        id: `preset_${Date.now()}`,
        categoryId: selectedCategory?.id,
        ...presetData,
      };
      setPresets((prev) => [...prev, newPreset]);
    },
    [selectedCategory],
  );

  // Slideshow handlers
  // Batch slideshow mode state
  const [slideshowBatchMode, setSlideshowBatchMode] = useState(false);

  const handleMakeSlideshow = useCallback(
    (options = null) => {
      if (options?.batch) {
        // Batch mode - create 10 separate slideshows instantly (like video batch)
        if (!selectedCategory) {
          // Library mode: batch slideshows not supported
          toastError(
            'Batch slideshows require a category. Please select one or use manual creation.',
          );
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
              duration: 3,
            },
            {
              id: `slide_${Date.now()}_${i}_1`,
              index: 1,
              backgroundImage: imageB.url || imageB.localUrl,
              thumbnail: imageB.url || imageB.localUrl,
              sourceBank: 'imageB',
              sourceImageId: imageB.id,
              textOverlays: [],
              duration: 3,
            },
          ];

          batchSlideshows.push({
            id: `slideshow_batch_${Date.now()}_${i}`,
            name: `${selectedCategory.name} Slideshow ${i + 1}`,
            aspectRatio: '9:16',
            slides,
            audio: null,
            status: 'draft',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        // Save all slideshows to category
        if (batchSlideshows.length > 0) {
          const updateCategory = (cat) => {
            if (cat.id !== selectedCategory.id) return cat;
            return {
              ...cat,
              slideshows: [...(cat.slideshows || []), ...batchSlideshows],
            };
          };

          setCategories((prev) => prev.map(updateCategory));
          setSelectedCategory((prev) => (prev ? updateCategory(prev) : prev));

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
    },
    [selectedCategory, currentArtistId, setCategories, setSelectedCategory, setCurrentView],
  );

  const handleEditMultipleSlideshows = useCallback((items) => {
    setSlideshowBatchMode(false);
    setEditingSlideshow({ multiple: items });
    setShowSlideshowEditor(true);
    setStudioMode('slideshows');
  }, []);

  // Consume pendingEditDraft from parent (App.jsx Schedule tab → Studio)
  const pendingEditDraftConsumedRef = useRef(null);
  useEffect(() => {
    if (!pendingEditDraft || !pendingEditDraft.post?.editorState) return;
    if (pendingEditDraftConsumedRef.current === pendingEditDraft) return;
    pendingEditDraftConsumedRef.current = pendingEditDraft;

    const { post } = pendingEditDraft;
    setSchedulerEditPostId(post.id);
    if (post.contentType === 'slideshow') {
      handleMakeSlideshow(post.editorState);
    } else {
      handleMakeVideo(post.editorState);
    }
    if (onClearPendingEditDraft) onClearPendingEditDraft();
  }, [pendingEditDraft, handleMakeSlideshow, handleMakeVideo, onClearPendingEditDraft]);

  const handleCloseSlideshowEditor = useCallback(() => {
    setShowSlideshowEditor(false);
    setEditingSlideshow(null);
    setSchedulerEditPostId(null);
    // Clear all library selection so nothing persists into next editor session
    setSelectedLibraryMedia({ videos: [], audio: null, images: [], lyrics: [] });
    // Return to project if opened from one
    if (activePipelineIdForEditor) {
      const nicheId = activePipelineIdForEditor;
      setActivePipelineIdForEditor(null);
      setActivePipelineObjectForEditor(null);
      setActivePipelineId(null);
      if (activeProjectId) {
        setActiveProjectNicheId(nicheId);
        setCurrentView('project', { projectId: activeProjectId, nicheId });
      }
    }
  }, [activePipelineIdForEditor, activeProjectId]);

  const handleSaveSlideshow = useCallback(
    async (slideshowData) => {
      // Scheduler edit mode: update the scheduledPost directly and return to scheduler
      if (schedulerEditPostId) {
        try {
          // Upload audio file to Firebase if it has a local blob URL (non-serializable for Firestore)
          if (
            slideshowData.audio &&
            (slideshowData.audio.file || slideshowData.audio.url?.startsWith('blob:'))
          ) {
            const audioFile = slideshowData.audio.file;
            if (audioFile) {
              const { url: firebaseUrl } = await uploadFile(audioFile, 'audio');
              slideshowData = {
                ...slideshowData,
                audio: {
                  ...slideshowData.audio,
                  url: firebaseUrl,
                },
              };
              log('[VideoStudio] Uploaded audio to Firebase:', firebaseUrl);
            }
          }
          // Strip non-serializable fields from audio before Firestore save
          if (slideshowData.audio) {
            const { file, localUrl, ...cleanAudio } = slideshowData.audio;
            slideshowData = { ...slideshowData, audio: cleanAudio };
          }
          const slides = slideshowData.slides || [];
          const firstSlide = slides[0];
          // Generate thumbnail with text overlays for scheduler preview (always slide 1)
          let thumbnail = firstSlide?.backgroundImage || firstSlide?.thumbnail || null;
          if (firstSlide) {
            try {
              thumbnail = await generateSlideThumbnail(
                firstSlide,
                slideshowData.aspectRatio || '9:16',
              );
            } catch (e) {
              log.warn('[VideoStudio] Thumbnail generation failed, using raw image:', e);
            }
          }
          await updateScheduledPost(db, currentArtistId, schedulerEditPostId, {
            editorState: slideshowData,
            contentName: slideshowData.name || 'Edited Slideshow',
            thumbnail,
          });
          log('[VideoStudio] Updated scheduledPost (slideshow) from editor:', schedulerEditPostId);
        } catch (err) {
          log.error('[VideoStudio] Failed to update scheduledPost:', err);
        }
        setShowSlideshowEditor(false);
        setEditingSlideshow(null);
        setSchedulerEditPostId(null);
        setSelectedLibraryMedia((prev) => ({ ...prev, images: [] }));
        setCurrentView('scheduling');
        return;
      }

      // Library mode: save via libraryService (with Firestore sync)
      if (!selectedCategory) {
        if (currentArtistId) {
          let data = {
            ...slideshowData,
            id: slideshowData.id || `slideshow_${Date.now()}`,
            collectionId: slideshowData.collectionId || pullFromCollection || null,
            createdAt: slideshowData.createdAt || new Date().toISOString(),
            status: slideshowData.status || 'draft',
          };

          // Upload audio to Firebase Storage if it has a blob URL (same as scheduler mode)
          if (data.audio && (data.audio.file || data.audio.url?.startsWith('blob:'))) {
            log('[VideoStudio] Safari Debug - Audio before upload:', {
              hasFile: !!data.audio.file,
              url: data.audio.url?.substring(0, 50),
              id: data.audio.id,
              name: data.audio.name,
            });

            try {
              const audioFile = data.audio.file;
              if (audioFile) {
                log('[VideoStudio] Safari Debug - Uploading audio file to Firebase...');
                const { url: firebaseUrl } = await uploadFile(audioFile, 'audio');
                data = {
                  ...data,
                  audio: {
                    ...data.audio,
                    url: firebaseUrl,
                  },
                };
                log('[VideoStudio] Uploaded audio to Firebase:', firebaseUrl);
              } else if (data.audio.url?.startsWith('blob:')) {
                log(
                  '[VideoStudio] Safari Debug - No file, trying to find in library. Library has',
                  libraryMedia.audio.length,
                  'audio items',
                );
                // Blob URL without file - try to find in library by ID
                const libAudio = libraryMedia.audio.find((a) => a.id === data.audio.id);
                if (libAudio && libAudio.url && !libAudio.url.startsWith('blob:')) {
                  log(
                    '[VideoStudio] Safari Debug - Found in library:',
                    libAudio.name,
                    'URL:',
                    libAudio.url?.substring(0, 50),
                  );
                  data = {
                    ...data,
                    audio: {
                      ...data.audio,
                      url: libAudio.url,
                    },
                  };
                  log('[VideoStudio] Replaced blob URL with library URL for audio:', libAudio.name);
                } else {
                  log.warn(
                    '[VideoStudio] Safari Debug - Audio has blob URL but not found in library. Searched for ID:',
                    data.audio.id,
                  );
                }
              }
            } catch (err) {
              log.error('[VideoStudio] Failed to upload audio:', err);
            }
          } else if (data.audio) {
            log(
              '[VideoStudio] Safari Debug - Audio already has valid URL:',
              data.audio.url?.substring(0, 50),
            );
          }

          // Clean audio object for Firestore (remove non-serializable fields)
          if (data.audio) {
            const { file, localUrl, ...cleanAudio } = data.audio;
            data = { ...data, audio: cleanAudio };
          }

          const savedSlideshow = addCreatedSlideshow(currentArtistId, data);
          // Sync to Firestore for persistence across refreshes/devices
          if (db) {
            addCreatedSlideshowAsync(db, currentArtistId, data).catch((err) => {
              log.error('[VideoStudio] Failed to sync slideshow to Firestore:', err);
            });
          }
          log('[VideoStudio] Saved slideshow via library system:', savedSlideshow.id);
          setCreatedContentVersion((v) => v + 1);
          setShowSlideshowEditor(false);
          setEditingSlideshow(null);
          setCurrentView('slideshows');
          setStudioMode('slideshows');
        }
        return;
      }

      // Also persist to created content system (Firestore + localStorage) so drafts view sees it
      if (currentArtistId) {
        let data = {
          ...slideshowData,
          id: slideshowData.id || `slideshow_${Date.now()}`,
          collectionId: slideshowData.collectionId || selectedCategory?.id || null,
          collectionName: slideshowData.collectionName || selectedCategory?.name || null,
          createdAt: slideshowData.createdAt || new Date().toISOString(),
          status: slideshowData.status || 'draft',
        };
        // Clean audio for Firestore
        if (data.audio) {
          if (data.audio.file || data.audio.url?.startsWith('blob:')) {
            try {
              const audioFile = data.audio.file;
              if (audioFile) {
                const { url: firebaseUrl } = await uploadFile(audioFile, 'audio');
                data = { ...data, audio: { ...data.audio, url: firebaseUrl } };
              }
            } catch (err) {
              log.error('[VideoStudio] Failed to upload audio:', err);
            }
          }
          const { file, localUrl, ...cleanAudio } = data.audio;
          data = { ...data, audio: cleanAudio };
        }
        addCreatedSlideshow(currentArtistId, data);
        if (db) {
          addCreatedSlideshowAsync(db, currentArtistId, data).catch((err) => {
            log.error('[VideoStudio] Failed to sync slideshow to Firestore:', err);
          });
        }
        setCreatedContentVersion((v) => v + 1);
      }

      const updateCategory = (cat) => {
        if (cat.id !== selectedCategory.id) return cat;

        // Initialize slideshows array if needed
        const slideshows = cat.slideshows || [];
        const existingIndex = slideshows.findIndex((s) => s.id === slideshowData.id);

        if (existingIndex >= 0) {
          // Update existing
          const newSlideshows = [...slideshows];
          newSlideshows[existingIndex] = { ...slideshowData, updatedAt: new Date().toISOString() };
          return { ...cat, slideshows: newSlideshows };
        } else {
          // Add new
          return {
            ...cat,
            slideshows: [
              ...slideshows,
              {
                ...slideshowData,
                id: `slideshow_${Date.now()}`,
                createdAt: new Date().toISOString(),
                status: 'draft',
              },
            ],
          };
        }
      };

      setCategories((prev) => prev.map(updateCategory));
      setSelectedCategory((prev) => (prev ? updateCategory(prev) : prev));

      setShowSlideshowEditor(false);
      setEditingSlideshow(null);
    },
    [selectedCategory, currentArtistId, schedulerEditPostId, db],
  );

  // ============================================
  // IMAGE BANK HANDLERS (for Slideshow mode)
  // ============================================

  // Upload images to Image A or Image B bank
  const handleUploadImages = useCallback(
    async (files, bank = 'A') => {
      if (!selectedCategory) return;

      const convertedFiles = await convertImageFilesIfNeeded(Array.from(files));
      const bankKey = bank === 'A' ? 'imagesA' : 'imagesB';
      setUploadProgress({ type: 'image', current: 0, total: convertedFiles.length });

      const uploadedImages = [];
      for (let i = 0; i < convertedFiles.length; i++) {
        const file = convertedFiles[i];
        try {
          setUploadProgress({
            type: 'image',
            current: i + 1,
            total: files.length,
            name: file.name,
            progress: 0,
          });

          // Upload to Firebase Storage (with quota check)
          const quotaCtx = { userData: user, userEmail: user?.email };
          const { url, path } = await uploadFileWithQuota(
            file,
            'images',
            (progress) => {
              setUploadProgress((prev) => ({ ...prev, progress }));
            },
            {},
            quotaCtx,
          );

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
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          log.error('Failed to upload image:', file.name, error);
        }
      }

      if (uploadedImages.length > 0) {
        setCategories((prev) =>
          prev.map((cat) =>
            cat.id === selectedCategory.id
              ? { ...cat, [bankKey]: [...(cat[bankKey] || []), ...uploadedImages] }
              : cat,
          ),
        );

        setSelectedCategory((prev) =>
          prev
            ? {
                ...prev,
                [bankKey]: [...(prev[bankKey] || []), ...uploadedImages],
              }
            : prev,
        );
      }

      setUploadProgress(null);
    },
    [selectedCategory],
  );

  // Delete image from bank
  // Delete a slideshow (soft-delete: stays in Firestore with deletedAt, removed from UI)
  const handleDeleteSlideshow = useCallback(
    (slideshowId) => {
      // Library mode: soft-delete via libraryService
      if (!selectedCategory) {
        if (currentArtistId) {
          if (db) {
            deleteCreatedSlideshowAsync(db, currentArtistId, slideshowId).catch(log.error);
          } else {
            deleteCreatedSlideshow(currentArtistId, slideshowId);
          }
          setCreatedContentVersion((v) => v + 1);
          // Cascade: remove any scheduled posts referencing this draft
          if (db && currentArtistId) {
            deletePostsByContentId(db, currentArtistId, slideshowId).catch((err) => {
              log.warn('[VideoStudio] Cascade delete for slideshow failed:', err);
              toastError('Failed to clean up scheduled posts');
            });
          }
        }
        return;
      }

      // Category mode
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === selectedCategory.id
            ? { ...cat, slideshows: (cat.slideshows || []).filter((s) => s.id !== slideshowId) }
            : cat,
        ),
      );

      setSelectedCategory((prev) =>
        prev
          ? {
              ...prev,
              slideshows: (prev.slideshows || []).filter((s) => s.id !== slideshowId),
            }
          : prev,
      );

      // Cascade: remove any scheduled posts referencing this draft
      if (db && currentArtistId) {
        deletePostsByContentId(db, currentArtistId, slideshowId).catch((err) => {
          log.warn('[VideoStudio] Cascade delete for slideshow failed:', err);
          toastError('Failed to clean up scheduled posts');
        });
      }
    },
    [selectedCategory, currentArtistId, db, toastError],
  );

  // ============================================
  // LYRIC BANK HANDLERS (shared between modes)
  // ============================================

  // Add lyrics to the bank
  const handleAddLyrics = useCallback(
    async (lyricsData) => {
      if (!currentArtistId) return;

      // Always persist via lyrics service (Firestore + localStorage)
      const nicheId = selectedCategory?.id || activeProjectNicheId || null;
      const newEntry = await addLyricsAsync(db, currentArtistId, {
        title: lyricsData.title || 'Untitled Lyrics',
        content: lyricsData.content || '',
        words: lyricsData.words || null,
        collectionIds: nicheId ? [nicheId] : [],
      });

      if (!selectedCategory) {
        // Library mode: also update selectedLibraryMedia so the editor sees the new lyric immediately
        if (newEntry) {
          setSelectedLibraryMedia((prev) => ({
            ...prev,
            lyrics: [...(prev.lyrics || []), newEntry],
          }));
        }
      } else {
        // Category mode: also update category state for in-session UI
        const catLyric = newEntry || {
          id: `lyrics_${Date.now()}`,
          title: lyricsData.title || 'Untitled Lyrics',
          content: lyricsData.content || '',
          words: lyricsData.words || null,
          createdAt: new Date().toISOString(),
        };

        setCategories((prev) =>
          prev.map((cat) =>
            cat.id === selectedCategory.id
              ? { ...cat, lyrics: [...(cat.lyrics || []), catLyric] }
              : cat,
          ),
        );

        setSelectedCategory((prev) =>
          prev
            ? {
                ...prev,
                lyrics: [...(prev.lyrics || []), catLyric],
              }
            : prev,
        );
      }

      return newEntry;
    },
    [selectedCategory, activeProjectNicheId, currentArtistId, db],
  );

  // Update lyrics
  const handleUpdateLyrics = useCallback(
    async (lyricsId, updates) => {
      if (!currentArtistId) return;

      // Always persist via lyrics service (Firestore + localStorage)
      await updateLyricsAsync(db, currentArtistId, lyricsId, updates);

      if (!selectedCategory) {
        // Library mode: also update selectedLibraryMedia
        setSelectedLibraryMedia((prev) => ({
          ...prev,
          lyrics: (prev.lyrics || []).map((l) =>
            l.id === lyricsId ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l,
          ),
        }));
      } else {
        // Category mode: also update category state for in-session UI
        setCategories((prev) =>
          prev.map((cat) =>
            cat.id === selectedCategory.id
              ? {
                  ...cat,
                  lyrics: (cat.lyrics || []).map((l) =>
                    l.id === lyricsId
                      ? { ...l, ...updates, updatedAt: new Date().toISOString() }
                      : l,
                  ),
                }
              : cat,
          ),
        );

        setSelectedCategory((prev) =>
          prev
            ? {
                ...prev,
                lyrics: (prev.lyrics || []).map((l) =>
                  l.id === lyricsId ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l,
                ),
              }
            : prev,
        );
      }
    },
    [selectedCategory, currentArtistId, db],
  );

  // Delete lyrics from bank
  const handleDeleteLyrics = useCallback(
    async (lyricsId) => {
      if (!currentArtistId) return;

      // Always persist via lyrics service (Firestore + localStorage)
      await deleteLyricsAsync(db, currentArtistId, lyricsId);

      if (selectedCategory) {
        // Category mode: also update category state for in-session UI
        setCategories((prev) =>
          prev.map((cat) =>
            cat.id === selectedCategory.id
              ? { ...cat, lyrics: (cat.lyrics || []).filter((l) => l.id !== lyricsId) }
              : cat,
          ),
        );

        setSelectedCategory((prev) =>
          prev
            ? {
                ...prev,
                lyrics: (prev.lyrics || []).filter((l) => l.id !== lyricsId),
              }
            : prev,
        );
      }
    },
    [selectedCategory, currentArtistId, db],
  );

  const categoryPresets = useMemo(
    () =>
      presets.filter(
        (p) => p.categoryId === selectedCategory?.id || p.categoryId === null || !p.categoryId,
      ),
    [presets, selectedCategory?.id],
  );

  // Memoized fallback categories for editors (avoids inline object creation in JSX)
  const editorCategory = useMemo(
    () =>
      selectedCategory ||
      pipelineCategory || {
        id: 'library-session',
        name: 'Library',
        videos: (selectedLibraryMedia?.videos || []).map((v) => ({
          ...v,
          src: v.url,
          localUrl: v.localUrl || v.url,
          thumbnail: v.thumbnail || null,
          name: v.name || v.metadata?.originalName || 'Clip',
        })),
        audio: selectedLibraryMedia?.audio
          ? [
              {
                ...selectedLibraryMedia.audio,
                src: selectedLibraryMedia.audio.url,
                localUrl: selectedLibraryMedia.audio.localUrl || selectedLibraryMedia.audio.url,
                savedLyrics: [],
              },
            ]
          : [],
        lyrics: selectedLibraryMedia?.lyrics || [],
        createdVideos: [],
        defaultPreset: null,
        captionTemplate: '',
        defaultHashtags: '',
      },
    [selectedCategory, pipelineCategory, selectedLibraryMedia],
  );

  const slideshowCategory = useMemo(
    () =>
      selectedCategory ||
      pipelineCategory || {
        id: 'library-session',
        name: 'Library',
        imagesA: [],
        imagesB: [],
        slideshows: [],
      },
    [selectedCategory, pipelineCategory],
  );

  return (
    <div style={styles.container}>
      {/* Breadcrumb hover styles — inline styles can't handle :hover */}
      <style>{`
        .studio-breadcrumbs button:hover {
          color: ${theme.text.primary} !important;
          background-color: rgba(255,255,255,0.08) !important;
        }
      `}</style>
      {/* Header — hide in inline mode on home view (ProjectLanding has own title) */}
      <header
        style={{
          ...styles.header,
          ...(isMobile ? { padding: '10px 12px', flexWrap: 'wrap', gap: '8px' } : {}),
          ...(inline &&
          currentView === 'home' &&
          !selectedCategory &&
          !studioMode &&
          !showEditor &&
          !showSlideshowEditor
            ? { display: 'none' }
            : {}),
        }}
      >
        <div
          style={{
            ...styles.headerLeft,
            ...(isMobile ? { minWidth: 0 } : {}),
            ...(inline ? { minWidth: 0 } : {}),
          }}
        >
          {/* Hide logo/Studio button in inline mode — AppShell sidebar already shows tab */}
          {!inline && (
            <button
              onClick={() => {
                setCurrentView('home');
                setSelectedCategory(null);
                setStudioMode(null);
              }}
              style={styles.logoButton}
              title="Back to categories"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polygon points="5,3 19,12 5,21" fill="currentColor" />
              </svg>
              {!isMobile && <span style={styles.logoText}>Studio</span>}
            </button>
          )}

          {/* Single artist indicator - hide on mobile and inline mode */}
          {!inline && !isMobile && artists.length === 1 && currentArtistId && (
            <span style={styles.singleArtistLabel}>{artists[0]?.name}</span>
          )}
        </div>

        <div
          style={{
            ...styles.headerCenter,
            ...(isMobile
              ? { flex: '1 1 auto', order: 3, width: '100%', justifyContent: 'flex-start' }
              : {}),
          }}
        >
          {/* Comprehensive Breadcrumb Navigation */}
          <div
            className="studio-breadcrumbs"
            style={{
              ...styles.breadcrumb,
              ...(isMobile
                ? { fontSize: '11px', padding: '4px 8px', overflowX: 'auto', maxWidth: '100%' }
                : {}),
            }}
          >
            {/* CATEGORY-BASED MODE: When selectedCategory exists */}
            {selectedCategory && (
              <>
                {isMobile ? (
                  /* Mobile: back arrow + current level only */
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      style={{
                        ...styles.breadcrumbLink,
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onClick={() => {
                        if (showEditor || showSlideshowEditor) {
                          const targetView =
                            studioMode === 'slideshows' ||
                            currentView === 'slideshows' ||
                            showSlideshowEditor
                              ? 'slideshows'
                              : 'library';
                          setCurrentView(targetView);
                          setShowEditor(false);
                          setShowSlideshowEditor(false);
                        } else if (currentView === 'library' || currentView === 'slideshows') {
                          setCurrentView('home');
                          setStudioMode(null);
                        } else if (studioMode) {
                          setCurrentView('home');
                          setStudioMode(null);
                        } else {
                          setSelectedCategory(null);
                          setStudioMode(null);
                        }
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <span style={styles.breadcrumbCurrent}>
                      {showEditor || showSlideshowEditor
                        ? 'Editor'
                        : currentView === 'library' || currentView === 'slideshows'
                          ? 'Dashboard'
                          : studioMode
                            ? studioMode === 'slideshows'
                              ? 'Slideshows'
                              : 'Videos'
                            : selectedCategory.name}
                    </span>
                  </div>
                ) : (
                  /* Desktop: full breadcrumb path */
                  <>
                    {/* Root: Categories */}
                    <button
                      style={{
                        ...styles.breadcrumbLink,
                        ...(!showEditor && !showSlideshowEditor ? styles.breadcrumbCurrent : {}),
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
                        ...(currentView === 'home' &&
                        !studioMode &&
                        !showEditor &&
                        !showSlideshowEditor
                          ? styles.breadcrumbCurrent
                          : {}),
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
                    {(studioMode ||
                      currentView === 'library' ||
                      currentView === 'slideshows' ||
                      showEditor ||
                      showSlideshowEditor) && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <button
                          style={{
                            ...styles.breadcrumbLink,
                            ...(currentView === 'home' &&
                            studioMode &&
                            !showEditor &&
                            !showSlideshowEditor
                              ? styles.breadcrumbCurrent
                              : {}),
                          }}
                          onClick={() => {
                            setCurrentView('home');
                            // Keep studioMode, determine from context
                            const mode =
                              studioMode ||
                              (currentView === 'slideshows' || showSlideshowEditor
                                ? 'slideshows'
                                : 'videos');
                            setStudioMode(mode);
                            setShowEditor(false);
                            setShowSlideshowEditor(false);
                          }}
                        >
                          {studioMode === 'slideshows' ||
                          currentView === 'slideshows' ||
                          showSlideshowEditor
                            ? 'Slideshows'
                            : 'Videos'}
                        </button>
                      </>
                    )}

                    {/* Dashboard (Content Library) */}
                    {(currentView === 'library' ||
                      currentView === 'slideshows' ||
                      showEditor ||
                      showSlideshowEditor) && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <button
                          style={{
                            ...styles.breadcrumbLink,
                            ...(!showEditor && !showSlideshowEditor
                              ? styles.breadcrumbCurrent
                              : {}),
                          }}
                          onClick={() => {
                            const targetView =
                              studioMode === 'slideshows' ||
                              currentView === 'slideshows' ||
                              showSlideshowEditor
                                ? 'slideshows'
                                : 'library';
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
              </>
            )}

            {/* LIBRARY-BASED MODE: Contextual breadcrumb (sidebar handles top-level nav) */}
            {!selectedCategory && (
              <>
                {isMobile ? (
                  /* Mobile: back arrow + current level only */
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      style={{
                        ...styles.breadcrumbLink,
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onClick={() => {
                        if (showEditor || showSlideshowEditor) {
                          setShowEditor(false);
                          setShowSlideshowEditor(false);
                          const targetView = studioMode === 'slideshows' ? 'slideshows' : 'library';
                          setCurrentView(targetView);
                        } else if (currentView === 'project') {
                          setActiveProjectId(null);
                          setActiveProjectNicheId(null);
                          setCurrentView('home');
                        } else if (
                          currentView === 'drafts' ||
                          currentView === 'scheduling' ||
                          currentView === 'media'
                        ) {
                          if (activeProjectId) {
                            setCurrentView('project', {
                              projectId: activeProjectId,
                              nicheId: activeProjectNicheId,
                            });
                          } else {
                            setCurrentView('home');
                          }
                          setStudioMode(null);
                          setDraftsCollectionFilter(null);
                        } else if (studioMode) {
                          setCurrentView('home');
                          setStudioMode(null);
                        } else {
                          navigateWithDraftCheck(onClose);
                        }
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <span style={styles.breadcrumbCurrent}>
                      {showEditor || showSlideshowEditor
                        ? showSlideshowEditor
                          ? 'Slideshow Editor'
                          : 'Video Editor'
                        : currentView === 'scheduling'
                          ? 'Scheduled Posts'
                          : currentView === 'drafts'
                            ? 'Drafts'
                            : currentView === 'media'
                              ? 'All Media'
                              : currentView === 'project'
                                ? 'Project'
                                : studioMode === 'videos'
                                  ? 'Videos'
                                  : studioMode === 'slideshows'
                                    ? 'Slideshows'
                                    : 'Studio'}
                    </span>
                  </div>
                ) : (
                  /* Desktop: contextual breadcrumb — only shows current path within Studio */
                  <>
                    {/* Studio (home) */}
                    <button
                      style={{
                        ...styles.breadcrumbLink,
                        ...(currentView === 'home' &&
                        !studioMode &&
                        !showEditor &&
                        !showSlideshowEditor
                          ? styles.breadcrumbCurrent
                          : {}),
                      }}
                      onClick={() =>
                        navigateWithDraftCheck(() => {
                          setCurrentView('home');
                          setActivePipelineId(null);
                          setActiveProjectId(null);
                          setActiveProjectNicheId(null);
                          setStudioMode(null);
                          setShowEditor(false);
                          setShowSlideshowEditor(false);
                        })
                      }
                    >
                      Studio
                    </button>

                    {/* Project breadcrumb */}
                    {currentView === 'project' && activeProjectId && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <span style={styles.breadcrumbCurrent}>Project</span>
                      </>
                    )}

                    {/* Videos sub-section */}
                    {(studioMode === 'videos' || (showEditor && studioMode !== 'slideshows')) && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <button
                          style={{
                            ...styles.breadcrumbLink,
                            ...(!showEditor ? styles.breadcrumbCurrent : {}),
                          }}
                          onClick={() =>
                            navigateWithDraftCheck(() => {
                              setCurrentView('home');
                              setStudioMode('videos');
                              setShowEditor(false);
                              setShowSlideshowEditor(false);
                            })
                          }
                        >
                          Videos
                        </button>
                      </>
                    )}

                    {/* Slideshows sub-section */}
                    {(studioMode === 'slideshows' || showSlideshowEditor) && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <button
                          style={{
                            ...styles.breadcrumbLink,
                            ...(!showSlideshowEditor ? styles.breadcrumbCurrent : {}),
                          }}
                          onClick={() =>
                            navigateWithDraftCheck(() => {
                              setCurrentView('home');
                              setStudioMode('slideshows');
                              setShowEditor(false);
                              setShowSlideshowEditor(false);
                            })
                          }
                        >
                          Slideshows
                        </button>
                      </>
                    )}

                    {/* Drafts view */}
                    {currentView === 'drafts' && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <span style={styles.breadcrumbCurrent}>Drafts</span>
                      </>
                    )}

                    {/* All Media view */}
                    {currentView === 'media' && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <span style={styles.breadcrumbCurrent}>All Media</span>
                      </>
                    )}

                    {/* Scheduled posts view (within Studio context) */}
                    {currentView === 'scheduling' && (
                      <>
                        <span style={styles.breadcrumbSep}>/</span>
                        <span style={styles.breadcrumbCurrent}>Scheduled Posts</span>
                      </>
                    )}

                    {/* Editor context */}
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
              </>
            )}
          </div>
        </div>

        {/* Hide close button in inline mode — user navigates away via AppShell sidebar */}
        {!inline && (
          <div
            style={{
              ...styles.headerRight,
              ...(isMobile ? { order: 2, marginLeft: 'auto' } : {}),
            }}
          >
            <IconButton
              size={isMobile ? 'medium' : 'small'}
              icon={<FeatherX />}
              aria-label="Close"
              onClick={() => {
                if (showEditor || showSlideshowEditor) {
                  setShowEditor(false);
                  setShowSlideshowEditor(false);
                  if (activeProjectId) {
                    setCurrentView('project', {
                      projectId: activeProjectId,
                      nicheId: activeProjectNicheId,
                    });
                  } else {
                    const targetView = studioMode === 'slideshows' ? 'slideshows' : 'library';
                    setCurrentView(targetView);
                  }
                } else if (currentView === 'project') {
                  setActiveProjectId(null);
                  setActiveProjectNicheId(null);
                  setCurrentView('home');
                } else if (currentView === 'library' || currentView === 'slideshows') {
                  setCurrentView('home');
                  setStudioMode(null);
                } else if (studioMode) {
                  setCurrentView('home');
                  setStudioMode(null);
                } else {
                  onClose();
                }
              }}
            />
          </div>
        )}
      </header>

      {/* Artist Selector Bar — hide in inline mode (AppShell already has one) */}
      {!inline && artists.length > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '6px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
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
                outline: 'none',
              }}
            >
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id} style={{ background: '#18181b' }}>
                  {artist.name}
                </option>
              ))}
            </select>
            <svg
              style={{
                position: 'absolute',
                right: '10px',
                pointerEvents: 'none',
                color: '#71717a',
              }}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main style={styles.main}>
        {currentView === 'home' && !selectedCategory && (
          <ProjectLanding
            db={db}
            artistId={currentArtistId}
            latePages={latePages}
            manualAccounts={manualAccounts}
            onOpenProject={handleOpenProject}
            onStartWizard={() => setCurrentView('project-wizard')}
            onViewAllMedia={() => setCurrentView('media')}
            onEditSlideshow={(slideshow) => handleMakeSlideshow(slideshow)}
            onOpenVideoEditor={(format, pipelineId) => {
              if (pipelineId) {
                setActivePipelineIdForEditor(pipelineId);
                setPullFromCollection(pipelineId);
              }
              const editorMode = FORMAT_TO_EDITOR[format?.id] || null;
              handleMakeVideo(null, editorMode);
            }}
            onViewContent={(options) => {
              if (options?.collectionFilter !== undefined) {
                setDraftsCollectionFilter(options.collectionFilter);
              } else {
                setDraftsCollectionFilter(null);
              }
              setCurrentView('drafts');
            }}
          />
        )}

        {currentView === 'project' && activeProjectId && (
          <ProjectWorkspace
            db={db}
            user={user}
            artistId={currentArtistId}
            artistName={artists.find((a) => a.id === currentArtistId)?.name || 'Unknown'}
            projectId={activeProjectId}
            initialNicheId={activeProjectNicheId}
            latePages={latePages}
            onBack={() => {
              setActiveProjectId(null);
              setActiveProjectNicheId(null);
              setCurrentView('home');
            }}
            onOpenEditor={(p, count, existingDraft) => {
              setSelectedCategory(null);
              setActivePipelineIdForEditor(p.id);
              setActivePipelineObjectForEditor(p);
              setPullFromCollection(p.id);
              setPipelineCategoryVersion((v) => v + 1);
              // Pass niche draft with generate count so editor creates N variations
              const draft = existingDraft || null;
              if (draft && count > 1 && !draft._nicheGenerateCount) {
                draft._nicheGenerateCount = count;
              }
              handleMakeSlideshow(draft);
            }}
            onOpenVideoEditor={(
              format,
              nicheId,
              existingDraft,
              _templateSettings,
              nicheSourceVideos,
              bankIds,
              nicheObject,
              clipIds,
            ) => {
              if (nicheId) {
                setSelectedCategory(null); // Clear stale category so pipelineCategory is used
                setActivePipelineIdForEditor(nicheId);
                // Store niche object for pipelineCategory fallback
                // Use passed nicheObject first (from ProjectWorkspace live state),
                // then try getUserCollections, then categories as last resort
                const nicheObj =
                  nicheObject ||
                  getUserCollections(currentArtistId).find((c) => c.id === nicheId) ||
                  categories.find((c) => c.id === nicheId);
                setActivePipelineObjectForEditor(nicheObj || null);
                setPullFromCollection(nicheId);
                setPipelineCategoryVersion((v) => v + 1); // Force recompute to pick up latest text banks
              }
              setSelectedMediaBankIds(bankIds || null);
              setSelectedClipIds(clipIds || null);
              setClipperSourceVideos(nicheSourceVideos || []);
              // Clipper: compute bank labels from niche + handle session objects
              if (format?.id === 'clipper' && nicheId && currentArtistId) {
                const niche =
                  (nicheObject?.id === nicheId ? nicheObject : null) ||
                  getUserCollections(currentArtistId).find((c) => c.id === nicheId) ||
                  categories.find((c) => c.id === nicheId);
                if (niche) {
                  const migrated = migrateCollectionBanks(niche);
                  const banks = migrated.banks || [];
                  if (banks.length > 0) {
                    setClipperBankLabels(banks.map((_, i) => getPipelineBankLabel(migrated, i)));
                  } else {
                    setClipperBankLabels(['Bucket 1']);
                  }
                }
                // If existingDraft has .clips and an .id, treat as session object
                if (existingDraft?.clips && existingDraft?.id?.startsWith('session_')) {
                  setClipperSession(existingDraft);
                  handleMakeVideo(null, 'clipper');
                  return;
                }
              } else {
                setClipperSession(null);
                setClipperBankLabels(null);
              }
              const editorMode = FORMAT_TO_EDITOR[format?.id] || null;
              handleMakeVideo(existingDraft || null, editorMode);
            }}
            onViewDrafts={(niche) => {
              if (niche?.id) {
                setDraftsCollectionFilter(niche.id);
                setCurrentView('drafts');
              } else {
                setCurrentView('slideshows');
                setStudioMode('slideshows');
              }
            }}
            onSchedule={() => {
              setCurrentView('scheduling');
            }}
            onAddLyrics={handleAddLyrics}
            onUpdateLyrics={handleUpdateLyrics}
            onDeleteLyrics={handleDeleteLyrics}
            crossNicheIds={crossNicheIds}
            onCrossNicheIdsChange={setCrossNicheIds}
            onNicheChange={(nicheId) => {
              setActiveProjectNicheId(nicheId);
              // Update URL query params to keep in sync
              const base = location.pathname.startsWith('/artist/')
                ? '/artist/studio'
                : '/operator/studio';
              const params = new URLSearchParams();
              params.set('projectId', activeProjectId);
              if (nicheId) params.set('nicheId', nicheId);
              navigate(`${base}/project?${params.toString()}`, { replace: true });
            }}
          />
        )}

        {currentView === 'project-wizard' && (
          <Suspense fallback={null}>
            <ProjectWizard
              db={db}
              artistId={currentArtistId}
              artistName={artists.find((a) => a.id === currentArtistId)?.name || 'Unknown'}
              latePages={latePages}
              manualAccounts={manualAccounts}
              onComplete={(projId) => handleOpenProject(projId)}
              onCancel={() => setCurrentView('home')}
            />
          </Suspense>
        )}

        {/* AestheticHome render branch removed in 94k. Default home view is
            now ProjectLanding (renders at currentView === 'home' &&
            !selectedCategory below). All handler functions that fed
            AestheticHome were swept in 94o — only handleUploadImages remains
            because it has a SlideshowEditor `onImportToBank` reference (also
            broken in modern flow, separate fix). */}

        {currentView === 'library' && (selectedCategory || libraryCategory) && (
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
            onRestoreContent={handleRestoreContent}
            onPermanentDelete={handlePermanentDelete}
            onGetDeletedContent={handleGetDeletedContent}
          />
        )}

        {currentView === 'slideshows' && (selectedCategory || libraryCategory) && (
          <ContentLibrary
            category={selectedCategory || libraryCategory}
            contentType="slideshows"
            onBack={() => setCurrentView('home')}
            onMakeSlideshow={handleMakeSlideshow}
            onEditSlideshow={(slideshow) => handleMakeSlideshow(slideshow)}
            onEditMultipleSlideshows={handleEditMultipleSlideshows}
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
            onRestoreContent={handleRestoreContent}
            onPermanentDelete={handlePermanentDelete}
            onGetDeletedContent={handleGetDeletedContent}
          />
        )}

        {/* Drafts View — swap between video and slideshow drafts */}
        {currentView === 'drafts' && (selectedCategory || libraryCategory) && (
          <DraftsView
            category={selectedCategory || libraryCategory}
            collectionFilter={draftsCollectionFilter}
            onBack={() => {
              setCurrentView(activeProjectId ? 'project' : 'home');
              setDraftsCollectionFilter(null);
            }}
            onMakeVideo={handleMakeVideo}
            onEditVideo={handleMakeVideo}
            onDeleteVideo={handleDeleteVideo}
            onApproveVideo={handleApproveVideo}
            onUpdateVideo={handleUpdateVideo}
            onMakeSlideshow={handleMakeSlideshow}
            onEditSlideshow={(slideshow) => handleMakeSlideshow(slideshow)}
            onEditMultipleSlideshows={handleEditMultipleSlideshows}
            onDeleteSlideshow={handleDeleteSlideshow}
            onSchedulePost={onSchedulePost}
            onViewScheduling={() => setCurrentView('scheduling')}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            db={db}
            accounts={accounts}
            lateAccountIds={lateAccountIds}
            artistId={currentArtistId}
            onRestoreContent={handleRestoreContent}
            onPermanentDelete={handlePermanentDelete}
            onGetDeletedContent={handleGetDeletedContent}
            onRemixDraft={handleRemixDraft}
          />
        )}

        {currentView === 'media' && (
          <AllMediaView db={db} artistId={currentArtistId} onBack={() => setCurrentView('home')} />
        )}

        {currentView === 'scheduling' && (
          <Suspense fallback={null}>
            <SchedulingPage
              db={db}
              artistId={currentArtistId}
              accounts={accounts}
              lateAccountIds={lateAccountIds}
              onSchedulePost={onSchedulePost}
              onDeleteLatePost={onDeleteLatePost}
              visibleArtists={artists}
              onArtistChange={(id) => {
                setCurrentArtistId(id);
                if (onArtistChange) onArtistChange(id);
              }}
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
              onBack={() => setCurrentView(activeProjectId ? 'project' : 'home')}
            />
          </Suspense>
        )}

        {/* Drafts bar removed — replaced by View Drafts buttons in StudioHome action bars and dashboard */}
      </main>

      {/* Editor Modal with ErrorBoundary to prevent blank page crashes */}
      <AnimatePresence>
        {showEditor && (
          <motion.div
            key="editor-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Suspense fallback={null}>
              <EditorErrorBoundary onClose={handleCloseEditor}>
                <VideoEditorModal
                  category={editorCategory}
                  existingVideo={editingVideo}
                  presets={categoryPresets}
                  onSave={handleSaveVideo}
                  onSavePreset={handleSavePreset}
                  onSaveLyrics={handleSaveLyricsToAudio}
                  onAddLyrics={handleAddLyrics}
                  onUpdateLyrics={handleUpdateLyrics}
                  onDeleteLyrics={handleDeleteLyrics}
                  onShowBatchPipeline={
                    schedulerEditPostId
                      ? null
                      : (settings) => {
                          setBatchLyricSettings(settings || null);
                          setShowBatchPipeline(true);
                        }
                  }
                  onClose={() => {
                    handleCloseEditor();
                    setSchedulerEditPostId(null);
                  }}
                  artistId={currentArtistId}
                  db={db}
                  user={user}
                  showTemplatePicker={schedulerEditPostId ? false : showTemplatePicker}
                  schedulerEditMode={!!schedulerEditPostId}
                  initialEditorMode={initialEditorMode}
                  clipperSourceVideos={clipperSourceVideos}
                  clipperSession={clipperSession}
                  onSaveClipperSession={handleSaveClipperSession}
                  nicheBankLabels={clipperBankLabels}
                  clipperProjectNiches={clipperProjectNiches}
                />
              </EditorErrorBoundary>
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slideshow Editor Modal */}
      <AnimatePresence>
        {showSlideshowEditor && (selectedCategory || currentArtistId) && (
          <motion.div
            key="slideshow-editor-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Suspense fallback={null}>
              <SlideshowEditor
                db={db}
                artistId={currentArtistId}
                category={slideshowCategory}
                existingSlideshow={editingSlideshow}
                initialImages={selectedLibraryMedia?.images || []}
                initialAudio={selectedLibraryMedia?.audio || null}
                initialLyrics={selectedLibraryMedia?.lyrics || []}
                initialSelectedBanks={selectedLibraryMedia?.selectedBanks || null}
                batchMode={slideshowBatchMode}
                onSave={handleSaveSlideshow}
                onClose={() => {
                  handleCloseSlideshowEditor();
                  setSchedulerEditPostId(null);
                }}
                onSchedulePost={schedulerEditPostId ? null : onSchedulePost}
                onAddLyrics={handleAddLyrics}
                onImportToBank={handleUploadImages}
                lateAccountIds={lateAccountIds}
                schedulerEditMode={!!schedulerEditPostId}
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Pipeline - Streamlined batch create & schedule */}
      {showBatchPipeline && selectedCategory && (
        <Suspense fallback={null}>
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
            onSaveLyrics={handleSaveLyricsToAudio}
            onVideosCreated={(videos) => {
              // Add created videos to category
              setCategories((prev) =>
                prev.map((cat) =>
                  cat.id === selectedCategory.id
                    ? { ...cat, createdVideos: [...cat.createdVideos, ...videos] }
                    : cat,
                ),
              );
              setSelectedCategory((prev) =>
                prev
                  ? {
                      ...prev,
                      createdVideos: [...prev.createdVideos, ...videos],
                    }
                  : prev,
              );
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
        </Suspense>
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
              {uploadProgress.type === 'video'
                ? '🎬'
                : uploadProgress.type === 'image'
                  ? '🖼️'
                  : '🎵'}
            </div>
            <h3 style={styles.uploadTitle}>
              Uploading{' '}
              {uploadProgress.type === 'video'
                ? 'Videos'
                : uploadProgress.type === 'image'
                  ? 'Images'
                  : 'Audio'}
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
                  backgroundColor: uploadProgress.type === 'image' ? '#14b8a6' : '#7c3aed',
                }}
              />
            </div>
            <p style={styles.uploadPercent}>{Math.round(uploadProgress.progress || 0)}%</p>
          </div>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme, inline = false) => ({
  container: inline
    ? {
        width: '100%',
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.bg.page,
        color: theme.text.primary,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }
    : {
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
        boxShadow: '0 0 60px rgba(0, 0, 0, 0.8)',
      },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    backgroundColor: theme.bg.surface,
    borderBottom: `1px solid ${theme.border.subtle}`,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    minWidth: '180px',
  },
  headerCenter: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    minWidth: '180px',
    justifyContent: 'flex-end',
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
    borderRadius: '8px',
  },
  logoText: {
    fontSize: '15px',
    fontWeight: '600',
  },
  artistSelector: {
    position: 'relative',
    marginLeft: '12px',
    paddingLeft: '12px',
    borderLeft: '1px solid #2a2a3e',
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
    outline: 'none',
  },
  artistSelectIcon: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
    color: theme.text.secondary,
  },
  singleArtistLabel: {
    marginLeft: '12px',
    paddingLeft: '12px',
    borderLeft: `1px solid ${theme.border.default}`,
    fontSize: '13px',
    fontWeight: '500',
    color: theme.text.secondary,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    backgroundColor: theme.hover.bg,
    padding: '6px 12px',
    borderRadius: '6px',
  },
  breadcrumbLink: {
    background: 'none',
    border: 'none',
    color: theme.text.secondary,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    transition: 'color 0.2s, background-color 0.2s',
  },
  breadcrumbSep: {
    color: theme.text.muted,
  },
  breadcrumbCurrent: {
    color: theme.text.primary,
    fontWeight: '500',
    cursor: 'default',
  },
  // Wave 4: Quick-nav breadcrumb links (always visible)
  breadcrumbQuickLink: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    cursor: 'pointer',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    transition: 'color 0.15s, background-color 0.15s',
  },
  breadcrumbQuickLinkActive: {
    color: theme.accent.hover,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
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
    zIndex: 9999,
  },
  uploadModal: {
    backgroundColor: theme.bg.surface,
    borderRadius: '16px',
    padding: '32px 48px',
    textAlign: 'center',
    minWidth: '300px',
  },
  uploadIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  uploadTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: theme.text.primary,
    margin: '0 0 8px 0',
  },
  uploadStatus: {
    fontSize: '13px',
    color: theme.text.secondary,
    margin: '0 0 20px 0',
  },
  uploadProgressBar: {
    width: '100%',
    height: '6px',
    backgroundColor: theme.bg.elevated,
    borderRadius: '3px',
    overflow: 'hidden',
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: theme.accent.primary,
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  uploadPercent: {
    fontSize: '24px',
    fontWeight: '700',
    color: theme.accent.primary,
    margin: '16px 0 0 0',
  },
});

export default VideoStudio;
