// Builds the "upload TSV + assign columns" UI. Renders into any container
// element so it can be reused for first-run onboarding, adding a new deck,
// and re-mapping an existing deck's columns.

import { parseTSV, ROLES, ROLE_LABELS, nameFromFileName } from './tsv.js';

const ROLE_OPTIONS = [ROLES.QUESTION, ROLES.ANSWER, ROLES.COMMENT, ROLES.TAG, ROLES.IGNORE];
const PREVIEW_ROW_COUNT = 3;

function guessDefaultMapping(columnCount) {
  const mapping = new Array(columnCount).fill(ROLES.IGNORE);
  if (columnCount > 0) mapping[0] = ROLES.QUESTION;
  if (columnCount > 1) mapping[1] = ROLES.ANSWER;
  if (columnCount > 2) mapping[2] = ROLES.COMMENT;
  return mapping;
}

function defaultMediaColumns(columnCount) {
  return new Array(columnCount).fill(true);
}

function normalizeMediaColumns(state) {
  return Array.from({ length: state.columnCount }, (_, i) => state.mapping[i] !== ROLES.QUESTION && state.mapping[i] !== ROLES.ANSWER && state.mediaColumns[i] !== false);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// state: { fileName, rawText, rows, columnCount, mapping, displayName, handle, mediaEnabled, mediaColumns }
function renderStep(container, state, handlers) {
  if (!state.rawText) {
    container.innerHTML = `
      <div class="import-step">
        <p class="import-help">Ankiなどから書き出したTSV（タブ区切り）ファイルを選んでください。</p>
        <label class="file-drop">
          <input type="file" accept=".tsv,.txt,.csv,text/tab-separated-values,text/plain" class="file-input" />
          <span>ファイルを選択</span>
        </label>
      </div>`;
    container.querySelector('.file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const rawText = await readFileAsText(file);
      const { rows, columnCount } = parseTSV(rawText);
      const { displayName, handle } = nameFromFileName(file.name);
      handlers.onFileLoaded({
        fileName: file.name,
        rawText,
        rows,
        columnCount,
        mapping: guessDefaultMapping(columnCount),
        mediaEnabled: true,
        mediaColumns: defaultMediaColumns(columnCount),
        displayName,
        handle,
      });
    });
    return;
  }

  const previewRows = state.rows.slice(0, PREVIEW_ROW_COUNT);
  const columnHeaders = Array.from({ length: state.columnCount }, (_, i) => i);

  const rowsHtml = columnHeaders
    .map((colIndex) => {
      const samples = previewRows
        .map((row) => row[colIndex] || '')
        .filter(Boolean)
        .map((s) => escapeHtml(s.slice(0, 40)))
        .join(' / ');
      const options = ROLE_OPTIONS.map(
        (role) => `<option value="${role}" ${state.mapping[colIndex] === role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`
      ).join('');
      const isQuestionOrAnswer = state.mapping[colIndex] === ROLES.QUESTION || state.mapping[colIndex] === ROLES.ANSWER;
      const mediaChecked = !isQuestionOrAnswer && state.mediaColumns[colIndex] !== false;
      const mediaDisabled = !state.mediaEnabled || isQuestionOrAnswer;
      return `
        <tr>
          <td class="col-index">列${colIndex + 1}</td>
          <td class="col-preview">${samples || '<span class="muted">(空)</span>'}</td>
          <td class="col-role"><select data-col="${colIndex}">${options}</select></td>
          <td class="col-media">
            <label class="media-column-option">
              <input type="checkbox" data-media-col="${colIndex}" ${mediaChecked ? 'checked' : ''} ${mediaDisabled ? 'disabled' : ''} />
              使う
            </label>
          </td>
        </tr>`;
    })
    .join('');

  container.innerHTML = `
    <div class="import-step">
      <div class="field-row">
        <label>表示名</label>
        <input type="text" class="display-name-input" value="${escapeHtml(state.displayName)}" maxlength="40" />
      </div>
      <div class="field-row">
        <label>@アカウント名</label>
        <input type="text" class="handle-input" value="${escapeHtml(state.handle)}" maxlength="40" />
      </div>
      <p class="import-help">各列の役割を選んでください（${state.rows.length}行を検出）</p>
      <label class="media-toggle">
        <input type="checkbox" class="media-enabled-input" ${state.mediaEnabled ? 'checked' : ''} />
        <span>
          <strong>メディアカードを作成する</strong>
          <small>チェックした補足列だけを、10〜15投稿に1回程度のカードに使います。</small>
        </span>
      </label>
      <div class="mapping-table-wrap">
        <table class="mapping-table">
          <thead><tr><th></th><th>プレビュー</th><th>役割</th><th>メディア</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="import-actions">
        ${state.allowCancel ? '<button type="button" class="btn-secondary" data-action="cancel">キャンセル</button>' : ''}
        <button type="button" class="btn-primary" data-action="save">${escapeHtml(state.saveLabel || '保存してはじめる')}</button>
      </div>
    </div>`;

  container.querySelector('.display-name-input').addEventListener('input', (e) => {
    state.displayName = e.target.value;
  });
  container.querySelector('.handle-input').addEventListener('input', (e) => {
    state.handle = e.target.value.replace(/^@/, '');
  });
  container.querySelector('.media-enabled-input').addEventListener('change', (e) => {
    state.mediaEnabled = e.target.checked;
    renderStep(container, state, handlers);
  });
  container.querySelectorAll('select[data-col]').forEach((select) => {
    select.addEventListener('change', (e) => {
      const col = parseInt(e.target.dataset.col, 10);
      state.mapping[col] = e.target.value;
      renderStep(container, state, handlers);
    });
  });
  container.querySelectorAll('input[data-media-col]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const col = parseInt(e.target.dataset.mediaCol, 10);
      state.mediaColumns[col] = e.target.checked;
    });
  });
  container.querySelector('[data-action="save"]').addEventListener('click', () => {
    if (!state.mapping.includes(ROLES.QUESTION) || !state.mapping.includes(ROLES.ANSWER)) {
      alert('「問題」と「答え」の列を1つずつ指定してください。');
      return;
    }
    if (!state.displayName.trim() || !state.handle.trim()) {
      alert('表示名と@アカウント名を入力してください。');
      return;
    }
    handlers.onSave({
      fileName: state.fileName,
      rawText: state.rawText,
      mapping: state.mapping,
      displayName: state.displayName.trim(),
      handle: state.handle.trim().replace(/\s+/g, '_'),
      mediaEnabled: state.mediaEnabled,
      mediaColumns: normalizeMediaColumns(state),
    });
  });
  const cancelBtn = container.querySelector('[data-action="cancel"]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => handlers.onCancel && handlers.onCancel());
}

// Mounts the full add-new-deck flow into `container`.
// options: { allowCancel, onSave(payload), onCancel() }
export function mountImportFlow(container, options = {}) {
  const state = { rawText: null, allowCancel: !!options.allowCancel, saveLabel: '保存してはじめる', mediaEnabled: true, mediaColumns: [] };
  renderStep(container, state, {
    onFileLoaded: (loaded) => {
      Object.assign(state, loaded);
      renderStep(container, state, {
        onSave: options.onSave,
        onCancel: options.onCancel,
      });
    },
  });
}

// Mounts the edit/remap flow (skips file picking) for an existing source.
// options: { source, onSave(payload), onCancel() }
export function mountRemapFlow(container, options = {}) {
  const { source } = options;
  const { rows, columnCount } = parseTSV(source.rawText);
  const state = {
    fileName: source.fileName,
    rawText: source.rawText,
    rows,
    columnCount,
    mapping: source.mapping.slice(),
    displayName: source.displayName,
    handle: source.handle,
    mediaEnabled: source.mediaEnabled !== false,
    mediaColumns: source.mediaColumns || defaultMediaColumns(columnCount),
    allowCancel: true,
    saveLabel: '保存',
  };
  renderStep(container, state, {
    onSave: options.onSave,
    onCancel: options.onCancel,
  });
}
