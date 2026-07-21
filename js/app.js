// App bootstrap: wires together repo (data), feed (ordering), render (DOM),
// importFlow and settingsPanel (UI flows).

import * as repo from './repo.js';
import { FeedEngine } from './feed.js';
import { createPostElement, setLikeButtonState, bumpCommentCount } from './render.js';
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

async function appendPost(cardId, isRetweet) {
  const card = state.cardsById.get(cardId);
  if (!card) return;
  const source = state.sourcesById.get(card.sourceId);
  const [liked, userComments] = await Promise.all([repo.isLiked(cardId), repo.getUserComments(cardId)]);
  const article = createPostElement({
    card,
    source,
    isRetweet,
    liked,
    tsvComment: card.tsvComment,
    userComments,
    answerMode: state.settings.answerMode,
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
        await appendPost(entry.cardId, entry.isRetweet);
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
    const nowLiked = !actionEl.classList.contains('liked');
    setLikeButtonState(article, nowLiked);
    await repo.setLiked(cardId, nowLiked);
    return;
  }

  if (action === 'retweet') {
    actionEl.classList.add('active');
    await state.feedEngine.addRetweet(cardId);
    setTimeout(() => actionEl.classList.remove('active'), 600);
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
