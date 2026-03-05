import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ExportAndPostModal from './ExportAndPostModal';
import ScheduleQueue from './ScheduleQueue';
import { StatusPill, ConfirmDialog, useToast } from '../ui';
import { VIDEO_STATUS } from '../../utils/status';
import { renderVideo } from '../../services/videoExportService';
import { uploadFile } from '../../services/firebaseStorage';
import { exportSlideshowAsImages } from '../../services/slideshowExportService';
import { createScheduledPost, deleteScheduledPost, getScheduledPosts, POST_STATUS } from '../../services/scheduledPostsService';
import { getLibrary, getLibraryAsync, getProjects, getProjectNiches, saveCreatedContentAsync, markContentScheduledAsync, unmarkContentScheduledAsync, resolveCollectionBanks } from '../../services/libraryService';
import log from '../../utils/logger';
import {
  initGoogleDrive, authenticate as driveAuth, isAuthenticated as isDriveAuth,
  uploadFile as driveUploadFile, ensureAppFolder
} from '../../services/googleDriveService';
import {
  initDropbox, authenticate as dbxAuth, isAuthenticated as isDbxAuth,
  uploadFile as dbxUploadFile, ensureAppFolder as dbxEnsureAppFolder
} from '../../services/dropboxService';
import useIsMobile from '../../hooks/useIsMobile';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import { useTheme } from '../../contexts/ThemeContext';
import CloudImportButton from './CloudImportButton';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { Badge } from '../../ui/components/Badge';
import { FeatherArrowLeft, FeatherPlus, FeatherTrash2, FeatherDownload, FeatherEdit2, FeatherMusic, FeatherCalendar, FeatherX, FeatherSend, FeatherUploadCloud, FeatherFilm } from '@subframe/core';

/**
 * ContentLibrary - Shows all videos or slideshows created within a category
 * With batch selection and posting capabilities
 */
const ContentLibrary = ({
  category,
  contentType = 'videos', // 'videos' or 'slideshows'
  onBack,
  // Video-specific props
  onMakeVideo,
  onEditVideo,
  onDeleteVideo,
  onApproveVideo,
  onSchedulePost,
  onUpdateVideo,  // New: update a video after rendering
  // Slideshow-specific props
  onMakeSlideshow,
  onEditSlideshow,
  onEditMultipleSlideshows,
  onDeleteSlideshow,
  // Shared
  onShowBatchPipeline, // Open the main batch create workflow
  onViewScheduling, // Navigate to scheduling page
  isDraftsView = false, // When true, hide Make buttons and show Delete Selected
  collectionFilter = null, // null=all, string=collectionId, 'uncategorized'=no collection
  db = null, // Firestore instance for creating scheduled posts
  // Posting module props
  accounts = [],
  lateAccountIds = {},
  artistId = null,
  // Trash / soft-delete props
  onRestoreContent,
  onPermanentDelete,
  onGetDeletedContent,
  // Drafts tab toggle (Video/Slideshow)
  draftsTab,
  onDraftsTabChange
}) => {
  // BUG-034: Toast notifications instead of alert()
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();

  const isSlideshow = contentType === 'slideshows';
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [nicheFilter, setNicheFilter] = useState('all');
  const [exportingVideo, setExportingVideo] = useState(null);
  const [previewingVideo, setPreviewingVideo] = useState(null);
  const [previewingSlideshow, setPreviewingSlideshow] = useState(null);

  // Trash view state
  const [showTrash, setShowTrash] = useState(false);
  const [trashItems, setTrashItems] = useState([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  // Projects & niches for filtering
  const projects = useMemo(() => artistId ? getProjects(artistId) : [], [artistId]);
  const niches = useMemo(() => {
    if (!artistId || projectFilter === 'all') {
      // Get all niches across all projects
      return projects.flatMap(p => getProjectNiches(artistId, p.id));
    }
    return getProjectNiches(artistId, projectFilter);
  }, [artistId, projects, projectFilter]);

  // Map niche (collection) IDs to their project IDs for filtering
  const nicheProjectMap = useMemo(() => {
    const map = new Map();
    for (const p of projects) {
      for (const n of getProjectNiches(artistId, p.id)) {
        map.set(n.id, p.id);
      }
    }
    return map;
  }, [artistId, projects]);

  // Reset niche filter when project changes
  useEffect(() => {
    setNicheFilter('all');
  }, [projectFilter]);

  // Build URL/ID→thumbnailUrl map from library for low-res card thumbnails
  const thumbMap = useMemo(() => {
    if (!artistId) return new Map();
    const lib = getLibrary(artistId);
    const map = new Map();
    for (const item of lib) {
      if (item.thumbnailUrl) {
        if (item.url) map.set(item.url, item.thumbnailUrl);
        if (item.id) map.set(item.id, item.thumbnailUrl);
        if (item.localUrl) map.set(item.localUrl, item.thumbnailUrl);
      }
    }
    return map;
  }, [artistId]);

  // Rendering state
  const [renderingVideoId, setRenderingVideoId] = useState(null);
  const [renderProgress, setRenderProgress] = useState(0);

  // Google Drive export
  const DRIVE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
  const DRIVE_API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
  const driveConfigured = !!(DRIVE_CLIENT_ID && DRIVE_API_KEY);
  const [driveExporting, setDriveExporting] = useState(null); // item id being exported

  // Dropbox export
  const DROPBOX_APP_KEY = process.env.REACT_APP_DROPBOX_APP_KEY;
  const dropboxConfigured = !!DROPBOX_APP_KEY;
  const [dropboxExporting, setDropboxExporting] = useState(null);

  // Export a video or slideshow to Google Drive
  const handleExportToDrive = useCallback(async (item) => {
    if (!driveConfigured) {
      toastError('Google Drive not configured');
      return;
    }
    setDriveExporting(item.id);
    try {
      // Init + auth
      await initGoogleDrive(DRIVE_CLIENT_ID, DRIVE_API_KEY);
      if (!isDriveAuth()) await driveAuth();

      // Ensure app folder exists
      const artistName = category?.name || 'StickToMusic';
      const appFolder = await ensureAppFolder(artistName);

      if (isSlideshow) {
        // Export slideshow slides as images to Drive
        const slides = item.slides || [];
        let uploaded = 0;
        for (let i = 0; i < slides.length; i++) {
          const slide = slides[i];
          const imageUrl = slide.backgroundImage || slide.imageA?.url || slide.imageA?.localUrl || slide.thumbnail;
          if (!imageUrl) continue;
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          const fileName = `${item.name || 'slideshow'}_slide${i + 1}.${blob.type.includes('png') ? 'png' : 'jpg'}`;
          await driveUploadFile(new File([blob], fileName, { type: blob.type }), fileName, appFolder.id, blob.type);
          uploaded++;
        }
        toastSuccess(`Exported ${uploaded} slide${uploaded !== 1 ? 's' : ''} to Google Drive`);
      } else {
        // Export video to Drive
        const url = item.cloudUrl;
        if (!url) {
          toastError('Video needs to be rendered first');
          setDriveExporting(null);
          return;
        }
        const resp = await fetch(url);
        const blob = await resp.blob();
        const fileName = `${item.name || item.textOverlay || 'video'}_${item.id}.mp4`;
        await driveUploadFile(new File([blob], fileName, { type: 'video/mp4' }), fileName, appFolder.id, 'video/mp4');
        toastSuccess('Video exported to Google Drive');
      }
    } catch (err) {
      log.error('[ContentLibrary] Drive export failed:', err);
      toastError('Drive export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDriveExporting(null);
    }
  }, [driveConfigured, DRIVE_CLIENT_ID, DRIVE_API_KEY, isSlideshow, category?.name, toastSuccess, toastError]);

  // Export a video or slideshow to Dropbox
  const handleExportToDropbox = useCallback(async (item) => {
    if (!dropboxConfigured) {
      toastError('Dropbox not configured');
      return;
    }
    setDropboxExporting(item.id);
    try {
      initDropbox(DROPBOX_APP_KEY);
      if (!isDbxAuth()) await dbxAuth();

      const artistName = category?.name || 'StickToMusic';
      const appFolder = await dbxEnsureAppFolder(artistName);

      if (isSlideshow) {
        const slides = item.slides || [];
        let uploaded = 0;
        for (let i = 0; i < slides.length; i++) {
          const slide = slides[i];
          const imageUrl = slide.backgroundImage || slide.imageA?.url || slide.imageA?.localUrl || slide.thumbnail;
          if (!imageUrl) continue;
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          const fileName = `${item.name || 'slideshow'}_slide${i + 1}.${ext}`;
          await dbxUploadFile(new File([blob], fileName, { type: blob.type }), `${appFolder.artistPath}/${fileName}`);
          uploaded++;
        }
        toastSuccess(`Exported ${uploaded} slide${uploaded !== 1 ? 's' : ''} to Dropbox`);
      } else {
        const url = item.cloudUrl;
        if (!url) {
          toastError('Video needs to be rendered first');
          setDropboxExporting(null);
          return;
        }
        const resp = await fetch(url);
        const blob = await resp.blob();
        const fileName = `${item.name || item.textOverlay || 'video'}_${item.id}.mp4`;
        await dbxUploadFile(new File([blob], fileName, { type: 'video/mp4' }), `${appFolder.artistPath}/${fileName}`);
        toastSuccess('Video exported to Dropbox');
      }
    } catch (err) {
      log.error('[ContentLibrary] Dropbox export failed:', err);
      toastError('Dropbox export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDropboxExporting(null);
    }
  }, [dropboxConfigured, DROPBOX_APP_KEY, isSlideshow, category?.name, toastSuccess, toastError]);

  // Scheduled posts for draft status tracking
  const [scheduledPosts, setScheduledPosts] = useState([]);

  // Load scheduled posts when in drafts view
  React.useEffect(() => {
    if (!isDraftsView || !db || !artistId) return;
    getScheduledPosts(db, artistId).then(posts =>
      setScheduledPosts(posts.filter(p => p.status !== 'draft'))
    ).catch(() => {});
  }, [isDraftsView, db, artistId]);

  // Handle rendering a video recipe into a real video
  // Returns the cloudUrl when called from PostingModule
  const handleRenderVideo = useCallback(async (video) => {
    if (renderingVideoId) throw new Error('Already rendering another video');

    setRenderingVideoId(video.id);
    setRenderProgress(0);

    try {
      log('[ContentLibrary] Rendering video:', video.id);

      // Render the video
      const blob = await renderVideo(video, (progress) => {
        setRenderProgress(progress);
      });

      log('[ContentLibrary] Video rendered, size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

      // Upload to Firebase - use correct extension based on blob type
      setRenderProgress(95);
      const isMP4 = blob.type === 'video/mp4';
      const extension = isMP4 ? 'mp4' : 'webm';
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `${video.id}.${extension}`, { type: blob.type }),
        'videos'
      );

      log('[ContentLibrary] Video uploaded:', cloudUrl);

      // Update the video with the cloudUrl
      if (onUpdateVideo) {
        onUpdateVideo(video.id, {
          cloudUrl,
          isRendered: true,
          status: VIDEO_STATUS.COMPLETED,
          updatedAt: new Date().toISOString()
        });
      }

      setRenderProgress(100);
      return cloudUrl; // Return URL for PostingModule
    } catch (err) {
      log.error('[ContentLibrary] Render failed:', err);
      toastError('Render failed: ' + err.message);
      throw err; // Re-throw for PostingModule to handle
    } finally {
      setRenderingVideoId(null);
      setRenderProgress(0);
    }
  }, [renderingVideoId, onUpdateVideo]);

  // UI-30: Confirm dialog for delete (supports single and bulk delete)
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, videoId: null, isBulk: false });

  // Schedule Queue state (replaces PostingModule + SlideshowPostingModal)
  const [showScheduleQueue, setShowScheduleQueue] = useState(false);

  // Legacy: postingSlideshow kept for single-slideshow post button
  const [postingSlideshow, setPostingSlideshow] = useState(null);

  // Bulk audio assign state
  const [showAudioAssign, setShowAudioAssign] = useState(false);
  const [audioLibrary, setAudioLibrary] = useState([]);
  const [assigningAudio, setAssigningAudio] = useState(false);

  // Get content array based on type — reverse chronological (newest first)
  // When collectionFilter is set, only show items from that collection
  const items = useMemo(() => {
    const raw = isSlideshow
      ? (category?.slideshows || [])
      : (category?.createdVideos || []);
    const sorted = [...raw].sort((a, b) => {
      const ta = new Date(b.createdAt || 0).getTime();
      const tb = new Date(a.createdAt || 0).getTime();
      return ta - tb;
    });
    if (!collectionFilter) return sorted;
    if (collectionFilter === 'uncategorized') {
      return sorted.filter(item => !item.collectionId);
    }
    return sorted.filter(item => item.collectionId === collectionFilter);
  }, [isSlideshow, category?.slideshows, category?.createdVideos, collectionFilter]);

  // For backwards compatibility, also alias as videos for video-specific logic
  const videos = isSlideshow ? [] : items;

  // Rubber-band multi-select — replaces manual selectedVideoIds + toggleItemSelection
  const { selectedIds, isDragSelecting, rubberBand, gridRef, gridMouseHandlers, toggleSelect, selectAll, clearSelection } = useMediaMultiSelect(items);
  const selectedVideoIds = selectedIds;

  const selectedItems = useMemo(() =>
    items.filter(v => selectedVideoIds.has(v.id)),
    [items, selectedVideoIds]
  );

  // Backwards compat alias
  const selectedVideos = isSlideshow ? [] : selectedItems;

  // Load audio library when bulk assign panel opens
  useEffect(() => {
    if (showAudioAssign && db && artistId && audioLibrary.length === 0) {
      getLibraryAsync(db, artistId).then(media => {
        const audioItems = (media || []).filter(m =>
          m.type === 'audio' || m.name?.match(/\.(mp3|wav|m4a|aac|ogg)$/i) || m.mimeType?.includes('audio')
        ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setAudioLibrary(audioItems);
      }).catch(err => log.error('[ContentLibrary] Failed to load audio library:', err));
    }
  }, [showAudioAssign, db, artistId, audioLibrary.length]);

  // Bulk assign audio to selected drafts
  const handleBulkAudioAssign = useCallback(async (audioItem) => {
    if (!db || !artistId || selectedVideoIds.size === 0) return;
    setAssigningAudio(true);
    try {
      const selected = items.filter(item => selectedVideoIds.has(item.id));
      const updatedSlideshows = selected.map(item => ({
        ...item,
        audio: {
          id: audioItem.id,
          name: audioItem.name,
          url: audioItem.url,
          duration: audioItem.duration,
          isTrimmed: false,
          startTime: 0,
          endTime: audioItem.duration || null,
        }
      }));
      await saveCreatedContentAsync(db, artistId, { videos: [], slideshows: updatedSlideshows });
      if (category?.slideshows) {
        const audioData = { id: audioItem.id, name: audioItem.name, url: audioItem.url, duration: audioItem.duration, isTrimmed: false, startTime: 0, endTime: audioItem.duration || null };
        category.slideshows.forEach(ss => {
          if (selectedVideoIds.has(ss.id)) { ss.audio = audioData; }
        });
      }
      toastSuccess(`Assigned "${audioItem.name}" to ${selectedVideoIds.size} drafts`);
      setShowAudioAssign(false);
    } catch (err) {
      log.error('[ContentLibrary] Bulk audio assign failed:', err);
      toastError(`Failed to assign audio: ${err.message}`);
    } finally { setAssigningAudio(false); }
  }, [db, artistId, selectedVideoIds, items, category, toastSuccess, toastError]);


  // Identify drafts that have been posted or scheduled via scheduled posts
  const postedContentIds = useMemo(() => {
    const ids = new Set();
    scheduledPosts.forEach(p => {
      if (p.status === 'posted' && p.contentId) ids.add(p.contentId);
    });
    return ids;
  }, [scheduledPosts]);

  const scheduledContentIds = useMemo(() => {
    const ids = new Set();
    scheduledPosts.forEach(p => {
      if ((p.status === 'scheduled' || p.status === 'draft') && p.contentId) ids.add(p.contentId);
    });
    return ids;
  }, [scheduledPosts]);

  // Split items into posted, scheduled, and unposted
  const [draftTab, setDraftTab] = useState('drafts'); // 'drafts' | 'scheduled' | 'posted'

  const { unpostedItems, scheduledItems, postedItems } = useMemo(() => {
    const posted = [];
    const scheduled = [];
    const unposted = [];
    items.forEach(item => {
      if (postedContentIds.has(item.id)) {
        posted.push(item);
      } else if (scheduledContentIds.has(item.id) || item.scheduledPostId) {
        scheduled.push(item);
      } else {
        unposted.push(item);
      }
    });
    return { unpostedItems: unposted, scheduledItems: scheduled, postedItems: posted };
  }, [items, postedContentIds, scheduledContentIds]);

  // Shared project/niche filter function
  const applyProjectNicheFilter = useCallback((item) => {
    if (projectFilter !== 'all') {
      const itemProject = item.collectionId ? nicheProjectMap.get(item.collectionId) : null;
      if (itemProject !== projectFilter) return false;
    }
    if (nicheFilter !== 'all') {
      if (item.collectionId !== nicheFilter) return false;
    }
    return true;
  }, [projectFilter, nicheFilter, nicheProjectMap]);

  const filteredItems = unpostedItems.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (dateRange !== 'all') {
      const created = new Date(item.createdAt);
      const now = new Date();
      const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      if (dateRange === 'today' && diffDays > 0) return false;
      if (dateRange === 'week' && diffDays > 7) return false;
      if (dateRange === 'month' && diffDays > 30) return false;
    }
    return applyProjectNicheFilter(item);
  });

  const filteredScheduledItems = useMemo(() => scheduledItems.filter(applyProjectNicheFilter), [scheduledItems, applyProjectNicheFilter]);
  const filteredPostedItems = useMemo(() => postedItems.filter(applyProjectNicheFilter), [postedItems, applyProjectNicheFilter]);


  // Backwards compat alias
  const filteredVideos = isSlideshow ? [] : filteredItems;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between px-6 py-5 border-b border-neutral-200 ${isDraftsView && !isMobile ? '!grid !grid-cols-[1fr_auto_1fr] !items-center' : ''} ${isMobile ? '!flex-col !items-stretch !gap-3 !p-4' : ''}`}>
        <div className="flex items-center gap-4">
          <IconButton size="small" icon={<FeatherArrowLeft />} aria-label="Back" onClick={() => { setPreviewingVideo(null); setPreviewingSlideshow(null); onBack?.(); }} />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-neutral-100 rounded-lg flex items-center justify-center text-base font-semibold text-neutral-400">{category?.name?.charAt(0).toUpperCase()}</div>
            <div>
              <h1 className="text-lg font-semibold text-white m-0">{category?.name}</h1>
              <p className="text-[13px] text-neutral-500 m-0">
                {isSlideshow ? 'Draft and approve slideshows' : 'Draft and approve videos'}
              </p>
            </div>
          </div>
        </div>
        {/* Video / Slideshow toggle — centered */}
        {isDraftsView && onDraftsTabChange && (
          <div className="flex items-center">
            {['videos', 'slideshows'].map(tab => (
              <button
                key={tab}
                onClick={() => onDraftsTabChange(tab)}
                className={`border-none cursor-pointer transition-all duration-150 px-4 py-2 text-[13px] font-semibold rounded-md ${draftsTab === tab ? 'bg-indigo-500/15 text-indigo-400' : 'bg-transparent text-neutral-500'}`}
              >
                {tab === 'videos' ? 'Videos' : 'Slideshows'}
              </button>
            ))}
          </div>
        )}
        <div className={`flex items-center gap-2 ${isDraftsView ? 'justify-end' : ''} ${isMobile ? '!flex-col !w-full !gap-2' : ''}`}>
          {isDraftsView ? (
            /* Drafts view: only show delete when items selected */
            selectedVideoIds.size > 0 && (
              <Button variant="destructive-secondary" size="small" className={isMobile ? 'w-full justify-center' : ''} icon={<FeatherTrash2 />} onClick={() => setDeleteConfirm({ isOpen: true, videoId: null, isBulk: true })}>
                Delete Selected ({selectedVideoIds.size})
              </Button>
            )
          ) : (
            /* Normal category view: show Make buttons */
            <>
              <CloudImportButton
                artistId={artistId}
                db={db}
                mediaType="all"
                onImportMedia={(files) => {
                  toastSuccess(`Imported ${files.length} file(s) from cloud`);
                }}
              />
              <Button variant="brand-primary" size="small" className={isMobile ? 'w-full justify-center' : ''} icon={<FeatherPlus />} onClick={() => isSlideshow ? onMakeSlideshow?.() : onMakeVideo?.()}>
                {isSlideshow ? 'Make a slideshow' : 'Make a video'}
              </Button>
              {!isSlideshow && (
                <Button variant="neutral-secondary" size="small" className={isMobile ? 'w-full justify-center' : ''} onClick={onShowBatchPipeline}>
                  Make up to 10 at once
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drafts / Scheduled / Posted tabs */}
      {isDraftsView && (
        <div className="flex items-center border-b border-neutral-200">
          {[
            { key: 'drafts', label: 'Drafts', count: filteredItems.length },
            { key: 'scheduled', label: 'Scheduled', count: filteredScheduledItems.length },
            { key: 'posted', label: 'Posted', count: filteredPostedItems.length },
          ].map(tab => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={draftTab === tab.key}
              onClick={() => { setDraftTab(tab.key); clearSelection(); }}
              className={`border-none cursor-pointer transition-all duration-150 px-5 py-2.5 text-[13px] font-semibold ${draftTab === tab.key ? 'bg-indigo-500/15 text-indigo-400 border-b-2 border-b-brand-600' : 'bg-transparent text-neutral-500 border-b-2 border-b-transparent'}`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      )}

      {/* Filters — show on all tabs */}
      {isDraftsView && (
        <div className={`flex items-center justify-between px-6 py-3 border-b border-neutral-200 ${isMobile ? '!flex-col !items-stretch !gap-2 !px-4' : ''}`}>
          {draftTab === 'drafts' ? (
            <ToggleGroup value={dateRange} onValueChange={(val) => val && setDateRange(val)}>
              <ToggleGroup.Item value="all">All time</ToggleGroup.Item>
              <ToggleGroup.Item value="today">Today</ToggleGroup.Item>
              <ToggleGroup.Item value="week">This week</ToggleGroup.Item>
              <ToggleGroup.Item value="month">This month</ToggleGroup.Item>
            </ToggleGroup>
          ) : (
            <div />
          )}
        <div className="flex items-center gap-4">
          {draftTab === 'drafts' && filteredItems.length > 0 && (
            <label className="flex items-center gap-2 text-neutral-400 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={filteredItems.length > 0 && filteredItems.every(v => selectedVideoIds.has(v.id))}
                onChange={selectAll}
                className="w-5 h-5 accent-brand-600 cursor-pointer"
              />
              Select All ({filteredItems.length})
            </label>
          )}
          {isDraftsView && projects.length > 0 && (
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="px-3 py-2 bg-black border border-neutral-200 rounded-md text-white text-[13px] cursor-pointer" style={{ colorScheme: 'dark' }}>
              <option value="all">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {isDraftsView && niches.length > 0 && (
            <select value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} className="px-3 py-2 bg-black border border-neutral-200 rounded-md text-white text-[13px] cursor-pointer" style={{ colorScheme: 'dark' }}>
              <option value="all">All niches</option>
              {niches.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          )}
          {onGetDeletedContent && (
            <Button
              variant="neutral-tertiary"
              size="small"
              icon={<FeatherTrash2 />}
              loading={loadingTrash}
              className={showTrash ? '' : 'opacity-70'}
              onClick={async () => {
                if (showTrash) {
                  setShowTrash(false);
                  return;
                }
                setLoadingTrash(true);
                try {
                  const deleted = await onGetDeletedContent();
                  const items = isSlideshow ? deleted.slideshows : deleted.videos;
                  setTrashItems(items);
                  setShowTrash(true);
                } catch (err) {
                  toastError('Failed to load trash');
                } finally {
                  setLoadingTrash(false);
                }
              }}
            >
              {showTrash ? 'Hide Trash' : 'Trash'}
            </Button>
          )}
          </div>
        </div>
      )}

      {/* ═══ Drafts Tab Content ═══ */}
      {draftTab === 'drafts' && <>
      {/* Trash Panel */}
      {showTrash && (
        <div className="px-6 py-4 border-b border-neutral-200 bg-neutral-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="m-0 text-sm font-semibold text-white">
              Trash ({trashItems.length} {isSlideshow ? 'slideshow' : 'video'}{trashItems.length !== 1 ? 's' : ''})
            </h3>
            <IconButton size="small" icon={<FeatherX />} aria-label="Close trash" onClick={() => setShowTrash(false)} />
          </div>
          {trashItems.length === 0 ? (
            <p className="text-neutral-500 text-xs m-0">Trash is empty</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {trashItems.map(item => {
                const thumb = isSlideshow
                  ? (item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageA?.url || item.thumbnail)
                  : (item.thumbnail || item.thumbnailUrl);
                const name = item.name || item.textOverlay || item.collectionName || 'Untitled';
                const deletedDate = item.deletedAt?.toDate ? item.deletedAt.toDate() : (item.deletedAt ? new Date(item.deletedAt) : null);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-red-500/[0.08] border border-red-500/20 rounded-lg text-[11px] text-neutral-400 max-w-[280px]"
                  >
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        className="w-8 h-10 rounded object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-white">
                        {name}
                      </div>
                      {deletedDate && (
                        <div className="text-[10px] text-neutral-500">
                          Deleted {deletedDate.toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        setRestoringId(item.id);
                        try {
                          const success = await onRestoreContent(item.id);
                          if (success) {
                            setTrashItems(prev => prev.filter(t => t.id !== item.id));
                            toastSuccess('Restored');
                          } else {
                            toastError('Restore failed');
                          }
                        } catch (err) {
                          toastError('Restore failed');
                        } finally {
                          setRestoringId(null);
                        }
                      }}
                      disabled={restoringId === item.id}
                      className={`bg-transparent border border-indigo-500 text-indigo-400 cursor-pointer text-[10px] font-semibold px-2 py-0.5 rounded flex-shrink-0 ${restoringId === item.id ? 'opacity-50' : ''}`}
                    >
                      {restoringId === item.id ? '...' : 'Restore'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm('Permanently delete? This cannot be undone.')) return;
                        try {
                          await onPermanentDelete(item.id);
                          setTrashItems(prev => prev.filter(t => t.id !== item.id));
                          toastSuccess('Permanently deleted');
                        } catch (err) {
                          toastError('Delete failed');
                        }
                      }}
                      className="bg-transparent border-none text-red-500 cursor-pointer text-sm px-1 py-0.5 flex-shrink-0"
                      title="Permanently delete"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Content Grid */}
      <div className={`flex-1 overflow-auto ${isMobile ? 'p-3' : 'p-6'}`}>
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <FeatherFilm className="w-12 h-12 text-zinc-600" />
            <h3 className="text-lg font-semibold text-white">No content yet</h3>
            <p className="text-sm text-zinc-400 max-w-xs">
              Create your first video or slideshow to get started
            </p>
          </div>
        ) : (
          <div
            ref={gridRef}
            {...(!isMobile ? gridMouseHandlers : {})}
            className={`grid gap-4 ${isMobile ? 'grid-cols-2 !gap-2.5' : 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'}`}
            style={{ position: 'relative', userSelect: isDragSelecting ? 'none' : undefined }}
          >
            {rubberBand && (
              <div style={{
                position: 'absolute', left: rubberBand.left, top: rubberBand.top,
                width: rubberBand.width, height: rubberBand.height,
                border: '1px solid #6366f1', backgroundColor: 'rgba(99,102,241,0.15)',
                pointerEvents: 'none', zIndex: 10
              }} />
            )}
            {filteredItems.map((item, index) => (
              isSlideshow ? (
                <div key={item.id} data-media-id={item.id} onClick={(e) => toggleSelect(item.id, e)} style={{ cursor: 'pointer', contentVisibility: 'auto', containIntrinsicSize: '0 200px' }}>
                  <SlideshowCard
                    slideshow={item}
                    isSelected={selectedVideoIds.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onPreview={() => setPreviewingSlideshow(item)}
                    onEdit={() => onEditSlideshow?.(item)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, videoId: item.id })}
                    onExportToDrive={driveConfigured ? () => handleExportToDrive(item) : null}
                    isDriveExporting={driveExporting === item.id}
                    onExportToDropbox={dropboxConfigured ? () => handleExportToDropbox(item) : null}
                    isDropboxExporting={dropboxExporting === item.id}
                    isMobile={isMobile}
                    draftNumber={index + 1}
                    thumbMap={thumbMap}
                    onPost={async () => {
                      if (onViewScheduling && db && artistId) {
                        // Create a scheduled post and navigate to scheduling page
                        try {
                          // Auto-populate caption + always-on hashtags from niche bank
                          const banks = item.collectionId ? resolveCollectionBanks(artistId, item.collectionId) : null;
                          const post = await createScheduledPost(db, artistId, {
                            contentId: item.id,
                            contentType: 'slideshow',
                            contentName: item.name || item.title || 'Untitled Slideshow',
                            thumbnail: item.thumbnail || item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl || null,
                            cloudUrl: null,
                            audioUrl: item.audio?.url || item.audio?.localUrl || null,
                            collectionId: item.collectionId || null,
                            collectionName: item.collectionName || item.collectionId || null,
                            caption: banks?.caption || '',
                            hashtags: banks?.alwaysHashtags || [],
                            platformHashtags: banks?.platformOnly || {},
                            editorState: item,
                            status: POST_STATUS.DRAFT
                          });
                          // Link draft → scheduled post
                          if (post?.id) {
                            await markContentScheduledAsync(db, artistId, item.id, post.id);
                          }
                          toastSuccess('Added to schedule queue');
                        } catch (err) {
                          log.error('[ContentLibrary] Failed to create scheduled post:', err);
                        }
                        onViewScheduling();
                      } else if (onViewScheduling) {
                        onViewScheduling();
                      } else {
                        setPostingSlideshow(item);
                        setShowScheduleQueue(true);
                      }
                    }}
                  />
                </div>
              ) : (
                <div key={item.id} data-media-id={item.id} onClick={(e) => toggleSelect(item.id, e)} style={{ cursor: 'pointer', contentVisibility: 'auto', containIntrinsicSize: '0 200px' }}>
                  <VideoCard
                    video={item}
                    isSelected={selectedVideoIds.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onEdit={() => onEditVideo(item)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, videoId: item.id })}
                    isMobile={isMobile}
                    onApprove={() => onApproveVideo(item.id)}
                    onExportToDrive={driveConfigured ? () => handleExportToDrive(item) : null}
                    isDriveExporting={driveExporting === item.id}
                    onExportToDropbox={dropboxConfigured ? () => handleExportToDropbox(item) : null}
                    isDropboxExporting={dropboxExporting === item.id}
                    thumbMap={thumbMap}
                    onPost={async () => {
                      if (onViewScheduling && db && artistId) {
                        // Create a scheduled post and navigate to scheduling page
                        try {
                          // Auto-populate caption + always-on hashtags from niche bank
                          const banks = item.collectionId ? resolveCollectionBanks(artistId, item.collectionId) : null;
                          const post = await createScheduledPost(db, artistId, {
                            contentId: item.id,
                            contentType: 'video',
                            contentName: item.name || item.title || 'Untitled Video',
                            thumbnail: item.thumbnail || null,
                            cloudUrl: item.cloudUrl || null,
                            collectionId: item.collectionId || null,
                            collectionName: item.collectionName || item.collectionId || null,
                            caption: banks?.caption || '',
                            hashtags: banks?.alwaysHashtags || [],
                            platformHashtags: banks?.platformOnly || {},
                            editorState: item,
                            status: POST_STATUS.DRAFT
                          });
                          // Link draft → scheduled post
                          if (post?.id) {
                            await markContentScheduledAsync(db, artistId, item.id, post.id);
                          }
                          toastSuccess('Added to schedule queue');
                        } catch (err) {
                          log.error('[ContentLibrary] Failed to create scheduled post:', err);
                        }
                        onViewScheduling();
                      } else {
                        setExportingVideo(item);
                      }
                    }}
                    onRender={() => handleRenderVideo(item)}
                    onPreview={() => setPreviewingVideo(item)}
                    isRendering={renderingVideoId === item.id}
                    renderProgress={renderingVideoId === item.id ? renderProgress : 0}
                  />
                </div>
              )
            ))}
          </div>
        )}
      </div>

      </>}

      {/* ═══ Scheduled Tab Content ═══ */}
      {draftTab === 'scheduled' && (
        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '12px' : '16px 24px' }}>
          {filteredScheduledItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <p className="mt-3 text-body font-body">No scheduled content</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: isMobile ? '10px' : '16px'
            }}>
              {filteredScheduledItems.map((item) => {
                const postInfo = scheduledPosts.find(p => p.contentId === item.id && (p.status === 'scheduled' || p.status === 'draft'));
                return (
                  <div key={item.id} style={{ position: 'relative' }}>
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold text-white" style={{ backgroundColor: `${theme.accent.primary}cc` }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {postInfo?.scheduledTime ? new Date(postInfo.scheduledTime).toLocaleDateString() : 'Scheduled'}
                    </div>
                    {isSlideshow ? (
                      <SlideshowCard
                        slideshow={item}
                        isSelected={false}
                        onToggleSelect={() => {}}
                        onPreview={() => setPreviewingSlideshow(item)}
                        onEdit={() => onEditSlideshow?.(item)}
                        isMobile={isMobile}
                        thumbMap={thumbMap}
                      />
                    ) : (
                      <VideoCard
                        video={item}
                        isSelected={false}
                        onToggleSelect={() => {}}
                        onEdit={() => onEditVideo?.(item)}
                        onPreview={() => setPreviewingVideo(item)}
                        isMobile={isMobile}
                        thumbMap={thumbMap}
                      />
                    )}
                    <Button
                      variant="neutral-secondary"
                      size="small"
                      className="w-full mt-1"
                      onClick={async () => {
                        const postToRemove = postInfo || scheduledPosts.find(p => p.contentId === item.id);
                        if (postToRemove) {
                          await deleteScheduledPost(db, artistId, postToRemove.id);
                          setScheduledPosts(prev => prev.filter(p => p.id !== postToRemove.id));
                        }
                        if (item.scheduledPostId && db && artistId) {
                          await unmarkContentScheduledAsync(db, artistId, item.id);
                          item.scheduledPostId = null;
                        }
                        toastSuccess('Unscheduled');
                      }}
                    >
                      Unschedule
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Posted Tab Content ═══ */}
      {draftTab === 'posted' && (
        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '12px' : '16px 24px' }}>
          {filteredPostedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                <path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/>
              </svg>
              <p className="mt-3 text-body font-body">No posted content yet</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: isMobile ? '10px' : '16px'
            }}>
              {filteredPostedItems.map((item) => {
                const postInfo = scheduledPosts.find(p => p.contentId === item.id && p.status === 'posted');
                return (
                  <div key={item.id} style={{ position: 'relative' }}>
                    {isSlideshow ? (
                      <SlideshowCard
                        slideshow={item}
                        isSelected={false}
                        onToggleSelect={() => {}}
                        onPreview={() => setPreviewingSlideshow(item)}
                        onEdit={() => {
                          const duplicate = {
                            ...item,
                            id: `slideshow_${Date.now()}`,
                            name: `${item.name || 'Untitled'} (copy)`,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                          };
                          onEditSlideshow?.(duplicate);
                        }}
                        onDelete={() => setDeleteConfirm({ isOpen: true, videoId: item.id })}
                        isMobile={isMobile}
                        draftNumber={null}
                        thumbMap={thumbMap}
                      />
                    ) : (
                      <VideoCard
                        video={item}
                        isSelected={false}
                        onToggleSelect={() => {}}
                        onEdit={() => {
                          const duplicate = {
                            ...item,
                            id: `video_${Date.now()}`,
                            name: `${item.name || 'Untitled'} (copy)`,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                          };
                          onEditVideo?.(duplicate);
                        }}
                        onDelete={() => setDeleteConfirm({ isOpen: true, videoId: item.id })}
                        isMobile={isMobile}
                        onPreview={() => setPreviewingVideo(item)}
                        thumbMap={thumbMap}
                      />
                    )}
                    <div className="absolute top-1.5 left-1.5 bg-green-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">
                      Posted{postInfo?.postedAt ? ` ${new Date(postInfo.postedAt).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Batch Action Bar */}
      {selectedItems.length > 0 && (
        <div className={`flex items-center justify-between px-6 py-4 bg-brand-600 mx-6 mb-4 rounded-xl shadow-[0_4px_20px_rgba(99,102,241,0.5)] ${isMobile ? '!flex-col !gap-3 !mx-3 !mb-3 !px-4 !py-3 !pb-[calc(12px+env(safe-area-inset-bottom,0px))]' : ''}`}>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={filteredItems.length > 0 && filteredItems.every(v => selectedVideoIds.has(v.id))} onChange={selectAll} className="w-5 h-5 accent-brand-600 cursor-pointer" />
            <span className="text-white text-sm font-medium">{selectedItems.length} selected</span>
          </div>
          <div className={`flex items-center gap-2 ${isMobile ? '!flex-wrap !justify-center !w-full' : ''}`}>
            <Button variant="neutral-tertiary" size="small" onClick={clearSelection}>Clear</Button>
            <Button variant="destructive-secondary" size="small" icon={<FeatherTrash2 />} onClick={() => setDeleteConfirm({ isOpen: true, videoId: null, isBulk: true })}>
              Delete {selectedItems.length}
            </Button>
            {!isSlideshow && selectedItems.length === 1 && (
              <Button variant="neutral-secondary" size="small" icon={<FeatherDownload />} onClick={() => setExportingVideo(selectedItems[0])}>
                Export
              </Button>
            )}
            {isSlideshow && selectedItems.length >= 2 && onEditMultipleSlideshows && (
              <Button variant="neutral-secondary" size="small" icon={<FeatherEdit2 />} onClick={() => onEditMultipleSlideshows(selectedItems)}>
                Edit {selectedItems.length} in Editor
              </Button>
            )}
            {isSlideshow && selectedItems.length >= 1 && db && artistId && (
              <Button variant="brand-secondary" size="small" icon={<FeatherMusic />} onClick={() => setShowAudioAssign(true)}>
                Assign Audio ({selectedItems.length})
              </Button>
            )}
            <Button variant="brand-primary" size="small" icon={<FeatherCalendar />} onClick={async () => {
              if (onViewScheduling && db && artistId) {
                try {
                  const postsToCreate = selectedItems.map(item => {
                    const banks = item.collectionId ? resolveCollectionBanks(artistId, item.collectionId) : null;
                    return {
                      contentId: item.id,
                      contentType: isSlideshow ? 'slideshow' : 'video',
                      contentName: item.name || item.title || (isSlideshow ? 'Untitled Slideshow' : 'Untitled Video'),
                      thumbnail: item.thumbnail || (isSlideshow ? (item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl) : null) || null,
                      cloudUrl: item.cloudUrl || null,
                      collectionId: item.collectionId || null,
                      caption: banks?.caption || '',
                      hashtags: banks?.alwaysHashtags || [],
                      platformHashtags: banks?.platformOnly || {},
                      editorState: item,
                      status: POST_STATUS.DRAFT,
                    };
                  });
                  const { addManyScheduledPosts } = await import('../../services/scheduledPostsService');
                  await addManyScheduledPosts(db, artistId, postsToCreate);
                  toastSuccess(`Added ${postsToCreate.length} item(s) to schedule queue`);
                  clearSelection();
                } catch (err) {
                  log.error('[ContentLibrary] Batch schedule failed:', err);
                  toastError('Failed to add items to queue');
                }
                onViewScheduling();
              } else if (onViewScheduling) {
                onViewScheduling();
              } else {
                setShowScheduleQueue(true);
              }
            }}>
              Schedule {selectedItems.length} {isSlideshow ? 'Carousel' : 'Post'}{selectedItems.length > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}

      {/* Footer — removed dead "Edit category" and "Upload your own videos" buttons (C-10)
         Category editing is available in the sidebar; uploads via the header upload buttons. */}

      {/* Bulk Audio Assign Panel */}
      {showAudioAssign && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowAudioAssign(false)}>
          <div style={{
            background: theme.bg.surface,
            borderRadius: '12px',
            border: `1px solid ${theme.border.default}`,
            width: '480px',
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: `1px solid ${theme.border.subtle}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: theme.text.primary }}>
                  Assign Audio to {selectedVideoIds.size} Draft{selectedVideoIds.size !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: '12px', color: theme.text.muted, marginTop: '2px' }}>
                  Select a song from your library
                </div>
              </div>
              <IconButton size="small" icon={<FeatherX />} aria-label="Close audio selection" onClick={() => setShowAudioAssign(false)} />
            </div>

            {/* Audio List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {audioLibrary.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: theme.text.muted, fontSize: '13px' }}>
                  Loading audio library...
                </div>
              ) : (
                <>
                  {/* "Remove Audio" option */}
                  <button
                    onClick={async () => {
                      if (!db || !artistId || selectedVideoIds.size === 0) return;
                      setAssigningAudio(true);
                      try {
                        const selected = items.filter(item => selectedVideoIds.has(item.id));
                        const cleared = selected.map(item => ({ ...item, audio: null }));
                        await saveCreatedContentAsync(db, artistId, { videos: [], slideshows: cleared });
                        if (category?.slideshows) {
                          category.slideshows.forEach(ss => {
                            if (selectedVideoIds.has(ss.id)) { ss.audio = null; }
                          });
                        }
                        toastSuccess(`Removed audio from ${selectedVideoIds.size} drafts`);
                        setShowAudioAssign(false);
                      } catch (err) {
                        toastError(`Failed: ${err.message}`);
                      } finally { setAssigningAudio(false); }
                    }}
                    disabled={assigningAudio}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      padding: '10px 20px',
                      background: 'none',
                      border: 'none',
                      cursor: assigningAudio ? 'wait' : 'pointer',
                      color: '#f87171',
                      fontSize: '13px',
                      textAlign: 'left',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Remove Audio
                  </button>

                  <div style={{ height: '1px', background: theme.border.subtle, margin: '4px 20px' }} />

                  {audioLibrary.map(audio => (
                    <button
                      key={audio.id}
                      onClick={() => handleBulkAudioAssign(audio)}
                      disabled={assigningAudio}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        width: '100%',
                        padding: '10px 20px',
                        background: 'none',
                        border: 'none',
                        cursor: assigningAudio ? 'wait' : 'pointer',
                        color: theme.text.primary,
                        fontSize: '13px',
                        textAlign: 'left',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = theme.bg.elevated}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        background: `${theme.accent.primary}22`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.accent.hover} strokeWidth="2">
                          <path d="M9 18V5l12-2v13"/>
                          <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                        </svg>
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
                          {(audio.name || 'Untitled').replace(' Audio Extracted', '').replace('.mp3', '')}
                        </div>
                        {audio.duration && (
                          <div style={{ fontSize: '11px', color: theme.text.muted, marginTop: '1px' }}>
                            {Math.floor(audio.duration / 60)}:{String(Math.floor(audio.duration % 60)).padStart(2, '0')}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export/Post Modal */}
      {exportingVideo && (
        <ExportAndPostModal
          video={exportingVideo}
          videos={selectedVideos.length > 0 ? selectedVideos : [exportingVideo]}
          category={category}
          onClose={() => { setExportingVideo(null); clearSelection(); }}
          onSchedulePost={onSchedulePost}
        />
      )}

      {/* UI-30: Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={deleteConfirm.isBulk
          ? `Delete ${selectedItems.length} ${isSlideshow ? 'slideshows' : 'videos'}?`
          : (() => {
              const item = items.find(i => i.id === deleteConfirm.videoId);
              const name = item?.name || item?.textOverlay || item?.collectionName || 'Untitled';
              return `Delete "${name}"?`;
            })()
        }
        message={deleteConfirm.isBulk
          ? `This will move ${selectedItems.length} ${isSlideshow ? 'slideshow' : 'video'}${selectedItems.length > 1 ? 's' : ''} to the trash. You can restore ${selectedItems.length > 1 ? 'them' : 'it'} later from the Trash button.`
          : `This will move this ${isSlideshow ? 'slideshow' : 'video'} to the trash. You can restore it later from the Trash button.`
        }
        confirmLabel={deleteConfirm.isBulk ? `Delete ${selectedItems.length}` : "Delete"}
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleteConfirm.isBulk) {
            // Bulk delete all selected items
            selectedItems.forEach(item => {
              if (isSlideshow) {
                onDeleteSlideshow?.(item.id);
              } else {
                onDeleteVideo?.(item.id);
              }
            });
            clearSelection();
          } else {
            if (isSlideshow) {
              onDeleteSlideshow?.(deleteConfirm.videoId);
            } else {
              onDeleteVideo?.(deleteConfirm.videoId);
            }
          }
          setDeleteConfirm({ isOpen: false, videoId: null, isBulk: false });
        }}
        onCancel={() => setDeleteConfirm({ isOpen: false, videoId: null, isBulk: false })}
      />

      {/* Schedule Queue — unified scheduling for videos and slideshows */}
      {showScheduleQueue && (
        <ScheduleQueue
          contentItems={postingSlideshow ? [postingSlideshow] : selectedItems}
          contentType={isSlideshow ? 'slideshows' : 'videos'}
          artistId={artistId}
          category={category}
          onSchedulePost={onSchedulePost}
          onRenderVideo={handleRenderVideo}
          onClose={() => {
            setShowScheduleQueue(false);
            setPostingSlideshow(null);
            clearSelection();
          }}
          accounts={accounts}
          lateAccountIds={lateAccountIds}
          db={db}
        />
      )}

      {/* Slideshow Preview Modal — scrollable slide gallery */}
      {previewingSlideshow && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: theme.overlay.heavy, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column'
        }} onClick={() => setPreviewingSlideshow(null)}>
          <div style={{
            position: 'relative',
            ...(isMobile
              ? { width: '100%', height: '100%', maxWidth: '100vw', maxHeight: '100vh', minWidth: 'unset', borderRadius: 0 }
              : { maxWidth: '90vw', maxHeight: '85vh', width: 'fit-content', minWidth: '320px', borderRadius: 16 }
            ),
            backgroundColor: theme.bg.input, overflow: 'hidden',
            boxShadow: theme.shadow, display: 'flex', flexDirection: 'column'
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border.subtle}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600 }}>
                  {previewingSlideshow.name || 'Untitled Slideshow'}
                </div>
                <div style={{ color: theme.text.muted, fontSize: 12, marginTop: 2 }}>
                  {previewingSlideshow.slides?.length || 0} slides · {previewingSlideshow.status || 'draft'}
                </div>
                {previewingSlideshow.audio?.name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <FeatherMusic style={{ width: 12, height: 12, color: '#6366f1' }} />
                    <span style={{ color: '#6366f1', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={previewingSlideshow.audio.name}>
                      {previewingSlideshow.audio.name.replace(' Audio Extracted', '').replace('.mp3', '')}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <Button variant="brand-secondary" size="small" icon={<FeatherEdit2 />} onClick={() => { setPreviewingSlideshow(null); onEditSlideshow?.(previewingSlideshow); }}>Edit</Button>
                <IconButton size={isMobile ? "medium" : "small"} icon={<FeatherX />} aria-label="Close preview" onClick={() => setPreviewingSlideshow(null)} />
              </div>
            </div>
            {/* Slides */}
            <div style={{
              padding: '16px', overflowY: 'auto', display: 'flex',
              flexWrap: 'wrap', gap: '12px', justifyContent: 'center',
              maxHeight: 'calc(85vh - 80px)'
            }}>
              {(previewingSlideshow.slides || []).map((slide, i) => (
                <div key={slide.id || i} style={{
                  width: isMobile ? '120px' : '180px', flexShrink: 0,
                  aspectRatio: '9/16', borderRadius: 10, overflow: 'hidden',
                  backgroundColor: theme.bg.page, position: 'relative',
                  border: `1px solid ${theme.border.subtle}`
                }}>
                  {(slide.backgroundImage || slide.thumbnail) ? (
                    <img src={slide.backgroundImage || slide.thumbnail} alt={`Slide ${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.text.muted }}>
                      Empty
                    </div>
                  )}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '4px 8px', background: theme.overlay.light,
                    color: theme.text.primary, fontSize: 11, textAlign: 'center'
                  }}>Slide {i + 1}</div>
                  {/* Show text overlays */}
                  {(slide.textOverlays || []).map((overlay, oi) => (
                    <div key={oi} style={{
                      position: 'absolute', left: `${overlay.position?.x || 50}%`,
                      top: `${overlay.position?.y || 50}%`, transform: 'translate(-50%,-50%)',
                      color: overlay.style?.color || '#fff',
                      fontSize: `${Math.max(8, (overlay.style?.fontSize || 24) * 0.2)}px`,
                      fontWeight: overlay.style?.fontWeight || '700',
                      textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      pointerEvents: 'none', maxWidth: '90%', wordBreak: 'break-word'
                    }}>{overlay.text}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Video Preview Modal - Always 9:16 portrait */}
      {previewingVideo && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: theme.overlay.heavy, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setPreviewingVideo(null)}>
          <div style={{
            position: 'relative',
            ...(isMobile
              ? { width: '100%', height: '100%', maxHeight: '100vh', borderRadius: 0 }
              : { width: 'min(320px, 80vh * 9 / 16)', maxHeight: '85vh', aspectRatio: '9 / 16', borderRadius: 16 }
            ),
            backgroundColor: theme.bg.page, overflow: 'hidden',
            boxShadow: theme.shadow
          }} onClick={e => e.stopPropagation()}>
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
              <IconButton size={isMobile ? "medium" : "small"} icon={<FeatherX />} aria-label="Close preview" onClick={() => setPreviewingVideo(null)} />
            </div>
            {previewingVideo.cloudUrl ? (
              <video
                src={previewingVideo.cloudUrl}
                controls
                playsInline
                preload="metadata"
                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
              />
            ) : previewingVideo.clips?.length > 0 ? (
              <>
                <video
                  src={previewingVideo.clips[0].url || previewingVideo.clips[0].localUrl}
                  controls
                  playsInline
                  preload="metadata"
                  muted={!!(previewingVideo.audio?.url && !previewingVideo.audio.url.startsWith('blob:') && !previewingVideo.audio.isSourceAudio)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
                />
                {previewingVideo.audio?.url && !previewingVideo.audio.url.startsWith('blob:') && !previewingVideo.audio.isSourceAudio && (
                  <audio
                    src={previewingVideo.audio.url}
                    autoPlay
                    controls
                    style={{ position: 'absolute', bottom: 70, left: 16, right: 16, height: 32, opacity: 0.9 }}
                  />
                )}
              </>
            ) : (
              <div style={{ padding: 40, color: theme.text.muted, textAlign: 'center' }}>
                No preview available - video needs to be rendered first
              </div>
            )}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '24px 16px 16px',
              background: `linear-gradient(transparent, ${theme.overlay.heavy})`
            }}>
              <div style={{ color: theme.text.primary, fontSize: 14, fontWeight: 600 }}>
                {previewingVideo.name || previewingVideo.textOverlay || 'Untitled Video'}
              </div>
              <div style={{ color: theme.text.secondary, fontSize: 12, marginTop: 4 }}>
                {previewingVideo.status} · {previewingVideo.clips?.length || 0} clips
                {previewingVideo.cloudUrl && ' · Rendered'}
              </div>
              {previewingVideo.audio?.name && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <FeatherMusic style={{ width: 12, height: 12, color: '#6366f1' }} />
                  <span style={{ color: '#6366f1', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={previewingVideo.audio.name}>
                    {previewingVideo.audio.name.replace(' Audio Extracted', '').replace('.mp3', '')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const VideoCard = ({ video, isSelected, onToggleSelect, onEdit, onDelete, onApprove, onPost, onRender, isRendering, renderProgress, onPreview, onExportToDrive, isDriveExporting, onExportToDropbox, isDropboxExporting, isMobile = false, thumbMap }) => {
  const { theme } = useTheme();
  const [showActions, setShowActions] = useState(false);
  const actionsVisible = isMobile || showActions;

  // UI-34: Prevent action buttons from triggering selection
  const handleActionClick = (e, action) => {
    e.stopPropagation();
    action();
  };

  const needsRendering = video.isRendered === false;

  return (
    <div
      className={`relative bg-[#171717] rounded-xl overflow-hidden ${isSelected ? 'border-2 border-brand-600 shadow-[0_0_0_2px_rgba(99,102,241,0.3)]' : 'border-2 border-transparent'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="absolute top-2 left-2 z-10 min-w-[44px] min-h-[44px] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="w-5 h-5 accent-brand-600 cursor-pointer" />
      </div>

      <div className="relative aspect-[9/16] bg-black select-none" onClick={() => !isRendering && onPreview?.(video)}>
        {(video.thumbnail || video.thumbnailUrl) ? (
          <ThumbImg src={thumbMap?.get(video.id) || video.thumbnail || video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : video.clips?.[0]?.thumbnail || video.clips?.[0]?.thumbnailUrl ? (
          <ThumbImg src={video.clips[0].thumbnail || video.clips[0].thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : video.clips?.[0]?.url ? (
          <video src={video.clips[0].url} className="w-full h-full object-cover" muted preload="metadata" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
            </svg>
          </div>
        )}

        {video.textOverlay && <div className="absolute bottom-[40%] left-1/2 -translate-x-1/2 px-4 py-2 bg-black/30 rounded text-white text-xs font-medium">{video.textOverlay}</div>}

        {/* "Needs Rendering" badge */}
        {needsRendering && !isRendering && (
          <div className="absolute top-2 right-2 bg-amber-400/90 text-amber-900 px-1.5 py-0.5 rounded text-[10px] font-semibold">
            ⚡ Recipe
          </div>
        )}

        {/* Rendering progress */}
        {isRendering && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white">
            <div className="text-xs mb-2">Rendering...</div>
            <div className="w-4/5 h-1 bg-neutral-200 rounded-sm">
              <div className="h-full bg-violet-500 rounded-sm transition-all duration-300" style={{ width: `${renderProgress}%` }} />
            </div>
            <div className="text-[11px] mt-1">{renderProgress}%</div>
          </div>
        )}

        {actionsVisible && !isRendering && (
          <div className={`absolute top-2 right-2 flex gap-1.5 ${isMobile ? '!bottom-2 !left-2 !right-2 !top-auto !justify-center !flex-wrap bg-black/30 rounded-md p-1' : ''}`}>
            <Button variant="neutral-secondary" size="small" icon={<FeatherEdit2 />} onClick={(e) => handleActionClick(e, onEdit)}>Edit</Button>
            {needsRendering ? (
              <Button variant="brand-primary" size="small" onClick={(e) => handleActionClick(e, onRender)}>🎬 Export</Button>
            ) : (
              <>
                {video.cloudUrl && (
                  <Button
                    variant="neutral-secondary"
                    size="small"
                    icon={<FeatherDownload />}
                    onClick={(e) => {
                      e.stopPropagation();
                      const a = document.createElement('a');
                      a.href = video.cloudUrl;
                      a.download = `${video.name || video.textOverlay || 'video'}_${video.id}.mp4`;
                      a.target = '_blank';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                  >
                    Download
                  </Button>
                )}
                {onExportToDrive && video.cloudUrl && (
                  <Button
                    variant="neutral-secondary"
                    size="small"
                    icon={<FeatherUploadCloud />}
                    disabled={isDriveExporting}
                    loading={isDriveExporting}
                    onClick={(e) => { e.stopPropagation(); onExportToDrive(); }}
                  >
                    {isDriveExporting ? 'Saving...' : 'Drive'}
                  </Button>
                )}
                {onExportToDropbox && video.cloudUrl && (
                  <Button
                    variant="neutral-secondary"
                    size="small"
                    icon={<FeatherUploadCloud />}
                    disabled={isDropboxExporting}
                    loading={isDropboxExporting}
                    onClick={(e) => { e.stopPropagation(); onExportToDropbox(); }}
                  >
                    {isDropboxExporting ? 'Saving...' : 'Dropbox'}
                  </Button>
                )}
                <Button variant="brand-primary" size="small" icon={<FeatherSend />} onClick={(e) => handleActionClick(e, onPost)}>Post</Button>
              </>
            )}
            <IconButton size="small" icon={<FeatherTrash2 />} aria-label="Delete" onClick={(e) => handleActionClick(e, onDelete)} />
          </div>
        )}
      </div>

      {/* UI-31: Use StatusPill instead of custom badge */}
      <div className="px-3 py-2.5 bg-[#171717] flex items-center justify-center">
        <StatusPill status={video.status || VIDEO_STATUS.DRAFT} />
      </div>
    </div>
  );
};

// Tiny thumbnail component — loads full image once, downscales to small canvas, caches data URL
const thumbCache = new Map();
const ThumbImg = ({ src, alt = '', className = '' }) => {
  const [dataUrl, setDataUrl] = useState(() => thumbCache.get(src) || null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!src || dataUrl || attempted.current) return;
    attempted.current = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const MAX = 96;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.6);
        thumbCache.set(src, url);
        setDataUrl(url);
      } catch {
        // CORS or canvas tainted — fall back to original
        setDataUrl(src);
      }
    };
    img.onerror = () => setDataUrl(src);
    img.src = src;
  }, [src, dataUrl]);

  if (!src) return null;
  return <img src={dataUrl || src} alt={alt} loading="lazy" decoding="async" className={className} />;
};

const SlideshowCard = ({ slideshow, isSelected, onToggleSelect, onPreview, onEdit, onDelete, onPost, onExportToDrive, isDriveExporting, onExportToDropbox, isDropboxExporting, isMobile = false, draftNumber, thumbMap }) => {
  const [showActions, setShowActions] = useState(false);
  const actionsVisible = isMobile || showActions;

  const handleActionClick = (e, action) => {
    e.stopPropagation();
    action();
  };

  const slides = slideshow.slides || [];
  const slideCount = slides.length;
  const isExported = slideshow.exportedImages?.length > 0 || slideshow.status === 'rendered';

  const getSlideThumb = (slide) => {
    if (!slide) return null;
    // Try sourceImageId first (most reliable match)
    if (slide.sourceImageId && thumbMap?.has(slide.sourceImageId)) return thumbMap.get(slide.sourceImageId);
    // Try all URL fields
    const urls = [slide.backgroundImage, slide.imageA?.url, slide.imageA?.localUrl, slide.thumbnail];
    for (const url of urls) {
      if (url && thumbMap?.has(url)) return thumbMap.get(url);
    }
    return urls.find(u => u) || null;
  };

  return (
    <div
      className={`relative rounded-lg overflow-hidden border border-solid transition-colors ${
        isSelected ? 'border-brand-600 shadow-[0_0_0_2px_rgba(99,102,241,0.3)]' : 'border-neutral-200 hover:border-neutral-600'
      } bg-[#1a1a1a]`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Checkbox */}
      <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect}
          className="w-5 h-5 cursor-pointer accent-indigo-500" />
      </div>

      {/* Thumbnail area — horizontal filmstrip */}
      <div className="relative bg-[#171717] select-none cursor-pointer" onClick={() => onPreview?.()}>
        {slideCount > 0 ? (
          <div className="flex w-full gap-px bg-[#171717]" style={{ height: '120px' }}>
            {slides.slice(0, 5).map((slide, idx) => {
              const thumb = getSlideThumb(slide);
              const visibleOverlays = (slide?.textOverlays || []).filter(o => o.text);
              return (
                <div key={idx} className="flex-1 min-w-0 overflow-hidden relative bg-neutral-100">
                  {thumb ? (
                    <ThumbImg src={thumb} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-neutral-500 text-[10px]">{idx + 1}</span>
                    </div>
                  )}
                  {visibleOverlays.map((overlay, oi) => (
                    <div key={oi} className="absolute pointer-events-none" style={{
                      left: `${overlay.position?.x || 50}%`,
                      top: `${overlay.position?.y || 50}%`,
                      transform: 'translate(-50%, -50%)',
                      color: overlay.style?.color || '#fff',
                      fontSize: `${Math.max(6, (overlay.style?.fontSize || 36) * 0.16)}px`,
                      fontWeight: overlay.style?.fontWeight || '600',
                      fontFamily: overlay.style?.fontFamily || 'Inter, sans-serif',
                      textAlign: overlay.style?.textAlign || 'center',
                      textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                      maxWidth: '92%',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      wordBreak: 'break-word',
                      lineHeight: '1.15',
                    }}>
                      {overlay.text}
                    </div>
                  ))}
                </div>
              );
            })}
            {slideCount > 5 && (
              <div className="flex-1 min-w-0 flex items-center justify-center bg-neutral-100">
                <span className="text-neutral-400 text-[11px] font-semibold">+{slideCount - 5}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full flex items-center justify-center" style={{ height: '100px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="6" width="6" height="12" rx="1"/>
              <rect x="9" y="6" width="6" height="12" rx="1"/>
              <rect x="16" y="6" width="6" height="12" rx="1"/>
            </svg>
          </div>
        )}

        {/* Draft number badge */}
        {draftNumber != null && (
          <div className="absolute top-2 left-9 bg-black/75 text-white px-1.5 py-0.5 rounded text-[10px] font-bold backdrop-blur-sm min-w-[20px] text-center">
            #{draftNumber}
          </div>
        )}

        {/* Status badge */}
        {isExported ? (
          <Badge className="absolute top-2 right-2" variant="success">Ready</Badge>
        ) : (
          <Badge className="absolute top-2 right-2" variant="warning">Draft</Badge>
        )}

        {/* Hover actions — icon-only to fit card width */}
        {actionsVisible && (
          <div className={`absolute flex gap-1 ${
            isMobile
              ? 'bottom-2 left-2 right-2 top-auto justify-center flex-wrap bg-black/60 rounded-md p-1'
              : 'bottom-2 right-2'
          }`}>
            <IconButton variant="neutral-secondary" size="small" icon={<FeatherEdit2 />} aria-label="Edit" onClick={(e) => handleActionClick(e, onEdit)} />
            {onExportToDrive && (
              <IconButton variant="neutral-secondary" size="small" icon={<FeatherUploadCloud />} aria-label="Export to Drive"
                disabled={isDriveExporting} loading={isDriveExporting}
                onClick={(e) => { e.stopPropagation(); onExportToDrive(); }} />
            )}
            {onExportToDropbox && (
              <IconButton variant="neutral-secondary" size="small" icon={<FeatherUploadCloud />} aria-label="Export to Dropbox"
                disabled={isDropboxExporting} loading={isDropboxExporting}
                onClick={(e) => { e.stopPropagation(); onExportToDropbox(); }} />
            )}
            <IconButton variant="brand-primary" size="small" icon={<FeatherSend />} aria-label="Post" onClick={(e) => handleActionClick(e, onPost)} />
            <IconButton size="small" icon={<FeatherTrash2 />} aria-label="Delete" onClick={(e) => handleActionClick(e, onDelete)} />
          </div>
        )}
      </div>

      {/* Metadata footer */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-caption font-caption text-neutral-200 truncate">{slideshow.name || 'Untitled'}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="brand">{slideCount} slide{slideCount !== 1 ? 's' : ''}</Badge>
            {slideshow.audio?.name && (
              <span className="flex items-center gap-1 text-[10px] text-indigo-400 truncate max-w-[120px]" title={slideshow.audio.name}>
                <FeatherMusic style={{ width: 10, height: 10, flexShrink: 0 }} />
                {slideshow.audio.name.replace(' Audio Extracted', '').replace('.mp3', '')}
              </span>
            )}
            {slideshow.collectionName && (
              <Badge variant="neutral" className="text-[9px]">{slideshow.collectionName}</Badge>
            )}
          </div>
        </div>
        <StatusPill status={slideshow.status || VIDEO_STATUS.DRAFT} />
      </div>
    </div>
  );
};

/**
 * SlideshowPostingModal - Modal for scheduling carousel posts
 */
const SlideshowPostingModal = ({ slideshows, lateAccountIds, onSchedulePost, onClose }) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const [selectedHandle, setSelectedHandle] = useState('');
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#carousel #slideshow #fyp');
  const [isScheduling, setIsScheduling] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const availableHandles = Object.keys(lateAccountIds);

  const handleSchedule = async () => {
    if (!selectedHandle) {
      toastError('Please select an account');
      return;
    }

    const accountMapping = lateAccountIds[selectedHandle];
    if (!accountMapping) {
      toastError(`No account mapping found for ${selectedHandle}`);
      return;
    }

    setIsScheduling(true);
    log('[Schedule] Starting carousel scheduling...');
    log('[Schedule] Selected handle:', selectedHandle);
    log('[Schedule] Account mapping:', accountMapping);
    log('[Schedule] Platforms:', platforms);
    log('[Schedule] Slideshows to schedule:', slideshows.length);

    try {
      // Schedule each slideshow as a carousel post
      let scheduled = 0;

      // Helper: export slides at a given aspect ratio
      const exportAtRatio = async (slideshow, ratio, label) => {
        setExportProgress(`Exporting for ${label}...`);
        const exportData = { ...slideshow, aspectRatio: ratio };
        return await exportSlideshowAsImages(exportData, (pct) => {
          setExportProgress(`Exporting for ${label} (${pct}%)`);
        });
      };

      for (let si = 0; si < slideshows.length; si++) {
        const slideshow = slideshows[si];
        const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
        const fullCaption = `${caption}\n\n${hashtags}`.trim();
        log(`[Schedule] Processing slideshow ${si + 1}/${slideshows.length}:`, slideshow.id);

        if (!onSchedulePost) {
          log.error('[Schedule] onSchedulePost is not defined!');
          toastError('Scheduling not available. Please try again.');
          break;
        }

        // Schedule for each selected platform separately (different aspect ratios)
        // Instagram = 4:5 (1080x1350), TikTok = 9:16 (1080x1920)
        const platformJobs = [];
        if (platforms.instagram && accountMapping.instagram) {
          platformJobs.push({ platform: 'instagram', accountId: accountMapping.instagram, ratio: '4:5', label: 'Instagram' });
        }
        if (platforms.tiktok && accountMapping.tiktok) {
          platformJobs.push({ platform: 'tiktok', accountId: accountMapping.tiktok, ratio: '9:16', label: 'TikTok' });
        }

        if (!platformJobs.length) {
          log.warn('[Schedule] No account IDs for selected platforms on', selectedHandle);
          continue;
        }

        // Export all needed ratios in parallel
        setExportProgress('Exporting slides...');
        const slideshowRatio = slideshow.aspectRatio || '9:16';
        const neededRatios = [...new Set(platformJobs.map(j => j.ratio))];
        const imagesByRatio = {};

        const exportPromises = neededRatios.map(async (ratio) => {
          if (slideshowRatio === ratio && slideshow.exportedImages?.length) {
            log(`[Schedule] Using cached export for ${ratio}`);
            imagesByRatio[ratio] = slideshow.exportedImages;
          } else {
            const label = platformJobs.find(j => j.ratio === ratio)?.label || ratio;
            log(`[Schedule] Exporting at ${ratio} for ${label}`);
            imagesByRatio[ratio] = await exportAtRatio(slideshow, ratio, label);
          }
        });
        await Promise.all(exportPromises);

        // Send all Late API calls in parallel
        setExportProgress('Scheduling...');
        const schedulePromises = platformJobs.map(async (job) => {
          const images = imagesByRatio[job.ratio];
          if (!images?.length) {
            log.warn(`[Schedule] No images for ${job.label}, skipping`);
            return null;
          }
          log(`[Schedule] Sending to Late for ${job.label}:`, images.length, 'images');
          try {
            const result = await onSchedulePost({
              type: 'carousel',
              platforms: [{
                platform: job.platform,
                accountId: job.accountId,
                customContent: fullCaption,
                scheduledFor
              }],
              caption: fullCaption,
              images,
              scheduledFor,
              audioUrl: slideshow.audio?.url || slideshow.audio?.localUrl || null,
              collectionName: slideshow.collectionName || null
            });
            log(`[Schedule] ${job.label} result:`, result);
            if (result?.success === false) {
              toastError(`Failed to schedule for ${job.label}: ${result.error || 'Unknown error'}`);
              return null;
            }
            return result;
          } catch (err) {
            log.error(`[Schedule] ${job.label} error:`, err);
            toastError(`Error scheduling for ${job.label}: ${err.message}`);
            return null;
          }
        });

        const results = await Promise.all(schedulePromises);
        scheduled += results.filter(Boolean).length;
      }

      log('[Schedule] Done. Scheduled:', scheduled);
      setExportProgress('');
      if (scheduled > 0) {
        toastSuccess(`Scheduled ${scheduled} carousel post${scheduled > 1 ? 's' : ''}!`);
        onClose();
      } else {
        toastError('No carousels were scheduled. Check that your account has the correct platform IDs configured.');
      }
    } catch (err) {
      log.error('[SlideshowPostingModal] Schedule failed:', err);
      toastError(`Failed to schedule: ${err.message}`);
    } finally {
      setIsScheduling(false);
    }
  };

  // Total slides across all slideshows (will be exported to Firebase before posting)
  const totalSlides = slideshows.reduce((sum, s) => sum + (s.slides?.length || 0), 0);
  const allExported = slideshows.every(s => s.exportedImages?.length > 0);

  const slideshowPostingStyles = getSlideshowPostingStyles(theme);

  return (
    <div style={slideshowPostingStyles.overlay}>
      <div style={slideshowPostingStyles.modal}>
        <div style={slideshowPostingStyles.header}>
          <h3 style={slideshowPostingStyles.title}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Schedule Carousel{slideshows.length > 1 ? 's' : ''}
          </h3>
          <IconButton size="small" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
        </div>

        {/* Preview */}
        <div style={slideshowPostingStyles.preview}>
          <div style={slideshowPostingStyles.previewImages}>
            {slideshows.slice(0, 3).map((slideshow, i) => {
              const previewUrl = slideshow.exportedImages?.[0]?.url
                || slideshow.slides?.[0]?.imageA?.url
                || slideshow.slides?.[0]?.imageA?.localUrl
                || slideshow.slides?.[0]?.thumbnail
                || slideshow.slides?.[0]?.backgroundImage;
              return previewUrl ? (
                <img
                  key={i}
                  src={previewUrl}
                  alt={`Slideshow ${i + 1}`}
                  style={slideshowPostingStyles.previewImg}
                />
              ) : null;
            })}
            {slideshows.length > 3 && (
              <div style={slideshowPostingStyles.previewMore}>+{slideshows.length - 3}</div>
            )}
          </div>
          <span style={slideshowPostingStyles.previewText}>
            {slideshows.length} carousel{slideshows.length > 1 ? 's' : ''} • {totalSlides} slide{totalSlides !== 1 ? 's' : ''}
            {!allExported && ' (will auto-export)'}
          </span>
        </div>

        {/* Account Selection */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Account</label>
          <select
            value={selectedHandle}
            onChange={(e) => setSelectedHandle(e.target.value)}
            style={slideshowPostingStyles.select}
          >
            <option value="">Select account...</option>
            {availableHandles.map(handle => (
              <option key={handle} value={handle}>{handle}</option>
            ))}
          </select>
        </div>

        {/* Date & Time */}
        <div style={slideshowPostingStyles.row}>
          <div style={slideshowPostingStyles.field}>
            <label style={slideshowPostingStyles.label}>Date</label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              style={slideshowPostingStyles.input}
            />
          </div>
          <div style={slideshowPostingStyles.field}>
            <label style={slideshowPostingStyles.label}>Time</label>
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              style={slideshowPostingStyles.input}
            />
          </div>
        </div>

        {/* Platforms */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Platforms</label>
          <div style={slideshowPostingStyles.checkboxRow}>
            <label style={slideshowPostingStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={platforms.instagram}
                onChange={(e) => setPlatforms(p => ({ ...p, instagram: e.target.checked }))}
              />
              Instagram
            </label>
            <label style={slideshowPostingStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={platforms.tiktok}
                onChange={(e) => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))}
              />
              TikTok
            </label>
          </div>
        </div>

        {/* Caption */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Caption</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={slideshowPostingStyles.textarea}
            placeholder="Write a caption..."
            rows={2}
          />
        </div>

        {/* Hashtags */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Hashtags</label>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            style={slideshowPostingStyles.hashtagInput}
            placeholder="#hashtag1 #hashtag2..."
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3" style={{ padding: '16px 20px', borderTop: `1px solid ${theme.border.subtle}` }}>
          <Button variant="neutral-secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="brand-primary"
            icon={<FeatherCalendar />}
            onClick={handleSchedule}
            disabled={isScheduling || !selectedHandle}
            loading={isScheduling}
          >
            {isScheduling ? (exportProgress || 'Scheduling...') : `Schedule ${slideshows.length} Carousel${slideshows.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ContentLibrary;
