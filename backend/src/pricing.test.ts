import assert from 'node:assert/strict';
import test from 'node:test';

import type { Item, PriceQuote } from '@shared/types.js';

import { BackendDatabase } from './db.js';
import { PriceService, SoldCompsSource, quoteFromPrices, type PriceSource } from './pricing.js';

const item: Item = {
  slug: 'butterprint-444',
  patternId: 'butterprint',
  formId: '444-cinderella',
  rarity: 'common',
  ebayQuery: 'Vintage Pyrex Butterprint 444 Cinderella',
  provenance: 'published-reference',
  userSubmitted: false,
};

const quote: PriceQuote = {
  itemSlug: item.slug,
  source: 'active',
  low: 12,
  median: 24,
  high: 36,
  sampleSize: 3,
  currency: 'USD',
  fetchedAt: '2026-08-09T12:00:00.000Z',
};

function database(): BackendDatabase {
  const db = new BackendDatabase(':memory:');
  db.seedCatalog({
    version: 1,
    patterns: [
      {
        id: 'butterprint',
        name: 'Butterprint',
        yearsStart: 1957,
        yearsEnd: 1968,
        colorway: 'turquoise on white',
        rarity: 'common',
        notes: null,
      },
    ],
    forms: [
      {
        id: '444-cinderella',
        modelNo: '444',
        family: 'cinderella-bowl',
        shape: 'Cinderella bowl',
        capacityQt: 4,
        dimensions: null,
      },
    ],
    items: [item],
  });
  return db;
}

test('builds a quote with a true median for an even sample', () => {
  assert.deepEqual(
    quoteFromPrices(item.slug, 'sold', [40, 10, 30, 20], '2026-08-09T12:00:00.000Z'),
    {
      itemSlug: item.slug,
      source: 'sold',
      low: 10,
      median: 25,
      high: 40,
      sampleSize: 4,
      currency: 'USD',
      fetchedAt: '2026-08-09T12:00:00.000Z',
    },
  );
});

test('falls back when sold comps has no result and reuses the weekly cache', async () => {
  let soldCalls = 0;
  let activeCalls = 0;
  const sold: PriceSource = {
    async fetch() {
      soldCalls += 1;
      return null;
    },
  };
  const active: PriceSource = {
    async fetch() {
      activeCalls += 1;
      return quote;
    },
  };
  const db = database();
  const service = new PriceService(db, sold, active);

  assert.deepEqual(await service.fetch(item), quote);
  assert.deepEqual(await service.fetch(item), quote);
  assert.equal(soldCalls, 1);
  assert.equal(activeCalls, 1);
});

test('sold quotes include only exact USD sales from the last 90 days', async () => {
  const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fetcher: typeof fetch = async () =>
    Response.json({
      keyword: item.ebayQuery,
      page: 1,
      totalItems: 4,
      hasNextPage: false,
      items: [
        { soldPrice: '20.00', soldCurrency: 'USD', endedAt: recent, bestOfferAccepted: false },
        { soldPrice: '10.00', soldCurrency: 'USD', endedAt: old, bestOfferAccepted: false },
        { soldPrice: '99.00', soldCurrency: 'USD', endedAt: recent, bestOfferAccepted: true },
        { soldPrice: '30.00', soldCurrency: 'CAD', endedAt: recent, bestOfferAccepted: false },
      ],
    });

  const result = await new SoldCompsSource('test-key', fetcher).fetch(item);
  assert.ok(result);
  assert.deepEqual(
    { ...result, fetchedAt: '<timestamp>' },
    {
      itemSlug: item.slug,
      source: 'sold',
      low: 20,
      median: 20,
      high: 20,
      sampleSize: 1,
      currency: 'USD',
      fetchedAt: '<timestamp>',
    },
  );
});

test('does not cache transient pricing failures as a week-long no-result', async () => {
  let calls = 0;
  const unavailable: PriceSource = {
    async fetch() {
      calls += 1;
      throw new Error('temporary outage');
    },
  };
  const service = new PriceService(database(), unavailable, unavailable);

  assert.equal(await service.fetch(item), null);
  assert.equal(await service.fetch(item), null);
  assert.equal(calls, 4);
});

test('coalesces concurrent price requests for the same item', async () => {
  let calls = 0;
  const sold: PriceSource = {
    async fetch() {
      calls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return quote;
    },
  };
  const service = new PriceService(database(), sold, sold);

  assert.deepEqual(await Promise.all([service.fetch(item), service.fetch(item)]), [quote, quote]);
  assert.equal(calls, 1);
});
