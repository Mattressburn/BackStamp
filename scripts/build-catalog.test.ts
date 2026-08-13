import assert from 'node:assert/strict';
import test from 'node:test';

import catalog from '../data/catalog.json' with { type: 'json' };

// Rarity is a claim, and claims need evidence. Evidence for existence (an item
// row) is not evidence for a rank, so null rarity is legal anywhere. The
// direction that must never appear: a rank on a pattern no item backs at all.
test('rarity ranks only appear where at least one item exists', () => {
  const itemPatternIds = new Set(catalog.items.map((item) => item.patternId));
  const rankedWithoutItems = catalog.patterns.filter(
    (pattern) => pattern.rarity !== null && !itemPatternIds.has(pattern.id),
  );
  assert.deepEqual(rankedWithoutItems.map((pattern) => pattern.id), []);
});

test('every rarity value is null or a known rank', () => {
  const ranks = new Set(['common', 'uncommon', 'hard-to-find', 'rare', 'grail']);
  const invalid = [...catalog.patterns, ...catalog.items].filter(
    (row) => row.rarity !== null && !ranks.has(row.rarity),
  );
  assert.deepEqual(invalid.map((row) => ('id' in row ? row.id : row.slug)), []);
});
