import assert from 'node:assert/strict';
import { test } from 'node:test';

import catalog from '@data/catalog.json' with { type: 'json' };

import { neutralSwatch, parseColorway } from './colorways.js';

/**
 * The parser stands between the catalog's prose and 379 items' worth of on-screen
 * color, so the thing worth testing is that word order actually decides figure from
 * ground, "white on pink" and "pink and white" are different pieces.
 */

test('"X on Y" reads Y as the glass and X as the print', () => {
  const swatch = parseColorway('white on pink', 'light');
  assert.ok(swatch);
  const pink = parseColorway('pink', 'light');
  const white = parseColorway('white', 'light');
  assert.equal(swatch.ground, pink?.ground, 'the piece named after "on" is the body');
  assert.equal(swatch.figure, white?.ground, 'the piece named before "on" is the decoration');
});

test('"X and Y" reads the first named color as the glass', () => {
  const swatch = parseColorway('pink and white', 'light');
  const pink = parseColorway('pink', 'light');
  const white = parseColorway('white', 'light');
  assert.equal(swatch?.ground, pink?.ground);
  assert.equal(swatch?.figure, white?.ground);
});

test('a single color is a solid body with no decoration', () => {
  assert.equal(parseColorway('blue', 'light')?.figure, null);
});

test('modifiers shift the color they attach to rather than being read as one', () => {
  const pale = parseColorway('pale blue bars on medium blue', 'light');
  const plain = parseColorway('blue', 'light');
  assert.ok(pale);
  assert.notEqual(pale.figure, plain?.ground, '"pale blue" is not the same value as "blue"');
  assert.equal(pale.ground, plain?.ground, '"medium blue" keeps the base value');
});

test('an unrecognised colorway yields null so callers can fall back rather than invent', () => {
  assert.equal(parseColorway('iridescent zorp', 'light'), null);
  assert.equal(parseColorway(null, 'light'), null);
  assert.equal(parseColorway('', 'light'), null);
});

test('light and dark produce different values for the same colorway', () => {
  assert.notEqual(
    parseColorway('turquoise and white', 'light')?.ground,
    parseColorway('turquoise and white', 'dark')?.ground,
  );
});

test('every pattern shipped in the catalog parses to a real swatch', () => {
  const unparsed = catalog.patterns.filter(
    (pattern) => parseColorway(pattern.colorway, 'light') === null,
  );
  assert.deepEqual(
    unparsed.map((pattern) => `${pattern.id}: ${pattern.colorway}`),
    [],
    'a pattern that does not parse silently renders as a grey box',
  );
});

test('the neutral fallback is a real color in both schemes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    assert.match(neutralSwatch(scheme).ground, /^#[0-9a-fA-F]{6}$/);
  }
});
