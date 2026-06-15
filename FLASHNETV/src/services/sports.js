/**
 * sports.js — ESPN Public API multi-deporte
 *
 * v1.0.29 FIX:
 * - En vivo: combina ESPN con fecha de hoy/mañana + endpoint actual sin fecha.
 * - Nunca muestra partidos antiguos finalizados.
 * - Si un partido está EN VIVO, se muestra aunque ESPN lo devuelva con desfase horario.
 * - Hoy: solo hoy; desde las 20:00 también mañana.
 * - Forzamos no-cache + cache buster en cada llamada.
 */
import logger from '../utils/logger';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const TIMEOUT_MS = 9000;
const ESPN_BATCH_SIZE = 8;
const NIGHT_HOUR_FOR_TOMORROW = 20;

// ─── Fecha ────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');
const toESPN = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const getTodayDate = () => new Date();
const getToday = () => toESPN(getTodayDate());
const getTomorrow = () => toESPN(addDays(getTodayDate(), 1));
const getYesterday = () => toESPN(addDays(getTodayDate(), -1));
const shouldIncludeTomorrow = () => new Date().getHours() >= NIGHT_HOUR_FOR_TOMORROW;

const normalizeDateInput = (dateOverride) => {
  if (Array.isArray(dateOverride)) return [...new Set(dateOverride.filter(Boolean))];
  if (typeof dateOverride === 'string' && dateOverride.includes('-')) {
    return [...new Set(dateOverride.split('-').filter(Boolean))];
  }
  if (dateOverride) return [dateOverride];
  return shouldIncludeTomorrow() ? [getToday(), getTomorrow()] : [getToday()];
};

const getRequestDateKeys = (dateOverride) => {
  // ESPN usa calendarios de EE.UU. en varias ligas. Para no perder partidos
  // que cruzan medianoche/zonas horarias, consultamos ayer-hoy-mañana,
  // pero filtramos duro para mostrar solo hoy y mañana cuando corresponde.
  const allowed = normalizeDateInput(dateOverride);
  return [...new Set([getYesterday(), ...allowed, getTomorrow()])];
};

const localDateKeyFromUtc = (utcDate) => {
  if (!utcDate) return null;
  const d = new Date(utcDate);
  if (Number.isNaN(d.getTime())) return null;
  return toESPN(d);
};

const isTodayOrTomorrow = (utcDate, allowedDateKeys = normalizeDateInput()) => {
  const key = localDateKeyFromUtc(utcDate);
  return key ? allowedDateKeys.includes(key) : false;
};

const isLiveStatus = (status) => status === 'IN_PLAY' || status === 'HALFTIME' || status === 'PAUSED';

const shouldKeepEvent = (event, allowedDateKeys, { includeLiveOutsideDate = false } = {}) => {
  if (!event || event.status === 'CANCELLED') return false;
  if (includeLiveOutsideDate && isLiveStatus(event.status)) return true;
  return isTodayOrTomorrow(event.utcDate, allowedDateKeys);
};

const eventStatusPriority = (status) => {
  switch (status) {
    case 'IN_PLAY': return 0;
    case 'HALFTIME': return 1;
    case 'PAUSED': return 2;
    case 'SCHEDULED': return 3;
    case 'POSTPONED': return 4;
    case 'FINISHED': return 5;
    default: return 6;
  }
};

const sortEvents = (events = []) => [...events].sort((a, b) => {
  const statusDelta = eventStatusPriority(a.status) - eventStatusPriority(b.status);
  if (statusDelta !== 0) return statusDelta;
  return new Date(a.utcDate || 0).getTime() - new Date(b.utcDate || 0).getTime();
});

const dedupeEvents = (events = []) => {
  const seen = new Set();
  const output = [];
  for (const event of events) {
    const key = `${event.league}-${event.id || event.utcDate || ''}-${event.homeTeam?.shortName || ''}-${event.awayTeam?.shortName || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
};

// ─── Ligas ────────────────────────────────────────────────────────────────────

export const ESPN_LEAGUES = [
  // 🏀 Basketball
  { key: 'nba', sport: 'basketball', league: 'nba', name: 'NBA', flag: '🏀', tab: 'basketball' },
  { key: 'wnba', sport: 'basketball', league: 'wnba', name: 'WNBA', flag: '🏀', tab: 'basketball' },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball', name: 'NCAA Basket', flag: '🏀', tab: 'basketball' },
  // 🏈 Football americano
  { key: 'nfl', sport: 'football', league: 'nfl', name: 'NFL', flag: '🏈', tab: 'football_am' },
  { key: 'ncaaf', sport: 'football', league: 'college-football', name: 'NCAA Football', flag: '🏈', tab: 'football_am' },
  // ⚾ Baseball
  { key: 'mlb', sport: 'baseball', league: 'mlb', name: 'MLB', flag: '⚾', tab: 'baseball' },
  // 🏒 Hockey
  { key: 'nhl', sport: 'hockey', league: 'nhl', name: 'NHL', flag: '🏒', tab: 'hockey' },
  // ⚽ Fútbol principales
  { key: 'mls', sport: 'soccer', league: 'usa.1', name: 'MLS', flag: '⚽', tab: 'soccer' },
  { key: 'ligamx', sport: 'soccer', league: 'mex.1', name: 'Liga MX', flag: '⚽', tab: 'soccer' },
  { key: 'epl', sport: 'soccer', league: 'eng.1', name: 'Premier League', flag: '⚽', tab: 'soccer' },
  { key: 'laliga', sport: 'soccer', league: 'esp.1', name: 'La Liga', flag: '⚽', tab: 'soccer' },
  { key: 'seriea', sport: 'soccer', league: 'ita.1', name: 'Serie A', flag: '⚽', tab: 'soccer' },
  { key: 'bundesliga', sport: 'soccer', league: 'ger.1', name: 'Bundesliga', flag: '⚽', tab: 'soccer' },
  { key: 'ligue1', sport: 'soccer', league: 'fra.1', name: 'Ligue 1', flag: '⚽', tab: 'soccer' },
  { key: 'ucl', sport: 'soccer', league: 'uefa.champions', name: 'Champions League', flag: '🏆', tab: 'soccer' },
  { key: 'uel', sport: 'soccer', league: 'uefa.europa', name: 'Europa League', flag: '🟠', tab: 'soccer' },
  { key: 'copa', sport: 'soccer', league: 'conmebol.libertadores', name: 'Copa Libertadores', flag: '🌎', tab: 'soccer' },
  { key: 'sudamericana', sport: 'soccer', league: 'conmebol.sudamericana', name: 'Sudamericana', flag: '🌎', tab: 'soccer' },
  { key: 'arg', sport: 'soccer', league: 'arg.1', name: 'Liga Argentina', flag: '⚽', tab: 'soccer' },
  { key: 'bra', sport: 'soccer', league: 'bra.1', name: 'Brasileirão', flag: '⚽', tab: 'soccer' },
  { key: 'chile', sport: 'soccer', league: 'chi.1', name: 'Chile Primera', flag: '⚽', tab: 'soccer' },
  // ⚽ Internacionales / amistosos / selecciones
  { key: 'friendly', sport: 'soccer', league: 'friendly', name: 'Amistosos', flag: '🤝', tab: 'friendly' },
  { key: 'intfriendly', sport: 'soccer', league: 'fifa.friendly', name: 'Amistosos FIFA', flag: '🌍', tab: 'friendly' },
  { key: 'fifaworld', sport: 'soccer', league: 'fifa.world', name: 'Mundial FIFA', flag: '🌍', tab: 'friendly' },
  { key: 'worldq', sport: 'soccer', league: 'fifa.worldq', name: 'Eliminatorias FIFA', flag: '🌍', tab: 'friendly' },
  { key: 'uefaeuro', sport: 'soccer', league: 'uefa.euro', name: 'Eurocopa', flag: '🇪🇺', tab: 'friendly' },
  { key: 'nations_uefa', sport: 'soccer', league: 'uefa.nations', name: 'UEFA Nations', flag: '🇪🇺', tab: 'friendly' },
  { key: 'nations_conc', sport: 'soccer', league: 'concacaf.nations', name: 'CONCACAF Nations', flag: '🌎', tab: 'friendly' },
  { key: 'wq_conmebol', sport: 'soccer', league: 'conmebol.wc.qual', name: 'Eliminatorias Sud', flag: '🌎', tab: 'friendly' },
  { key: 'wq_concacaf', sport: 'soccer', league: 'concacaf.wc.qual', name: 'Eliminatorias Norte', flag: '🌎', tab: 'friendly' },
  { key: 'copaamerica', sport: 'soccer', league: 'conmebol.america', name: 'Copa América', flag: '🌎', tab: 'friendly' },
  // 🎾 Tenis / 🥊 MMA / ⛳ Golf / 🏎 F1
  { key: 'tennis', sport: 'tennis', league: 'atp', name: 'ATP Tennis', flag: '🎾', tab: 'tennis' },
  { key: 'ufc', sport: 'mma', league: 'ufc', name: 'UFC / MMA', flag: '🥊', tab: 'mma' },
  { key: 'golf', sport: 'golf', league: 'pga', name: 'PGA Golf', flag: '⛳', tab: 'golf' },
  { key: 'f1', sport: 'racing', league: 'f1', name: 'F1', flag: '🏎', tab: 'motorsport' },
];

export const SPORT_TABS = [
  { key: 'live', label: '🔴 En vivo' },
  { key: 'today', label: shouldIncludeTomorrow() ? '📅 Hoy + mañana' : '📅 Hoy' },
  { key: 'friendly', label: '🤝 Amistosos' },
  { key: 'basketball', label: '🏀 Basket' },
  { key: 'football_am', label: '🏈 NFL' },
  { key: 'baseball', label: '⚾ MLB' },
  { key: 'hockey', label: '🏒 NHL' },
  { key: 'soccer', label: '⚽ Fútbol' },
  { key: 'tennis', label: '🎾 Tenis' },
  { key: 'mma', label: '🥊 UFC' },
  { key: 'motorsport', label: '🏎 F1' },
];

// ─── HTTP ─────────────────────────────────────────────────────────────────────

const ESPN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const fetchWithTimeout = (url, ms = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    headers: ESPN_HEADERS,
    signal: controller.signal,
    cache: 'no-store',
  }).finally(() => clearTimeout(timer));
};

const settleInBatches = async (tasks = [], batchSize = ESPN_BATCH_SIZE) => {
  const output = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map(task => task());
    const results = await Promise.allSettled(batch);
    output.push(...results);
  }
  return output;
};

// ─── Normalización ────────────────────────────────────────────────────────────

const normalizeESPNStatus = (statusName = '', state = '') => {
  const raw = `${statusName} ${state}`.toLowerCase();
  if (raw.includes('progress') || raw === 'in' || raw.includes(' in ')) return 'IN_PLAY';
  if (raw.includes('half')) return 'HALFTIME';
  if (raw.includes('final') || raw.includes('post') || raw === 'post') return 'FINISHED';
  if (raw.includes('pre') || raw.includes('scheduled') || raw === 'pre') return 'SCHEDULED';
  if (raw.includes('postponed')) return 'POSTPONED';
  if (raw.includes('cancel')) return 'CANCELLED';
  if (raw.includes('suspend') || raw.includes('pause')) return 'PAUSED';
  return 'SCHEDULED';
};

const normalizeESPNEvent = (event, leagueInfo) => {
  const comp = event.competitions?.[0] || {};
  const teams = comp.competitors || [];
  const home = teams.find(t => t.homeAway === 'home') || teams[0] || {};
  const away = teams.find(t => t.homeAway === 'away') || teams[1] || {};
  const st = event.status?.type || {};

  return {
    id: event.id,
    sport: leagueInfo.tab,
    league: leagueInfo.key,
    competition: leagueInfo.name,
    flag: leagueInfo.flag,
    homeTeam: {
      name: home.team?.displayName || '?',
      shortName: home.team?.abbreviation || home.team?.shortDisplayName || '?',
      logo: home.team?.logo || null,
      record: home.records?.[0]?.summary || '',
    },
    awayTeam: {
      name: away.team?.displayName || '?',
      shortName: away.team?.abbreviation || away.team?.shortDisplayName || '?',
      logo: away.team?.logo || null,
      record: away.records?.[0]?.summary || '',
    },
    homeScore: home.score ?? null,
    awayScore: away.score ?? null,
    status: normalizeESPNStatus(st.name || st.description || '', st.state || ''),
    statusLabel: st.shortDetail || st.description || event.shortName || '',
    clock: event.status?.displayClock || null,
    period: event.status?.period || null,
    utcDate: event.date || null,
    venue: comp.venue?.fullName || null,
  };
};

// ─── Fetch ESPN ───────────────────────────────────────────────────────────────

const getLeagueInfo = (leagueKey) => ESPN_LEAGUES.find(l => l.key === leagueKey);

const fetchLeagueUrl = async (info, query = '', allowedDateKeys, options = {}) => {
  const separator = query ? '&' : '?';
  const url = `${ESPN_BASE}/${info.sport}/${info.league}/scoreboard${query}${separator}limit=200&groups=100&_=${Date.now()}-${info.key}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || [])
      .map(e => normalizeESPNEvent(e, info))
      .filter(e => shouldKeepEvent(e, allowedDateKeys, options));
  } catch (error) {
    if (error?.name !== 'AbortError') logger.log(`ESPN ${info.key}:`, error?.message || error);
    return [];
  }
};

const fetchLeagueForDate = async (info, dateKey) => {
  const query = `?dates=${dateKey}`;
  return fetchLeagueUrl(info, query, [dateKey]);
};

const fetchLeagueCurrent = async (info, allowedDateKeys) => {
  // Endpoint sin dates: ESPN suele devolver la agenda actual de esa liga.
  // Filtramos duro: solo live o fechas permitidas.
  return fetchLeagueUrl(info, '', allowedDateKeys, { includeLiveOutsideDate: true });
};

export const fetchLeagueScoreboard = async (leagueKey, dateOverride) => {
  const info = getLeagueInfo(leagueKey);
  if (!info) return [];
  const dateKeys = normalizeDateInput(dateOverride);
  const requestDateKeys = getRequestDateKeys(dateKeys);
  const results = await settleInBatches(requestDateKeys.map(dateKey => () => fetchLeagueForDate(info, dateKey)));
  const all = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value || []);
  return sortEvents(dedupeEvents(all).filter(e => shouldKeepEvent(e, dateKeys, { includeLiveOutsideDate: true })));
};

const fetchLeaguesForDates = async (leagueKeys, allowedDateKeys = normalizeDateInput(), requestDateKeys = getRequestDateKeys(allowedDateKeys)) => {
  const tasks = leagueKeys.flatMap((key) => {
    const info = getLeagueInfo(key);
    if (!info) return [];
    return requestDateKeys.map(dateKey => () => fetchLeagueForDate(info, dateKey));
  });
  const results = await settleInBatches(tasks);
  const all = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value || []);
  return sortEvents(dedupeEvents(all).filter(e => shouldKeepEvent(e, allowedDateKeys, { includeLiveOutsideDate: true })));
};

// ─── Por tab ──────────────────────────────────────────────────────────────────

export const fetchTabScoreboard = async (tab) => {
  if (tab === 'live') return fetchAllLive();
  if (tab === 'today') return fetchAllToday();

  const leagues = ESPN_LEAGUES.filter(l => l.tab === tab).map(l => l.key);
  if (!leagues.length) return [];
  return fetchLeaguesForDates(leagues, normalizeDateInput());
};

// ─── En vivo ──────────────────────────────────────────────────────────────────

export const fetchAllLive = async () => {
  const priority = [...new Set([
    'nba', 'wnba', 'nfl', 'mlb', 'nhl', 'mls', 'ligamx', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1',
    'ucl', 'uel', 'copa', 'sudamericana', 'arg', 'bra', 'chile',
    'friendly', 'intfriendly', 'fifaworld', 'worldq', 'uefaeuro', 'nations_uefa', 'nations_conc',
    'wq_conmebol', 'wq_concacaf', 'copaamerica', 'ufc', 'tennis', 'golf', 'f1',
  ])];
  const dateKeys = normalizeDateInput();
  const requestDateKeys = getRequestDateKeys(dateKeys);

  const currentTasks = priority.map((key) => {
    const info = getLeagueInfo(key);
    return info ? () => fetchLeagueCurrent(info, dateKeys) : null;
  }).filter(Boolean);
  const datedTasks = priority.flatMap((key) => {
    const info = getLeagueInfo(key);
    if (!info) return [];
    return requestDateKeys.map(dateKey => () => fetchLeagueForDate(info, dateKey));
  });

  // No disparamos 100+ llamadas de golpe: varios Android TV se quedan sin respuesta
  // o ESPN empieza a devolver vacío. Se ejecuta por tandas para mayor estabilidad.
  const results = await settleInBatches([...currentTasks, ...datedTasks]);
  const all = sortEvents(dedupeEvents(results.filter(r => r.status === 'fulfilled').flatMap(r => r.value || [])));
  const live = all.filter(e => isLiveStatus(e.status));

  // Prioridad: live real. Si no hay live, mostrar agenda permitida del día, nunca partidos antiguos.
  return live.length ? live : all.filter(e => e.status !== 'FINISHED' && shouldKeepEvent(e, dateKeys));
};

// ─── Hoy — incluye amistosos y eliminatorias ──────────────────────────────────

export const fetchAllToday = async () => {
  const dateKeys = normalizeDateInput();
  const leagues = ESPN_LEAGUES.map(l => l.key);
  return fetchLeaguesForDates(leagues, dateKeys, getRequestDateKeys(dateKeys));
};

// ─── Legacy ───────────────────────────────────────────────────────────────────
export const getAllLiveMatches = fetchAllLive;
export const getAllTodayMatches = fetchAllToday;
export const getLiveMatches = fetchAllLive;
export const getTodayMatches = fetchAllToday;

// ─── Helpers UI ───────────────────────────────────────────────────────────────

export const getMatchStatus = (status) => {
  switch (status) {
    case 'IN_PLAY': return { label: 'EN VIVO', color: '#ff3b3b' };
    case 'HALFTIME': return { label: 'DESCANSO', color: '#FFD700' };
    case 'PAUSED': return { label: 'PAUSADO', color: '#FFD700' };
    case 'FINISHED': return { label: 'FINAL', color: '#888' };
    case 'SCHEDULED': return { label: 'PRÓXIMO', color: '#32C5FF' };
    case 'POSTPONED': return { label: 'POSPUESTO', color: '#888' };
    case 'CANCELLED': return { label: 'CANCELADO', color: '#555' };
    default: return { label: status || '?', color: '#888' };
  }
};

export const formatMatchTime = (match) => {
  if (match.statusLabel) return match.statusLabel;
  if (match.status === 'SCHEDULED' && match.utcDate) {
    try {
      return new Date(match.utcDate).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      logger.log('formatMatchTime error:', error?.message || error);
      return '';
    }
  }
  return '';
};

export const formatMatchDate = (utcDate) => {
  if (!utcDate) return '';
  try {
    const key = localDateKeyFromUtc(utcDate);
    if (key === getToday()) return 'Hoy';
    if (key === getTomorrow()) return 'Mañana';
    return new Date(utcDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  } catch (error) {
    logger.log('formatMatchDate error:', error?.message || error);
    return '';
  }
};

export const SPORT_EMOJI = {
  basketball: '🏀',
  football_am: '🏈',
  baseball: '⚾',
  hockey: '🏒',
  soccer: '⚽',
  friendly: '🤝',
  tennis: '🎾',
  mma: '🥊',
  golf: '⛳',
  motorsport: '🏎',
  default: '🏆',
};
