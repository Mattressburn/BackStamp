import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyReviewOutput,
  filterPendingPages,
  itemSlug,
  mergeReviewOutput,
} from './digitize-book.ts';

test('itemSlug joins the catalog pattern ID and form model number', () => {
  assert.equal(itemSlug('butterprint', '444'), 'butterprint-444');
});

test('mergeReviewOutput preserves conflicting candidates and flags their differing fields', () => {
  const existing = emptyReviewOutput();
  existing.processedPages.push('001.jpg');
  existing.patterns.push({
    id: 'butterprint',
    name: 'Butterprint',
    yearsStart: 1957,
    yearsEnd: 1968,
    colorway: 'turquoise on white',
    rarity: null,
    notes: null,
    sourcePage: '001.jpg',
    confidence: 0.96,
  });

  const incoming = emptyReviewOutput();
  incoming.processedPages.push('002.jpg');
  incoming.patterns.push({
    id: 'butterprint',
    name: 'Butterprint',
    yearsStart: 1957,
    yearsEnd: 1969,
    colorway: 'turquoise on white',
    rarity: null,
    notes: null,
    sourcePage: '002.jpg',
    confidence: 0.88,
  });

  const merged = mergeReviewOutput(existing, incoming);

  assert.equal(merged.patterns.length, 2);
  assert.deepEqual(merged.processedPages, ['001.jpg', '002.jpg']);
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(merged.conflicts[0], {
    recordType: 'pattern',
    key: 'butterprint',
    fields: ['yearsEnd'],
    sourcePages: ['001.jpg', '002.jpg'],
  });
});

test('mergeReviewOutput keeps the strongest source for duplicate facts', () => {
  const existing = emptyReviewOutput();
  existing.patterns.push({
    id: 'gooseberry',
    name: 'Gooseberry',
    yearsStart: 1957,
    yearsEnd: 1966,
    colorway: 'pink on white',
    rarity: null,
    notes: null,
    sourcePage: '010.jpg',
    confidence: 0.7,
  });
  existing.conflicts.push({
    recordType: 'pattern',
    key: 'gooseberry',
    fields: ['yearsEnd'],
    sourcePages: ['008.jpg', '009.jpg'],
  });
  const incoming = emptyReviewOutput();
  incoming.patterns.push({
    ...existing.patterns[0]!,
    sourcePage: '011.jpg',
    confidence: 0.95,
  });

  const merged = mergeReviewOutput(existing, incoming);

  assert.equal(merged.patterns.length, 1);
  assert.equal(merged.patterns[0]?.sourcePage, '011.jpg');
  assert.deepEqual(merged.conflicts, []);
});

test('filterPendingPages sorts input and only skips completed pages when resuming', () => {
  const pages = ['003.webp', '001.jpg', '002.png'];

  assert.deepEqual(filterPendingPages(pages, ['001.jpg', '003.webp'], true), ['002.png']);
  assert.deepEqual(filterPendingPages(pages, ['001.jpg', '003.webp'], false), [
    '001.jpg',
    '002.png',
    '003.webp',
  ]);
});
