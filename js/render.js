// DOM rendering for timeline posts. Pure-ish: builds/updates nodes, all
// interaction is wired via data-action attributes and handled by app.js
// through event delegation.

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

export function createPostElement({ card, source, isRetweet, liked, rtPending, tsvComment, userComments, answerMode }) {
  const article = document.createElement('article');
  article.className = 'post';
  article.dataset.cardId = card.id;

  const hue = hashHue(source ? source.handle : 'deck');
  const initial = (source ? source.displayName : '?').charAt(0).toUpperCase();
  const answerBlurClass = answerMode === 'blur' ? ' blurred' : '';

  article.innerHTML = `
    ${isRetweet ? '<div class="retweet-flag">🔁 もう一度見る</div>' : ''}
    <div class="post-row">
      ${avatarHtml(source, hue, initial)}
      <div class="post-body">
        <div class="post-header">
          <span class="display-name">${escapeHtml(source ? source.displayName : '')}</span>
          <span class="handle">@${escapeHtml(source ? source.handle : '')}</span>
        </div>
        <div class="post-question">${escapeHtml(card.question)}</div>
        <div class="post-answer${answerBlurClass}" data-action="reveal-answer">
          <span class="answer-text">${escapeHtml(card.answer)}</span>
          <span class="answer-hint">タップして答えを表示</span>
        </div>
        ${linkifyTags(card.tags)}
        ${commentsSectionHtml(tsvComment, userComments)}
        <div class="post-actions">
          <button type="button" class="action-btn action-comment" data-action="toggle-comments">
            <span class="icon">💬</span><span class="count">${userComments.length}</span>
          </button>
          <button type="button" class="action-btn action-retweet${rtPending ? ' active' : ''}" data-action="retweet">
            <span class="icon">🔁</span><span class="rt-label">${rtPending ? '予約済み' : ''}</span>
          </button>
          <button type="button" class="action-btn action-like${liked ? ' liked' : ''}" data-action="like">
            <span class="icon">${liked ? '❤️' : '🤍'}</span>
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
  btn.querySelector('.icon').textContent = liked ? '❤️' : '🤍';
}

export function setRetweetButtonState(article, pending) {
  const btn = article.querySelector('.action-retweet');
  btn.classList.toggle('active', pending);
  btn.querySelector('.rt-label').textContent = pending ? '予約済み' : '';
}

export function bumpCommentCount(article, delta) {
  const el = article.querySelector('.action-comment .count');
  el.textContent = String(Math.max(0, parseInt(el.textContent, 10) + delta));
}
