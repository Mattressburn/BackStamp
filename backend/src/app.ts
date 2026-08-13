import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Hono, type Context, type Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import type {
  ApiErrorCode,
  ApiResult,
  AuthProvider,
  IdentifyRequest,
  IdentifySetRequest,
  ItemDetail,
  PhotoVisibility,
  ScanGuess,
  Session,
  UserItem,
} from '@shared/types.js';

import { createSession, IdentityTokenError, verifyIdentityToken, verifySession } from './auth.js';
import { BackendDatabase } from './db.js';
import { configuredImageGenerator, type ImageGenerator } from './image-generator.js';
import { Identifier } from './identify.js';
import { PriceService } from './pricing.js';
import { stripExif } from './photos/strip-exif.js';
import { createRateLimit, type RateLimitOptions } from './rate-limit.js';

type BackendEnv = { Variables: { session: Omit<Session, 'token'> } };
type ErrorStatus = 400 | 401 | 404 | 429 | 500 | 502;

export interface AppOptions {
  db: BackendDatabase;
  photoDir: string;
  sessionSecret?: string;
  identifier?: Identifier;
  imageGenerator?: ImageGenerator;
  prices?: PriceService;
  rateLimit?: {
    clientAddress?: RateLimitOptions['clientAddress'];
    limits?: Partial<Record<'identify' | 'scans' | 'unknownPattern', number>>;
    now?: RateLimitOptions['now'];
    trustProxyHeader?: boolean;
  };
}

class ApiRouteError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: ErrorStatus,
    message: string,
  ) {
    super(message);
  }
}

const success = <T>(data: T): ApiResult<T> => ({ ok: true, data });

const failure = (error: string, code: ApiErrorCode): ApiResult<never> => ({
  ok: false,
  error,
  code,
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiRouteError('bad_request', 400, 'Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

async function body(c: Context<BackendEnv>): Promise<Record<string, unknown>> {
  try {
    return record(await c.req.json<unknown>());
  } catch (error) {
    if (error instanceof ApiRouteError) throw error;
    throw new ApiRouteError('bad_request', 400, 'Invalid JSON body');
  }
}

function requiredString(value: unknown, field: string, maxLength = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ApiRouteError('bad_request', 400, `Invalid ${field}`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function visibility(value: unknown): PhotoVisibility {
  if (value !== 'attributed' && value !== 'anonymous' && value !== 'private') {
    throw new ApiRouteError('bad_request', 400, 'Invalid visibility');
  }
  return value;
}

function guess(value: unknown): ScanGuess {
  const input = record(value);
  const itemSlug = requiredString(input.itemSlug, 'guess itemSlug', 200);
  const confidence = input.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ApiRouteError('bad_request', 400, 'Invalid guess confidence');
  }
  return {
    itemSlug,
    confidence,
    reasoning: requiredString(input.reasoning, 'guess reasoning', 1_000),
  };
}

const MAX_JPEG_BYTES = 15 * 1024 * 1024;
const MAX_JPEG_BASE64_CHARS = Math.ceil((MAX_JPEG_BYTES * 4) / 3) + 4;
const PRICE_BATCH_CONCURRENCY = 4;
const jsonLimit = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (c) => c.json(failure('Request body is too large', 'bad_request'), 413),
  });

function environmentLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

function jpegFromBase64(value: string): Buffer {
  const encoded = value.startsWith('data:image/jpeg;base64,') ? value.slice(23) : value;
  if (!encoded || encoded.length > MAX_JPEG_BASE64_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new ApiRouteError('bad_request', 400, 'Invalid JPEG');
  }
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const jpeg = Buffer.from(padded, 'base64');
  if (jpeg.length === 0 || jpeg.length > MAX_JPEG_BYTES) {
    throw new ApiRouteError('bad_request', 400, 'Invalid JPEG');
  }
  try {
    return stripExif(jpeg);
  } catch {
    throw new ApiRouteError('bad_request', 400, 'Invalid JPEG');
  }
}

function optionalJpeg(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null;
  try {
    return jpegFromBase64(value);
  } catch {
    return null;
  }
}

function collectionItem(value: unknown, db: BackendDatabase): UserItem {
  const input = record(value);
  const itemSlug = requiredString(input.itemSlug, 'itemSlug', 200);
  if (!db.getItem(itemSlug)) throw new ApiRouteError('not_found', 404, `Item not found: ${itemSlug}`);
  if (input.status !== 'have' && input.status !== 'want') {
    throw new ApiRouteError('bad_request', 400, 'Invalid collection status');
  }
  if (!Number.isSafeInteger(input.quantity) || (input.quantity as number) < 0) {
    throw new ApiRouteError('bad_request', 400, 'Invalid collection quantity');
  }
  if (input.status === 'want' && input.quantity !== 0) {
    throw new ApiRouteError('bad_request', 400, 'Want-list quantity must be zero');
  }
  return {
    itemSlug,
    status: input.status,
    quantity: input.quantity as number,
    condition: null,
    notes: null,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  };
}

export function createApp(options: AppOptions): Hono<BackendEnv> {
  const app = new Hono<BackendEnv>();
  const identifier = options.identifier ?? new Identifier();
  const imageGenerator = options.imageGenerator ?? configuredImageGenerator();
  const prices = options.prices ?? new PriceService(options.db);
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET ?? '';
  const sessionConfigured = Buffer.byteLength(sessionSecret) >= 32;
  // Only TRUST_PROXY_HEADER=true enables forwarded identity. Direct exposure or a proxy
  // that does not sanitize X-Forwarded-For lets callers spoof fresh addresses and bypass us.
  const rateLimitOptions = {
    clientAddress: options.rateLimit?.clientAddress,
    now: options.rateLimit?.now,
    trustProxyHeader:
      options.rateLimit?.trustProxyHeader ?? process.env.TRUST_PROXY_HEADER === 'true',
  };
  // One Gemini call per request is the common scan path, so allow short capture bursts.
  const identifyRateLimit = createRateLimit({
    ...rateLimitOptions,
    limit:
      options.rateLimit?.limits?.identify ??
      environmentLimit('RATE_LIMIT_IDENTIFY_PER_MINUTE', 30),
    windowMs: 60_000,
  });
  // A scan can write six sanitized photos, so cap disk-heavy bursts below identification.
  const scansRateLimit = createRateLimit({
    ...rateLimitOptions,
    limit:
      options.rateLimit?.limits?.scans ?? environmentLimit('RATE_LIMIT_SCANS_PER_MINUTE', 12),
    windowMs: 60_000,
  });
  // Unknown patterns make two model calls including image generation, so this is intentionally tight.
  const unknownPatternRateLimit = createRateLimit({
    ...rateLimitOptions,
    limit:
      options.rateLimit?.limits?.unknownPattern ??
      environmentLimit('RATE_LIMIT_UNKNOWN_PATTERNS_PER_HOUR', 2),
    windowMs: 60 * 60_000,
  });

  const sessionFrom = (c: Context<BackendEnv>): Omit<Session, 'token'> | null => {
    const authorization = c.req.header('Authorization');
    if (!sessionConfigured || !authorization?.startsWith('Bearer ')) return null;
    return verifySession(authorization.slice(7), sessionSecret);
  };

  const requireAuth = async (c: Context<BackendEnv>, next: Next): Promise<Response | void> => {
    if (!sessionConfigured) {
      return c.json(failure('Authentication is not configured', 'internal'), 500);
    }
    const session = sessionFrom(c);
    if (!session) return c.json(failure('Authentication required', 'unauthorized'), 401);
    c.set('session', session);
    await next();
  };

  app.onError((error, c) => {
    if (error instanceof ApiRouteError) return c.json(failure(error.message, error.code), error.status);
    console.error(error instanceof Error ? error.message : 'Unknown backend error');
    return c.json(failure('Internal server error', 'internal'), 500);
  });
  app.notFound((c) => c.json(failure('Route not found', 'not_found'), 404));

  // Permissive CORS is safe here: it is a browser-only gate, auth uses bearer tokens rather than cookies so there is no cookie CSRF surface, and native apps never send an Origin.
  app.use('*', cors());

  app.post('/identify', identifyRateLimit, jsonLimit(6 * MAX_JPEG_BASE64_CHARS + 10_000), async (c) => {
    const input = await body(c);
    if (!Array.isArray(input.photos) || input.photos.length === 0 || input.photos.length > 6) {
      throw new ApiRouteError('bad_request', 400, 'photos must contain 1 to 6 JPEGs');
    }
    const photos = input.photos.map((photo) =>
      jpegFromBase64(requiredString(photo, 'photo', MAX_JPEG_BASE64_CHARS)).toString('base64'),
    );
    if (typeof input.hasBaseShot !== 'boolean') {
      throw new ApiRouteError('bad_request', 400, 'Invalid hasBaseShot');
    }
    const request: IdentifyRequest = { photos, hasBaseShot: input.hasBaseShot };
    try {
      return c.json(success(await identifier.identify(request, options.db.getCatalog())));
    } catch (error) {
      // The client message stays generic; the log keeps the real reason. A fully
      // swallowed error here cost an hour of blind debugging on 2026-08-12.
      console.error('identify failed:', error instanceof Error ? error.message : error);
      throw new ApiRouteError('upstream_failed', 502, 'Identification is unavailable');
    }
  });

  app.post('/identify/set', identifyRateLimit, jsonLimit(MAX_JPEG_BASE64_CHARS + 10_000), async (c) => {
    const input = await body(c);
    const request: IdentifySetRequest = {
      photo: jpegFromBase64(
        requiredString(input.photo, 'photo', MAX_JPEG_BASE64_CHARS),
      ).toString('base64'),
    };
    try {
      return c.json(success(await identifier.identifySet(request, options.db.getCatalog())));
    } catch {
      throw new ApiRouteError('upstream_failed', 502, 'Identification is unavailable');
    }
  });

  // The app's NetInfo reachability probe. What "online" means to a collector in a
  // thrift store is "can I reach this backend", not "can I reach Google"; NetInfo's
  // default probe false-negatived on device while the LAN was fine.
  app.get('/health', (c) => c.body(null, 204));

  app.get('/catalog', (c) => {
    const sinceText = c.req.query('since') ?? '0';
    const since = Number(sinceText);
    if (!Number.isSafeInteger(since) || since < 0) {
      throw new ApiRouteError('bad_request', 400, 'Invalid catalog version');
    }
    const catalog = options.db.getCatalog();
    return c.json(
      success(
        since === catalog.version
          ? { version: catalog.version, patterns: [], forms: [], items: [] }
          : catalog,
      ),
    );
  });

  app.post('/items', scansRateLimit, jsonLimit(10_000), async (c) => {
    const input = await body(c);
    const patternId = requiredString(input.patternId, 'patternId', 200);
    const formId = requiredString(input.formId, 'formId', 200);
    const pattern = options.db.getPattern(patternId);
    if (!pattern) throw new ApiRouteError('bad_request', 400, `Unknown pattern id: ${patternId}`);
    const form = options.db.getForm(formId);
    if (!form) throw new ApiRouteError('bad_request', 400, `Unknown form id: ${formId}`);
    const slug = `${pattern.id}-${form.modelNo}`;
    if (options.db.getItem(slug)) {
      throw new ApiRouteError('bad_request', 400, `Item combination already exists: ${slug}`);
    }
    // ponytail: Creating a brand-new Form for an unknown model number is deferred; this only joins existing pattern x existing form.
    return c.json(success(options.db.createKnownCombination(pattern, form)));
  });

  app.get('/items/:slug', async (c) => {
    const item = options.db.getItem(c.req.param('slug'));
    if (!item) throw new ApiRouteError('not_found', 404, 'Item not found');
    const pattern = options.db.getPattern(item.patternId);
    const form = options.db.getForm(item.formId);
    if (!pattern || !form) throw new Error('Catalog relation is missing');
    const detail: ItemDetail = {
      ...item,
      pattern,
      form,
      photos: options.db.getPhotos(item.slug, sessionFrom(c)?.userId ?? null),
      price: await prices.fetch(item),
    };
    return c.json(success(detail));
  });

  app.get('/price/:slug', async (c) => {
    const item = options.db.getItem(c.req.param('slug'));
    if (!item) throw new ApiRouteError('not_found', 404, 'Item not found');
    return c.json(success(await prices.fetch(item)));
  });

  app.post('/price/batch', jsonLimit(25_000), async (c) => {
    const input = await body(c);
    if (!Array.isArray(input.slugs) || input.slugs.length > 100) {
      throw new ApiRouteError('bad_request', 400, 'slugs must be an array of at most 100 items');
    }
    const slugs = [...new Set(input.slugs.map((slug) => requiredString(slug, 'slug', 200)))];
    const items = slugs.map((slug) => {
      const item = options.db.getItem(slug);
      if (!item) throw new ApiRouteError('not_found', 404, `Item not found: ${slug}`);
      return item;
    });
    const quotes = [];
    for (let offset = 0; offset < items.length; offset += PRICE_BATCH_CONCURRENCY) {
      const batch = await Promise.all(
        items.slice(offset, offset + PRICE_BATCH_CONCURRENCY).map((item) => prices.fetch(item)),
      );
      quotes.push(...batch.filter((quote) => quote !== null));
    }
    return c.json(success(quotes));
  });

  app.post('/scans', scansRateLimit, jsonLimit(6 * MAX_JPEG_BASE64_CHARS + 25_000), async (c) => {
    const input = await body(c);
    if (
      !Array.isArray(input.photos) ||
      input.photos.length > 6 ||
      input.photos.some((photo) => typeof photo !== 'string' || photo.length > MAX_JPEG_BASE64_CHARS) ||
      !Array.isArray(input.guesses) ||
      input.guesses.length > 3
    ) {
      throw new ApiRouteError('bad_request', 400, 'Invalid scan');
    }
    const scanSource = input.source === undefined ? 'single' : input.source;
    if (scanSource !== 'single' && scanSource !== 'set') {
      throw new ApiRouteError('bad_request', 400, 'Invalid scan source');
    }
    const guesses = input.guesses.map(guess);
    for (const candidate of guesses) {
      if (!options.db.getItem(candidate.itemSlug)) {
        throw new ApiRouteError('bad_request', 400, `Unknown guess slug: ${candidate.itemSlug}`);
      }
    }
    const confirmedItemSlug = nullableString(input.confirmedItemSlug, 'confirmedItemSlug');
    if (confirmedItemSlug && !options.db.getItem(confirmedItemSlug)) {
      throw new ApiRouteError('bad_request', 400, 'Unknown confirmed item');
    }
    if (
      typeof input.consentedToTraining !== 'boolean' ||
      (input.llmWasRight !== null && typeof input.llmWasRight !== 'boolean')
    ) {
      throw new ApiRouteError('bad_request', 400, 'Invalid scan labels');
    }
    if (typeof input.hasBaseShot !== 'boolean') {
      throw new ApiRouteError('bad_request', 400, 'Invalid hasBaseShot');
    }
    if ((confirmedItemSlug === null) !== (input.llmWasRight === null)) {
      throw new ApiRouteError('bad_request', 400, 'Confirmed item and llmWasRight must be labeled together');
    }
    if (input.llmWasRight === true && !guesses.some((candidate) => candidate.itemSlug === confirmedItemSlug)) {
      throw new ApiRouteError(
        'bad_request',
        400,
        'Confirmed item must match a guess when llmWasRight is true',
      );
    }

    const id = randomUUID();
    const photoRefs: string[] = [];
    try {
      if (input.consentedToTraining) {
        // api.ts sends an empty array when the user has not opted in, so only this
        // branch decodes photos. jpegFromBase64 strips EXIF before bytes touch disk.
        const photos = input.photos.map((photo) => jpegFromBase64(photo as string));
        if (photos.length > 0) {
          await mkdir(options.photoDir, { recursive: true });
        }
        for (const [ordinal, photo] of photos.entries()) {
          const photoRef = `scan-${id}-${ordinal}.jpg`;
          photoRefs.push(photoRef);
          await writeFile(join(options.photoDir, photoRef), photo, { flag: 'wx' });
        }
      }
      options.db.addScan({
        id,
        userId: sessionFrom(c)?.userId ?? null,
        photoRefs,
        hasBaseShot: input.hasBaseShot,
        source: scanSource,
        guessesJson: JSON.stringify(guesses),
        confirmedItemSlug,
        llmWasRight: input.llmWasRight as boolean | null,
        consentedToTraining: input.consentedToTraining,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      await Promise.all(
        photoRefs.map((photoRef) => rm(join(options.photoDir, photoRef), { force: true })),
      );
      throw error;
    }
    return c.json(success({ id }));
  });

  app.get('/collection', requireAuth, (c) =>
    c.json(success(options.db.getCollection(c.get('session').userId))),
  );

  app.put('/collection', requireAuth, jsonLimit(5_000_000), async (c) => {
    const input = await body(c);
    if (!Array.isArray(input.items) || input.items.length > 10_000) {
      throw new ApiRouteError('bad_request', 400, 'Invalid collection');
    }
    // CONTRACT: UserItem includes condition, notes, and updatedAt, but the privacy contract
    // permits sync storage of only user_id, item_slug, status, and quantity.
    const items = input.items.map((item) => collectionItem(item, options.db));
    if (new Set(items.map((item) => item.itemSlug)).size !== items.length) {
      throw new ApiRouteError('bad_request', 400, 'Duplicate collection item');
    }
    return c.json(success(options.db.replaceCollection(c.get('session').userId, items)));
  });

  app.post('/photos', requireAuth, jsonLimit(MAX_JPEG_BASE64_CHARS + 10_000), async (c) => {
    const input = await body(c);
    const itemSlug = requiredString(input.itemSlug, 'itemSlug', 200);
    if (!options.db.getItem(itemSlug)) throw new ApiRouteError('not_found', 404, 'Item not found');
    const photo = jpegFromBase64(requiredString(input.photo, 'photo', MAX_JPEG_BASE64_CHARS));
    const photoVisibility = visibility(input.visibility);
    let uploaderHandle: string | null = null;
    if (photoVisibility === 'attributed') {
      if (typeof input.handle !== 'string' || !input.handle.trim()) {
        throw new ApiRouteError('bad_request', 400, 'handle required for attributed uploads');
      }
      uploaderHandle = input.handle.trim();
      if (Array.from(uploaderHandle).length > 40) {
        throw new ApiRouteError('bad_request', 400, 'handle must be 40 characters or fewer');
      }
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(uploaderHandle)) {
        throw new ApiRouteError('bad_request', 400, 'handle contains control characters');
      }
    }
    const id = randomUUID();
    const fileRef = `${id}.jpg`;
    await mkdir(options.photoDir, { recursive: true });
    await writeFile(join(options.photoDir, fileRef), photo, { flag: 'wx' });
    try {
      options.db.addPhoto({
        id,
        itemSlug,
        fileRef,
        visibility: photoVisibility,
        approved: false,
        isAiPlaceholder: false,
        uploaderId: c.get('session').userId,
        uploaderHandle,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      await rm(join(options.photoDir, fileRef), { force: true });
      throw error;
    }
    // Handles belong to attributed photo rows, never user records.
    return c.json(success({ id }));
  });

  app.get('/photo-files/:id', async (c) => {
    const photo = options.db.photoFile(c.req.param('id'), sessionFrom(c)?.userId ?? null);
    if (!photo) throw new ApiRouteError('not_found', 404, 'Photo not found');
    try {
      return c.body(await readFile(join(options.photoDir, photo.fileRef)), 200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': photo.publiclyCacheable
          ? 'public, max-age=604800, immutable'
          : 'private, no-store',
      });
    } catch {
      throw new ApiRouteError('not_found', 404, 'Photo not found');
    }
  });

  app.post('/patterns/unknown', unknownPatternRateLimit, jsonLimit(MAX_JPEG_BASE64_CHARS + 25_000), async (c) => {
    const input = await body(c);
    const patternName = requiredString(input.patternName, 'patternName', 100);
    const description = requiredString(input.description, 'description');
    const formId = nullableString(input.formId, 'formId');
    visibility(input.visibility);
    if (input.photo !== null && typeof input.photo !== 'string') {
      throw new ApiRouteError('bad_request', 400, 'Invalid photo');
    }
    const sourcePhoto = optionalJpeg(input.photo)?.toString('base64') ?? null;
    let writtenDescription = description;
    try {
      writtenDescription = await identifier.describePattern(sourcePhoto, description);
    } catch {
      // The user's description is sufficient when vision description is unavailable.
    }
    let created: { slug: string };
    try {
      created = options.db.createUnknownPattern({ patternName, formId, description: writtenDescription });
    } catch (error) {
      if (error instanceof Error && error.message === 'Form not found') {
        throw new ApiRouteError('not_found', 404, 'Form not found');
      }
      throw error;
    }

    try {
      const generated = await imageGenerator.generate(writtenDescription);
      if (generated) {
        const photo = stripExif(generated);
        const id = randomUUID();
        const fileRef = `${id}.jpg`;
        await mkdir(options.photoDir, { recursive: true });
        await writeFile(join(options.photoDir, fileRef), photo, { flag: 'wx' });
        try {
          options.db.addPhoto({
            id,
            itemSlug: created.slug,
            fileRef,
            visibility: 'anonymous',
            approved: true,
            isAiPlaceholder: true,
            uploaderId: null,
            uploaderHandle: null,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          await rm(join(options.photoDir, fileRef), { force: true });
          throw error;
        }
      }
    } catch {
      // The null generator and provider failures leave a valid catalog entry without art.
    }
    return c.json(success(created));
  });

  app.post('/auth/session', jsonLimit(25_000), async (c) => {
    const input = await body(c);
    if (input.provider !== 'google' && input.provider !== 'apple') {
      throw new ApiRouteError('bad_request', 400, 'Invalid auth provider');
    }
    const provider: AuthProvider = input.provider;
    const identityToken = requiredString(input.identityToken, 'identityToken', 20_000);
    if (!sessionConfigured) {
      throw new ApiRouteError('internal', 500, 'Authentication is not configured');
    }
    try {
      const subject = await verifyIdentityToken(provider, identityToken);
      return c.json(success(createSession(provider, subject, sessionSecret)));
    } catch (error) {
      if (error instanceof IdentityTokenError && error.kind === 'configuration') {
        throw new ApiRouteError('internal', 500, 'Authentication is not configured');
      }
      if (error instanceof IdentityTokenError && error.kind === 'upstream') {
        throw new ApiRouteError('upstream_failed', 502, 'Identity provider is unavailable');
      }
      throw new ApiRouteError('unauthorized', 401, 'Invalid identity token');
    }
  });

  return app;
}
