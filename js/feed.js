// Feed ordering engine. Decides what card to show next: normal shuffled
// rotation, plus three re-surfacing mechanics:
//   ♡ 覚えている  — resurfaces 5 days after the like (repeats each cycle)
//   🔁 リツイート — resurfaces once, 24 hours after the tap
//   🔖 保存      — reinserted once, ~10 posts after the tap

import * as repo from './repo.js';

const LIKE_DELAY_MS = 5 * 24 * 60 * 60 * 1000;
const RETWEET_DELAY_MS = 24 * 60 * 60 * 1000;
const BOOKMARK_DELAY_POSTS = 10;
const PRIORITY_SPREAD = 4; // 1 priority card every (spread+1) posts near the front

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

export class FeedEngine {
  constructor(cardIds) {
    this.allCardIds = cardIds;
    this.cycleQueue = []; // [{ cardId, kind: 'normal' | 'rt' }]
    this.pendingBookmarks = []; // [{ id, cardId, remaining }]
    this.activeRetweets = new Map(); // cardId -> db id (waiting for their 24h)
  }

  static async create() {
    const cards = await repo.getAllCards();
    const engine = new FeedEngine(cards.map((c) => c.id));
    const [bookmarks, retweets] = await Promise.all([repo.getAllBookmarks(), repo.getAllRetweets()]);
    engine.pendingBookmarks = bookmarks.map((b) => ({ id: b.id, cardId: b.cardId, remaining: b.remaining }));
    for (const r of retweets) engine.activeRetweets.set(r.cardId, r.id);
    return engine;
  }

  setCardIds(cardIds) {
    this.allCardIds = cardIds;
    // Drop anything mid-cycle that no longer exists (deleted deck etc).
    const valid = new Set(cardIds);
    this.cycleQueue = this.cycleQueue.filter((e) => valid.has(e.cardId));
    this.pendingBookmarks = this.pendingBookmarks.filter((b) => valid.has(b.cardId));
    for (const cardId of this.activeRetweets.keys()) {
      if (!valid.has(cardId)) this.activeRetweets.delete(cardId);
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
    const [likes, retweets] = await Promise.all([repo.getAllLikes(), repo.getAllRetweets()]);
    const validIds = new Set(this.allCardIds);

    const dueRts = retweets.filter(
      (r) => validIds.has(r.cardId) && now - r.retweetedAt >= RETWEET_DELAY_MS
    );
    const dueRtIds = new Set(dueRts.map((r) => r.cardId));

    const dueLikeIds = likes
      .filter((l) => validIds.has(l.cardId) && now - l.likedAt >= LIKE_DELAY_MS && !dueRtIds.has(l.cardId))
      .map((l) => l.cardId);

    const priority = shuffle([
      ...dueRts.map((r) => ({ cardId: r.cardId, kind: 'rt' })),
      ...dueLikeIds.map((cardId) => ({ cardId, kind: 'normal' })),
    ]);
    const prioritySet = new Set(priority.map((e) => e.cardId));
    const rest = shuffle(
      this.allCardIds.filter((id) => !prioritySet.has(id)).map((cardId) => ({ cardId, kind: 'normal' }))
    );

    this.cycleQueue = interleaveFront(priority, rest, PRIORITY_SPREAD);
  }

  // ---- Retweet (24h, one-shot) ----

  isRetweetPending(cardId) {
    return this.activeRetweets.has(cardId);
  }

  async addRetweet(cardId) {
    const dbId = await repo.addRetweet(cardId);
    this.activeRetweets.set(cardId, dbId);
  }

  async cancelRetweet(cardId) {
    const dbId = this.activeRetweets.get(cardId);
    if (dbId === undefined) return;
    this.activeRetweets.delete(cardId);
    // Also drop a not-yet-rendered resurfaced copy from the current cycle.
    this.cycleQueue = this.cycleQueue.filter((e) => !(e.cardId === cardId && e.kind === 'rt'));
    await repo.removeRetweet(dbId);
  }

  // ---- Bookmark (~10 posts, one-shot) ----

  isBookmarkPending(cardId) {
    return this.pendingBookmarks.some((b) => b.cardId === cardId);
  }

  async addBookmark(cardId) {
    const dbId = await repo.addBookmark(cardId, BOOKMARK_DELAY_POSTS);
    this.pendingBookmarks.push({ id: dbId, cardId, remaining: BOOKMARK_DELAY_POSTS });
  }

  async cancelBookmark(cardId) {
    const idx = this.pendingBookmarks.findIndex((b) => b.cardId === cardId);
    if (idx === -1) return;
    const [rec] = this.pendingBookmarks.splice(idx, 1);
    await repo.removeBookmark(rec.id);
  }

  // Returns up to n upcoming feed entries: { cardId, isRetweet, isBookmark }
  async getNextBatch(n) {
    const batch = [];
    for (let i = 0; i < n; i++) {
      for (const b of this.pendingBookmarks) b.remaining--;
      const dueIndex = this.pendingBookmarks.findIndex((b) => b.remaining <= 0);
      if (dueIndex !== -1) {
        const [due] = this.pendingBookmarks.splice(dueIndex, 1);
        repo.removeBookmark(due.id);
        batch.push({ cardId: due.cardId, isRetweet: false, isBookmark: true });
        continue;
      }

      if (this.cycleQueue.length === 0) {
        await this.buildCycle();
      }
      if (this.cycleQueue.length === 0) break; // no cards to show at all
      const entry = this.cycleQueue.shift();
      const isRetweet = entry.kind === 'rt';
      if (isRetweet) {
        // The 24h reservation is fulfilled by this appearance.
        const dbId = this.activeRetweets.get(entry.cardId);
        this.activeRetweets.delete(entry.cardId);
        if (dbId !== undefined) repo.removeRetweet(dbId);
      }
      batch.push({ cardId: entry.cardId, isRetweet, isBookmark: false });
    }
    return batch;
  }
}
