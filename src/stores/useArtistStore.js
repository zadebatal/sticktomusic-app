import { create } from 'zustand';

const useArtistStore = create((set, get) => ({
  // Artist data
  firestoreArtists: [],
  currentArtistId: null,
  artistsLoaded: false,
  artistPhotoMap: {},

  // Actions
  setFirestoreArtists: (artists) => set({ firestoreArtists: artists }),
  setCurrentArtistId: (id) => set({ currentArtistId: id }),
  setArtistsLoaded: (loaded) => set({ artistsLoaded: loaded }),
  setArtistPhotoMap: (map) => set({ artistPhotoMap: map }),
  updateArtistPhoto: (artistId, url) =>
    set((state) => ({
      artistPhotoMap: { ...state.artistPhotoMap, [artistId]: url },
    })),
}));

export default useArtistStore;
