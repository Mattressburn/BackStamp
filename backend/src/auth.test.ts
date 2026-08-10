import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { createSession, verifyIdentityToken, verifySession } from './auth.js';

const secret = 'test-secret-that-is-at-least-thirty-two-bytes';

test('signed sessions round-trip without storing profile data', () => {
  const session = createSession('apple', 'provider-subject-123', secret, 2_000_000_000);

  assert.deepEqual(verifySession(session.token, secret, 1_900_000_000), {
    userId: 'apple:provider-subject-123',
    provider: 'apple',
  });
  assert.deepEqual(Object.keys(session).sort(), ['provider', 'token', 'userId']);
});

test('rejects a tampered session token', () => {
  const session = createSession('google', 'provider-subject-123', secret, 2_000_000_000);
  const replacement = session.token.endsWith('A') ? 'B' : 'A';
  const tampered = `${session.token.slice(0, -1)}${replacement}`;

  assert.equal(verifySession(tampered, secret, 1_900_000_000), null);
});

test('verifies provider signatures before accepting a subject', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      aud: 'google-client',
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: 'https://accounts.google.com',
      sub: 'provider-subject',
    }),
  ).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
  const token = `${header}.${claims}.${signature}`;
  const fetcher: typeof fetch = async () =>
    Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key' }] });

  assert.equal(
    await verifyIdentityToken('google', token, { GOOGLE_CLIENT_ID: 'google-client' }, fetcher),
    'provider-subject',
  );
  const tamperedClaims = Buffer.from(
    JSON.stringify({
      aud: 'google-client',
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: 'https://accounts.google.com',
      sub: 'attacker',
    }),
  ).toString('base64url');
  await assert.rejects(
    verifyIdentityToken('google', `${header}.${tamperedClaims}.${signature}`, { GOOGLE_CLIENT_ID: 'google-client' }, fetcher),
    /signature/,
  );

  const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rotatedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'rotated-key' })).toString('base64url');
  const rotatedSignature = sign(
    'RSA-SHA256',
    Buffer.from(`${rotatedHeader}.${claims}`),
    rotated.privateKey,
  ).toString('base64url');
  const rotatedFetcher: typeof fetch = async () =>
    Response.json({ keys: [{ ...rotated.publicKey.export({ format: 'jwk' }), kid: 'rotated-key' }] });
  assert.equal(
    await verifyIdentityToken(
      'google',
      `${rotatedHeader}.${claims}.${rotatedSignature}`,
      { GOOGLE_CLIENT_ID: 'google-client' },
      rotatedFetcher,
    ),
    'provider-subject',
  );
});
