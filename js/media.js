// Media-card helpers shared by TSV parsing and import/edit UI.
// Keeping these in one module reduces merge conflicts in the high-traffic
// import and TSV files when media rules evolve.

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?[^#\s]*)?(#[^\s]*)?$/i;
const IMAGE_URL_RE = /(?:https?:\/\/|\.{0,2}\/|[A-Za-z0-9_.~-]+\/)?[A-Za-z0-9_.~/%-]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^#\s]*)?(?:#[^\s]*)?/gi;
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_RE = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i;

function isSafeImageSrc(src) {
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

export function defaultMediaColumns(columnCount) {
  return new Array(columnCount).fill(true);
}

export function normalizeMediaColumns({ columnCount, mapping, mediaColumns, questionRole, answerRole }) {
  return Array.from(
    { length: columnCount },
    (_, i) => mapping[i] !== questionRole && mapping[i] !== answerRole && mediaColumns[i] !== false
  );
}

export function extractImageSources(text) {
  const raw = text || '';
  const fromTags = Array.from(raw.matchAll(IMG_TAG_RE))
    .map(([tag]) => {
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

export function buildMediaFields(row, mapping, { questionCol, answerCol, mediaColumns, roles }) {
  return row
    .map((cell, colIndex) => {
      const raw = (cell || '').trim();
      if (!raw || colIndex === questionCol || colIndex === answerCol) return null;
      if (mediaColumns && mediaColumns[colIndex] === false) return null;
      const role = mapping[colIndex] || roles.IGNORE;
      const text = textWithoutImageSources(raw);
      const images = extractImageSources(raw);
      if (!text && images.length === 0) return null;
      return {
        label: mediaLabelForRole(role, colIndex, roles),
        text,
        images,
        priority: mediaPriorityForRole(role, roles),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority);
}

function mediaLabelForRole(role, colIndex, roles) {
  if (role === roles.COMMENT) return 'コメント';
  if (role === roles.TAG) return '関連キーワード';
  return `補足 ${colIndex + 1}`;
}

function mediaPriorityForRole(role, roles) {
  if (role === roles.COMMENT) return 1;
  if (role === roles.TAG) return 3;
  return 2;
}
