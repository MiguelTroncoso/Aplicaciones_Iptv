/**
 * contentCache.js — Caché inteligente con TTL diferenciado por tipo
 *
 * TTL por tipo:
 *  'live'     → 30 min  (canales en vivo cambian poco)
 *  'home_*'   → 6 horas (listas del home)
 *  'all'      → 6 horas (listados completos de películas/series)
 *  'detail'   → 24 horas (detalle de serie/película)
 *  'epg'      → 15 min  (guía de programación)
 *  default    → 6 horas
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import logger from '../utils/logger';

const CACHE_PREFIX = 'flashnetv_content_cache_v1';

const TTL_MAP = {
  live:    1000 * 60 * 30,       // 30 min
  epg:     1000 * 60 * 15,       // 15 min
  detail:  1000 * 60 * 60 * 24,  // 24 horas
  default: 1000 * 60 * 60 * 6,   // 6 horas
};

const getTTL = (type = '') => {
  if (type === 'live' || type === 'home_live')  return TTL_MAP.live;
  if (type === 'epg')                           return TTL_MAP.epg;
  if (type === 'detail')                        return TTL_MAP.detail;
  return TTL_MAP.default;
};

const makeKey = (serverUrl, username, type, categoryId = 'all') => {
  const safeServer = (serverUrl || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeUser   = (username  || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${CACHE_PREFIX}_${safeServer}_${safeUser}_${type}_${categoryId}`;
};

export const compactItem = (item = {}, type = 'movie') => ({
  ...item,
  _cachedType: type,
});

export const saveCache = async (serverUrl, username, type, categoryId, data) => {
  try {
    const key = makeKey(serverUrl, username, type, categoryId);
    await AsyncStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      type,
      data: Array.isArray(data) ? data : (data || null),
    }));
  } catch (e) {
    logger.log('Error guardando caché:', e);
  }
};

export const getCache = async (serverUrl, username, type, categoryId = 'all') => {
  try {
    const key = makeKey(serverUrl, username, type, categoryId);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const ttl     = getTTL(type);
    return {
      data:    payload.data || null,
      isFresh: Date.now() - (payload.savedAt || 0) < ttl,
      savedAt: payload.savedAt || 0,
      age:     Date.now() - (payload.savedAt || 0),
    };
  } catch (e) {
    logger.log('Error leyendo caché:', e);
    return null;
  }
};

export const clearContentCache = async () => {
  try {
    const keys      = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
  } catch (e) {
    logger.log('Error limpiando caché:', e);
  }
};

export const withCategoryNames = (items = [], categories = []) => {
  const map = {};
  categories.forEach(cat => { map[cat.category_id] = cat.category_name; });
  return (items || []).map(item => ({
    ...item,
    category_name: map[item.category_id] || item.category_name || 'Sin categoría',
  }));
};

export const deriveCategoriesFromItems = (items = []) => {
  const seen = new Map();
  (items || []).forEach((item) => {
    const id = item?.category_id;
    if (id === undefined || id === null || id === '') return;
    const key = String(id);
    if (seen.has(key)) return;
    seen.set(key, {
      category_id: id,
      category_name: item?.category_name || item?.category || `Categoria ${key}`,
    });
  });
  return Array.from(seen.values());
};

export const mergeCategories = (primary = [], fallback = []) => {
  const seen = new Set();
  const merged = [];
  [...(primary || []), ...(fallback || [])].forEach((cat) => {
    const id = cat?.category_id;
    if (id === undefined || id === null || id === '') return;
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(cat);
  });
  return merged;
};

export const pickHomeHighlights = (items = [], type = 'movie', limit = 30) => {
  const imageKey = type === 'series' ? 'cover' : 'stream_icon';
  return (items || [])
    .filter(item => item && item.name && item[imageKey])
    .slice(0, limit)
    .map(item => compactItem(item, type));
};
