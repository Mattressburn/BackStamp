import assert from 'node:assert/strict';
import test from 'node:test';

import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';

import { createRateLimit } from './rate-limit.js';

function setup(limit = 2, windowMs = 1_000, trustProxyHeader = false) {
  let now = 0;
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use(createRateLimit({ limit, windowMs, trustProxyHeader, now: () => now }));
  app.get('/', (c) => c.text('ok'));

  return {
    setNow(value: number) {
      now = value;
    },
    request(address: string, forwarded?: string) {
      return app.request(
        '/',
        { headers: forwarded ? { 'X-Forwarded-For': forwarded } : undefined },
        { incoming: { socket: { remoteAddress: address } } } as unknown as HttpBindings,
      );
    },
  };
}

test('requests under the limit pass', async () => {
  const limiter = setup(2);
  assert.equal((await limiter.request('192.0.2.1')).status, 200);
  assert.equal((await limiter.request('192.0.2.1')).status, 200);
});

test('the first request over the limit returns the ApiResult error and retry delay', async () => {
  const limiter = setup(1);
  await limiter.request('192.0.2.1');
  const response = await limiter.request('192.0.2.1');

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '1');
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Too many requests',
    code: 'rate_limited',
  });
});

test('an expired window allows the caller again', async () => {
  const limiter = setup(1);
  await limiter.request('192.0.2.1');
  limiter.setNow(1_000);
  assert.equal((await limiter.request('192.0.2.1')).status, 200);
});

test('different client addresses do not share a window', async () => {
  const limiter = setup(1);
  assert.equal((await limiter.request('192.0.2.1')).status, 200);
  assert.equal((await limiter.request('192.0.2.2')).status, 200);
});

test('spoofed forwarded addresses share the socket window when proxy trust is off', async () => {
  const limiter = setup(1);
  assert.equal((await limiter.request('192.0.2.1', '198.51.100.1')).status, 200);
  assert.equal((await limiter.request('192.0.2.1', '198.51.100.2')).status, 429);
});

test('trusted forwarding uses the leftmost address rather than the whole chain', async () => {
  const limiter = setup(1, 1_000, true);
  assert.equal((await limiter.request('192.0.2.1', '198.51.100.1, 10.0.0.1')).status, 200);
  assert.equal((await limiter.request('192.0.2.1', '198.51.100.1, 10.0.0.2')).status, 429);
  assert.equal((await limiter.request('192.0.2.1', '198.51.100.2, 10.0.0.2')).status, 200);
});

test('access evicts idle clients instead of retaining expired entries', async () => {
  const limiter = setup(1);
  await limiter.request('192.0.2.1');
  limiter.setNow(1_000);
  await limiter.request('192.0.2.2');
  limiter.setNow(500);
  assert.equal((await limiter.request('192.0.2.1')).status, 200);
});
