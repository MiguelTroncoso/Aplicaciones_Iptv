// Helpers visuales para nombres largos o decorados del servidor Xtream.
// No cambian IDs ni filtros; solo limpian lo que se muestra en pantalla.

const DECORATION_RE = /[★☆✦✧•●⭐️◆◇■□▪▫▸▹▶▷◀◁🔥🏆🎬📺📡🆕]+/gu;
const PREFIX_RE = /^(?:VOD|LIVE|TV|SERIES|SERIE|CINE|MOVIES?)\s*(?:\|\||\||:|-|–|—)?\s*/i;
const QUALITY_RE = /\b(4K|UHD|FHD|HD|SD|HEVC|H265|H264|1080P|720P|2160P)\b/gi;

export const toTitleCase = (value = '') => {
  const input = String(value || '').toLowerCase().trim();
  if (!input) return '';

  // Evita el bug de \b con letras acentuadas en Android/Hermes:
  // antes podía convertir "Recién" en "ReciÉN".
  return input
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part) || !part) return part;
      const [first, ...rest] = Array.from(part);
      return `${first.toLocaleUpperCase('es-ES')}${rest.join('')}`;
    })
    .join('');
};

export const cleanCategoryName = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return 'Sin categoría';

  let clean = raw
    .replace(DECORATION_RE, ' ')
    .replace(PREFIX_RE, '')
    .replace(/\s*\|\|\s*/g, ' ')
    .replace(/[|_]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(QUALITY_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '')
    .trim();

  clean = clean
    .replace(/^ESTRENOS?\s+/i, 'Estrenos ')
    .replace(/^EVENTOS?\s+EXCLUSIVOS?/i, 'Eventos exclusivos')
    .replace(/^AGENDA\s+LATINA/i, 'Agenda latina');

  if (!clean) {
    const fallback = raw.replace(/[★☆✦✧•●⭐️◆◇■□▪▫▸▹▶▷◀◁🔥🏆🎬📺📡🆕]+/gu, ' ').replace(/\s+/g, ' ').trim();
    return fallback ? toTitleCase(fallback) : 'Sin categoría';
  }

  return toTitleCase(clean);
};

export const compactCategoryName = (value = '', max = 24) => {
  const clean = cleanCategoryName(value);
  const safe = clean && clean !== 'Sin categoría' ? clean : String(value || 'Sin categoría').replace(/\s+/g, ' ').trim();
  if (safe.length <= max) return safe;
  return `${safe.slice(0, Math.max(1, max - 1)).trim()}…`;
};

export const cleanContentTitle = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return 'Sin nombre';

  let text = raw
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Limpia nombres tipo Movie.Title.2026.1080p.WEBRip sin tocar títulos normales.
  if ((text.match(/\./g) || []).length >= 3) {
    const cut = text.search(/[\s.](?:19|20)\d{2}[.\s]|[\s.](720p|1080p|2160p|4K|BRRip|BluRay|WEBRip|HDTV|DVDRip|AMZN|NF)/i);
    if (cut > 0) text = text.substring(0, cut);
    text = text.replaceAll('.', ' ').replace(/\s+/g, ' ').trim();
  }

  return text || raw;
};
