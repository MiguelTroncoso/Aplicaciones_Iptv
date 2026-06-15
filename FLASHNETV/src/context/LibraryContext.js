import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import logger from '../utils/logger';

const LibraryContext = createContext();

const buildItemId = (item, type) => {
  const rawId = item?.stream_id || item?.series_id || item?.id || item?.name || Date.now();
  return `${type}-${rawId}`;
};

const buildEpisodeWatchId = (serie, episode) => {
  const s = serie?.series_id || serie?.id || serie?.name || 'serie';
  const e = episode?.id || episode?.stream_id || `${episode?.season || ''}-${episode?.episode_num || episode?.title || ''}`;
  return `watched-${s}-${e}`;
};

const normalizeItem = (item, type) => {
  const raw = item?.raw || item || {};
  return {
    id: buildItemId(raw, type),
    type,
    stream_id: raw.stream_id || null,
    series_id: raw.series_id || null,
    episode_id: raw.id || null,
    name: raw.name || raw.title || 'Sin nombre',
    category_name: raw.category_name || '',
    stream_icon: raw.stream_icon || raw.cover || raw.series_cover || raw.info?.movie_image || '',
    cover: raw.cover || raw.stream_icon || raw.series_cover || raw.info?.movie_image || '',
    rating: raw.rating || raw.info?.rating || '',
    container_extension: raw.container_extension || raw.info?.container_extension || 'mp4',
    raw: {
      stream_id: raw.stream_id || null,
      series_id: raw.series_id || null,
      id: raw.id || null,
      name: raw.name || raw.title || '',
      title: raw.title || raw.name || '',
      stream_icon: raw.stream_icon || raw.cover || raw.series_cover || raw.info?.movie_image || '',
      cover: raw.cover || raw.stream_icon || raw.series_cover || raw.info?.movie_image || '',
      category_name: raw.category_name || '',
      container_extension: raw.container_extension || 'mp4',
      rating: raw.rating || '',
    },
    savedAt: new Date().toISOString(),
  };
};

export const LibraryProvider = ({ children }) => {
  const [favorites, setFavorites] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [watchedEpisodes, setWatchedEpisodes] = useState([]);
  const [watchStats, setWatchStats] = useState([]);
  const [loading, setLoading] = useState(true);

  const storageKey = useMemo(() => 'flashnetv_library_v1_default', []);

  useEffect(() => { loadLibrary(); }, [storageKey]);

  const persistPayload = async ({ favs = favorites, cw = continueWatching, watched = watchedEpisodes, stats = watchStats, wl = watchlist } = {}) => {
    if (!storageKey) return;
    const payload = {
      favorites: favs,
      continueWatching: cw,
      watchedEpisodes: watched,
      watchStats: stats,
      watchlist: wl,
      updatedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
  };

  const loadLibrary = async () => {
    try {
      setLoading(true);
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setFavorites(parsed.favorites || []);
        setContinueWatching(parsed.continueWatching || []);
        setWatchedEpisodes(parsed.watchedEpisodes || []);
        setWatchStats(parsed.watchStats || []);
        setWatchlist(parsed.watchlist || []);
      } else {
        const oldKey = 'flashnetv_library_legacy_default';
        const oldStored = await AsyncStorage.getItem(oldKey);
        if (oldStored) {
          const oldParsed = JSON.parse(oldStored);
          const migratedFavs = (oldParsed.favorites || []).map(item =>
            normalizeItem(item.raw || item, item.type || 'movie')
          );
          const migratedCW = (oldParsed.continueWatching || []).slice(0, 30).map(item => ({
            ...normalizeItem(item.raw || item, item.type || 'movie'),
            positionMillis: item.positionMillis || 0,
            durationMillis: item.durationMillis || 0,
            progress: item.progress || 0,
            updatedAt: item.updatedAt || new Date().toISOString(),
          }));
          setFavorites(migratedFavs);
          setContinueWatching(migratedCW);
          setWatchedEpisodes([]);
          setWatchStats([]);
          await persistPayload({ favs: migratedFavs, cw: migratedCW, watched: [], stats: [] });
        } else {
          setFavorites([]);
          setContinueWatching([]);
          setWatchedEpisodes([]);
          setWatchStats([]);
        }
      }
    } catch (e) {
      logger.log('Error cargando biblioteca:', e);
      setFavorites([]);
      setContinueWatching([]);
      setWatchedEpisodes([]);
      setWatchStats([]);
    } finally {
      setLoading(false);
    }
  };

  const saveLibrary = async (nextFavorites, nextContinueWatching) => {
    setFavorites(nextFavorites);
    setContinueWatching(nextContinueWatching);
    await persistPayload({ favs: nextFavorites, cw: nextContinueWatching });
  };

  const isFavorite = (item, type) => {
    const id = buildItemId(item?.raw || item, type);
    return favorites.some(fav => fav.id === id);
  };

  const toggleFavorite = async (item, type) => {
    const normalized = normalizeItem(item, type);
    const exists = favorites.some(fav => fav.id === normalized.id);
    const nextFavorites = exists
      ? favorites.filter(fav => fav.id !== normalized.id)
      : [normalized, ...favorites].slice(0, 300);
    await saveLibrary(nextFavorites, continueWatching);
    return !exists;
  };

  const addToContinueWatching = async (item, type, positionMillis = 0, durationMillis = 0) => {
    if (type === 'live' || !item) return;
    const position = Number(positionMillis || 0);
    const duration = Number(durationMillis || 0);
    if (position < 15000) return;
    if (duration > 0 && position >= duration - 30000) {
      await removeFromContinueWatching(item, type);
      return;
    }
    const normalized = normalizeItem(item, type);
    const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
    const nextItem = {
      ...normalized,
      positionMillis: position,
      durationMillis: duration,
      progress,
      updatedAt: new Date().toISOString(),
    };
    const nextCW = [nextItem, ...continueWatching.filter(row => row.id !== nextItem.id)].slice(0, 30);
    await saveLibrary(favorites, nextCW);
  };

  const getContinueWatchingItem = (item, type = 'movie') => {
    if (type === 'live' || !item) return null;
    const raw = item?.raw || item;
    const id = buildItemId(raw, type);
    return continueWatching.find(row => row.id === id) || null;
  };

  const removeFromContinueWatching = async (item, type) => {
    const raw = item?.raw || item;
    const id = buildItemId(raw, type);
    const nextCW = continueWatching.filter(row => row.id !== id);
    await saveLibrary(favorites, nextCW);
  };

  const clearContinueWatching = async () => {
    await saveLibrary(favorites, []);
  };

  const saveWatchedEpisodes = async (nextWatched) => {
    setWatchedEpisodes(nextWatched);
    await persistPayload({ watched: nextWatched });
  };

  const isEpisodeWatched = (serie, episode) => {
    const id = buildEpisodeWatchId(serie, episode);
    return watchedEpisodes.some(row => row.id === id);
  };

  const toggleEpisodeWatched = async (serie, episode) => {
    const id = buildEpisodeWatchId(serie, episode);
    const exists = watchedEpisodes.some(row => row.id === id);
    const next = exists
      ? watchedEpisodes.filter(row => row.id !== id)
      : [{
          id,
          series_id: serie?.series_id || serie?.id || null,
          serieName: serie?.name || '',
          episode_id: episode?.id || episode?.stream_id || null,
          episode_num: episode?.episode_num || null,
          title: episode?.title || episode?.name || '',
          watchedAt: new Date().toISOString(),
        }, ...watchedEpisodes].slice(0, 1500);
    await saveWatchedEpisodes(next);
    return !exists;
  };

  const markEpisodeWatched = async (serie, episode) => {
    const id = buildEpisodeWatchId(serie, episode);
    if (watchedEpisodes.some(row => row.id === id)) return true;
    const next = [{
      id,
      series_id: serie?.series_id || serie?.id || null,
      serieName: serie?.name || '',
      episode_id: episode?.id || episode?.stream_id || null,
      episode_num: episode?.episode_num || null,
      title: episode?.title || episode?.name || '',
      watchedAt: new Date().toISOString(),
    }, ...watchedEpisodes].slice(0, 1500);
    await saveWatchedEpisodes(next);
    return true;
  };

  const recordWatchSession = async (item, type, seconds = 0) => {
    const s = Math.floor(Number(seconds || 0));
    if (!item || s < 30) return;
    const raw = item?.raw || item || {};
    const row = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      itemId: buildItemId(raw, type),
      type,
      name: raw.name || raw.title || 'Sin nombre',
      category_name: raw.category_name || '',
      seconds: s,
      watchedAt: new Date().toISOString(),
    };
    const next = [row, ...watchStats].slice(0, 700);
    setWatchStats(next);
    await persistPayload({ stats: next });
  };

  const clearWatchStats = async () => {
    setWatchStats([]);
    await persistPayload({ stats: [] });
  };


  // ─── Watchlist ────────────────────────────────────────────────────────────
  const normalizeWatchItem = (item, type = 'movie') => {
    const raw = item?.raw || item || {};
    return {
      id:         raw.stream_id || raw.series_id || raw.num || raw.name,
      type,
      name:       raw.name || raw.title || '',
      poster:     raw.stream_icon || raw.cover || raw.info?.movie_image || '',
      addedAt:    new Date().toISOString(),
      raw,
    };
  };

  const isInWatchlist = (item, type = 'movie') => {
    const id = (item?.raw || item)?.stream_id || (item?.raw || item)?.series_id || (item?.raw || item)?.name;
    return watchlist.some(w => w.id === id);
  };

  const toggleWatchlist = async (item, type = 'movie') => {
    const id = (item?.raw || item)?.stream_id || (item?.raw || item)?.series_id || (item?.raw || item)?.name;
    let updated;
    if (watchlist.some(w => w.id === id)) {
      updated = watchlist.filter(w => w.id !== id);
    } else {
      updated = [normalizeWatchItem(item, type), ...watchlist].slice(0, 500);
    }
    setWatchlist(updated);
    await persistPayload({ wl: updated });
    return !watchlist.some(w => w.id === id); // true = added
  };

  return (
    <LibraryContext.Provider value={{
      favorites,
      continueWatching,
      loading,
      watchedEpisodes,
      watchStats,
      isFavorite,
      toggleFavorite,
      addToContinueWatching,
      getContinueWatchingItem,
      removeFromContinueWatching,
      clearContinueWatching,
      isEpisodeWatched,
      toggleEpisodeWatched,
      markEpisodeWatched,
      recordWatchSession,
      clearWatchStats,
      watchlist,
      isInWatchlist,
      toggleWatchlist,
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = () => useContext(LibraryContext);
