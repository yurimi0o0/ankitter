// TSV parsing helpers. Pure functions, no DB/DOM knowledge.

export const ROLES = {
  QUESTION: 'question',
  ANSWER: 'answer',
  COMMENT: 'comment',
  TAG: 'tag',
  IGNORE: 'ignore',
};

export const ROLE_LABELS = {
  [ROLES.QUESTION]: '問題',
  [ROLES.ANSWER]: '答え',
  [ROLES.COMMENT]: 'コメント',
  [ROLES.TAG]: 'タグ',
  [ROLES.IGNORE]: '無視',
};

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

// Parses raw TSV text into rows of cells. Lines starting with "#" are
// treated as Anki export metadata and skipped. Handles \r\n and \n.
export function parseTSV(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.length > 0 && !line.startsWith('#'));
  const rows = lines.map((line) => line.split('\t'));
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows, columnCount };
}

// Builds card objects from parsed rows + a column -> role mapping.
// mapping is an array where mapping[columnIndex] is one of ROLES.
export function rowsToCards(sourceId, rows, mapping) {
  const questionCol = mapping.indexOf(ROLES.QUESTION);
  const answerCol = mapping.indexOf(ROLES.ANSWER);
  const commentCol = mapping.indexOf(ROLES.COMMENT);
  const tagCols = mapping.reduce((acc, role, i) => {
    if (role === ROLES.TAG) acc.push(i);
    return acc;
  }, []);

  return rows.map((row, rowIndex) => {
    const questionRaw = questionCol >= 0 ? (row[questionCol] || '').trim() : '';
    const answerRaw = answerCol >= 0 ? (row[answerCol] || '').trim() : '';
    const commentRaw = commentCol >= 0 ? (row[commentCol] || '').trim() : '';
    const question = textWithoutImageSources(questionRaw);
    const answer = textWithoutImageSources(answerRaw);
    const tsvComment = textWithoutImageSources(commentRaw);
    const questionImages = extractImageSources(questionRaw);
    const answerImages = extractImageSources(answerRaw);
    const tags = tagCols
      .flatMap((c) => (row[c] || '').split(/[\s,]+/))
      .map((t) => t.trim())
      .filter(Boolean);
    const mediaFields = buildMediaFields(row, mapping, { questionCol, answerCol });
    return {
      id: `${sourceId}::${rowIndex}`,
      sourceId,
      question,
      answer,
      tsvComment,
      tags,
      questionImages,
      answerImages,
      mediaFields,
    };
  }).filter((card) => card.question || card.answer || card.questionImages.length || card.answerImages.length);
}

function buildMediaFields(row, mapping, { questionCol, answerCol }) {
  return row
    .map((cell, colIndex) => {
      const raw = (cell || '').trim();
      if (!raw || colIndex === questionCol || colIndex === answerCol) return null;
      const role = mapping[colIndex] || ROLES.IGNORE;
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

function mediaLabelForRole(role, colIndex) {
  if (role === ROLES.COMMENT) return 'コメント';
  if (role === ROLES.TAG) return '関連キーワード';
  return `補足 ${colIndex + 1}`;
}

function mediaPriorityForRole(role) {
  if (role === ROLES.COMMENT) return 1;
  if (role === ROLES.TAG) return 3;
  return 2;
}

// Derives a display name / handle pair from a TSV file name.
// "english.tsv" -> { displayName: "English", handle: "english" }
export function nameFromFileName(fileName) {
  const base = fileName.replace(/\.[^/.]+$/, '');
  const handle = base
    .toLowerCase()
    .replace(/[^a-z0-9_\-一-龠ぁ-んァ-ヶ]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'deck';
  const displayName = base.charAt(0).toUpperCase() + base.slice(1);
  return { displayName, handle };
}
