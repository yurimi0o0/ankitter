// App bootstrap: wires together repo (data), feed (ordering), render (DOM),
// importFlow and settingsPanel (UI flows).

import * as repo from './repo.js';
import { FeedEngine } from './feed.js';
import { createPostElement, setLikeButtonState, setRetweetButtonState, setBookmarkButtonState, setActionCount, bumpCommentCount } from './render.js';
import { mountImportFlow, mountRemapFlow } from './importFlow.js';
import { renderSettingsPanel } from './settingsPanel.js';
import { downloadBackup, restoreBackupFromFile } from './backup.js';

const BATCH_SIZE = 8;
const INITIAL_FILL_BATCHES = 2;

const el = {
  onboarding: document.getElementById('onboarding'),
  onboardingContent: document.getElementById('onboarding-content'),
  feedSection: document.getElementById('feed-section'),
  feedList: document.getElementById('feed-list'),
  feedSentinel: document.getElementById('feed-sentinel'),
  feedLoading: document.getElementById('feed-loading'),
  refreshBtn: document.getElementById('refresh-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsContent: document.getElementById('settings-content'),
  importDialog: document.getElementById('import-dialog'),
  importDialogTitle: document.getElementById('import-dialog-title'),
  importDialogContent: document.getElementById('import-dialog-content'),
};

const state = {
  settings: null,
  sourcesById: new Map(),
  cardsById: new Map(),
  feedEngine: null,
  isLoading: false,
  observer: null,
};

function applyTheme() {
  const mode = state.settings.darkMode;
  if (mode === 'on') document.documentElement.dataset.theme = 'dark';
  else if (mode === 'off') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
}

function applyAnswerModeToDOM() {
  const blur = state.settings.answerMode === 'blur';
  el.feedList.querySelectorAll('.post-answer').forEach((node) => {
    node.classList.toggle('blurred', blur);
    node.classList.remove('revealed');
  });
}

async function loadSourcesAndCards() {
  const sources = await repo.getSources();
  state.sourcesById = new Map(sources.map((s) => [s.id, s]));
  const cards = await repo.getAllCards();
  state.cardsById = new Map(cards.map((c) => [c.id, c]));
  return { sources, cards };
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function setupDialogBackdropClose(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.querySelectorAll('[data-close-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => dialog.close());
  });
}

// ---- Feed rendering ----

async function appendPost(cardId, isRetweet, isBookmark) {
  const card = state.cardsById.get(cardId);
  if (!card) return;
  const source = state.sourcesById.get(card.sourceId);
  // recordImpression bumps the impression counter and returns the full stats,
  // so we render all four counts without an extra read.
  const [liked, userComments, stats] = await Promise.all([
    repo.isLiked(cardId),
    repo.getUserComments(cardId),
    repo.recordImpression(cardId),
  ]);
  const article = createPostElement({
    card,
    source,
    isRetweet,
    isBookmark,
    liked,
    rtPending: state.feedEngine ? state.feedEngine.isRetweetPending(cardId) : false,
    bmPending: state.feedEngine ? state.feedEngine.isBookmarkPending(cardId) : false,
    tsvComment: card.tsvComment,
    userComments,
    answerMode: state.settings.answerMode,
    stats,
  });
  el.feedList.appendChild(article);
  repo.addViewHistory(cardId);
}

async function loadMore(batches = 1) {
  if (state.isLoading || !state.feedEngine) return;
  state.isLoading = true;
  el.feedLoading.hidden = false;
  try {
    let renderedAny = false;
    for (let i = 0; i < batches; i++) {
      const batch = await state.feedEngine.getNextBatch(BATCH_SIZE);
      if (batch.length === 0) break;
      for (const entry of batch) {
        await appendPost(entry.cardId, entry.isRetweet, entry.isBookmark);
        renderedAny = true;
      }
    }
    if (!renderedAny && el.feedList.children.length === 0) {
      el.feedList.innerHTML = '<div class="muted" style="padding:2rem 1rem;text-align:center;">表示できる項目がありません。設定からTSVを確認してください。</div>';
    }
  } finally {
    state.isLoading = false;
    el.feedLoading.hidden = true;
  }
}

function resetFeedDOM() {
  el.feedList.innerHTML = '';
}

async function startFeed() {
  el.onboarding.hidden = true;
  el.feedSection.hidden = false;
  state.feedEngine = await FeedEngine.create();
  resetFeedDOM();
  await loadMore(INITIAL_FILL_BATCHES);
}

// Re-shuffles the timeline from scratch and scrolls to the top. Recreating
// the engine re-reads likes / retweets / bookmarks, so anything that has
// newly become due (a 5-day-old like, a 24h retweet) resurfaces.
async function refreshTimeline() {
  if (!state.feedEngine || state.isLoading) return;
  el.refreshBtn.classList.remove('spinning');
  void el.refreshBtn.offsetWidth;
  el.refreshBtn.classList.add('spinning');
  state.feedEngine = await FeedEngine.create();
  resetFeedDOM();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await loadMore(INITIAL_FILL_BATCHES);
}

function setupInfiniteScroll() {
  state.observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore(1);
    },
    { rootMargin: '600px 0px' }
  );
  state.observer.observe(el.feedSentinel);
}

// ---- Feed action handling (event delegation) ----

function findPostContext(target) {
  const article = target.closest('.post');
  if (!article) return null;
  return { article, cardId: article.dataset.cardId };
}

// Applies fn to every rendered copy of a card (the same card can appear more
// than once in an infinite feed).
function forEachCardCopy(cardId, fn) {
  el.feedList.querySelectorAll(`.post[data-card-id="${CSS.escape(cardId)}"]`).forEach(fn);
}

function updateActionCountForAllCopies(cardId, actionClass, count) {
  forEachCardCopy(cardId, (post) => setActionCount(post, actionClass, count));
}

async function handleFeedClick(e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const ctx = findPostContext(e.target);
  if (!ctx) return;
  const { article, cardId } = ctx;
  const action = actionEl.dataset.action;

  if (action === 'reveal-answer') {
    const answerEl = article.querySelector('.post-answer');
    if (answerEl.classList.contains('blurred')) answerEl.classList.add('revealed');
    return;
  }

  if (action === 'toggle-comments') {
    const commentsSection = article.querySelector('.post-comments');
    const nowExpanded = commentsSection.classList.toggle('collapsed') === false;
    actionEl.classList.toggle('expanded', nowExpanded);
    return;
  }

  if (action === 'like') {
    const wasLiked = article.dataset.likeActive === 'true';
    const nowLiked = !wasLiked;
    const stats = await repo.changeStat(cardId, 'likes', nowLiked ? 1 : -1);
    await repo.setLikeSuppression(cardId, nowLiked);
    setLikeButtonState(article, nowLiked);
    updateActionCountForAllCopies(cardId, 'action-like', stats.likes);
    return;
  }

  if (action === 'retweet') {
    const wasRetweeted = article.dataset.retweetActive === 'true';
    const nowRetweeted = !wasRetweeted;
    if (nowRetweeted) {
      await state.feedEngine.addRetweet(cardId);
    } else {
      await state.feedEngine.cancelRetweet(cardId);
    }
    const stats = await repo.changeStat(cardId, 'retweets', nowRetweeted ? 1 : -1);
    setRetweetButtonState(article, nowRetweeted);
    updateActionCountForAllCopies(cardId, 'action-retweet', stats.retweets);
    return;
  }

  if (action === 'bookmark') {
    const wasBookmarked = article.dataset.bookmarkActive === 'true';
    const nowBookmarked = !wasBookmarked;
    if (nowBookmarked) {
      if (!state.feedEngine.isBookmarkPending(cardId)) await state.feedEngine.addBookmark(cardId);
    } else {
      await state.feedEngine.cancelBookmark(cardId);
    }
    const stats = await repo.changeStat(cardId, 'bookmarks', nowBookmarked ? 1 : -1);
    setBookmarkButtonState(article, nowBookmarked);
    updateActionCountForAllCopies(cardId, 'action-bookmark', stats.bookmarks);
    return;
  }

  if (action === 'comment-edit') {
    const item = actionEl.closest('.comment-item');
    startEditComment(item);
    return;
  }

  if (action === 'comment-delete') {
    const item = actionEl.closest('.comment-item');
    const commentId = Number(item.dataset.commentId);
    await repo.deleteUserComment(commentId);
    item.remove();
    bumpCommentCount(article, -1);
    return;
  }

  if (action === 'comment-save') {
    const item = actionEl.closest('.comment-item');
    const textarea = item.querySelector('.comment-edit-textarea');
    const text = textarea.value.trim();
    if (!text) return;
    const commentId = Number(item.dataset.commentId);
    await repo.updateUserComment(commentId, text);
    renderCommentView(item, text);
    return;
  }

  if (action === 'comment-cancel') {
    const item = actionEl.closest('.comment-item');
    renderCommentView(item, item.dataset.originalText);
    return;
  }
}

function startEditComment(item) {
  const textEl = item.querySelector('.comment-text');
  const originalText = textEl.textContent;
  item.dataset.originalText = originalText;
  item.innerHTML = `
    <textarea class="comment-edit-textarea" maxlength="500"></textarea>
    <div class="comment-edit-actions">
      <button type="button" class="link-btn" data-action="comment-save">保存</button>
      <button type="button" class="link-btn" data-action="comment-cancel">キャンセル</button>
    </div>`;
  const textarea = item.querySelector('.comment-edit-textarea');
  textarea.value = originalText;
  textarea.focus();
}

function renderCommentView(item, text) {
  item.innerHTML = `
    <div class="comment-text"></div>
    <div class="comment-actions">
      <button type="button" class="link-btn" data-action="comment-edit">編集</button>
      <button type="button" class="link-btn danger" data-action="comment-delete">削除</button>
    </div>`;
  item.querySelector('.comment-text').textContent = text;
}

async function handleFeedSubmit(e) {
  const form = e.target.closest('[data-action="comment-submit"]');
  if (!form) return;
  e.preventDefault();
  const ctx = findPostContext(e.target);
  if (!ctx) return;
  const input = form.querySelector('.comment-input');
  const text = input.value.trim();
  if (!text) return;
  const comment = await repo.addUserComment(ctx.cardId, text);
  const list = form.parentElement.querySelector('.comment-list');
  const li = document.createElement('li');
  li.className = 'comment-item';
  li.dataset.commentId = comment.id;
  renderCommentView(li, comment.text);
  list.appendChild(li);
  input.value = '';
  bumpCommentCount(ctx.article, 1);
}

// Downscales an uploaded image to a small square data URL so avatars stay
// light in IndexedDB and in the DOM.
function fileToAvatarDataUrl(file, size = 96) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('invalid image'));
    };
    img.src = url;
  });
}

// ---- Settings dialog ----

function openSettingsDialog() {
  renderSettingsDialogContent();
  el.settingsDialog.showModal();
}

function renderSettingsDialogContent() {
  renderSettingsPanel(el.settingsContent, {
    getSettings: () => state.settings,
    getSources: () => Array.from(state.sourcesById.values()).sort((a, b) => a.createdAt - b.createdAt),
    setDarkMode: async (value) => {
      state.settings.darkMode = value;
      await repo.setSetting('darkMode', value);
      applyTheme();
    },
    setAnswerMode: async (value) => {
      state.settings.answerMode = value;
      await repo.setSetting('answerMode', value);
      applyAnswerModeToDOM();
    },
    openAddSource: () => openImportDialog({ mode: 'add' }),
    changeSourceIcon: async (source, file) => {
      try {
        const dataUrl = await fileToAvatarDataUrl(file);
        await repo.updateSourceIcon(source.id, dataUrl);
        await loadSourcesAndCards();
        renderSettingsDialogContent();
        await refreshFeedForDataChange();
      } catch (err) {
        alert('画像の読み込みに失敗しました');
      }
    },
    openRemapSource: (source) => openImportDialog({ mode: 'remap', source }),
    deleteSource: async (source) => {
      await repo.deleteSource(source.id);
      await loadSourcesAndCards();
      renderSettingsDialogContent();
      await refreshFeedForDataChange();
    },
    exportBackup: () => downloadBackup(),
    importBackup: async (file) => {
      try {
        await restoreBackupFromFile(file);
        await loadSourcesAndCards();
        state.settings = await repo.getAllSettings();
        applyTheme();
        renderSettingsDialogContent();
        await refreshFeedForDataChange();
        alert('インポートが完了しました。');
      } catch (err) {
        alert('インポートに失敗しました: ' + err.message);
      }
    },
  });
}

async function refreshFeedForDataChange() {
  if (state.sourcesById.size === 0) {
    el.feedSection.hidden = true;
    el.onboarding.hidden = false;
    mountOnboarding();
    return;
  }
  el.onboarding.hidden = true;
  el.feedSection.hidden = false;

  if (state.feedEngine) {
    state.feedEngine.setCardIds(Array.from(state.cardsById.keys()));
  }
  resetFeedDOM();
  if (!state.feedEngine || !state.feedEngine.hasCards()) {
    state.feedEngine = await FeedEngine.create();
  }
  await loadMore(INITIAL_FILL_BATCHES);
}

// ---- Import dialog (add / remap) ----

function openImportDialog({ mode, source }) {
  el.importDialogTitle.textContent = mode === 'remap' ? '列割り当てを変更' : 'TSVを追加';
  el.importDialogContent.innerHTML = '';

  const onDone = async () => {
    closeDialog(el.importDialog);
    await loadSourcesAndCards();
    renderSettingsDialogContent();
    await refreshFeedForDataChange();
  };

  if (mode === 'remap') {
    mountRemapFlow(el.importDialogContent, {
      source,
      onSave: async (mapping) => {
        await repo.updateSourceMapping(source.id, mapping);
        await onDone();
      },
      onCancel: () => closeDialog(el.importDialog),
    });
  } else {
    mountImportFlow(el.importDialogContent, {
      allowCancel: true,
      onSave: async (payload) => {
        await repo.addSource(payload);
        await onDone();
      },
      onCancel: () => closeDialog(el.importDialog),
    });
  }

  el.importDialog.showModal();
}

// ---- Onboarding (first run) ----

function mountOnboarding() {
  el.onboardingContent.innerHTML = '';
  mountImportFlow(el.onboardingContent, {
    allowCancel: false,
    onSave: async (payload) => {
      await repo.addSource(payload);
      await loadSourcesAndCards();
      await startFeed();
    },
  });
}

// ---- Init ----

async function init() {
  state.settings = await repo.getAllSettings();
  applyTheme();

  const { sources } = await loadSourcesAndCards();

  el.settingsBtn.addEventListener('click', openSettingsDialog);
  el.refreshBtn.addEventListener('click', refreshTimeline);
  setupDialogBackdropClose(el.settingsDialog);
  setupDialogBackdropClose(el.importDialog);
  el.feedList.addEventListener('click', handleFeedClick);
  el.feedList.addEventListener('submit', handleFeedSubmit);
  setupInfiniteScroll();

  if (sources.length === 0) {
    el.onboarding.hidden = false;
    mountOnboarding();
  } else {
    await startFeed();
  }
}

init();
