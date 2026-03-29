import { create } from 'zustand';

const useContentStore = create((set) => ({
  // Content tab filter/display state
  contentArtist: 'all',
  contentStatus: 'all',
  contentSortOrder: 'newest',

  // Late API data
  latePosts: [],
  latePages: [],

  // Batch schedule form
  batchForm: {
    artist: 'Boon',
    category: 'Fashion',
    artistVideos: '',
    adjacentVideos: '',
    weekStart: '',
    numDays: 7,
    step: 1,
  },

  // Generated schedule (from batch form)
  generatedSchedule: [],

  // Syncing state
  syncing: false,
  syncStatus: null,
  isExporting: false,

  // Content view & filters (moved from App.jsx useState)
  contentView: (() => {
    try {
      return localStorage.getItem('stm_contentView') || 'list';
    } catch {
      return 'list';
    }
  })(),
  postSearch: '',
  postPlatformFilter: 'all',
  postAccountFilter: 'all',
  calendarMonth: new Date(),
  deletingPostId: null,
  lastSynced: null,

  // Actions
  setContentArtist: (artist) => set({ contentArtist: artist }),
  setContentStatus: (status) => set({ contentStatus: status }),
  setContentSortOrder: (order) => set({ contentSortOrder: order }),
  setLatePosts: (posts) => set({ latePosts: posts }),
  setLatePages: (pages) => set({ latePages: pages }),
  setBatchForm: (formOrUpdater) =>
    set((state) => ({
      batchForm:
        typeof formOrUpdater === 'function' ? formOrUpdater(state.batchForm) : formOrUpdater,
    })),
  setGeneratedSchedule: (schedule) => set({ generatedSchedule: schedule }),
  setSyncing: (syncing) => set({ syncing }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  setIsExporting: (exporting) => set({ isExporting: exporting }),

  // Content view & filter actions
  setContentView: (view) => {
    try {
      localStorage.setItem('stm_contentView', view);
    } catch {}
    set({ contentView: view });
  },
  setPostSearch: (search) => set({ postSearch: search }),
  setPostPlatformFilter: (filter) => set({ postPlatformFilter: filter }),
  setPostAccountFilter: (filter) => set({ postAccountFilter: filter }),
  setCalendarMonth: (month) => set({ calendarMonth: month }),
  setDeletingPostId: (id) => set({ deletingPostId: id }),
  setLastSynced: (synced) => set({ lastSynced: synced }),

  resetBatchForm: () =>
    set({
      batchForm: {
        artist: 'Boon',
        category: 'Fashion',
        artistVideos: '',
        adjacentVideos: '',
        weekStart: '',
        numDays: 7,
        step: 1,
      },
      generatedSchedule: [],
    }),
}));

export default useContentStore;
