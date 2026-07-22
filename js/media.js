// Media-card helpers. Keep image extraction, URL safety, and media column
// defaults here so TSV parsing and import UI only orchestrate these helpers.

const ROLE_QUESTION = 'question';
const ROLE_ANSWER = 'answer';
const ROLE_COMMENT = 'comment';
const ROLE_TAG = 'tag';
const ROLE_IGNORE = 'ignore';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?[^#\s]*)?(#[^\s]*)?$/i;
const IMAGE_URL_RE = /(?:https?:\/\/|\.{0,2}\/|[A-Za-z0-9_.~-]+\/)?[A-Za-z0-9_.~/%-]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^#\s]*)?(?:#[^\s]*)?/gi;
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_RE = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i;

export function isSafeImageSrc(src) {
  const value = (src || '').trim();
  if (!value) return false;
  if (/^javascript:/i.test(value)) return false;
  if (/^data:/i.test(value)) return /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);/i.test(value);
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\/\//.test(value)) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && IMAGE_EXT_RE.test(value);
}

function unique(values) {
  return Array.from(new Set(values));
}

export function extractImageSources(text) {
  const raw = text || '';
  const fromTags = Array.from(raw.matchAll(IMG_TAG_RE)).map(([tag]) => {
    const match = tag.match(IMG_SRC_RE);
    return match ? (match[1] || match[2] || match[3] || '').trim() : '';
  });
  const fromUrls = Array.from(raw.matchAll(IMAGE_URL_RE)).map(([url]) => url.trim());
  return unique([...fromTags, ...fromUrls].filter(isSafeImageSrc));
}

export function textWithoutImageSources(text) {
  return (text || '')
    .replace(IMG_TAG_RE, ' ')
    .replace(IMAGE_URL_RE, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function mediaLabelForRole(role, colIndex) {
  if (role === ROLE_COMMENT) return 'コメント';
  if (role === ROLE_TAG) return '関連キーワード';
  return `補足 ${colIndex + 1}`;
}

export function mediaPriorityForRole(role) {
  if (role === ROLE_COMMENT) return 1;
  if (role === ROLE_TAG) return 3;
  return 2;
}

export function defaultMediaColumns(mappingOrCount) {
  const mapping = Array.isArray(mappingOrCount) ? mappingOrCount : new Array(mappingOrCount).fill(ROLE_IGNORE);
  return mapping.map((role) => role !== ROLE_QUESTION && role !== ROLE_ANSWER);
}

export function normalizeMediaSettings(settings, mappingOrCount) {
  const columnCount = Array.isArray(mappingOrCount) ? mappingOrCount.length : mappingOrCount;
  const defaults = defaultMediaColumns(mappingOrCount);
  const columns = Array.from({ length: columnCount }, (_, i) => {
    if (Array.isArray(settings?.columns) && typeof settings.columns[i] === 'boolean') return settings.columns[i];
    return defaults[i];
  });
  return {
    enabled: settings?.enabled !== false,
    columns,
  };
}

export function buildMediaFields(row, mapping, mediaSettings) {
  const settings = normalizeMediaSettings(mediaSettings, mapping);
  if (!settings.enabled) return [];

  return row
    .map((cell, colIndex) => {
      const role = mapping[colIndex] || ROLE_IGNORE;
      if (!settings.columns[colIndex] || role === ROLE_QUESTION || role === ROLE_ANSWER) return null;
      const raw = (cell || '').trim();
      if (!raw) return null;
      const text = textWithoutImageSources(raw);
      const images = extractImageSources(raw);
      if (!text && images.length === 0) return null;
      return {
        label: mediaLabelForRole(role, colIndex),
        text,
        images,
        priority: mediaPriorityForRole(role),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority);
}
