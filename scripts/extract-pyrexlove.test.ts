import assert from 'node:assert/strict';
import test from 'node:test';

import type { CatalogResponse } from '../shared/types.ts';
import {
  applyEvidence,
  extractPieceRecords,
  parsePiecePage,
  type ExtractedPiece,
} from './extract-pyrexlove.ts';

function page(fields: string, description = ''): string {
  return `
    <html><head><title>Sample Piece : Pyrex Love</title></head><body>
      <h2 id="post-1"><a href="/sample/glassware/">Sample Piece</a></h2>
      <br />${fields}${description}<div id="sidebar"></div>
    </body></html>`;
}

test('parses labeled facts and accessory mentions', () => {
  const record = parsePiecePage({
    url: 'https://www.pyrexlove.com/sample/glassware/',
    html: page(
      '<b>Item Type: </b>Promotional Covered Casseroles<br />' +
        '<b>Years Manufactured: </b>Holidays 1961<br />' +
        '<b>Sizes and ID#s:</b> #471 (1 pint) #475 (2.5 quart)<br />' +
        '<b>Original Box#s:</b> 480-12, 480-13<br />',
      '<p>The package included a cradle, a candle warmer, and a cork trivet.</p>',
    ),
  });

  assert.deepEqual(record, {
    sourceUrl: 'https://www.pyrexlove.com/sample/glassware/',
    pieceName: 'Sample Piece',
    patternName: null,
    itemType: 'Promotional Covered Casseroles',
    models: [
      { modelNo: '471', capacityQt: 0.5 },
      { modelNo: '475', capacityQt: 2.5 },
    ],
    years: {
      raw: 'Holidays 1961',
      start: 1961,
      end: 1961,
      season: 'Holidays',
    },
    boxNumbers: ['480-12', '480-13'],
    accessories: ['candle warmer', 'cradle', 'trivet'],
  });
});

test('normalizes mixed capacities and excludes a lid number', () => {
  const record = parsePiecePage({
    url: 'https://www.pyrexlove.com/sample/glassware/',
    html: page(
        '<b>Item Type: </b>Cinderella Bowl Set<br />' +
        '<b>Sizes and ID#s:</b> 043 (1 1/2 quart) #441 (1.5 pint) #444 (4 quart) #515 (1.5 quart) #664 (4 quart casserole with lid) #963/1063 (1.5 quart) #045 Lid #550MC (metal cover) #515-C for lid<br />',
    ),
  });

  assert.deepEqual(record.models, [
    { modelNo: '043', capacityQt: 1.5 },
    { modelNo: '441', capacityQt: 0.75 },
    { modelNo: '444', capacityQt: 4 },
    { modelNo: '515', capacityQt: 1.5 },
    { modelNo: '664', capacityQt: 4 },
    { modelNo: '963', capacityQt: 1.5 },
    { modelNo: '1063', capacityQt: 1.5 },
  ]);
  assert.equal(record.years, null);
  assert.equal(record.boxNumbers, null);
  assert.equal(record.accessories, null);
});

test('returns null for dirty or missing fields', () => {
  const record = parsePiecePage({
    url: 'https://www.pyrexlove.com/sample/glassware/',
    html: page(
      '<b>Item Type: </b>Unknown<br />' +
        '<b>Years Manufactured: </b>1964(?)<br />' +
        '<b>Sizes and ID#s:</b> No Markings<br />' +
        '<b>Original Box#s:</b> 4375(?)<br />',
      '<p>This release did not include a cradle.</p>',
    ),
  });

  assert.equal(record.years, null);
  assert.equal(record.models, null);
  assert.equal(record.boxNumbers, null);
  assert.equal(record.accessories, null);
});

test('does not promote an accessory from the title when the description disputes it', () => {
  const record = parsePiecePage({
    url: 'https://www.pyrexlove.com/sample/glassware/',
    html:
      '<h2 id="post-2"><a href="/sample/glassware/">Sample Casserole w/ Cradle.</a></h2>' +
      '<b>Item Type: </b>Promotional Casserole<br />' +
      '<p>It may have included a cradle, but the details are uncertain.</p>',
  });

  assert.equal(record.accessories, null);
});

test('preserves an open production start without inventing an end year', () => {
  const record = parsePiecePage({
    url: 'https://www.pyrexlove.com/sample/glassware/',
    html: page(
      '<b>Item Type: </b>Pie Plate<br />' +
        '<b>Years Manufactured: </b>1915 - modern<br />' +
        '<b>Sizes and ID#s:</b> #205 (5 ounce)<br />',
    ),
  });

  assert.deepEqual(record.years, {
    raw: '1915 - modern',
    start: 1915,
    end: null,
    season: null,
  });
});

test('decodes numeric HTML entities in piece names', () => {
  const record = parsePiecePage({
    url: 'https://www.pyrexlove.com/sample/glassware/',
    html:
      '<h2 id="post-2"><a href="/sample/glassware/">Sample &#8243; Piece</a></h2>' +
      '<b>Item Type: </b>Pie Plate<br />',
  });

  assert.equal(record.pieceName, 'Sample ″ Piece');
});

test('uses index and pattern pages to identify patterns', () => {
  const base = 'https://www.pyrexlove.com';
  const records = extractPieceRecords([
    {
      url: `${base}/vintage-pyrex-pattern-guide/`,
      html:
        '<a href="/blue-barcode/glassware/"><img />' +
        '<div class="pattern"><b>Blue Barcode #</b></div></a>',
    },
    {
      url: `${base}/in/vintage-color-patterns/butterprint/`,
      html:
        '<title>Butterprint : Pyrex Love</title>' +
        '<a href="/butterprint-bowls/glassware/">Bowls</a>',
    },
    {
      url: `${base}/in/clear-pyrex-ovenware/measuring-cups/`,
      html: '<a href="/clear-cup/glassware/">Clear measuring cup</a>',
    },
    {
      url: `${base}/blue-barcode/glassware/`,
      html: page(
        '<b>Item Type: </b>Covered Casserole<br />' +
          '<b>Sizes and ID#s:</b> #475 (2.5 quart)<br />',
      ),
    },
    {
      url: `${base}/butterprint-bowls/glassware/`,
      html: page(
        '<b>Item Type: </b>Mixing Bowls<br />' +
          '<b>Sizes and ID#s:</b> #401 (1.5 pint)<br />',
      ),
    },
    {
      url: `${base}/clear-cup/glassware/`,
      html: page(
        '<b>Item Type: </b>Dry Measuring Cup<br />' +
          '<b>Sizes and ID#s:</b> No Number<br />',
      ),
    },
  ]);

  assert.deepEqual(records.map((record) => record.patternName), [
    'Blue Barcode',
    'Butterprint',
    'Clear',
  ]);
});

test('applies evidence once without overwriting existing facts', () => {
  const catalog: CatalogResponse = {
    version: 5,
    patterns: [
      {
        id: 'blue-stripe-barcode',
        name: 'Blue Stripe (Barcode)',
        yearsStart: null,
        yearsEnd: 1970,
        colorway: null,
        rarity: 'rare',
        notes: null,
      },
    ],
    forms: [],
    items: [],
  };
  const record: ExtractedPiece = {
    sourceUrl: 'https://www.pyrexlove.com/blue-barcode/glassware/',
    pieceName: 'Blue Barcode Covered Casserole',
    patternName: 'Blue Barcode',
    itemType: 'Covered Casserole',
    models: [{ modelNo: '999', capacityQt: 2.5 }],
    years: { raw: 'Fall 1966', start: 1966, end: 1966, season: 'Fall' },
    boxNumbers: ['999-X'],
    accessories: ['cradle'],
  };

  const records = [
    record,
    {
      ...record,
      sourceUrl: 'https://www.pyrexlove.com/blue-barcode-metric/glassware/',
      models: [{ modelNo: '999', capacityQt: 2.6417 }],
    },
  ];
  const first = applyEvidence(catalog, records);
  const second = applyEvidence(first.catalog, records);

  assert.deepEqual(first.counts, {
    newForms: 1,
    newItems: 1,
    newPatterns: 0,
    patternsEnriched: 1,
  });
  assert.equal(first.catalog.version, 6);
  assert.equal(first.catalog.patterns[0].yearsStart, 1966);
  assert.equal(first.catalog.patterns[0].yearsEnd, 1970);
  assert.equal(first.catalog.patterns[0].rarity, 'rare');
  assert.equal(first.catalog.patterns[0].notes, 'Documented for Fall 1966 on model 999. The package included a cradle.');
  assert.deepEqual(first.catalog.forms[0], {
    id: '999-covered-casserole',
    modelNo: '999',
    family: 'casserole',
    shape: 'Covered casserole',
    capacityQt: 2.5,
    dimensions: null,
  });
  assert.deepEqual(first.catalog.items[0], {
    slug: 'blue-stripe-barcode-999',
    patternId: 'blue-stripe-barcode',
    formId: '999-covered-casserole',
    rarity: null,
    ebayQuery: 'Vintage Pyrex Blue Stripe Barcode 999 Covered Casserole',
    userSubmitted: false,
    provenance: 'published-reference',
  });
  assert.deepEqual(first.conflicts, []);
  assert.deepEqual(second.counts, {
    newForms: 0,
    newItems: 0,
    newPatterns: 0,
    patternsEnriched: 0,
  });
  assert.equal(second.catalog.version, 6);
});

test('routes a mixed-color set to the matching pattern variants', () => {
  const pattern = (id: string, name: string) => ({
    id,
    name,
    yearsStart: 1957,
    yearsEnd: 1966,
    colorway: null,
    rarity: null,
    notes: 'Existing museum fact.',
  });
  const form = (modelNo: string) => ({
    id: `${modelNo}-cinderella-bowl`,
    modelNo,
    family: 'cinderella-bowl' as const,
    shape: 'Cinderella mixing bowl',
    capacityQt: null,
    dimensions: null,
  });
  const catalog: CatalogResponse = {
    version: 5,
    patterns: [
      pattern('gooseberry-black-white', 'Gooseberry (Black on White)'),
      pattern('gooseberry-black-yellow', 'Gooseberry (Black on Yellow)'),
    ],
    forms: [form('441'), form('442')],
    items: [],
  };
  const result = applyEvidence(catalog, [
    {
      sourceUrl:
        'https://www.pyrexlove.com/gooseberry-yellow-cinderella-mixing-bowls/glassware/',
      pieceName: 'Gooseberry Yellow Cinderella Mixing Bowls',
      patternName: 'Gooseberry',
      itemType: 'Cinderella Mixing Bowl Set',
      models: [
        { modelNo: '441', capacityQt: 0.75 },
        { modelNo: '442', capacityQt: 1.5 },
      ],
      years: null,
      boxNumbers: null,
      accessories: null,
    },
  ]);

  assert.deepEqual(result.catalog.items.map((item) => item.slug), [
    'gooseberry-black-white-441',
    'gooseberry-black-yellow-442',
  ]);
  assert.equal(result.counts.newPatterns, 0);
});

test('keeps a majority capacity and leaves a tied conflict unresolved', () => {
  const piece = (sourceUrl: string, models: ExtractedPiece['models']): ExtractedPiece => ({
    sourceUrl,
    pieceName: 'Capacity Sample',
    patternName: 'Capacity Sample',
    itemType: 'Covered Casserole',
    models,
    years: null,
    boxNumbers: null,
    accessories: null,
  });
  const result = applyEvidence(
    { version: 5, patterns: [], forms: [], items: [] },
    [
      piece('https://www.pyrexlove.com/a/glassware/', [
        { modelNo: '800', capacityQt: 2 },
        { modelNo: '801', capacityQt: 2 },
      ]),
      piece('https://www.pyrexlove.com/b/glassware/', [
        { modelNo: '800', capacityQt: 2 },
        { modelNo: '801', capacityQt: 3 },
      ]),
      piece('https://www.pyrexlove.com/c/glassware/', [
        { modelNo: '800', capacityQt: 3 },
      ]),
    ],
  );

  assert.equal(result.catalog.forms.find((form) => form.modelNo === '800')?.capacityQt, 2);
  assert.equal(result.catalog.forms.find((form) => form.modelNo === '801')?.capacityQt, null);
  assert.deepEqual(
    result.conflicts.map(({ modelNo, chosen }) => ({ modelNo, chosen })),
    [
      { modelNo: '800', chosen: 2 },
      { modelNo: '801', chosen: null },
    ],
  );
});

test('aggregates date bounds for a new pattern', () => {
  const record = (year: number): ExtractedPiece => ({
    sourceUrl: `https://www.pyrexlove.com/sample-${year}/glassware/`,
    pieceName: `Sample ${year}`,
    patternName: 'New Sample',
    itemType: 'Mixing Bowl',
    models: null,
    years: { raw: String(year), start: year, end: year, season: null },
    boxNumbers: null,
    accessories: null,
  });
  const result = applyEvidence(
    { version: 5, patterns: [], forms: [], items: [] },
    [record(1965), record(1960)],
  );

  assert.equal(result.catalog.patterns[0].yearsStart, 1960);
  assert.equal(result.catalog.patterns[0].yearsEnd, 1965);
  assert.equal(result.counts.newPatterns, 1);
  assert.equal(result.counts.patternsEnriched, 0);
});

test('keeps a new pattern end date open when any record is open-ended', () => {
  const record = (raw: string, start: number, end: number | null): ExtractedPiece => ({
    sourceUrl: `https://www.pyrexlove.com/sample-${start}/glassware/`,
    pieceName: `Sample ${start}`,
    patternName: 'New Sample',
    itemType: 'Pie Plate',
    models: null,
    years: { raw, start, end, season: null },
    boxNumbers: null,
    accessories: null,
  });
  const result = applyEvidence(
    { version: 5, patterns: [], forms: [], items: [] },
    [record('1950 - 1952', 1950, 1952), record('1915 - modern', 1915, null)],
  );
  const second = applyEvidence(
    result.catalog,
    [record('1950 - 1952', 1950, 1952), record('1915 - modern', 1915, null)],
  );

  assert.equal(result.catalog.patterns[0].yearsStart, 1915);
  assert.equal(result.catalog.patterns[0].yearsEnd, null);
  assert.equal(second.catalog.patterns[0].yearsEnd, null);
});
