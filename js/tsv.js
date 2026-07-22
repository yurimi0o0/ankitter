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

import { buildMediaFields, extractImageSources, textWithoutImageSources } from './media.js';

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
export function rowsToCards(sourceId, rows, mapping, mediaSettings) {
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
    const mediaFields = buildMediaFields(row, mapping, mediaSettings);
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
