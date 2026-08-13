import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { approvePhotos } from './approve-photos.ts';

test('approvePhotos approves one pending collector photo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'approve-photos-test-'));
  const sqlite = new DatabaseSync(join(directory, 'photos.sqlite'));
  try {
    sqlite.exec(`
      CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        approved INTEGER NOT NULL,
        is_ai_placeholder INTEGER NOT NULL
      );
      INSERT INTO photos(id, approved, is_ai_placeholder) VALUES ('photo-1', 0, 0);
    `);

    assert.equal(approvePhotos(sqlite, 'photo-1'), 1);
    assert.equal(
      (sqlite.prepare("SELECT approved FROM photos WHERE id = 'photo-1'").get() as { approved: number }).approved,
      1,
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
