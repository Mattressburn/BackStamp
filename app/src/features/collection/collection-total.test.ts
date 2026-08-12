/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PriceQuote, UserItem } from '@shared/types';

// @ts-expect-error Node 26 resolves the TypeScript extension directly.
import { calculateCollectionValues, countOwnedPieces } from './collection-total.ts';

const updatedAt = '2026-08-09T12:00:00.000Z';
const fetchedAt = '2026-08-09T12:00:00.000Z';

function userItem(
  itemSlug: string,
  status: UserItem['status'],
  quantity: number,
): UserItem {
  return { itemSlug, status, quantity, condition: null, notes: null, updatedAt };
}

function quote(itemSlug: string, median: number): PriceQuote {
  return {
    itemSlug,
    source: 'sold',
    low: median,
    median,
    high: median,
    sampleSize: 1,
    currency: 'USD',
    fetchedAt,
  };
}

test('counts every owned quantity as a piece', () => {
  assert.equal(countOwnedPieces([
    userItem('butterprint-444', 'have', 2),
    userItem('snowflake-045', 'have', 1),
    userItem('gooseberry-441', 'have', 1),
    userItem('friendship-473', 'want', 0),
  ]), 4);
});

test('multiplies an owned item median by its quantity', () => {
  const [sold] = calculateCollectionValues(
    [userItem('butterprint-444', 'have', 3)],
    [quote('butterprint-444', 12.5)],
  );

  assert.equal(sold.haveTotal, 37.5);
});

test('separates owned value from the cost of one of each wanted item', () => {
  const [sold] = calculateCollectionValues(
    [
      userItem('butterprint-444', 'have', 2),
      userItem('snowflake-045', 'want', 0),
    ],
    [quote('butterprint-444', 20), quote('snowflake-045', 30)],
  );

  assert.equal(sold.haveTotal, 40);
  assert.equal(sold.wantTotal, 30);
});

test('excludes unpriced items instead of treating them as zero-value comps', () => {
  const [sold] = calculateCollectionValues(
    [
      userItem('butterprint-444', 'have', 1),
      userItem('gooseberry-444', 'have', 4),
      userItem('snowflake-045', 'want', 0),
    ],
    [quote('butterprint-444', 20)],
  );

  assert.deepEqual(sold, {
    haveTotal: 20,
    wantTotal: 0,
    source: 'sold',
    itemsPriced: 1,
    itemsUnpriced: 2,
  });
});
