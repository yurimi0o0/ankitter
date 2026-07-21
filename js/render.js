// DOM rendering for timeline posts. Pure-ish: builds/updates nodes, all
// interaction is wired via data-action attributes and handled by app.js
// through event delegation.

const ICONS = {
  comment: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  retweet: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="heart-path"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
};

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

function commentItemHtml(comment) {
  return `
    <li class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-text">${escapeHtml(comment.text)}</div>
      <div class="comment-actions">
        <button type="button" class="link-btn" data-action="comment-edit">編集</button>
        <button type="button" class="link-btn danger" data-action="comment-delete">削除</button>
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

function avatarHtml(source, hue, initial) {
  if (source && source.icon) {
    if (source.icon.startsWith('data:')) {
      return `<div class="avatar avatar-img"><img src="${source.icon}" alt="" /></div>`;
    }
    return `<div class="avatar" style="background: hsl(${hue} 70% 45%)">${escapeHtml(source.icon)}</div>`;
  }
  return `<div class="avatar" style="background: hsl(${hue} 70% 45%)">${escapeHtml(initial)}</div>`;
}

export function createPostElement({ card, source, isRetweet, isBookmark, liked, rtPending, bmPending, tsvComment, userComments, answerMode }) {
  const article = document.createElement('article');
  article.className = 'post';
  article.dataset.cardId = card.id;

  const hue = hashHue(source ? source.handle : 'deck');
  const initial = (source ? source.displayName : '?').charAt(0).toUpperCase();
  const answerBlurClass = answerMode === 'blur' ? ' blurred' : '';

  article.innerHTML = `
    ${isRetweet ? `<div class="retweet-flag">${ICONS.retweet} 昨日のリツイート</div>` : ''}
    ${isBookmark ? `<div class="retweet-flag">${ICONS.bookmark} 保存から再表示</div>` : ''}
    <div class="post-row">
      ${avatarHtml(source, hue, initial)}
      <div class="post-body">
        <div class="post-header">
          <span class="display-name">${escapeHtml(source ? source.displayName : '')}</span>
          <span class="handle">@${escapeHtml(source ? source.handle : '')}</span>
        </div>
        <div class="post-question">${escapeHtml(card.question)}</div>
        <div class="post-answer${answerBlurClass}" data-action="reveal-answer"><span class="answer-text">${escapeHtml(card.answer)}</span><span class="answer-hint">タップして答えを表示</span></div>
        ${linkifyTags(card.tags)}
        ${commentsSectionHtml(tsvComment, userComments)}
        <div class="post-actions">
          <button type="button" class="action-btn action-comment" data-action="toggle-comments" aria-label="コメント">
            <span class="icon">${ICONS.comment}</span><span class="count">${userComments.length || ''}</span>
          </button>
          <button type="button" class="action-btn action-retweet${rtPending ? ' active' : ''}" data-action="retweet" aria-label="明日もう一度見る">
            <span class="icon">${ICONS.retweet}</span>
          </button>
          <button type="button" class="action-btn action-like${liked ? ' liked' : ''}" data-action="like" aria-label="覚えている">
            <span class="icon">${ICONS.heart}</span>
          </button>
          <button type="button" class="action-btn action-bookmark${bmPending ? ' active' : ''}" data-action="bookmark" aria-label="少し後でもう一度見る">
            <span class="icon">${ICONS.bookmark}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  article.querySelector('.post-comments').classList.add('collapsed');

  return article;
}

export function setLikeButtonState(article, liked) {
  const btn = article.querySelector('.action-like');
  btn.classList.toggle('liked', liked);
  if (liked) {
    // retrigger the pop animation
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
}

export function setRetweetButtonState(article, pending) {
  article.querySelector('.action-retweet').classList.toggle('active', pending);
}

export function setBookmarkButtonState(article, pending) {
  article.querySelector('.action-bookmark').classList.toggle('active', pending);
}

export function bumpCommentCount(article, delta) {
  const el = article.querySelector('.action-comment .count');
  const current = parseInt(el.textContent, 10) || 0;
  const next = Math.max(0, current + delta);
  el.textContent = next === 0 ? '' : String(next);
}
