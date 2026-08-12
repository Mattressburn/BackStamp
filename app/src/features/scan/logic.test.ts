/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiErrorCode, PriceQuote, SetDetection } from '@shared/types';

// @ts-expect-error Node's TypeScript test runner requires the explicit extension.
import { deriveLlmWasRight, groupDetections, ordinal, ordinalWord, shouldRetryQueueDrain, summarizeFiledPrices } from './logic.ts';

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

test('set detections group duplicate slugs without changing first-appearance order', () => {
  const detections = [
    {
      itemSlug: 'gooseberry-444',
      confidence: 0.78,
      location: 'top bowl',
      visibleEvidence: 'pink gooseberry print',
    },
    {
      itemSlug: 'butterprint-441',
      confidence: 0.71,
      location: 'bottom bowl',
      visibleEvidence: 'turquoise figures',
    },
    {
      itemSlug: 'gooseberry-444',
      confidence: 0.92,
      location: 'middle bowl',
      visibleEvidence: 'pink leaves on white',
    },
  ] satisfies SetDetection[];

  assert.deepEqual(groupDetections(detections), [
    {
      itemSlug: 'gooseberry-444',
      count: 2,
      maxConfidence: 0.92,
      evidence: ['pink gooseberry print', 'pink leaves on white'],
    },
    {
      itemSlug: 'butterprint-441',
      count: 1,
      maxConfidence: 0.71,
      evidence: ['turquoise figures'],
    },
  ]);
});

test('filed price summary multiplies counts, preserves source order, and reports missing pieces', () => {
  const quotes = [
    {
      itemSlug: 'gooseberry-444',
      source: 'sold',
      low: 10,
      median: 15,
      high: 20,
      sampleSize: 3,
      currency: 'USD',
      fetchedAt: '2026-08-11T12:00:00.000Z',
    },
    {
      itemSlug: 'butterprint-441',
      source: 'active',
      low: 5,
      median: 7,
      high: 9,
      sampleSize: 2,
      currency: 'USD',
      fetchedAt: '2026-08-11T12:00:00.000Z',
    },
  ] satisfies PriceQuote[];

  assert.deepEqual(
    summarizeFiledPrices(
      [
        { itemSlug: 'gooseberry-444', count: 2 },
        { itemSlug: 'butterprint-441', count: 1 },
        { itemSlug: 'snowflake-045', count: 3 },
      ],
      quotes,
    ),
    {
      low: 25,
      high: 49,
      sources: ['sold', 'active'],
      unpriced: 3,
    },
  );
});
