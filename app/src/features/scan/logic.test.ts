/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiErrorCode } from '@shared/types';

// @ts-expect-error Node's TypeScript test runner requires the explicit extension.
import { deriveLlmWasRight, shouldRetryQueueDrain } from './logic.ts';

const guesses = [
  { itemSlug: 'butterprint-444', confidence: 0.86, reasoning: 'Pattern and base match.' },
  { itemSlug: 'gooseberry-444', confidence: 0.51, reasoning: 'Form matches.' },
];

test('llmWasRight is true only when the confirmed slug is the top guess', () => {
  assert.equal(deriveLlmWasRight(guesses, 'butterprint-444'), true);
  assert.equal(deriveLlmWasRight(guesses, 'gooseberry-444'), false);
  assert.equal(deriveLlmWasRight([], 'butterprint-444'), false);
});

test('queue drain retries transient failures until the third failed attempt', () => {
  const transient = ['upstream_failed', 'rate_limited', 'internal'] satisfies ApiErrorCode[];
  const terminal = ['unauthorized', 'not_found', 'bad_request'] satisfies ApiErrorCode[];

  for (const code of transient) {
    assert.equal(shouldRetryQueueDrain(code, 0), true, `${code} should retry`);
    assert.equal(shouldRetryQueueDrain(code, 2), false, `${code} should stop at the limit`);
  }
  for (const code of terminal) {
    assert.equal(shouldRetryQueueDrain(code, 0), false, `${code} should not retry`);
  }
});
