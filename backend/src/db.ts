import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  CatalogResponse,
  Form,
  Item,
  OwnershipStatus,
  Pattern,
  Photo,
  PhotoVisibility,
  PriceQuote,
  Scan,
  UserItem,
} from '@shared/types.js';

interface PatternRow {
  id: string;
  name: string;
  years_start: number | null;
  years_end: number | null;
  colorway: string | null;
  rarity: Pattern['rarity'];
  notes: string | null;
}

interface FormRow {
  id: string;
  model_no: string;
  family: Form['family'];
  shape: string;
  capacity_qt: number | null;
  dimensions: string | null;
}

interface ItemRow {
  slug: string;
  pattern_id: string;
  form_id: string;
  rarity: Item['rarity'];
  ebay_query: string;
  provenance: Item['provenance'] | null;
  user_submitted: number;
}

interface PhotoRow {
  id: string;
  item_slug: string;
  visibility: PhotoVisibility;
  approved: number;
  is_ai_placeholder: number;
  uploader_handle: string | null;
  created_at: string;
}

interface PriceRow {
  source: PriceQuote['source'] | null;
  low: number | null;
  median: number | null;
  high: number | null;
  sample_size: number | null;
  fetched_at: string;
}

interface CollectionRow {
  item_slug: string;
  status: OwnershipStatus;
  quantity: number;
}

interface VersionRow {
  value: string;
}

interface CountRow {
  count: number;
}

interface TrainingScanPhotoRow {
  id: string;
  file_ref: string;
  has_base_shot: number;
  guesses_json: string;
  confirmed_item_slug: string;
  llm_was_right: number | null;
  created_at: string;
}

const patternFromRow = (row: PatternRow): Pattern => ({
  id: row.id,
  name: row.name,
  yearsStart: row.years_start,
  yearsEnd: row.years_end,
  colorway: row.colorway,
  rarity: row.rarity,
  notes: row.notes,
});

const formFromRow = (row: FormRow): Form => ({
  id: row.id,
  modelNo: row.model_no,
  family: row.family,
  shape: row.shape,
  capacityQt: row.capacity_qt,
  dimensions: row.dimensions,
});

const itemFromRow = (row: ItemRow): Item => ({
  slug: row.slug,
  patternId: row.pattern_id,
  formId: row.form_id,
  rarity: row.rarity,
  ebayQuery: row.ebay_query,
  provenance: row.provenance ?? 'published-reference',
  userSubmitted: Boolean(row.user_submitted),
});

function ebayQuery(pattern: Pattern, form: Form): string {
  const formName =
    form.family === 'cinderella-bowl'
      ? 'Cinderella bowl'
      : form.family === 'other'
        ? ''
        : form.family.replaceAll('-', ' ');
  return ['Vintage Pyrex', pattern.name, form.modelNo, formName].filter(Boolean).join(' ');
}

export class BackendDatabase {
  readonly sqlite: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO meta(key, value) VALUES ('catalog_version', '0');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('seed_version', '0');

      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        years_start INTEGER,
        years_end INTEGER,
        colorway TEXT,
        rarity TEXT,
        notes TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS forms (
        id TEXT PRIMARY KEY,
        model_no TEXT NOT NULL,
        family TEXT NOT NULL,
        shape TEXT NOT NULL,
        capacity_qt REAL,
        dimensions TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS items (
        slug TEXT PRIMARY KEY,
        pattern_id TEXT NOT NULL REFERENCES patterns(id),
        form_id TEXT NOT NULL REFERENCES forms(id),
        rarity TEXT,
        ebay_query TEXT NOT NULL,
        provenance TEXT NOT NULL,
        user_submitted INTEGER NOT NULL CHECK (user_submitted IN (0, 1))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        item_slug TEXT NOT NULL REFERENCES items(slug),
        file_ref TEXT NOT NULL UNIQUE,
        uploader_id TEXT,
        visibility TEXT NOT NULL,
        approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
        is_ai_placeholder INTEGER NOT NULL CHECK (is_ai_placeholder IN (0, 1)),
        uploader_handle TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        -- Retained for legacy rows. New writes use scan_photos and leave this NULL.
        photo_ref TEXT,
        guesses_json TEXT NOT NULL,
        confirmed_item_slug TEXT,
        llm_was_right INTEGER,
        consented_to_training INTEGER NOT NULL CHECK (consented_to_training IN (0, 1)),
        has_base_shot INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'single',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scan_photos (
        scan_id TEXT NOT NULL REFERENCES scans(id),
        ordinal INTEGER NOT NULL,
        file_ref TEXT NOT NULL,
        PRIMARY KEY (scan_id, ordinal)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS collection (
        user_id TEXT NOT NULL,
        item_slug TEXT NOT NULL REFERENCES items(slug),
        status TEXT NOT NULL CHECK (status IN ('have', 'want')),
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        PRIMARY KEY (user_id, item_slug)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scan_usage (
        key TEXT NOT NULL,
        month TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (key, month)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS price_cache (
        item_slug TEXT PRIMARY KEY REFERENCES items(slug),
        source TEXT,
        low REAL,
        median REAL,
        high REAL,
        sample_size INTEGER,
        fetched_at TEXT NOT NULL,
        CHECK (
          (source IS NULL AND low IS NULL AND median IS NULL AND high IS NULL AND sample_size IS NULL)
          OR
          (source IN ('sold', 'active') AND low IS NOT NULL AND median IS NOT NULL AND high IS NOT NULL AND sample_size IS NOT NULL)
        )
      ) STRICT;
    `);

    const scanColumns = this.sqlite.prepare('PRAGMA table_info(scans)').all() as unknown as {
      name: string;
    }[];
    if (!scanColumns.some((column) => column.name === 'has_base_shot')) {
      this.sqlite.exec(
        'ALTER TABLE scans ADD COLUMN has_base_shot INTEGER NOT NULL DEFAULT 0',
      );
    }
    if (!scanColumns.some((column) => column.name === 'source')) {
      this.sqlite.exec(
        "ALTER TABLE scans ADD COLUMN source TEXT NOT NULL DEFAULT 'single'",
      );
    }

    const itemColumns = this.sqlite.prepare('PRAGMA table_info(items)').all() as unknown as {
      name: string;
      notnull: number;
    }[];
    if (!itemColumns.some((column) => column.name === 'provenance')) {
      this.sqlite.exec(
        "ALTER TABLE items ADD COLUMN provenance TEXT NOT NULL DEFAULT 'published-reference'",
      );
    }

    const patternColumns = this.sqlite.prepare('PRAGMA table_info(patterns)').all() as unknown as {
      name: string;
      notnull: number;
    }[];
    const rarityIsRequired =
      patternColumns.find((column) => column.name === 'rarity')?.notnull === 1 ||
      itemColumns.find((column) => column.name === 'rarity')?.notnull === 1;
    if (rarityIsRequired) {
      this.sqlite.exec('PRAGMA foreign_keys = OFF');
      try {
        this.transaction(() => {
          this.sqlite.exec(`
            CREATE TABLE patterns_nullable (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              years_start INTEGER,
              years_end INTEGER,
              colorway TEXT,
              rarity TEXT,
              notes TEXT
            ) STRICT;
            INSERT INTO patterns_nullable SELECT * FROM patterns;

            CREATE TABLE items_nullable (
              slug TEXT PRIMARY KEY,
              pattern_id TEXT NOT NULL REFERENCES patterns_nullable(id),
              form_id TEXT NOT NULL REFERENCES forms(id),
              rarity TEXT,
              ebay_query TEXT NOT NULL,
              provenance TEXT NOT NULL,
              user_submitted INTEGER NOT NULL CHECK (user_submitted IN (0, 1))
            ) STRICT;
            INSERT INTO items_nullable(
              slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted
            )
            SELECT slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted
            FROM items;

            DROP TABLE items;
            DROP TABLE patterns;
            ALTER TABLE patterns_nullable RENAME TO patterns;
            ALTER TABLE items_nullable RENAME TO items;
          `);
          const violations = this.sqlite.prepare('PRAGMA foreign_key_check').all();
          if (violations.length > 0) throw new Error('Rarity migration violated foreign keys');
        });
      } finally {
        this.sqlite.exec('PRAGMA foreign_keys = ON');
      }
    }
  }

  seedCatalog(catalog: CatalogResponse): void {
    const seedVersion = Number(
      (this.sqlite.prepare("SELECT value FROM meta WHERE key = 'seed_version'").get() as unknown as VersionRow)
        .value,
    );
    if (catalog.version <= seedVersion) return;

    const insertPattern = this.sqlite.prepare(`
      INSERT INTO patterns(id, name, years_start, years_end, colorway, rarity, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, years_start=excluded.years_start,
        years_end=excluded.years_end, colorway=excluded.colorway, rarity=excluded.rarity,
        notes=excluded.notes
    `);
    const insertForm = this.sqlite.prepare(`
      INSERT INTO forms(id, model_no, family, shape, capacity_qt, dimensions)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET model_no=excluded.model_no, family=excluded.family,
        shape=excluded.shape, capacity_qt=excluded.capacity_qt, dimensions=excluded.dimensions
    `);
    const insertItem = this.sqlite.prepare(`
      INSERT INTO items(slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET pattern_id=excluded.pattern_id, form_id=excluded.form_id,
        rarity=excluded.rarity, ebay_query=excluded.ebay_query,
        provenance=excluded.provenance, user_submitted=excluded.user_submitted
    `);

    this.transaction(() => {
      for (const pattern of catalog.patterns) {
        insertPattern.run(
          pattern.id,
          pattern.name,
          pattern.yearsStart,
          pattern.yearsEnd,
          pattern.colorway,
          pattern.rarity,
          pattern.notes,
        );
      }
      for (const form of catalog.forms) {
        insertForm.run(
          form.id,
          form.modelNo,
          form.family,
          form.shape,
          form.capacityQt,
          form.dimensions,
        );
      }
      for (const item of catalog.items) {
        insertItem.run(
          item.slug,
          item.patternId,
          item.formId,
          item.rarity,
          item.ebayQuery,
          item.provenance,
          Number(item.userSubmitted),
        );
      }
      this.sqlite.prepare("UPDATE meta SET value = ? WHERE key = 'seed_version'").run(
        String(catalog.version),
      );
      this.sqlite
        .prepare(
          "UPDATE meta SET value = MAX(CAST(value AS INTEGER) + 1, ?) WHERE key = 'catalog_version'",
        )
        .run(catalog.version);
    });
  }

  catalogVersion(): number {
    const row = this.sqlite
      .prepare("SELECT value FROM meta WHERE key = 'catalog_version'")
      .get() as unknown as VersionRow;
    return Number(row.value);
  }

  getCatalog(): CatalogResponse {
    return {
      patterns: (this.sqlite.prepare('SELECT * FROM patterns ORDER BY name').all() as unknown as PatternRow[]).map(
        patternFromRow,
      ),
      forms: (this.sqlite.prepare('SELECT * FROM forms ORDER BY model_no').all() as unknown as FormRow[]).map(
        formFromRow,
      ),
      items: (this.sqlite.prepare('SELECT * FROM items ORDER BY slug').all() as unknown as ItemRow[]).map(
        itemFromRow,
      ),
      version: this.catalogVersion(),
    };
  }

  getItem(slug: string): Item | null {
    const row = this.sqlite.prepare('SELECT * FROM items WHERE slug = ?').get(slug) as
      | (ItemRow & Record<string, unknown>)
      | undefined;
    return row ? itemFromRow(row) : null;
  }

  getPattern(id: string): Pattern | null {
    const row = this.sqlite.prepare('SELECT * FROM patterns WHERE id = ?').get(id) as
      | (PatternRow & Record<string, unknown>)
      | undefined;
    return row ? patternFromRow(row) : null;
  }

  getForm(id: string): Form | null {
    const row = this.sqlite.prepare('SELECT * FROM forms WHERE id = ?').get(id) as
      | (FormRow & Record<string, unknown>)
      | undefined;
    return row ? formFromRow(row) : null;
  }

  createKnownCombination(pattern: Pattern, form: Form): Item {
    const item: Item = {
      slug: `${pattern.id}-${form.modelNo}`,
      patternId: pattern.id,
      formId: form.id,
      rarity: pattern.rarity,
      ebayQuery: ebayQuery(pattern, form),
      provenance: 'collector-attested',
      userSubmitted: true,
    };
    this.transaction(() => {
      this.sqlite
        .prepare(`
          INSERT INTO items(
            slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted
          ) VALUES (?, ?, ?, ?, ?, ?, 1)
        `)
        .run(
          item.slug,
          item.patternId,
          item.formId,
          item.rarity,
          item.ebayQuery,
          item.provenance,
        );
      this.sqlite
        .prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'catalog_version'")
        .run();
    });
    return item;
  }

  getPhotos(itemSlug: string, userId: string | null = null): Photo[] {
    const rows = this.sqlite
      .prepare(`
        SELECT id, item_slug, visibility, approved, is_ai_placeholder, uploader_handle, created_at
        FROM photos
        WHERE item_slug = ? AND (
          uploader_id = ?
          OR (visibility != 'private' AND (approved = 1 OR is_ai_placeholder = 1))
        )
        ORDER BY is_ai_placeholder, created_at DESC
      `)
      .all(itemSlug, userId) as unknown as PhotoRow[];
    return rows.map((row) => ({
      id: row.id,
      itemSlug: row.item_slug,
      url: `/photo-files/${row.id}`,
      visibility: row.visibility,
      approved: Boolean(row.approved),
      isAiPlaceholder: Boolean(row.is_ai_placeholder),
      uploaderHandle: row.uploader_handle,
      createdAt: row.created_at,
    }));
  }

  addPhoto(input: {
    id: string;
    itemSlug: string;
    fileRef: string;
    visibility: PhotoVisibility;
    approved: boolean;
    isAiPlaceholder: boolean;
    uploaderId: string | null;
    uploaderHandle: string | null;
    createdAt: string;
  }): void {
    this.sqlite
      .prepare(`
        INSERT INTO photos(
          id, item_slug, file_ref, uploader_id, visibility, approved, is_ai_placeholder,
          uploader_handle, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.itemSlug,
        input.fileRef,
        input.uploaderId,
        input.visibility,
        Number(input.approved),
        Number(input.isAiPlaceholder),
        input.uploaderHandle,
        input.createdAt,
      );
  }

  photoFile(
    id: string,
    userId: string | null = null,
  ): { fileRef: string; publiclyCacheable: boolean } | null {
    const row = this.sqlite
      .prepare(`
        SELECT file_ref, visibility, approved, is_ai_placeholder FROM photos
        WHERE id = ? AND (
          uploader_id = ?
          OR (visibility != 'private' AND (approved = 1 OR is_ai_placeholder = 1))
        )
      `)
      .get(id, userId) as
      | { file_ref: string; visibility: PhotoVisibility; approved: number; is_ai_placeholder: number }
      | undefined;
    return row
      ? {
          fileRef: row.file_ref,
          publiclyCacheable:
            row.visibility !== 'private' && (Boolean(row.approved) || Boolean(row.is_ai_placeholder)),
        }
      : null;
  }

  cachedPrice(slug: string, notBefore: string): { quote: PriceQuote | null } | null {
    const row = this.sqlite
      .prepare('SELECT source, low, median, high, sample_size, fetched_at FROM price_cache WHERE item_slug = ? AND fetched_at >= ?')
      .get(slug, notBefore) as (PriceRow & Record<string, unknown>) | undefined;
    if (!row) return null;
    if (row.source === null) return { quote: null };
    if (
      row.low === null ||
      row.median === null ||
      row.high === null ||
      row.sample_size === null
    ) {
      return null;
    }
    return {
      quote: {
        itemSlug: slug,
        source: row.source,
        low: row.low,
        median: row.median,
        high: row.high,
        sampleSize: row.sample_size,
        currency: 'USD',
        fetchedAt: row.fetched_at,
      },
    };
  }

  savePrice(slug: string, quote: PriceQuote | null, fetchedAt: string): void {
    this.sqlite
      .prepare(`
        INSERT INTO price_cache(item_slug, source, low, median, high, sample_size, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_slug) DO UPDATE SET source=excluded.source, low=excluded.low,
          median=excluded.median, high=excluded.high, sample_size=excluded.sample_size,
          fetched_at=excluded.fetched_at
      `)
      .run(
        slug,
        quote?.source ?? null,
        quote?.low ?? null,
        quote?.median ?? null,
        quote?.high ?? null,
        quote?.sampleSize ?? null,
        fetchedAt,
      );
  }

  getCollection(userId: string): UserItem[] {
    const now = new Date().toISOString();
    const rows = this.sqlite
      .prepare('SELECT item_slug, status, quantity FROM collection WHERE user_id = ? ORDER BY item_slug')
      .all(userId) as unknown as CollectionRow[];
    return rows.map((row) => ({
      itemSlug: row.item_slug,
      status: row.status,
      quantity: row.quantity,
      condition: null,
      notes: null,
      updatedAt: now,
    }));
  }

  replaceCollection(userId: string, items: UserItem[]): UserItem[] {
    const insert = this.sqlite.prepare(
      'INSERT INTO collection(user_id, item_slug, status, quantity) VALUES (?, ?, ?, ?)',
    );
    this.transaction(() => {
      this.sqlite.prepare('DELETE FROM collection WHERE user_id = ?').run(userId);
      for (const item of items) insert.run(userId, item.itemSlug, item.status, item.quantity);
    });
    return this.getCollection(userId);
  }

  scanUsage(key: string, month: string): number {
    const row = this.sqlite
      .prepare('SELECT count FROM scan_usage WHERE key = ? AND month = ?')
      .get(key, month) as unknown as CountRow | undefined;
    return row?.count ?? 0;
  }

  incrementScanUsage(key: string, month: string): number {
    return (
      this.sqlite
        .prepare(`
          INSERT INTO scan_usage(key, month, count) VALUES (?, ?, 1)
          ON CONFLICT(key, month) DO UPDATE SET count = count + 1
          RETURNING count
        `)
        .get(key, month) as unknown as CountRow
    ).count;
  }

  deleteAccount(userId: string): string[] {
    return this.transaction(() => {
      const rows = this.sqlite
        .prepare(`
          SELECT file_ref FROM photos WHERE uploader_id = ?
          UNION
          SELECT p.file_ref FROM scan_photos p
          JOIN scans s ON s.id = p.scan_id
          WHERE s.user_id = ?
          UNION
          SELECT photo_ref AS file_ref FROM scans
          WHERE user_id = ? AND photo_ref IS NOT NULL
        `)
        .all(userId, userId, userId) as unknown as { file_ref: string }[];
      this.sqlite.prepare('DELETE FROM collection WHERE user_id = ?').run(userId);
      this.sqlite
        .prepare('DELETE FROM scan_photos WHERE scan_id IN (SELECT id FROM scans WHERE user_id = ?)')
        .run(userId);
      this.sqlite.prepare('DELETE FROM scans WHERE user_id = ?').run(userId);
      this.sqlite.prepare('DELETE FROM photos WHERE uploader_id = ?').run(userId);
      this.sqlite.prepare('DELETE FROM scan_usage WHERE key = ?').run(userId);
      return rows.map((row) => row.file_ref);
    });
  }

  addScan(input: {
    id: string;
    userId: string | null;
    photoRefs: string[];
    hasBaseShot: boolean;
    source: 'single' | 'set';
    guessesJson: string;
    confirmedItemSlug: string | null;
    llmWasRight: boolean | null;
    consentedToTraining: boolean;
    createdAt: string;
  }): void {
    const insertScan = this.sqlite.prepare(`
        INSERT INTO scans(
          id, user_id, photo_ref, guesses_json, confirmed_item_slug,
          llm_was_right, consented_to_training, has_base_shot, source, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `);
    const insertPhoto = this.sqlite.prepare(
      'INSERT INTO scan_photos(scan_id, ordinal, file_ref) VALUES (?, ?, ?)',
    );
    this.transaction(() => {
      insertScan.run(
        input.id,
        input.userId,
        input.guessesJson,
        input.confirmedItemSlug,
        input.llmWasRight === null ? null : Number(input.llmWasRight),
        Number(input.consentedToTraining),
        Number(input.hasBaseShot),
        input.source,
        input.createdAt,
      );
      for (const [ordinal, photoRef] of input.photoRefs.entries()) {
        insertPhoto.run(input.id, ordinal, photoRef);
      }
    });
  }

  listTrainingScans(): Omit<Scan, 'consentedToTraining'>[] {
    const rows = this.sqlite
      .prepare(`
        SELECT s.id, p.file_ref, s.has_base_shot, s.guesses_json,
          s.confirmed_item_slug, s.llm_was_right, s.created_at
        FROM scans s
        JOIN scan_photos p ON p.scan_id = s.id
        WHERE s.consented_to_training = 1 AND s.confirmed_item_slug IS NOT NULL
        ORDER BY s.created_at, s.id, p.ordinal
      `)
      .all() as unknown as TrainingScanPhotoRow[];
    const scans = new Map<string, Omit<Scan, 'consentedToTraining'>>();
    for (const row of rows) {
      const scan = scans.get(row.id);
      if (scan) {
        scan.photoRefs.push(row.file_ref);
        continue;
      }
      scans.set(row.id, {
        id: row.id,
        photoRefs: [row.file_ref],
        hasBaseShot: Boolean(row.has_base_shot),
        guesses: JSON.parse(row.guesses_json) as Scan['guesses'],
        confirmedItemSlug: row.confirmed_item_slug,
        llmWasRight: row.llm_was_right === null ? null : Boolean(row.llm_was_right),
        createdAt: row.created_at,
      });
    }
    return [...scans.values()];
  }

  createUnknownPattern(input: {
    patternName: string;
    formId: string | null;
    description: string;
  }): { slug: string } {
    const baseId = slugify(input.patternName);
    let patternId = baseId;
    while (this.getPattern(patternId)) patternId = `${baseId}-${randomUUID().slice(0, 6)}`;

    let form = input.formId ? this.getForm(input.formId) : null;
    if (input.formId && !form) throw new Error('Form not found');
    if (!form) {
      form = {
        id: `${patternId}-unknown-form`,
        modelNo: 'unknown',
        family: 'other',
        shape: 'Unknown form',
        capacityQt: null,
        dimensions: null,
      };
    }
    const slug = `${patternId}-${form.modelNo}`;

    this.transaction(() => {
      this.sqlite
        .prepare(`
          INSERT INTO patterns(id, name, years_start, years_end, colorway, rarity, notes)
          VALUES (?, ?, NULL, NULL, NULL, 'common', ?)
        `)
        .run(patternId, input.patternName, input.description);
      if (!input.formId) {
        this.sqlite
          .prepare(`
            INSERT INTO forms(id, model_no, family, shape, capacity_qt, dimensions)
            VALUES (?, ?, ?, ?, NULL, NULL)
          `)
          .run(form.id, form.modelNo, form.family, form.shape);
      }
      this.sqlite
        .prepare(`
          INSERT INTO items(
            slug, pattern_id, form_id, rarity, ebay_query, provenance, user_submitted
          ) VALUES (?, ?, ?, 'common', ?, 'collector-attested', 1)
        `)
        .run(slug, patternId, form.id, `Vintage Pyrex ${input.patternName} ${form.modelNo}`);
      this.sqlite
        .prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'catalog_version'")
        .run();
    });
    return { slug };
  }

  private transaction<T>(operation: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) throw new Error('Pattern name cannot be converted to a slug');
  return slug;
}
