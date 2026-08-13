/**
 * Local SQLite. Holds three things:
 *
 *   1. A cached copy of the catalog, so browsing and confirming a guess work with no
 *      signal. Antique malls and thrift stores are the primary scanning environment
 *      and they have terrible reception.
 *   2. The user's collection, mirrored from the server so it survives a reinstall.
 *   3. The offline scan queue.
 *
 * Photos in the queue are stored as local file URIs, never base64. A burst of three
 * frames is several megabytes; base64 in a SQLite row would balloon the database and
 * blow up memory on read. Conversion to base64 happens in api.ts at send time.
 */

import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import type {
  CatalogResponse,
  Condition,
  Form,
  Item,
  OwnershipStatus,
  Pattern,
  PhotoVisibility,
  QueuedScan,
  UserItem,
} from '@shared/types';
import { getOrCreateInstallId } from '@/features/scan/logic';

const DB_NAME = 'backstamp.db';
const INSTALL_ID_KEY = 'install_id';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let installIdPromise: Promise<string> | null = null;

function connect(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
    await migrate(db);
    return db;
  });
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS patterns (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      years_start  INTEGER,
      years_end    INTEGER,
      colorway     TEXT,
      rarity       TEXT,
      notes        TEXT
    );

    CREATE TABLE IF NOT EXISTS forms (
      id           TEXT PRIMARY KEY,
      model_no     TEXT NOT NULL,
      family       TEXT NOT NULL,
      shape        TEXT NOT NULL,
      capacity_qt  REAL,
      dimensions   TEXT
    );

    CREATE TABLE IF NOT EXISTS items (
      slug            TEXT PRIMARY KEY,
      pattern_id      TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      form_id         TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      rarity          TEXT,
      ebay_query      TEXT NOT NULL,
      provenance      TEXT NOT NULL DEFAULT 'published-reference',
      user_submitted  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_items_pattern ON items(pattern_id);

    CREATE TABLE IF NOT EXISTS user_items (
      item_slug  TEXT PRIMARY KEY,
      status     TEXT NOT NULL CHECK (status IN ('have','want')),
      quantity   INTEGER NOT NULL DEFAULT 0,
      condition  TEXT,
      notes      TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_items_status ON user_items(status);

    CREATE TABLE IF NOT EXISTS scan_queue (
      local_id      TEXT PRIMARY KEY,
      photo_uris    TEXT NOT NULL,   -- JSON array of local file URIs
      has_base_shot INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const itemColumns = await db.getAllAsync<{ name: string; notnull: number }>(
    'PRAGMA table_info(items)',
  );
  if (!itemColumns.some(({ name }) => name === 'provenance')) {
    await db.execAsync(
      "ALTER TABLE items ADD COLUMN provenance TEXT NOT NULL DEFAULT 'published-reference'",
    );
  }

  const patternColumns = await db.getAllAsync<{ name: string; notnull: number }>(
    'PRAGMA table_info(patterns)',
  );
  const rarityIsRequired =
    patternColumns.find(({ name }) => name === 'rarity')?.notnull === 1 ||
    itemColumns.find(({ name }) => name === 'rarity')?.notnull === 1;
  if (rarityIsRequired) {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    try {
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          CREATE TABLE patterns_nullable (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            years_start  INTEGER,
            years_end    INTEGER,
            colorway     TEXT,
            rarity       TEXT,
            notes        TEXT
          );
          INSERT INTO patterns_nullable SELECT * FROM patterns;

          CREATE TABLE items_nullable (
            slug            TEXT PRIMARY KEY,
            pattern_id      TEXT NOT NULL REFERENCES patterns_nullable(id) ON DELETE CASCADE,
            form_id         TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
            rarity          TEXT,
            ebay_query      TEXT NOT NULL,
            provenance      TEXT NOT NULL DEFAULT 'published-reference',
            user_submitted  INTEGER NOT NULL DEFAULT 0
          );
          INSERT INTO items_nullable(
            slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted
          )
          SELECT slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted
          FROM items;

          DROP TABLE items;
          DROP TABLE patterns;
          ALTER TABLE patterns_nullable RENAME TO patterns;
          ALTER TABLE items_nullable RENAME TO items;
          CREATE INDEX idx_items_pattern ON items(pattern_id);
        `);
        const violations = await db.getAllAsync('PRAGMA foreign_key_check');
        if (violations.length > 0) throw new Error('Rarity migration violated foreign keys');
      });
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  }
}

// ---------------------------------------------------------------- catalog

export async function getCatalogVersion(): Promise<number> {
  return Number((await getMeta('catalog_version')) ?? 0);
}

/** Replaces the cached catalog wholesale. Cheap at this size and avoids stale rows. */
export async function syncCatalog(catalog: CatalogResponse): Promise<void> {
  const db = await connect();
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM items; DELETE FROM patterns; DELETE FROM forms;');

    for (const p of catalog.patterns) {
      await db.runAsync(
        `INSERT INTO patterns (id,name,years_start,years_end,colorway,rarity,notes)
         VALUES (?,?,?,?,?,?,?)`,
        [p.id, p.name, p.yearsStart, p.yearsEnd, p.colorway, p.rarity, p.notes],
      );
    }
    for (const f of catalog.forms) {
      await db.runAsync(
        `INSERT INTO forms (id,model_no,family,shape,capacity_qt,dimensions)
         VALUES (?,?,?,?,?,?)`,
        [f.id, f.modelNo, f.family, f.shape, f.capacityQt, f.dimensions],
      );
    }
    for (const i of catalog.items) {
      await db.runAsync(
        `INSERT INTO items
           (slug,pattern_id,form_id,rarity,ebay_query,provenance,user_submitted)
         VALUES (?,?,?,?,?,?,?)`,
        [
          i.slug,
          i.patternId,
          i.formId,
          i.rarity,
          i.ebayQuery,
          i.provenance,
          i.userSubmitted ? 1 : 0,
        ],
      );
    }
    await db.runAsync(
      `INSERT INTO meta (key,value) VALUES ('catalog_version',?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(catalog.version)],
    );
  });
}

export interface CatalogRow extends Item {
  patternName: string;
  shape: string;
  modelNo: string;
  colorway: string | null;
}

/** Catalog browse and the "none of these" fallback both read through here. */
export async function searchCatalog(query = '', limit = 200): Promise<CatalogRow[]> {
  const db = await connect();
  const like = `%${query.trim()}%`;
  return db.getAllAsync<CatalogRow>(
    `SELECT i.slug, i.pattern_id AS patternId, i.form_id AS formId, i.rarity,
            i.ebay_query AS ebayQuery, i.provenance,
            i.user_submitted AS userSubmitted,
            p.name AS patternName, p.colorway, f.shape, f.model_no AS modelNo
       FROM items i
       JOIN patterns p ON p.id = i.pattern_id
       JOIN forms f    ON f.id = i.form_id
      WHERE ? = '' OR p.name LIKE ? OR f.shape LIKE ? OR f.model_no LIKE ?
      ORDER BY p.name, f.model_no
      LIMIT ?`,
    [query.trim(), like, like, like, limit],
  );
}

/** How many items the phone holds. Counts in SQLite rather than loading every row. */
export async function countCatalogItems(): Promise<number> {
  const db = await connect();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM items');
  return row?.count ?? 0;
}

export async function getPattern(id: string): Promise<Pattern | null> {
  const db = await connect();
  return db.getFirstAsync<Pattern>(
    `SELECT id, name, years_start AS yearsStart, years_end AS yearsEnd,
            colorway, rarity, notes FROM patterns WHERE id = ?`,
    [id],
  );
}

export async function getForm(id: string): Promise<Form | null> {
  const db = await connect();
  return db.getFirstAsync<Form>(
    `SELECT id, model_no AS modelNo, family, shape,
            capacity_qt AS capacityQt, dimensions FROM forms WHERE id = ?`,
    [id],
  );
}

// ---------------------------------------------------------------- collection

export async function getCollection(status?: OwnershipStatus): Promise<UserItem[]> {
  const db = await connect();
  const sql = `SELECT item_slug AS itemSlug, status, quantity, condition, notes,
                      updated_at AS updatedAt
                 FROM user_items ${status ? 'WHERE status = ?' : ''}
                ORDER BY updated_at DESC`;
  return db.getAllAsync<UserItem>(sql, status ? [status] : []);
}

export async function getUserItem(itemSlug: string): Promise<UserItem | null> {
  const db = await connect();
  return db.getFirstAsync<UserItem>(
    `SELECT item_slug AS itemSlug, status, quantity, condition, notes,
            updated_at AS updatedAt FROM user_items WHERE item_slug = ?`,
    [itemSlug],
  );
}

export async function setOwnership(
  itemSlug: string,
  status: OwnershipStatus,
  quantity: number,
  condition: Condition | null = null,
  notes: string | null = null,
): Promise<void> {
  const db = await connect();
  // A want-list entry is quantity 0 by definition; an owned entry is at least 1.
  const qty = status === 'want' ? 0 : Math.max(1, Math.trunc(quantity));
  await db.runAsync(
    `INSERT INTO user_items (item_slug,status,quantity,condition,notes,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(item_slug) DO UPDATE SET
       status = excluded.status, quantity = excluded.quantity,
       condition = excluded.condition, notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [itemSlug, status, qty, condition, notes, new Date().toISOString()],
  );
}

export async function removeFromCollection(itemSlug: string): Promise<void> {
  const db = await connect();
  await db.runAsync('DELETE FROM user_items WHERE item_slug = ?', [itemSlug]);
}

/** Server is authoritative on sign-in; this replaces the local mirror. */
export async function replaceCollection(items: UserItem[]): Promise<void> {
  const db = await connect();
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM user_items;');
    for (const u of items) {
      await db.runAsync(
        `INSERT INTO user_items (item_slug,status,quantity,condition,notes,updated_at)
         VALUES (?,?,?,?,?,?)`,
        [u.itemSlug, u.status, u.quantity, u.condition, u.notes, u.updatedAt],
      );
    }
  });
}

// ---------------------------------------------------------------- scan queue

export async function enqueueScan(
  photoUris: string[],
  hasBaseShot: boolean,
): Promise<string> {
  const db = await connect();
  const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT INTO scan_queue (local_id,photo_uris,has_base_shot,created_at,attempts)
     VALUES (?,?,?,?,0)`,
    [localId, JSON.stringify(photoUris), hasBaseShot ? 1 : 0, new Date().toISOString()],
  );
  return localId;
}

/** `photos` here are file URIs, matching what enqueueScan stored. */
export async function listQueuedScans(): Promise<QueuedScan[]> {
  const db = await connect();
  const rows = await db.getAllAsync<{
    local_id: string;
    photo_uris: string;
    has_base_shot: number;
    created_at: string;
    attempts: number;
  }>('SELECT * FROM scan_queue ORDER BY created_at ASC');

  return rows.map((r) => ({
    localId: r.local_id,
    photos: JSON.parse(r.photo_uris) as string[],
    hasBaseShot: r.has_base_shot === 1,
    createdAt: r.created_at,
    attempts: r.attempts,
  }));
}

export async function dequeueScan(localId: string): Promise<void> {
  const db = await connect();
  await db.runAsync('DELETE FROM scan_queue WHERE local_id = ?', [localId]);
}

export async function bumpScanAttempts(localId: string): Promise<void> {
  const db = await connect();
  await db.runAsync(
    'UPDATE scan_queue SET attempts = attempts + 1 WHERE local_id = ?',
    [localId],
  );
}

// ---------------------------------------------------------------- settings

export interface Settings {
  /** Opt-in, default off. Governs whether scans are kept for future training. */
  trainingOptIn: boolean;
  defaultPhotoVisibility: PhotoVisibility;
  /** Shown beside attributed photos; stored on this device and sent only with attributed uploads. */
  photoHandle: string;
  /**
   * Keep money off the shelf, for a collector who does not want it on screen.
   *
   * There is deliberately no "prefer sold comps" flag beside this one. The design
   * handoff drew that toggle, but `fetchPrices(slugs)` takes no source argument and
   * `/price/batch` returns whichever of SoldComps or eBay Browse answered, so nothing
   * could read the flag. A switch that persists a value no code consults is the same
   * class of dishonesty as an unlabelled price. Adding it for real means changing the
   * `PriceSource` interface, the route, and the cache keys.
   */
  hideValuesOnShelf: boolean;
}

const SETTINGS_DEFAULTS: Settings = {
  trainingOptIn: false,
  defaultPhotoVisibility: 'private',
  photoHandle: '',
  hideValuesOnShelf: false,
};

export async function getSettings(): Promise<Settings> {
  const raw = await getMeta('settings');
  if (!raw) return SETTINGS_DEFAULTS;
  return { ...SETTINGS_DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await setMeta('settings', JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------- meta

export async function getMeta(key: string): Promise<string | null> {
  const db = await connect();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await connect();
  await db.runAsync(
    `INSERT INTO meta (key,value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export function getInstallId(): Promise<string> {
  installIdPromise ??= getOrCreateInstallId(
    () => getMeta(INSTALL_ID_KEY),
    (value) => setMeta(INSTALL_ID_KEY, value),
    randomUUID,
  );
  return installIdPromise;
}

/** Test hook. Drops everything and reruns migrations. */
export async function resetDatabase(): Promise<void> {
  const db = await connect();
  await db.execAsync(`
    DROP TABLE IF EXISTS scan_queue;
    DROP TABLE IF EXISTS user_items;
    DROP TABLE IF EXISTS items;
    DROP TABLE IF EXISTS patterns;
    DROP TABLE IF EXISTS forms;
    DROP TABLE IF EXISTS meta;
  `);
  await migrate(db);
  installIdPromise = null;
}
