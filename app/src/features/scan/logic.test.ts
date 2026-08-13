/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiErrorCode, ApiResult, ItemDetail, PriceQuote, SetDetection } from '@shared/types';

// @ts-expect-error Node's TypeScript test runner requires the explicit extension.
import { adjustSetGroupCount, advanceBulkQueue, bulkPhotoProgress, photoInvitesFor, browseDetailFacts, deriveHuntingChips, deriveLlmWasRight, groupDetections, knownCombinationOptions, ordinal, ordinalWord, rankHuntingRows, replaceOrMergeDetectionGroup, setFilingPieces, setScanLogInputs, shouldPresentBrowseDetail, shouldRetryQueueDrain, summarizeFiledPrices, type GroupedDetection } from './logic.ts';

const guesses = [
  { itemSlug: 'butterprint-444', confidence: 0.86, reasoning: 'Pattern and base match.' },
  { itemSlug: 'gooseberry-444', confidence: 0.51, reasoning: 'Form matches.' },
];

const huntingRows = [
  {
    slug: 'butterprint-403',
    patternId: 'butterprint',
    formId: '403-mixing',
    patternName: 'Butterprint',
    modelNo: '403',
  },
  {
    slug: 'terra-404',
    patternId: 'terra',
    formId: '404-mixing',
    patternName: 'Terra',
    modelNo: '404',
  },
  {
    slug: 'terra-403',
    patternId: 'terra',
    formId: '403-mixing',
    patternName: 'Terra',
    modelNo: '403',
  },
  {
    slug: 'butterprint-401',
    patternId: 'butterprint',
    formId: '401-mixing',
    patternName: 'Butterprint',
    modelNo: '401',
  },
  {
    slug: 'gooseberry-403',
    patternId: 'gooseberry',
    formId: '403-mixing',
    patternName: 'Gooseberry',
    modelNo: '403',
  },
  {
    slug: 'gooseberry-444',
    patternId: 'gooseberry',
    formId: '444-cinderella',
    patternName: 'Gooseberry',
    modelNo: '444',
  },
];

test('hunting ranks a lead pattern match ahead of a lead form match', () => {
  const ranked = rankHuntingRows(
    [{ itemSlug: 'terra-403', confidence: 0.99, reasoning: 'Lead guess' }],
    huntingRows,
  );

  assert.ok(ranked.findIndex(({ slug }) => slug === 'terra-404') < ranked.findIndex(({ slug }) => slug === 'butterprint-403'));
});

test('hunting weights a lead form match above a later pattern match', () => {
  const ranked = rankHuntingRows(
    [
      { itemSlug: 'terra-403', confidence: 0.01, reasoning: 'Lead guess' },
      { itemSlug: 'butterprint-444', confidence: 0.99, reasoning: 'Second guess' },
    ],
    huntingRows,
  );

  assert.ok(ranked.findIndex(({ slug }) => slug === 'gooseberry-403') < ranked.findIndex(({ slug }) => slug === 'butterprint-401'));
});

test('hunting excludes every rejected guess', () => {
  const ranked = rankHuntingRows(
    [
      { itemSlug: 'terra-403', confidence: 0.8, reasoning: 'Lead guess' },
      { itemSlug: 'gooseberry-444', confidence: 0.7, reasoning: 'Second guess' },
    ],
    huntingRows,
  );

  assert.equal(ranked.length, huntingRows.length - 2);
  assert.equal(ranked.some(({ slug }) => slug === 'terra-403'), false);
  assert.equal(ranked.some(({ slug }) => slug === 'gooseberry-444'), false);
});

test('hunting with no guesses preserves catalog order', () => {
  assert.deepEqual(rankHuntingRows([], huntingRows), huntingRows);
});

test('hunting chips keep distinct guessed patterns and model numbers in guess order', () => {
  assert.deepEqual(
    deriveHuntingChips(
      [
        { itemSlug: 'terra-403', confidence: 0.8, reasoning: 'Lead guess' },
        { itemSlug: 'terra-404', confidence: 0.7, reasoning: 'Second guess' },
        { itemSlug: 'butterprint-403', confidence: 0.6, reasoning: 'Third guess' },
      ],
      huntingRows,
    ),
    [
      { kind: 'pattern', value: 'terra', label: 'All Terra pieces' },
      { kind: 'pattern', value: 'butterprint', label: 'All Butterprint pieces' },
      { kind: 'model', value: '403', label: 'All 403s' },
      { kind: 'model', value: '404', label: 'All 404s' },
    ],
  );
});

const correctionGroups = [
  {
    itemSlug: 'gooseberry-444',
    count: 2,
    maxConfidence: 0.92,
    evidence: ['pink leaves on white', 'pink gooseberry print'],
    detections: [
      {
        itemSlug: 'gooseberry-444',
        confidence: 0.92,
        location: 'top bowl',
        visibleEvidence: 'pink leaves on white',
      },
      {
        itemSlug: 'gooseberry-444',
        confidence: 0.78,
        location: 'middle bowl',
        visibleEvidence: 'pink gooseberry print',
      },
    ],
  },
  {
    itemSlug: 'butterprint-444',
    count: 1,
    maxConfidence: 0.71,
    evidence: ['turquoise figures'],
    detections: [{
      itemSlug: 'butterprint-444',
      confidence: 0.71,
      location: 'bottom bowl',
      visibleEvidence: 'turquoise figures',
    }],
  },
] satisfies GroupedDetection[];

test('llmWasRight is true only when the confirmed slug is the top guess', () => {
  assert.equal(deriveLlmWasRight(guesses, 'butterprint-444'), true);
  assert.equal(deriveLlmWasRight(guesses, 'gooseberry-444'), false);
  assert.equal(deriveLlmWasRight([], 'butterprint-444'), false);
});

test('queue drain retries transient failures until the third failed attempt', () => {
  const transient = ['upstream_failed', 'rate_limited', 'internal'] satisfies ApiErrorCode[];
  const terminal = ['unauthorized', 'not_found', 'bad_request'] satisfies ApiErrorCode[];

  for (const code of transient) {
    assert.equal(shouldRetryQueueDrain(code, 0), true, `${code} should retry`);
    assert.equal(shouldRetryQueueDrain(code, 2), false, `${code} should stop at the limit`);
  }
  for (const code of terminal) {
    assert.equal(shouldRetryQueueDrain(code, 0), false, `${code} should not retry`);
  }
});

test('bulk photo progress is one-based for collectors', () => {
  assert.equal(bulkPhotoProgress(0, 12), 'Photo 1 of 12');
  assert.equal(bulkPhotoProgress(2, 12), 'Photo 3 of 12');
});

test('bulk queue skip advances without marking a photo filed', () => {
  assert.deepEqual(advanceBulkQueue(0, 3, false, false), {
    nextIndex: 1,
    filedAny: false,
  });
});

test('bulk queue filing advances and marks the run filed', () => {
  assert.deepEqual(advanceBulkQueue(1, 3, false, true), {
    nextIndex: 2,
    filedAny: true,
  });
});

test('bulk queue completion preserves whether any earlier photo was filed', () => {
  assert.deepEqual(advanceBulkQueue(2, 3, true, false), {
    nextIndex: null,
    filedAny: true,
  });
  assert.deepEqual(advanceBulkQueue(0, 1, false, false), {
    nextIndex: null,
    filedAny: false,
  });
});

test('ordinal handles the teens exception', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(25), '25th');
  assert.equal(ordinal(112), '112th');
});

test('ordinalWord runs out past ten so the caller can reword', () => {
  assert.equal(ordinalWord(3), 'third');
  assert.equal(ordinalWord(10), 'tenth');
  assert.equal(ordinalWord(11), null);
});

test('browse detail facts format known production years and form measurements', () => {
  assert.deepEqual(
    browseDetailFacts(
      { yearsStart: 1957, yearsEnd: 1966 },
      { capacityQt: 4, dimensions: '13 x 10 x 4 in' },
    ),
    { productionYears: '1957–1966', measurements: '4 qt · 13 x 10 x 4 in' },
  );
});

test('browse detail facts omit catalog facts that are not documented', () => {
  assert.deepEqual(
    browseDetailFacts(
      { yearsStart: null, yearsEnd: null },
      { capacityQt: null, dimensions: null },
    ),
    { productionYears: null, measurements: null },
  );
});

test('browse detail opens from browse or set results and ignores stale lookups', () => {
  assert.equal(shouldPresentBrowseDetail(2, 2, 'browse'), true);
  assert.equal(shouldPresentBrowseDetail(2, 2, 'set-results'), true);
  assert.equal(shouldPresentBrowseDetail(1, 2, 'browse'), false);
  assert.equal(shouldPresentBrowseDetail(2, 2, 'camera'), false);
});

test('known combination choices deduplicate catalog rows and exclude forms already used by the pattern', () => {
  const rows = [
    {
      patternId: 'butterprint',
      patternName: 'Butterprint',
      formId: '444-cinderella',
      shape: 'Cinderella bowl',
      modelNo: '444',
    },
    {
      patternId: 'gooseberry',
      patternName: 'Gooseberry',
      formId: '444-cinderella',
      shape: 'Cinderella bowl',
      modelNo: '444',
    },
    {
      patternId: 'gooseberry',
      patternName: 'Gooseberry',
      formId: '501-refrigerator',
      shape: 'Refrigerator dish',
      modelNo: '501',
    },
  ];

  assert.deepEqual(knownCombinationOptions(rows, 'butterprint'), {
    patterns: [
      { id: 'butterprint', name: 'Butterprint' },
      { id: 'gooseberry', name: 'Gooseberry' },
    ],
    forms: [
      { id: '501-refrigerator', shape: 'Refrigerator dish', modelNo: '501' },
    ],
  });
});

test('known combination choices include catalog patterns that have no item rows', () => {
  const rows = [{
    patternId: 'butterprint',
    patternName: 'Butterprint',
    formId: '444-cinderella',
    shape: 'Cinderella bowl',
    modelNo: '444',
  }];
  const definitions = {
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
      {
        id: 'terra',
        name: 'Terra',
        yearsStart: 1971,
        yearsEnd: 1972,
        colorway: 'brown on tan',
        rarity: null,
        notes: 'Fine horizontal bands.',
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
      {
        id: '403-mixing',
        modelNo: '403',
        family: 'mixing-bowl',
        shape: 'Mixing bowl',
        capacityQt: 2.5,
        dimensions: null,
      },
    ],
  } as const;

  assert.deepEqual(knownCombinationOptions(rows, 'terra', definitions), {
    patterns: [
      { id: 'butterprint', name: 'Butterprint' },
      { id: 'terra', name: 'Terra' },
    ],
    forms: [
      { id: '444-cinderella', shape: 'Cinderella bowl', modelNo: '444' },
      { id: '403-mixing', shape: 'Mixing bowl', modelNo: '403' },
    ],
  });
});

test('set detections group duplicate slugs without changing first-appearance order', () => {
  const detections = [
    {
      itemSlug: 'gooseberry-444',
      confidence: 0.78,
      location: 'top bowl',
      visibleEvidence: 'pink gooseberry print',
    },
    {
      itemSlug: 'butterprint-441',
      confidence: 0.71,
      location: 'bottom bowl',
      visibleEvidence: 'turquoise figures',
    },
    {
      itemSlug: 'gooseberry-444',
      confidence: 0.92,
      location: 'middle bowl',
      visibleEvidence: 'pink leaves on white',
    },
  ] satisfies SetDetection[];

  assert.deepEqual(groupDetections(detections), [
    {
      itemSlug: 'gooseberry-444',
      count: 2,
      maxConfidence: 0.92,
      evidence: ['pink gooseberry print', 'pink leaves on white'],
      detections: [detections[0], detections[2]],
    },
    {
      itemSlug: 'butterprint-441',
      count: 1,
      maxConfidence: 0.71,
      evidence: ['turquoise figures'],
      detections: [detections[1]],
    },
  ]);
});

test('set count adjustment moves up and down without changing detection evidence', () => {
  const raised = adjustSetGroupCount(correctionGroups, 'gooseberry-444', 1);

  assert.equal(raised[0].count, 3);
  assert.strictEqual(raised[0].detections, correctionGroups[0].detections);
  assert.strictEqual(raised[1], correctionGroups[1]);
  assert.equal(adjustSetGroupCount(raised, 'gooseberry-444', -1)[0].count, 2);
});

test('set count adjustment floors at one and caps at nine', () => {
  assert.equal(adjustSetGroupCount([correctionGroups[1]], 'butterprint-444', -1)[0].count, 1);
  assert.equal(adjustSetGroupCount([correctionGroups[1]], 'butterprint-444', 20)[0].count, 9);
});

test('set filing uses adjusted counts while training logs stay tied to detections', () => {
  const groups = adjustSetGroupCount(correctionGroups, 'gooseberry-444', 1);

  assert.deepEqual(setFilingPieces(groups, ['butterprint-444']), [
    { itemSlug: 'gooseberry-444', count: 3 },
  ]);
  assert.equal(
    setScanLogInputs(groups, ['butterprint-444'], 'file:///set.jpg', true).length,
    correctionGroups[0].detections.length,
  );
});

test('set correction replaces a group slug without changing its count', () => {
  assert.deepEqual(
    replaceOrMergeDetectionGroup(
      [correctionGroups[0]],
      'gooseberry-444',
      'butterprint-444',
    ),
    [{
      itemSlug: 'butterprint-444',
      count: 2,
      maxConfidence: 0.92,
      evidence: ['pink leaves on white', 'pink gooseberry print'],
      detections: correctionGroups[0].detections,
    }],
  );
});

test('set correction merges counts when the replacement slug already exists', () => {
  assert.deepEqual(
    replaceOrMergeDetectionGroup(correctionGroups, 'gooseberry-444', 'butterprint-444'),
    [{
      itemSlug: 'butterprint-444',
      count: 3,
      maxConfidence: 0.92,
      evidence: ['pink leaves on white', 'pink gooseberry print', 'turquoise figures'],
      detections: [...correctionGroups[0].detections, ...correctionGroups[1].detections],
    }],
  );
});

test('set correction is a no-op when the corrected slug is unknown', () => {
  const groups = [correctionGroups[0]];

  assert.strictEqual(
    replaceOrMergeDetectionGroup(groups, 'unknown-444', 'butterprint-444'),
    groups,
  );
});

test('set scan logs keep original guesses, mark corrections, and omit removed pieces', () => {
  const groups = replaceOrMergeDetectionGroup(
    groupDetections([
      {
        itemSlug: 'butterprint-441',
        confidence: 0.81,
        location: 'top bowl',
        visibleEvidence: 'turquoise figures',
      },
      {
        itemSlug: 'gooseberry-444',
        confidence: 0.62,
        location: 'middle bowl',
        visibleEvidence: 'pink leaves',
      },
      {
        itemSlug: 'snowflake-045',
        confidence: 0.73,
        location: 'bottom dish',
        visibleEvidence: 'white snowflakes',
      },
    ]),
    'gooseberry-444',
    'butterprint-441',
  );

  assert.deepEqual(
    setScanLogInputs(groups, ['snowflake-045'], 'file:///set.jpg', true),
    [
      {
        photoUris: ['file:///set.jpg'],
        guesses: [{
          itemSlug: 'butterprint-441',
          confidence: 0.81,
          reasoning: 'turquoise figures',
        }],
        confirmedItemSlug: 'butterprint-441',
        llmWasRight: true,
        consentedToTraining: true,
        hasBaseShot: false,
        source: 'set',
      },
      {
        photoUris: ['file:///set.jpg'],
        guesses: [{
          itemSlug: 'gooseberry-444',
          confidence: 0.62,
          reasoning: 'pink leaves',
        }],
        confirmedItemSlug: 'butterprint-441',
        llmWasRight: false,
        consentedToTraining: true,
        hasBaseShot: false,
        source: 'set',
      },
    ],
  );
});

test('filed price summary multiplies counts, preserves source order, and reports missing pieces', () => {
  const quotes = [
    {
      itemSlug: 'gooseberry-444',
      source: 'sold',
      low: 10,
      median: 15,
      high: 20,
      sampleSize: 3,
      currency: 'USD',
      fetchedAt: '2026-08-11T12:00:00.000Z',
    },
    {
      itemSlug: 'butterprint-441',
      source: 'active',
      low: 5,
      median: 7,
      high: 9,
      sampleSize: 2,
      currency: 'USD',
      fetchedAt: '2026-08-11T12:00:00.000Z',
    },
  ] satisfies PriceQuote[];

  assert.deepEqual(
    summarizeFiledPrices(
      [
        { itemSlug: 'gooseberry-444', count: 2 },
        { itemSlug: 'butterprint-441', count: 1 },
        { itemSlug: 'snowflake-045', count: 3 },
      ],
      quotes,
    ),
    {
      low: 25,
      high: 49,
      sources: ['sold', 'active'],
      unpriced: 3,
    },
  );
});

test('photo invites include only fetched items without a real photograph', () => {
  const item = {
    slug: 'terra-401',
    patternId: 'terra',
    formId: '401-mixing',
    rarity: 'common',
    ebayQuery: 'Vintage Terra 401',
    provenance: 'published-reference',
    userSubmitted: false,
    pattern: {
      id: 'terra',
      name: 'Terra',
      yearsStart: 1971,
      yearsEnd: 1972,
      colorway: 'brown on tan',
      rarity: 'common',
      notes: null,
    },
    form: {
      id: '401-mixing',
      modelNo: '401',
      family: 'mixing-bowl',
      shape: 'Mixing bowl',
      capacityQt: 0.75,
      dimensions: null,
    },
    photos: [],
    price: null,
  } satisfies ItemDetail;
  const placeholder = {
    id: 'placeholder',
    itemSlug: item.slug,
    url: 'https://example.com/placeholder.jpg',
    visibility: 'anonymous',
    approved: true,
    isAiPlaceholder: true,
    uploaderHandle: null,
    createdAt: '2026-08-12T12:00:00.000Z',
  } as const;
  const realPhoto = {
    ...placeholder,
    id: 'collector-photo',
    isAiPlaceholder: false,
  } as const;
  const responses = [
    { ok: true, data: item },
    {
      ok: true,
      data: {
        ...item,
        slug: 'terra-402',
        form: { ...item.form, modelNo: '402' },
        photos: [{ ...placeholder, itemSlug: 'terra-402' }],
      },
    },
    {
      ok: true,
      data: {
        ...item,
        slug: 'terra-403',
        form: { ...item.form, modelNo: '403' },
        photos: [{ ...realPhoto, itemSlug: 'terra-403' }],
      },
    },
    { ok: false, code: 'not_found', error: 'Missing' },
  ] satisfies ApiResult<ItemDetail>[];

  assert.deepEqual(photoInvitesFor(responses), [
    { slug: 'terra-401', label: 'Terra 401' },
    { slug: 'terra-402', label: 'Terra 402' },
  ]);
});
