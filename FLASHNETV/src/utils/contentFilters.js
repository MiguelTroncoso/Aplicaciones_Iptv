const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const RECENTLY_ADDED_MS = 14 * 24 * 60 * 60 * 1000;

export const SORT_OPTIONS = [
  { key: 'server', label: 'Servidor' },
  { key: 'recent', label: 'Recientes' },
  { key: 'rating', label: 'Rating' },
  { key: 'az', label: 'A-Z' },
  { key: 'za', label: 'Z-A' },
  { key: 'year', label: 'Año' },
];

export const getRaw = (item) => item?.raw || item || {};

export const getTitle = (item) => String(getRaw(item).name || getRaw(item).title || '').trim();

export const getRating = (item) => {
  const raw = getRaw(item);
  const value = parseFloat(raw.rating || raw.info?.rating || 0);
  return Number.isFinite(value) ? value : 0;
};

export const getYear = (item) => {
  const raw = getRaw(item);
  const fromRelease = String(raw.releaseDate || raw.release_date || raw.releasedate || raw.info?.releasedate || '').match(/(19|20)\d{2}/)?.[0];
  const value = parseInt(raw.year || raw.info?.year || fromRelease || 0, 10);
  return Number.isFinite(value) ? value : 0;
};

export const getAddedTimestamp = (item) => {
  const raw = getRaw(item);
  const added = parseInt(raw.added || raw.info?.added || 0, 10);
  return Number.isFinite(added) ? added : 0;
};

export const isNewRelease = (item) => {
  const year = getYear(item);
  const currentYear = new Date().getFullYear();
  if (year >= currentYear - 1 && year > 2000) return true;
  const added = getAddedTimestamp(item);
  return added > 0 && (Date.now() - added * 1000) < ONE_YEAR_MS;
};

export const isRecentlyAdded = (item, days = 14) => {
  const added = getAddedTimestamp(item);
  if (added <= 0) return false;
  return (Date.now() - added * 1000) < days * 24 * 60 * 60 * 1000;
};

export const sortContent = (items = [], sortKey = 'server') => {
  const arr = [...(items || [])];
  switch (sortKey) {
    case 'az':
      return arr.sort((a, b) => getTitle(a).localeCompare(getTitle(b), 'es', { sensitivity: 'base' }));
    case 'za':
      return arr.sort((a, b) => getTitle(b).localeCompare(getTitle(a), 'es', { sensitivity: 'base' }));
    case 'rating':
      return arr.sort((a, b) => getRating(b) - getRating(a));
    case 'year':
      return arr.sort((a, b) => getYear(b) - getYear(a));
    case 'recent':
      return arr.sort((a, b) => getAddedTimestamp(b) - getAddedTimestamp(a));
    case 'server':
    default:
      return arr;
  }
};

export const getRecentlyAdded = (items = [], limit = 20, days = 14) => {
  const recents = (items || []).filter((item) => isRecentlyAdded(item, days));
  const sorted = sortContent(recents, 'recent');
  if (sorted.length >= Math.min(limit, 6)) return sorted.slice(0, limit);
  // Fallback: si el servidor no trae suficientes timestamps nuevos, mostrar los más nuevos por added.
  return sortContent(items || [], 'recent').filter(item => getAddedTimestamp(item) > 0).slice(0, limit);
};
