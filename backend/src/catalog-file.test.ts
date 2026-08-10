import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadCatalog } from './catalog-file.js';

test('rejects a malformed catalog before seeding SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-test-'));
  const path = join(directory, 'catalog.json');
  try {
    writeFileSync(path, JSON.stringify({ patterns: [], forms: [], version: 1 }));
    assert.throws(() => loadCatalog(path), /catalog/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
