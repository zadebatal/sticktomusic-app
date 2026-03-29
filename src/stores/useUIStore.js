import { create } from 'zustand';

const useUIStore = create((set, get) => ({
  // Navigation
  currentPage: 'home',
  operatorTab: 'studio',
  artistTab: 'dashboard',

  // Modals
  showLoginModal: false,
  showSignupModal: false,
  showScheduleModal: false,
  showLateConnectModal: false,
  showLateAccounts: false,

  // Actions
  setCurrentPage: (page) => set({ currentPage: page }),
  setOperatorTab: (tab) => set({ operatorTab: tab }),
  setArtistTab: (tab) => set({ artistTab: tab }),

  setShowLoginModal: (show) => set({ showLoginModal: show }),
  setShowSignupModal: (show) => set({ showSignupModal: show }),
  setShowScheduleModal: (show) => set({ showScheduleModal: show }),
  setShowLateConnectModal: (show) => set({ showLateConnectModal: show }),
  setShowLateAccounts: (show) => set({ showLateAccounts: show }),

  // Batch clear modals (used on tab/artist change)
  clearModals: () =>
    set({
      showScheduleModal: false,
      showLateConnectModal: false,
      showLateAccounts: false,
    }),
}));

export default useUIStore;
