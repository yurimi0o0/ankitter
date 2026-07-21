// JSON export/import helpers (file download + parsing only; DB work lives
// in repo.js).

import * as repo from './repo.js';

export async function downloadBackup() {
  const backup = await repo.exportAllData();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ankitter-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function restoreBackupFromFile(file) {
  const text = await file.text();
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (e) {
    throw new Error('JSONの読み込みに失敗しました');
  }
  await repo.importAllData(backup);
}
