// ponytail: Manual CLI moderation is the ceiling; replace it with an admin surface if strangers ever get accounts.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export function approvePhotos(sqlite: DatabaseSync, id: string | null = null): number {
  const result = id === null
    ? sqlite.prepare('UPDATE photos SET approved = 1 WHERE approved = 0 AND is_ai_placeholder = 0').run()
    : sqlite.prepare('UPDATE photos SET approved = 1 WHERE id = ? AND approved = 0 AND is_ai_placeholder = 0').run(id);
  return Number(result.changes);
}

function main(args: string[]): number {
  const [databasePath, mode, id] = args;
  const valid =
    (args.length === 1 && databasePath !== undefined) ||
    (args.length === 2 && databasePath !== undefined && mode === '--all') ||
    (args.length === 3 && databasePath !== undefined && mode === '--approve' && id !== undefined);
  if (!valid) {
    console.error('Usage: node --import tsx approve-photos.ts <path-to-sqlite-db> [--approve <id> | --all]');
    return 1;
  }
  if (!existsSync(databasePath)) {
    console.error(`Database is missing: ${databasePath}`);
    return 1;
  }

  const sqlite = new DatabaseSync(databasePath, { readOnly: mode === undefined });
  try {
    if (mode === undefined) {
      console.table(sqlite.prepare(`
        SELECT id, item_slug, visibility, uploader_handle, created_at
        FROM photos
        WHERE approved = 0 AND is_ai_placeholder = 0
        ORDER BY created_at
      `).all());
    } else {
      console.log(`Approved ${approvePhotos(sqlite, mode === '--all' ? null : id!)} photo(s).`);
    }
    return 0;
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
