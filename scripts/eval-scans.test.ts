import assert from 'node:assert/strict';
import test from 'node:test';

import { score } from './eval-scans.ts';

const guess = (itemSlug: string, confidence: number) => ({
  itemSlug,
  confidence,
  reasoning: 'test',
});

const confirmedSlug = 'primary-colors-401';
const otherSlug = 'primary-colors-402';

test('score counts an exact top-1 hit', () => {
  const result = score([
    {
      scanId: 'scan-1',
      confirmedItemSlug: confirmedSlug,
      freshGuesses: [guess(confirmedSlug, 0.9), guess(otherSlug, 0.7)],
      storedGuesses: [guess(confirmedSlug, 0.8)],
    },
  ]);

  assert.deepEqual(result.top1Accuracy, { count: 1, sampleSize: 1, rate: 1 });
  assert.deepEqual(result.top3Accuracy, { count: 1, sampleSize: 1, rate: 1 });
  assert.deepEqual(result.meanConfidenceOnHits, { mean: 0.9, sampleSize: 1 });
  assert.deepEqual(result.agreementWithStoredTopGuess, { count: 1, sampleSize: 1, rate: 1 });
  assert.equal(result.scans[0]?.result, 'hit');
});

test('score counts a top-3 hit that is not top-1 as a confident top-1 miss', () => {
  const result = score([
    {
      scanId: 'scan-2',
      confirmedItemSlug: confirmedSlug,
      freshGuesses: [guess(otherSlug, 0.8), guess(confirmedSlug, 0.6)],
      storedGuesses: [guess(otherSlug, 0.75)],
    },
  ]);

  assert.deepEqual(result.top1Accuracy, { count: 0, sampleSize: 1, rate: 0 });
  assert.deepEqual(result.top3Accuracy, { count: 1, sampleSize: 1, rate: 1 });
  assert.deepEqual(result.missRate, { count: 0, sampleSize: 1, rate: 0 });
  assert.deepEqual(result.meanConfidenceOnMisses, { mean: 0.8, sampleSize: 1 });
  assert.equal(result.scans[0]?.result, 'miss');
});

test('score keeps a wrong answer separate from the no-guesses miss rate', () => {
  const result = score([
    {
      scanId: 'scan-3',
      confirmedItemSlug: confirmedSlug,
      freshGuesses: [guess(otherSlug, 0.7)],
      storedGuesses: [guess(confirmedSlug, 0.9)],
    },
  ]);

  assert.deepEqual(result.top3Accuracy, { count: 0, sampleSize: 1, rate: 0 });
  assert.deepEqual(result.missRate, { count: 0, sampleSize: 1, rate: 0 });
  assert.deepEqual(result.meanConfidenceOnMisses, { mean: 0.7, sampleSize: 1 });
  assert.deepEqual(result.agreementWithStoredTopGuess, { count: 0, sampleSize: 1, rate: 0 });
});

test('score counts empty guesses as a no-guesses miss without inventing confidence', () => {
  const result = score([
    {
      scanId: 'scan-4',
      confirmedItemSlug: confirmedSlug,
      freshGuesses: [],
      storedGuesses: [guess(confirmedSlug, 0.85)],
    },
  ]);

  assert.deepEqual(result.missRate, { count: 1, sampleSize: 1, rate: 1 });
  assert.deepEqual(result.meanConfidenceOnMisses, { mean: null, sampleSize: 0 });
  assert.equal(result.scans[0]?.freshTopGuess, null);
  assert.equal(result.scans[0]?.confidence, null);
});

test('score returns null rates and means for an empty input set', () => {
  const result = score([]);

  assert.equal(result.evaluated, 0);
  assert.deepEqual(result.top1Accuracy, { count: 0, sampleSize: 0, rate: null });
  assert.deepEqual(result.top3Accuracy, { count: 0, sampleSize: 0, rate: null });
  assert.deepEqual(result.missRate, { count: 0, sampleSize: 0, rate: null });
  assert.deepEqual(result.meanConfidenceOnHits, { mean: null, sampleSize: 0 });
  assert.deepEqual(result.meanConfidenceOnMisses, { mean: null, sampleSize: 0 });
  assert.deepEqual(result.agreementWithStoredTopGuess, {
    count: 0,
    sampleSize: 0,
    rate: null,
  });
  assert.deepEqual(result.scans, []);
});
