// Feed ordering engine. Decides what card to show next: normal shuffled
// rotation, with liked cards resurfacing 72h+ after the like, and
// retweeted cards reinserted ~15 posts later.

import * as repo from './repo.js';

const LIKE_DELAY_MS = 72 * 60 * 60 * 1000;
const RETWEET_DELAY_POSTS = 15;
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
    this.cycleQueue = [];
    this.pendingRetweets = []; // { id, cardId, remaining }
  }

  static async create() {
    const cards = await repo.getAllCards();
    const engine = new FeedEngine(cards.map((c) => c.id));
    const retweets = await repo.getAllRetweets();
    engine.pendingRetweets = retweets.map((r) => ({ id: r.id, cardId: r.cardId, remaining: r.remaining }));
    return engine;
  }

  setCardIds(cardIds) {
    this.allCardIds = cardIds;
    // Drop anything mid-cycle that no longer exists (deleted deck etc).
    const valid = new Set(cardIds);
    this.cycleQueue = this.cycleQueue.filter((id) => valid.has(id));
    this.pendingRetweets = this.pendingRetweets.filter((r) => valid.has(r.cardId));
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
    const likes = await repo.getAllLikes();
    const validIds = new Set(this.allCardIds);
    const eligiblePriority = likes
      .filter((l) => validIds.has(l.cardId) && now - l.likedAt >= LIKE_DELAY_MS)
      .map((l) => l.cardId);

    const prioritySet = new Set(eligiblePriority);
    const rest = shuffle(this.allCardIds.filter((id) => !prioritySet.has(id)));
    const priority = shuffle(eligiblePriority);

    this.cycleQueue = interleaveFront(priority, rest, PRIORITY_SPREAD);
  }

  isRetweetPending(cardId) {
    return this.pendingRetweets.some((r) => r.cardId === cardId);
  }

  async cancelRetweet(cardId) {
    const idx = this.pendingRetweets.findIndex((r) => r.cardId === cardId);
    if (idx === -1) return;
    const [rec] = this.pendingRetweets.splice(idx, 1);
    await repo.removeRetweet(rec.id);
  }

  async addRetweet(cardId) {
    const dbId = await repo.addRetweet(cardId, RETWEET_DELAY_POSTS);
    this.pendingRetweets.push({ id: dbId, cardId, remaining: RETWEET_DELAY_POSTS });
  }

  // Returns up to n upcoming feed entries: { cardId, isRetweet }
  async getNextBatch(n) {
    const batch = [];
    for (let i = 0; i < n; i++) {
      for (const r of this.pendingRetweets) r.remaining--;
      const dueIndex = this.pendingRetweets.findIndex((r) => r.remaining <= 0);
      if (dueIndex !== -1) {
        const [due] = this.pendingRetweets.splice(dueIndex, 1);
        repo.removeRetweet(due.id);
        batch.push({ cardId: due.cardId, isRetweet: true });
        continue;
      }

      if (this.cycleQueue.length === 0) {
        await this.buildCycle();
      }
      if (this.cycleQueue.length === 0) break; // no cards to show at all
      const cardId = this.cycleQueue.shift();
      batch.push({ cardId, isRetweet: false });
    }
    return batch;
  }
}
