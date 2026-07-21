// Renders the settings dialog contents and wires its controls.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// handlers: {
//   getSettings(), setDarkMode(v), setAnswerMode(v),
//   getSources(), openAddSource(), openRemapSource(source), deleteSource(source),
//   exportBackup(), importBackup(file),
// }
export function renderSettingsPanel(container, handlers) {
  const settings = handlers.getSettings();
  const sources = handlers.getSources();

  container.innerHTML = `
    <section class="settings-section">
      <h3>表示</h3>
      <div class="field-row">
        <label for="setting-dark-mode">ダークモード</label>
        <select id="setting-dark-mode">
          <option value="system" ${settings.darkMode === 'system' ? 'selected' : ''}>端末の設定に従う</option>
          <option value="on" ${settings.darkMode === 'on' ? 'selected' : ''}>常にダーク</option>
          <option value="off" ${settings.darkMode === 'off' ? 'selected' : ''}>常にライト</option>
        </select>
      </div>
      <div class="field-row field-row-radio">
        <label>答えの表示方法</label>
        <div class="radio-group">
          <label class="radio-option">
            <input type="radio" name="answer-mode" value="inline" ${settings.answerMode === 'inline' ? 'checked' : ''} />
            問題と同時表示
          </label>
          <label class="radio-option">
            <input type="radio" name="answer-mode" value="blur" ${settings.answerMode === 'blur' ? 'checked' : ''} />
            ぼかしてタップ表示
          </label>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3>TSV</h3>
      <ul class="source-list">
        ${sources
          .map(
            (s) => `
          <li class="source-item" data-source-id="${s.id}">
            <div class="source-info">
              <div class="source-name">${escapeHtml(s.displayName)} <span class="handle">@${escapeHtml(s.handle)}</span></div>
              <div class="source-meta">${escapeHtml(s.fileName)}</div>
            </div>
            <div class="source-actions">
              <label class="btn-secondary btn-sm file-drop-inline">
                アイコン
                <input type="file" accept="image/*" data-action="icon" hidden />
              </label>
              <button type="button" class="btn-secondary btn-sm" data-action="remap">列割り当て</button>
              <button type="button" class="btn-secondary btn-sm danger" data-action="delete">削除</button>
            </div>
          </li>`
          )
          .join('') || '<li class="muted">TSVが読み込まれていません</li>'}
      </ul>
      <button type="button" class="btn-primary btn-block" id="setting-add-source">＋ 新しいTSVを追加</button>
    </section>

    <section class="settings-section">
      <h3>バックアップ</h3>
      <div class="backup-actions">
        <button type="button" class="btn-secondary" id="setting-export">JSONをエクスポート</button>
        <label class="btn-secondary file-drop-inline">
          JSONをインポート
          <input type="file" accept="application/json,.json" id="setting-import" hidden />
        </label>
      </div>
    </section>
  `;

  container.querySelector('#setting-dark-mode').addEventListener('change', (e) => {
    handlers.setDarkMode(e.target.value);
  });
  container.querySelectorAll('input[name="answer-mode"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      if (e.target.checked) handlers.setAnswerMode(e.target.value);
    });
  });
  container.querySelector('#setting-add-source').addEventListener('click', () => handlers.openAddSource());
  container.querySelectorAll('.source-item').forEach((item) => {
    const sourceId = item.dataset.sourceId;
    item.querySelector('input[data-action="icon"]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const source = sources.find((s) => s.id === sourceId);
      handlers.changeSourceIcon(source, file);
      e.target.value = '';
    });
    item.querySelector('[data-action="remap"]').addEventListener('click', () => {
      const source = sources.find((s) => s.id === sourceId);
      handlers.openRemapSource(source);
    });
    item.querySelector('[data-action="delete"]').addEventListener('click', () => {
      const source = sources.find((s) => s.id === sourceId);
      if (confirm(`「${source.displayName}」を削除しますか？関連するコメントやいいねも削除されます。`)) {
        handlers.deleteSource(source);
      }
    });
  });
  container.querySelector('#setting-export').addEventListener('click', () => handlers.exportBackup());
  container.querySelector('#setting-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (confirm('インポートすると現在のデータはすべて上書きされます。よろしいですか？')) {
      handlers.importBackup(file);
    }
    e.target.value = '';
  });
}
