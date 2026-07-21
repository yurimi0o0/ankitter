// Domain-level data access, built on top of db.js. This is the only module
// that other app code should talk to for persistence.

import { STORES, dbGet, dbGetAll, dbGetAllByIndex, dbPut, dbBulkPut, dbDelete, dbDeleteByIndex, dbClear, dbTrimOldest } from './db.js';
import { parseTSV, rowsToCards } from './tsv.js';

const VIEW_HISTORY_LIMIT = 3000;

function uuid() {
  return crypto.randomUUID();
}

// ---- Sources (imported TSV files) ----

export async function getSources() {
  const sources = await dbGetAll(STORES.sources);
  return sources.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getSource(id) {
  return dbGet(STORES.sources, id);
}

// Creates a source + its cards from raw TSV text and a column mapping.
export async function addSource({ fileName, displayName, handle, rawText, mapping }) {
  const id = uuid();
  const source = {
    id,
    fileName,
    displayName,
    handle,
    rawText,
    mapping,
    createdAt: Date.now(),
  };
  await dbPut(STORES.sources, source);
  await regenerateCards(source);
  return source;
}

// Re-parses a source's stored TSV with a new column mapping and replaces
// its cards. Card ids are row-index based, so existing likes/comments on
// unchanged rows survive the remap.
export async function updateSourceMapping(sourceId, mapping) {
  const source = await dbGet(STORES.sources, sourceId);
  if (!source) throw new Error('source not found');
  source.mapping = mapping;
  await dbPut(STORES.sources, source);
  await regenerateCards(source);
  return source;
}

// icon: a data: URL image or a short emoji/text string; null clears it.
export async function updateSourceIcon(sourceId, icon) {
  const source = await dbGet(STORES.sources, sourceId);
  if (!source) return;
  source.icon = icon || null;
  await dbPut(STORES.sources, source);
  return source;
}

export async function deleteSource(sourceId) {
  const cards = await dbGetAllByIndex(STORES.cards, 'sourceId', sourceId);
  for (const card of cards) {
    await dbDelete(STORES.cards, card.id);
    await dbDeleteByIndex(STORES.userComments, 'cardId', card.id);
    await dbDelete(STORES.likes, card.id);
    await dbDeleteByIndex(STORES.retweets, 'cardId', card.id);
    await dbDeleteByIndex(STORES.viewHistory, 'cardId', card.id);
  }
  await dbDelete(STORES.sources, sourceId);
}

async function regenerateCards(source) {
  const existing = await dbGetAllByIndex(STORES.cards, 'sourceId', source.id);
  for (const card of existing) await dbDelete(STORES.cards, card.id);
  const { rows } = parseTSV(source.rawText);
  const cards = rowsToCards(source.id, rows, source.mapping);
  await dbBulkPut(STORES.cards, cards);
  return cards;
}

// ---- Cards ----

export async function getAllCards() {
  return dbGetAll(STORES.cards);
}

export async function getCard(cardId) {
  return dbGet(STORES.cards, cardId);
}

// ---- User comments ----

export async function getUserComments(cardId) {
  const comments = await dbGetAllByIndex(STORES.userComments, 'cardId', cardId);
  return comments.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addUserComment(cardId, text) {
  const now = Date.now();
  const record = { cardId, text, createdAt: now, updatedAt: now };
  const id = await dbPut(STORES.userComments, record);
  return { ...record, id };
}

export async function updateUserComment(id, text) {
  const record = await dbGet(STORES.userComments, id);
  if (!record) return;
  record.text = text;
  record.updatedAt = Date.now();
  await dbPut(STORES.userComments, record);
  return record;
}

export async function deleteUserComment(id) {
  await dbDelete(STORES.userComments, id);
}

// ---- Likes ----

export async function getAllLikes() {
  return dbGetAll(STORES.likes);
}

export async function isLiked(cardId) {
  const rec = await dbGet(STORES.likes, cardId);
  return !!rec;
}

export async function setLiked(cardId, liked) {
  if (liked) {
    await dbPut(STORES.likes, { cardId, likedAt: Date.now() });
  } else {
    await dbDelete(STORES.likes, cardId);
  }
}

// ---- Retweets ----

export async function getAllRetweets() {
  return dbGetAll(STORES.retweets);
}

export async function addRetweet(cardId, remaining) {
  return dbPut(STORES.retweets, { cardId, remaining });
}

export async function updateRetweetRemaining(id, remaining) {
  const rec = await dbGet(STORES.retweets, id);
  if (!rec) return;
  rec.remaining = remaining;
  await dbPut(STORES.retweets, rec);
}

export async function removeRetweet(id) {
  await dbDelete(STORES.retweets, id);
}

// ---- View history ----

export async function addViewHistory(cardId) {
  await dbPut(STORES.viewHistory, { cardId, viewedAt: Date.now() });
  await dbTrimOldest(STORES.viewHistory, VIEW_HISTORY_LIMIT);
}

// ---- Settings (simple key/value) ----

const DEFAULT_SETTINGS = {
  darkMode: 'system', // 'system' | 'on' | 'off'
  answerMode: 'inline', // 'inline' | 'blur'
};

export async function getSetting(key) {
  const rec = await dbGet(STORES.settings, key);
  return rec ? rec.value : DEFAULT_SETTINGS[key];
}

export async function setSetting(key, value) {
  await dbPut(STORES.settings, { key, value });
}

export async function getAllSettings() {
  const rows = await dbGetAll(STORES.settings);
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

// ---- Backup (export / import everything) ----

export async function exportAllData() {
  const [sources, cards, userComments, likes, retweets, viewHistory, settings] = await Promise.all([
    dbGetAll(STORES.sources),
    dbGetAll(STORES.cards),
    dbGetAll(STORES.userComments),
    dbGetAll(STORES.likes),
    dbGetAll(STORES.retweets),
    dbGetAll(STORES.viewHistory),
    dbGetAll(STORES.settings),
  ]);
  return {
    app: 'ankitter',
    version: 1,
    exportedAt: Date.now(),
    data: { sources, cards, userComments, likes, retweets, viewHistory, settings },
  };
}

export async function importAllData(backup) {
  if (!backup || !backup.data) throw new Error('不正なバックアップファイルです');
  const { sources, cards, userComments, likes, retweets, viewHistory, settings } = backup.data;

  await Promise.all([
    dbClear(STORES.sources),
    dbClear(STORES.cards),
    dbClear(STORES.userComments),
    dbClear(STORES.likes),
    dbClear(STORES.retweets),
    dbClear(STORES.viewHistory),
    dbClear(STORES.settings),
  ]);

  await Promise.all([
    dbBulkPut(STORES.sources, sources || []),
    dbBulkPut(STORES.cards, cards || []),
    dbBulkPut(STORES.userComments, userComments || []),
    dbBulkPut(STORES.likes, likes || []),
    dbBulkPut(STORES.retweets, retweets || []),
    dbBulkPut(STORES.viewHistory, viewHistory || []),
    dbBulkPut(STORES.settings, settings || []),
  ]);
}
