/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { UserItem } from '@shared/types';

// @ts-expect-error Node 26 resolves the TypeScript extension directly.
import { cardLabel, cardPosition, offlineNotice } from './card-position.ts';

function userItem(itemSlug: string, status: UserItem['status']): UserItem {
  return {
    itemSlug,
    status,
    quantity: status === 'have' ? 1 : 0,
    condition: null,
    notes: null,
    updatedAt: '2026-08-09T12:00:00.000Z',
  };
}

const collection = [
  userItem('butterprint-444', 'have'),
  userItem('snowflake-045', 'want'),
  userItem('gooseberry-441', 'have'),
];

test('counts a position within its own tab, not across the whole collection', () => {
  assert.deepEqual(cardPosition(collection, 'gooseberry-441'), { index: 2, total: 2 });
  assert.deepEqual(cardPosition(collection, 'snowflake-045'), { index: 1, total: 1 });
});

test('a piece in neither list has no card number', () => {
  assert.equal(cardPosition(collection, 'old-orchard-443'), null);
  assert.equal(cardLabel(null), 'Not in your file');
  assert.equal(cardLabel(cardPosition(collection, 'butterprint-444')), 'Card 1 of 2');
});

test('the offline banner drops the queue clause rather than printing zero', () => {
  assert.equal(offlineNotice(0), 'No connection. Showing the copy on this phone.');
  assert.match(offlineNotice(1), /1 scan waiting to upload\.$/);
  assert.match(offlineNotice(4), /4 scans waiting to upload\.$/);
});
