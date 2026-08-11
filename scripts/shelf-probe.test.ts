import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareWidths,
  detectionRows,
  estimateCost,
  parseDetections,
  parseOptions,
  parseWidths,
  responseSchema,
} from './shelf-probe.ts';

const detection = (itemSlug: string, location: string) => ({
  itemSlug,
  confidence: 0.8,
  location,
  visibleEvidence: 'test evidence',
});

test('parseWidths accepts comma-separated positive integers and supplies the defaults', () => {
  assert.deepEqual(parseWidths('2048,1024'), [2048, 1024]);
  assert.deepEqual(parseWidths(undefined), [4032, 2048, 1024]);
  assert.throws(() => parseWidths('2048,1024,800,640,320,160'), /at most 5/);
});

test('parseWidths rejects malformed widths', () => {
  for (const value of ['', '1024,', '0', '-1', '1.5', 'wide']) {
    assert.throws(() => parseWidths(value), /positive integer/);
  }
});

test('parseOptions rejects a missing --widths value', () => {
  assert.throws(() => parseOptions(['shelf.jpg', '--widths']), /positive integer/);
});

test('estimateCost applies the published input and output token rates', () => {
  assert.equal(estimateCost(1_000_000, 1_000_000), 1.75);
  assert.equal(estimateCost(4_000, 500), 0.00175);
});

test('responseSchema makes every off-catalog slug unreachable without capping detections', () => {
  const schema = responseSchema(['catalog-1', 'catalog-2']);

  assert.deepEqual(
    schema.properties.detections.items.properties.itemSlug.enum,
    ['catalog-1', 'catalog-2'],
  );
  assert.equal('maxItems' in schema.properties.detections, false);
});

test('parseDetections rejects an off-catalog slug even if the provider ignores its schema', () => {
  assert.throws(
    () => parseDetections(JSON.stringify({
      detections: [detection('invented-1', 'top shelf')],
    }), new Set(['catalog-1'])),
    /invalid detection/,
  );
});

test('compareWidths separates slugs found everywhere from slugs found at some widths', () => {
  const result = compareWidths([
    { width: 4032, detections: [detection('common-1', 'a'), detection('large-only-1', 'b')] },
    { width: 2048, detections: [detection('common-1', 'c'), detection('large-only-1', 'd')] },
    { width: 1024, detections: [detection('common-1', 'e'), detection('small-only-1', 'f')] },
  ]);

  assert.deepEqual(result, {
    commonSlugs: ['common-1'],
    partialSlugs: [
      { itemSlug: 'large-only-1', widths: [4032, 2048] },
      { itemSlug: 'small-only-1', widths: [1024] },
    ],
  });
});

test('empty detections produce empty comparison and report rows', () => {
  assert.deepEqual(compareWidths([{ width: 1024, detections: [] }]), {
    commonSlugs: [],
    partialSlugs: [],
  });
  assert.deepEqual(
    detectionRows([], { patterns: [], forms: [], items: [], version: 1 }),
    [],
  );
});
