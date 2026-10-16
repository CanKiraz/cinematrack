import { contextBridge, ipcRenderer } from 'electron'

// `kind` is 'movie' (CinemaTrack) or 'tv' (DiziTrack); it defaults to 'movie' in the main process.
const api = {
  getConfig: (key: string): Promise<string | null> => ipcRenderer.invoke('config:get', key),
  setConfig: (key: string, value: string): Promise<void> => ipcRenderer.invoke('config:set', key, value),
  checkName: (name: string): Promise<{ ok: boolean; reason?: 'format' | 'blocked' | 'reserved' }> => ipcRenderer.invoke('names:check', name),
  setWatchlistAddedAt: (tmdbId: number, iso: string, kind?: string): Promise<boolean> => ipcRenderer.invoke('watchlist:setAddedAt', tmdbId, iso, kind),
  // Tells the main process which account is signed in; a different account than last time gets an empty local database
  claimLocalData: (uid: string): Promise<{ reset: boolean }> => ipcRenderer.invoke('account:claimLocalData', uid),
  // Firebase ID token for the CinemaTrack API (null when signed out), and the main process asking for a fresh one
  setAuthToken: (token: string | null): Promise<void> => ipcRenderer.invoke('auth:setToken', token),
  onAuthRefreshRequest: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('auth:refresh-request', listener)
    return () => { ipcRenderer.removeListener('auth:refresh-request', listener) }
  },
  searchMovies: (query: string, kind?: string, language?: string): Promise<unknown[]> => ipcRenderer.invoke('tmdb:search', query, kind, language),
  getMovie: (tmdbId: number, kind?: string): Promise<unknown> => ipcRenderer.invoke('tmdb:getMovie', tmdbId, kind),
  getWatchProviders: (tmdbId: number, kind?: string): Promise<unknown> => ipcRenderer.invoke('tmdb:watchProviders', tmdbId, kind),
  addToWatchlist: (movie: unknown, kind?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('watchlist:add', movie, kind),
  removeFromWatchlist: (movieId: number, kind?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('watchlist:remove', movieId, kind),
  getWatchlist: (kind?: string): Promise<unknown[]> => ipcRenderer.invoke('watchlist:getAll', kind),
  checkWatchlist: (tmdbId: number, kind?: string): Promise<boolean> => ipcRenderer.invoke('watchlist:check', tmdbId, kind),
  addWatchLog: (data: unknown, kind?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('watchlog:add', data, kind),
  addRemoteWatchLog: (data: unknown, kind?: string): Promise<{ success: boolean; added: boolean }> => ipcRenderer.invoke('watchlog:addRemote', data, kind),
  removeRemoteWatchLog: (remoteId: string, kind?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('watchlog:removeRemote', remoteId, kind),
  isWatched: (tmdbId: number, kind?: string): Promise<boolean> => ipcRenderer.invoke('watchlog:isWatched', tmdbId, kind),
  removeWatchLog: (logId: number, kind?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('watchlog:remove', logId, kind),
  getWatchLog: (kind?: string): Promise<unknown[]> => ipcRenderer.invoke('watchlog:getAll', kind),
  getWatchLogByDate: (kind?: string): Promise<{ date: string; titles: string[]; posters: (string | null)[] }[]> => ipcRenderer.invoke('watchlog:getByDate', kind),
  togetherResolve: (data: unknown): Promise<unknown> =>
    ipcRenderer.invoke('together:resolve', data),

  getStats: (kind?: string): Promise<unknown> => ipcRenderer.invoke('stats:get', kind),
  getDetailedStats: (kind?: string): Promise<unknown> => ipcRenderer.invoke('stats:getDetailed', kind),
  aiChat: (messages: unknown[], watchlist: unknown[], stats: unknown, kind?: string, language?: string): Promise<{ text: string; suggestedMovies: unknown[] }> =>
    ipcRenderer.invoke('ai:chat', messages, watchlist, stats, kind, language),
}

contextBridge.exposeInMainWorld('api', api)
