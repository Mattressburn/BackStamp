import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { ApiResult, CatalogResponse } from '@shared/types.js';

import { createApp } from './app.js';
import { createSession } from './auth.js';
import { BackendDatabase } from './db.js';
import { Identifier } from './identify.js';

const secret = 'test-secret-that-is-at-least-thirty-two-bytes';
const catalog: CatalogResponse = {
  version: 7,
  patterns: [
    {
      id: 'butterprint',
      name: 'Butterprint',
      yearsStart: 1957,
      yearsEnd: 1968,
      colorway: 'turquoise on white',
      rarity: 'common',
      notes: null,
    },
  ],
  forms: [
    {
      id: '444-cinderella',
      modelNo: '444',
      family: 'cinderella-bowl',
      shape: 'Cinderella bowl',
      capacityQt: 4,
      dimensions: null,
    },
  ],
  items: [
    {
      slug: 'butterprint-444',
      patternId: 'butterprint',
      formId: '444-cinderella',
      rarity: 'common',
      ebayQuery: 'Vintage Pyrex Butterprint 444 Cinderella',
      userSubmitted: false,
    },
  ],
};

function setup() {
  const db = new BackendDatabase(':memory:');
  db.seedCatalog(catalog);
  const photoDir = mkdtempSync(join(tmpdir(), 'backend-photo-test-'));
  return { db, photoDir, app: createApp({ db, photoDir, sessionSecret: secret }) };
}

function jpegWithExif(): Buffer {
  const exif = Buffer.from('Exif\0\0GPS=home');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(exif.length + 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    length,
    exif,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0x11, 0xff, 0xd9]),
  ]);
}

test('catalog sync returns the current version and no rows when unchanged', async () => {
  const { app, photoDir } = setup();
  try {
    const response = await app.request('/catalog?since=7');
    assert.deepEqual(await response.json(), {
      ok: true,
      data: { version: 7, patterns: [], forms: [], items: [] },
    });
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('identify accepts realistic JPEG payloads larger than a text field', async () => {
  const db = new BackendDatabase(':memory:');
  db.seedCatalog(catalog);
  const photoDir = mkdtempSync(join(tmpdir(), 'backend-photo-test-'));
  const identifier = new Identifier();
  identifier.identify = async () => ({ guesses: [], lowConfidence: true });
  const app = createApp({ db, photoDir, sessionSecret: secret, identifier });
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0]),
    Buffer.alloc(2_500, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);
  try {
    const response = await app.request('/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: [jpeg.toString('base64')], hasBaseShot: false }),
    });
    assert.equal(response.status, 200);
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('seed updates cannot reuse a version already issued to an unknown pattern', () => {
  const db = new BackendDatabase(':memory:');
  db.seedCatalog({ ...catalog, version: 1 });
  db.createUnknownPattern({ patternName: 'New Find', formId: '444-cinderella', description: 'dots' });
  assert.equal(db.catalogVersion(), 2);

  db.seedCatalog({
    ...catalog,
    version: 2,
    patterns: [{ ...catalog.patterns[0]!, name: 'Butterprint revised' }],
  });

  assert.equal(db.catalogVersion(), 3);
  assert.equal(db.getPattern('butterprint')?.name, 'Butterprint revised');
});

test('auth-required routes return an ApiResult unauthorized body', async () => {
  const { app, photoDir } = setup();
  try {
    const response = await app.request('/collection');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Authentication required',
      code: 'unauthorized',
    });
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('auth configuration failures are not reported as bad user tokens', async () => {
  const { app, photoDir } = setup();
  const configuredClientId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({})).toString('base64url');
    const response = await app.request('/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', identityToken: `${header}.${claims}.signature` }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Authentication is not configured',
      code: 'internal',
    });
  } finally {
    if (configuredClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = configuredClientId;
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('a short session secret is reported as server configuration failure', async () => {
  const db = new BackendDatabase(':memory:');
  db.seedCatalog(catalog);
  const photoDir = mkdtempSync(join(tmpdir(), 'backend-photo-test-'));
  const app = createApp({ db, photoDir, sessionSecret: 'short' });
  try {
    const response = await app.request('/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'apple', identityToken: 'header.claims.signature' }),
    });
    assert.equal(response.status, 500);
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('want-list entries reject owned quantities', async () => {
  const { app, photoDir } = setup();
  try {
    const token = createSession('google', 'subject', secret).token;
    const response = await app.request('/collection', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ itemSlug: 'butterprint-444', status: 'want', quantity: 1 }],
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('photo upload strips EXIF before the stored file is observable', async () => {
  const { app, db, photoDir } = setup();
  try {
    const token = createSession('apple', 'subject', secret).token;
    const response = await app.request('/photos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemSlug: 'butterprint-444',
        visibility: 'anonymous',
        photo: jpegWithExif().toString('base64'),
      }),
    });
    const result = (await response.json()) as ApiResult<{ id: string }>;
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(db.photoFile(result.data.id), null);
    const stored = db.photoFile(result.data.id, 'apple:subject');
    assert.ok(stored);
    assert.equal(readFileSync(join(photoDir, stored.fileRef)).includes(Buffer.from('Exif')), false);
    const asset = await app.request(`/photo-files/${result.data.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(asset.headers.get('Cache-Control'), 'private, no-store');
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('scan logging never stores photo bytes without training consent', async () => {
  const { app, photoDir } = setup();
  try {
    const response = await app.request('/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: [jpegWithExif().toString('base64')],
        guesses: [],
        confirmedItemSlug: null,
        llmWasRight: null,
        consentedToTraining: false,
      }),
    });
    assert.equal(((await response.json()) as ApiResult<{ id: string }>).ok, true);
    assert.deepEqual(readdirSync(photoDir), []);
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});

test('scan labels must agree with the confirmed item and guesses', async () => {
  const { app, photoDir } = setup();
  try {
    const response = await app.request('/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: [],
        guesses: [],
        confirmedItemSlug: 'butterprint-444',
        llmWasRight: true,
        consentedToTraining: false,
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Confirmed item must match a guess when llmWasRight is true',
      code: 'bad_request',
    });
  } finally {
    rmSync(photoDir, { recursive: true, force: true });
  }
});
