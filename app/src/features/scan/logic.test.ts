/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiErrorCode } from '@shared/types';

// @ts-expect-error Node's TypeScript test runner requires the explicit extension.
import { deriveLlmWasRight, ordinal, ordinalWord, shouldRetryQueueDrain } from './logic.ts';

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

test('ordinal handles the teens exception', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(25), '25th');
  assert.equal(ordinal(112), '112th');
});

test('ordinalWord runs out past ten so the caller can reword', () => {
  assert.equal(ordinalWord(3), 'third');
  assert.equal(ordinalWord(10), 'tenth');
  assert.equal(ordinalWord(11), null);
});
