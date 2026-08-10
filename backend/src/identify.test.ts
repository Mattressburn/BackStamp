import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGuesses } from './identify.js';

test('drops unknown slugs, low-confidence guesses, and returns at most three in order', () => {
  const resolved = resolveGuesses(
    [
      { itemSlug: 'known-c', confidence: 0.7, reasoning: 'c' },
      { itemSlug: 'invented', confidence: 0.99, reasoning: 'bad' },
      { itemSlug: 'known-a', confidence: 0.91, reasoning: 'a' },
      { itemSlug: 'known-a', confidence: 0.85, reasoning: 'duplicate' },
      { itemSlug: 'known-low', confidence: 0.49, reasoning: 'low' },
      { itemSlug: 'known-b', confidence: 0.8, reasoning: 'b' },
      { itemSlug: 'known-d', confidence: 0.6, reasoning: 'd' },
    ],
    new Set(['known-a', 'known-b', 'known-c', 'known-d', 'known-low']),
  );

  assert.deepEqual(resolved.map(({ itemSlug }) => itemSlug), ['known-a', 'known-b', 'known-c']);
});
