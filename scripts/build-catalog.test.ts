import assert from 'node:assert/strict';
import test from 'node:test';

import catalog from '../data/catalog.json' with { type: 'json' };

test('only patterns backed by items carry rarity claims', () => {
  const itemPatternIds = new Set(catalog.items.map((item) => item.patternId));
  const rated = catalog.patterns.filter((pattern) => itemPatternIds.has(pattern.id));
  const unrated = catalog.patterns.filter((pattern) => !itemPatternIds.has(pattern.id));

  assert.equal(rated.length, 33);
  assert.equal(unrated.length, 151);
  assert.deepEqual(rated.filter((pattern) => pattern.rarity === null), []);
  assert.deepEqual(unrated.filter((pattern) => pattern.rarity !== null), []);
});
