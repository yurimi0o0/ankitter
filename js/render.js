// DOM rendering for timeline posts. Pure-ish: builds/updates nodes, all
// interaction is wired via data-action attributes and handled by app.js
// through event delegation.

const ICONS = {
  comment: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  retweet: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="heart-path"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="7"/><line x1="18" y1="20" x2="18" y2="10"/></svg>',
};

function countText(n) {
  return n > 0 ? String(n) : '';
}

function hashHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function linkifyTags(tags) {
  if (!tags || tags.length === 0) return '';
  return `<div class="post-tags">${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>`;
}

// .trim() matters here: this can be interpolated directly inside
// .post-answer, which is white-space: pre-wrap (to preserve the answer's
// own line breaks) — a stray leading/trailing newline would render as a
// visible blank line there.
function mediaImagesHtml(images, className = 'inline-image-grid') {
  if (!images || images.length === 0) return '';
  return `
    <div class="${className}">
      ${images.map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`).join('')}
    </div>`.trim();
}

function attachImageFallback(root) {
  root.querySelectorAll('.inline-image-grid img').forEach((img) => {
    img.addEventListener('error', () => {
      img.closest('.inline-image-grid')?.classList.add('has-broken-image');
      img.remove();
    });
  });
}

function commentItemHtml(comment) {
  return `
    <li class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-content">
        <div class="comment-text">${escapeHtml(comment.text)}</div>
      </div>
      <div class="comment-actions">
        <button type="button" class="comment-menu-toggle" data-action="comment-menu-toggle" aria-label="コメントの操作メニュー" aria-expanded="false">⋮</button>
        <div class="comment-menu" hidden>
          <button type="button" class="link-btn" data-action="comment-edit">編集</button>
          <button type="button" class="link-btn danger" data-action="comment-delete">削除</button>
        </div>
      </div>
    </li>`;
}

export function commentsSectionHtml(tsvComment, userComments) {
  const tsvHtml = tsvComment
    ? `<div class="comment-item comment-tsv"><span class="comment-badge">元コメント</span><div class="comment-text">${escapeHtml(tsvComment)}</div></div>`
    : '';
  const userHtml = userComments.map(commentItemHtml).join('');
  return `
    <div class="post-comments">
      <ul class="comment-list">${tsvHtml}${userHtml}</ul>
      <form class="comment-form" data-action="comment-submit">
        <input type="text" class="comment-input" placeholder="コメントを追加..." maxlength="500" />
        <button type="submit" class="comment-submit-btn">投稿</button>
      </form>
    </div>`;
}

// Media-attachment block: whenever a card has supplementary fields (comment/
// tag/other non-Q&A columns), it's attached to the same interactive post —
// like a photo tweet — rather than shown as a separate teaser post. The
// presentation (a few compact tiles vs. one big pull-quote) is re-rolled
// each time the card renders, purely for visual variety.
function fieldTileHtml(field) {
  return `
    <section class="post-attachment-field">
      <div class="post-attachment-label">${escapeHtml(field.label)}</div>
      ${field.text ? `<p>${escapeHtml(field.text)}</p>` : ''}
      ${mediaImagesHtml(field.images, 'inline-image-grid post-attachment-images-small')}
    </section>`;
}

function quoteAttachmentHtml(field) {
  return `<p class="post-attachment-quote-text">${escapeHtml(field.text || field.label)}</p>${mediaImagesHtml(field.images, 'inline-image-grid post-attachment-quote-images')}`;
}

const ATTACHMENT_CHANCE = 0.25; // most posts stay plain text; this is a rare accent, not the default look

function attachmentHtml(card, tsvComment) {
  // A comment-role column can double as a mediaField; when its text is
  // identical to the TSV comment already shown in 元コメント, suppress just
  // the duplicate text (not the whole field) so any images it carries still
  // show up — 元コメント only ever renders plain text, never images.
  const fields = (card.mediaFields || [])
    .map((f) => (tsvComment && f.text === tsvComment ? { ...f, text: '' } : f))
    .filter((f) => f.text || (f.images && f.images.length));
  if (fields.length === 0 || Math.random() >= ATTACHMENT_CHANCE) return '';
  const variant = Math.random() < 0.5 ? 'fields' : 'quote';
  if (variant === 'quote') {
    const top = fields[0];
    return `
      <div class="post-attachment post-attachment-quote">
        ${quoteAttachmentHtml(top)}
      </div>`;
  }
  return `
    <div class="post-attachment post-attachment-fields">
      ${fields.slice(0, 4).map(fieldTileHtml).join('')}
    </div>`;
}

// Derives a stable "覚えた実感" percentage from real per-card data only (no
// fabricated crowd stats): a liked card sits in a high band, an unliked one
// climbs slowly with view count. The per-card jitter is a hash, not
// Math.random(), so the number stays the same every time the card is shown.
export function computeConfidence(stats, liked, cardId) {
  const jitter = hashHue(cardId) % 20;
  if (liked) return Math.min(95, 70 + jitter);
  return Math.min(55, Math.round(Math.min(stats.impressions || 0, 12) * 4));
}

// .trim() for the same reason as mediaImagesHtml above.
function gaugeHtml(percent) {
  return `
    <div class="confidence-gauge">
      <div class="confidence-gauge-track"><div class="confidence-gauge-fill" style="width:${percent}%"></div></div>
      <span class="confidence-gauge-label">覚えた実感 ${percent}%</span>
    </div>`.trim();
}

function avatarHtml(source, hue, initial) {
  if (source && source.icon) {
    if (source.icon.startsWith('data:')) {
      return `<div class="avatar avatar-img"><img src="${source.icon}" alt="" /></div>`;
    }
    return `<div class="avatar" style="background: hsl(${hue} 70% 45%)">${escapeHtml(source.icon)}</div>`;
  }
  return `<div class="avatar" style="background: hsl(${hue} 70% 45%)">${escapeHtml(initial)}</div>`;
}

export function createPostElement({ card, source, isRetweet, isBookmark, liked, rtPending, bmPending, tsvComment, userComments, answerMode, stats, gauge }) {
  const s = stats || { impressions: 0, likes: 0, retweets: 0, bookmarks: 0 };
  const article = document.createElement('article');
  article.className = 'post';
  article.dataset.cardId = card.id;
  article.dataset.likeActive = 'false';
  article.dataset.retweetActive = 'false';
  article.dataset.bookmarkActive = 'false';

  const hue = hashHue(source ? source.handle : 'deck');
  const initial = (source ? source.displayName : '?').charAt(0).toUpperCase();
  const answerBlurClass = answerMode === 'blur' ? ' blurred' : '';
  const hasImages = (card.questionImages?.length || 0) + (card.answerImages?.length || 0) > 0;
  const emphasizeImages = hasImages && Math.random() < 0.4;
  const imageGridClass = `inline-image-grid${emphasizeImages ? ' emphasized' : ''}`;

  article.innerHTML = `
    ${isRetweet ? `<div class="retweet-flag">${ICONS.retweet} もう一度</div>` : ''}
    ${isBookmark ? `<div class="retweet-flag">${ICONS.bookmark} 保存から</div>` : ''}
    <div class="post-row">
      ${avatarHtml(source, hue, initial)}
      <div class="post-body">
        <div class="post-header">
          <span class="display-name">${escapeHtml(source ? source.displayName : '')}</span>
          <span class="handle">@${escapeHtml(source ? source.handle : '')}</span>
        </div>
        <div class="post-question">${escapeHtml(card.question)}</div>
        ${mediaImagesHtml(card.questionImages, imageGridClass)}
        <div class="post-answer${answerBlurClass}" data-action="reveal-answer"><span class="answer-text">${escapeHtml(card.answer)}</span>${mediaImagesHtml(card.answerImages, `${imageGridClass} answer-media`)}${gauge ? gaugeHtml(gauge.percent) : ''}<span class="answer-hint">タップして答えを表示</span></div>
        ${attachmentHtml(card, tsvComment)}
        ${linkifyTags(card.tags)}
        ${commentsSectionHtml(tsvComment, userComments)}
        <div class="post-actions">
          <button type="button" class="action-btn action-comment" data-action="toggle-comments" aria-label="コメント">
            <span class="icon">${ICONS.comment}</span><span class="count">${countText(userComments.length)}</span>
          </button>
          <button type="button" class="action-btn action-retweet" data-action="retweet" aria-label="すぐまた見る">
            <span class="icon">${ICONS.retweet}</span><span class="count">${countText(s.retweets)}</span>
          </button>
          <button type="button" class="action-btn action-like" data-action="like" aria-label="覚えた">
            <span class="icon">${ICONS.heart}</span><span class="count">${countText(s.likes)}</span>
          </button>
          <div class="action-btn action-stat" aria-label="表示回数">
            <span class="icon">${ICONS.chart}</span><span class="count">${countText(s.impressions)}</span>
          </div>
          <button type="button" class="action-btn action-bookmark" data-action="bookmark" aria-label="後で見返す">
            <span class="icon">${ICONS.bookmark}</span><span class="count">${countText(s.bookmarks)}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  article.querySelector('.post-comments').classList.add('collapsed');
  attachImageFallback(article);

  // Reflect the card's actual state (from DB) on the freshly-built DOM.
  // Without this, a card that resurfaces (RT reinsertion, a due bookmark,
  // a repeat in a small deck) would render as unliked/inactive even though
  // it's still liked/pending, and the next tap would double-count it.
  // (Uses the silent setter, not setLikeButtonState, so the "just liked"
  // pop animation only ever plays in response to an actual tap.)
  applyLikeState(article, !!liked);
  setRetweetButtonState(article, !!rtPending);
  setBookmarkButtonState(article, !!bmPending);

  return article;
}

// Card-less "recap" post: real aggregate stats across the whole deck,
// shown periodically. Has no cardId and no action bar (there's nothing on
// it to like/retweet/bookmark), so it never enters forEachCardCopy sync.
export function createRecapPostElement({ data }) {
  const article = document.createElement('article');
  article.className = 'post recap-post';

  const tiles = [
    { icon: ICONS.chart, label: '今週の表示', value: data.weeklyViews },
    { icon: ICONS.heart, label: 'いいね', value: data.likeCount },
    { icon: ICONS.bookmark, label: '保存', value: data.bookmarkCount },
  ];

  article.innerHTML = `
    <div class="post-row">
      <div class="avatar recap-avatar">📊</div>
      <div class="post-body">
        <div class="post-header">
          <span class="display-name">学習レポート</span>
        </div>
        <div class="recap-card">
          <div class="recap-card-kicker">あなたの記録</div>
          <div class="recap-card-tiles">
            ${tiles
              .map(
                (t) => `
              <div class="recap-tile">
                <span class="recap-tile-icon">${t.icon}</span>
                <span class="recap-tile-value">${t.value}</span>
                <span class="recap-tile-label">${escapeHtml(t.label)}</span>
              </div>`
              )
              .join('')}
          </div>
          <div class="recap-card-footnote">累計表示回数 ${data.totalImpressions}回</div>
        </div>
      </div>
    </div>`;

  return article;
}

function applyLikeState(article, liked) {
  article.dataset.likeActive = String(liked);
  article.querySelector('.action-like')?.classList.toggle('liked', liked);
}

export function setLikeButtonState(article, liked) {
  applyLikeState(article, liked);
  if (liked) {
    // retrigger the pop animation (tap feedback only, not initial render)
    const btn = article.querySelector('.action-like');
    if (!btn) return;
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
}

export function setRetweetButtonState(article, pending) {
  article.dataset.retweetActive = String(pending);
  article.querySelector('.action-retweet')?.classList.toggle('active', pending);
}

export function setBookmarkButtonState(article, pending) {
  article.dataset.bookmarkActive = String(pending);
  article.querySelector('.action-bookmark')?.classList.toggle('active', pending);
}

export function bumpCommentCount(article, delta) {
  const el = article.querySelector('.action-comment .count');
  const current = parseInt(el.textContent, 10) || 0;
  el.textContent = countText(Math.max(0, current + delta));
}

// Sets the numeric count on one action (e.g. '.action-like') to an absolute value.
export function setActionCount(article, actionClass, n) {
  const el = article.querySelector(`.${actionClass} .count`);
  if (el) el.textContent = countText(n);
}
