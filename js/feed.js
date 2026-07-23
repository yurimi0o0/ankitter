// Feed ordering engine. Decides what card to show next: normal shuffled
// rotation, plus:
//   ♡ 覚えた   — SUPPRESSED for ~7 days after the like (shown less), then
//                 returns to normal rotation.
//   🔁 RT      — reinserted once, ~10 posts after the tap (in-session).
//   🔖 保存    — resurfaces once near the front, ~24 hours after the tap.
//   学習レポート — a card-less recap entry inserted periodically.
//
// Media attachments, image emphasis, and the "覚えた実感" gauge are no
// longer scheduled here — they're per-card real data, so render.js/app.js
// decide them at render time for whichever card the cycle already picked.

import * as repo from './repo.js';

const LIKE_SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000; // ♡: hide from rotation this long
const BOOKMARK_DELAY_MS = 24 * 60 * 60 * 1000;    // 🔖 保存: resurface after ~1 day
const RETWEET_DELAY_POSTS = 10;                    // 🔁 RT: reinsert after ~10 posts
const PRIORITY_SPREAD = 4; // 1 priority card every (spread+1) posts near the front
const RECAP_MIN_GAP = 40;
const RECAP_MAX_GAP = 60;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function interleaveFront(priority, rest, spread) {
  const result = [];
  let pi = 0;
  let ri = 0;
  while (pi < priority.length || ri < rest.length) {
    if (pi < priority.length) result.push(priority[pi++]);
    for (let k = 0; k < spread && ri < rest.length; k++) result.push(rest[ri++]);
  }
  return result;
}

function randomRecapGap() {
  return RECAP_MIN_GAP + Math.floor(Math.random() * (RECAP_MAX_GAP - RECAP_MIN_GAP + 1));
}

export class FeedEngine {
  constructor(cards) {
    this.setCards(cards);
    this.cycleQueue = []; // [{ cardId, kind: 'normal' | 'bm' }]
    this.pendingRetweets = []; // [{ id, cardId, remaining }] — post-count countdown
    this.activeBookmarks = new Map(); // cardId -> db id (waiting for their 24h)
    this.recapCountdown = randomRecapGap();
  }

  static async create() {
    const cards = await repo.getAllCards();
    const engine = new FeedEngine(cards);
    const [retweets, bookmarks] = await Promise.all([repo.getAllRetweets(), repo.getAllBookmarks()]);
    engine.pendingRetweets = retweets.map((r) => ({ id: r.id, cardId: r.cardId, remaining: r.remaining }));
    for (const b of bookmarks) engine.activeBookmarks.set(b.cardId, b.id);
    return engine;
  }

  setCards(cards) {
    this.allCardIds = cards.map((c) => c.id);
  }

  setCardIds(cardIds) {
    this.allCardIds = cardIds;
    // Drop anything mid-cycle that no longer exists (deleted deck etc).
    const valid = new Set(cardIds);
    this.cycleQueue = this.cycleQueue.filter((e) => valid.has(e.cardId));
    this.pendingRetweets = this.pendingRetweets.filter((r) => valid.has(r.cardId));
    for (const cardId of this.activeBookmarks.keys()) {
      if (!valid.has(cardId)) this.activeBookmarks.delete(cardId);
    }
  }

  hasCards() {
    return this.allCardIds.length > 0;
  }

  async buildCycle() {
    if (this.allCardIds.length === 0) {
      this.cycleQueue = [];
      return;
    }
    const now = Date.now();
    const [likes, bookmarks] = await Promise.all([repo.getAllLikes(), repo.getAllBookmarks()]);
    const validIds = new Set(this.allCardIds);

    // Bookmarks past their 24h resurface near the front (one appearance).
    const dueBms = bookmarks.filter((b) => validIds.has(b.cardId) && now - b.savedAt >= BOOKMARK_DELAY_MS);
    const dueBmIds = new Set(dueBms.map((b) => b.cardId));

    // Recently-liked ("覚えた") cards are suppressed from rotation for a week.
    const suppressed = new Set(
      likes.filter((l) => validIds.has(l.cardId) && now - l.likedAt < LIKE_SUPPRESS_MS).map((l) => l.cardId)
    );

    let restIds = this.allCardIds.filter((id) => !suppressed.has(id) && !dueBmIds.has(id));
    // If everything is suppressed, fall back to showing them anyway so the
    // infinite feed never runs dry.
    if (restIds.length === 0) {
      restIds = this.allCardIds.filter((id) => !dueBmIds.has(id));
    }

    const priority = shuffle(dueBms.map((b) => ({ cardId: b.cardId, kind: 'bm' })));
    const rest = shuffle(restIds.map((cardId) => ({ cardId, kind: 'normal' })));

    this.cycleQueue = interleaveFront(priority, rest, PRIORITY_SPREAD);
  }

  // ---- Retweet (~10 posts, one-shot, in-session) ----

  isRetweetPending(cardId) {
    return this.pendingRetweets.some((r) => r.cardId === cardId);
  }

  async addRetweet(cardId) {
    const dbId = await repo.addRetweet(cardId, RETWEET_DELAY_POSTS);
    this.pendingRetweets.push({ id: dbId, cardId, remaining: RETWEET_DELAY_POSTS });
  }

  async cancelRetweet(cardId) {
    const idx = this.pendingRetweets.findIndex((r) => r.cardId === cardId);
    if (idx === -1) return;
    const [rec] = this.pendingRetweets.splice(idx, 1);
    await repo.removeRetweet(rec.id);
  }

  // ---- Bookmark (24h, one-shot) ----

  isBookmarkPending(cardId) {
    return this.activeBookmarks.has(cardId);
  }

  async addBookmark(cardId) {
    const dbId = await repo.addBookmark(cardId);
    this.activeBookmarks.set(cardId, dbId);
  }

  async cancelBookmark(cardId) {
    const dbId = this.activeBookmarks.get(cardId);
    if (dbId === undefined) return;
    this.activeBookmarks.delete(cardId);
    // Also drop a not-yet-rendered resurfaced copy from the current cycle.
    this.cycleQueue = this.cycleQueue.filter((e) => !(e.cardId === cardId && e.kind === 'bm'));
    await repo.removeBookmark(dbId);
  }

  tickRecapCountdown() {
    if (this.recapCountdown > 0) this.recapCountdown--;
  }

  // Returns up to n upcoming feed entries: { cardId, isRetweet, isBookmark, isRecap }
  async getNextBatch(n) {
    const batch = [];
    for (let i = 0; i < n; i++) {
      for (const r of this.pendingRetweets) r.remaining--;
      const dueIndex = this.pendingRetweets.findIndex((r) => r.remaining <= 0);
      if (dueIndex !== -1) {
        const [due] = this.pendingRetweets.splice(dueIndex, 1);
        repo.removeRetweet(due.id);
        batch.push({ cardId: due.cardId, isRetweet: true, isBookmark: false, isRecap: false });
        this.tickRecapCountdown();
        continue;
      }

      if (this.recapCountdown <= 0) {
        this.recapCountdown = randomRecapGap();
        batch.push({ cardId: null, isRetweet: false, isBookmark: false, isRecap: true });
        continue;
      }

      if (this.cycleQueue.length === 0) {
        await this.buildCycle();
      }
      if (this.cycleQueue.length === 0) break; // no cards to show at all
      const entry = this.cycleQueue.shift();
      const isBookmark = entry.kind === 'bm';
      if (isBookmark) {
        // The 24h reservation is fulfilled by this appearance.
        const dbId = this.activeBookmarks.get(entry.cardId);
        this.activeBookmarks.delete(entry.cardId);
        if (dbId !== undefined) repo.removeBookmark(dbId);
      }
      batch.push({ cardId: entry.cardId, isRetweet: false, isBookmark, isRecap: false });
      this.tickRecapCountdown();
    }
    return batch;
  }
}
