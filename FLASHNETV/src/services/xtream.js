/**
 * xtream.js - API Xtream Codes para FLASHNETV
 *
 * IMPORTANTE: Los servidores Xtream comparan credenciales como string exacto.
 * NO usar encodeURIComponent en usuario/contraseña — rompe con usuarios que
 * tienen @ u otros caracteres (ej: @demo@ → %40demo%40 → falla el login).
 * Solo se escapan & = # + espacio que rompen la estructura de la URL.
 */

const DEFAULT_TIMEOUT = 18000;

const fetchWithTimeout = (url, ms = DEFAULT_TIMEOUT) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

// Escapa solo los caracteres que rompen la URL, NO el @
const sp = (val = '') =>
  String(val)
    .replace(/%/g, '%25')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .replace(/#/g, '%23')
    .replace(/\+/g, '%2B')
    .replace(/ /g, '%20');

const base = (server) => server.endsWith('/') ? server : `${server}/`;
const creds = (u, p) => `username=${sp(u)}&password=${sp(p)}`;

export const login = async (server, username, password) => {
  try {
    const url = `${base(server)}player_api.php?${creds(username, password)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.user_info || data?.user_info?.auth === 0)
      throw new Error('Credenciales inválidas');
    return {
      success:    true,
      userInfo:   data.user_info,
      serverInfo: data.server_info,
    };
  } catch (e) {
    return {
      success: false,
      error:   e.message || 'No se pudo conectar al servidor',
    };
  }
};

export const getLiveCategories = async (server, username, password) => {
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_live_categories`
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const getLiveStreams = async (server, username, password, categoryId = '') => {
  const cat = categoryId ? `&category_id=${sp(categoryId)}` : '';
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_live_streams${cat}`
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const getVodCategories = async (server, username, password) => {
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_vod_categories`
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const getVodStreams = async (server, username, password, categoryId = '') => {
  const cat = categoryId ? `&category_id=${sp(categoryId)}` : '';
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_vod_streams${cat}`
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const getSeriesCategories = async (server, username, password) => {
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_series_categories`
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const getSeries = async (server, username, password, categoryId = '') => {
  const cat = categoryId ? `&category_id=${sp(categoryId)}` : '';
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_series${cat}`
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const getSeriesInfo = async (server, username, password, seriesId) => {
  const res = await fetchWithTimeout(
    `${base(server)}player_api.php?${creds(username, password)}&action=get_series_info&series_id=${sp(seriesId)}`
  );
  if (!res.ok) return null;
  return res.json().catch(() => null);
};

export const getStreamExtension = (item = {}, type = 'live') => {
  if (type === 'live') return 'ts';
  return item?.container_extension || item?.info?.container_extension || item?.extension || 'mp4';
};

// Stream URL: sin ningún encoding — Xtream espera las credenciales exactas
export const getStreamUrl = (server, username, password, streamId, type = 'live', ext = 'ts') => {
  const b  = base(server);
  const u  = username || '';
  const p  = password || '';
  const id = streamId || '';
  if (type === 'live')   return `${b}live/${u}/${p}/${id}.${ext}`;
  if (type === 'movie')  return `${b}movie/${u}/${p}/${id}.${ext}`;
  if (type === 'series') return `${b}series/${u}/${p}/${id}.${ext}`;
  return `${b}movie/${u}/${p}/${id}.${ext}`;
};

const ADULT_KEYWORDS = [
  'adult', 'xxx', '+18', '18+', 'adulto', 'adultos',
  'erotic', 'erotico', 'erótico', 'porno', 'porn', 'sex', 'sexy',
];

export const isAdultContent = (categoryName = '', streamName = '') => {
  const text = `${categoryName} ${streamName}`.toLowerCase();
  return ADULT_KEYWORDS.some(kw => text.includes(kw));
};

// ─── EPG ──────────────────────────────────────────────────────────────────────

export const getShortEPG = async (server, username, password, streamId, limit = 4) => {
  try {
    const res = await fetchWithTimeout(
      `${base(server)}player_api.php?${creds(username, password)}&action=get_short_epg&stream_id=${sp(streamId)}&limit=${limit}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.epg_listings || null;
  } catch (_) { return null; }
};

// ─── Detección de sesión expirada ─────────────────────────────────────────────
// Wrapper: si cualquier llamada recibe 401/403, retorna { sessionExpired: true }

export const checkSessionValid = async (server, username, password) => {
  try {
    const url = `${base(server)}player_api.php?${creds(username, password)}`;
    const res = await fetchWithTimeout(url, 8000);
    if (res.status === 401 || res.status === 403) return { valid: false, expired: true };
    const data = await res.json();
    if (!data?.user_info || data.user_info.auth === 0) return { valid: false, expired: true };
    const exp = data.user_info.exp_date;
    if (exp && Number(exp) > 0 && Number(exp) < Date.now() / 1000)
      return { valid: false, expired: true, expiredAt: new Date(Number(exp) * 1000) };
    return { valid: true, userInfo: data.user_info };
  } catch (_) { return { valid: true }; } // red caída ≠ sesión expirada
};
