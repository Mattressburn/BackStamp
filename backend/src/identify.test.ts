import assert from 'node:assert/strict';
import test from 'node:test';

import type { SetDetection } from '@shared/types.js';

import { Identifier, resolveGuesses, resolveSetDetections } from './identify.js';

const catalog = {
  items: [
    { slug: 'butterprint-444', patternId: 'butterprint', formId: '444-cinderella', rarity: 'rare' as const, ebayQuery: '', provenance: 'published-reference' as const, userSubmitted: false },
    { slug: 'butterprint-501', patternId: 'butterprint', formId: '501-fridge', rarity: 'common' as const, ebayQuery: '', provenance: 'collector-attested' as const, userSubmitted: false },
    { slug: 'spring-blossom-green-444', patternId: 'spring-blossom-green', formId: '444-cinderella', rarity: 'uncommon' as const, ebayQuery: '', provenance: 'published-reference' as const, userSubmitted: false },
  ],
  patterns: [
    { id: 'butterprint', name: 'Butterprint', yearsStart: 1957, yearsEnd: 1968, colorway: 'turquoise on white', rarity: 'rare' as const, notes: null },
    { id: 'spring-blossom-green', name: 'Spring Blossom Green', yearsStart: 1972, yearsEnd: 1979, colorway: 'green and white', rarity: 'uncommon' as const, notes: null },
  ],
  forms: [
    { id: '444-cinderella', modelNo: '444', family: 'cinderella-bowl' as const, shape: 'Cinderella bowl', capacityQt: 4, dimensions: '13 x 10 in' },
    { id: '501-fridge', modelNo: '501', family: 'refrigerator-dish' as const, shape: 'Refrigerator dish', capacityQt: 1.5, dimensions: '4 x 3 in' },
  ],
};

const geminiReply = (guesses: unknown) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ guesses }) }] } }] });

const geminiSetReply = (detections: unknown) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detections }) }] } }] });

test('drops unknown slugs, low-confidence guesses, and returns at most three in order', () => {
  const resolved = resolveGuesses(
    [
      { itemSlug: 'known-c', confidence: 0.7, reasoning: 'c' },
      { itemSlug: 'invented', confidence: 0.99, reasoning: 'bad' },
      { itemSlug: 'known-a', confidence: 0.91, reasoning: 'a' },
      { itemSlug: 'known-a', confidence: 0.85, reasoning: 'duplicate' },
      { itemSlug: 'known-low', confidence: 0.49, reasoning: 'low' },
      { itemSlug: 'known-b', confidence: 0.8, reasoning: 'b' },
      { itemSlug: 'known-d', confidence: 0.6, reasoning: 'd' },
    ],
    new Set(['known-a', 'known-b', 'known-c', 'known-d', 'known-low']),
  );

  assert.deepEqual(resolved.map(({ itemSlug }) => itemSlug), ['known-a', 'known-b', 'known-c']);
});

test('set detection resolution validates rows, rejects color contradictions, and keeps duplicates in order', () => {
  const resolved = resolveSetDetections(
    [
      null as unknown as SetDetection,
      {
        itemSlug: 'spring-blossom-green-444',
        confidence: 0.9,
        location: 'largest bowl',
        visibleEvidence: 'extra large round bowl, solid orange',
      },
      {
        itemSlug: 'butterprint-444',
        confidence: 0.9,
        location: ' top bowl ',
        visibleEvidence: ' blue rim ',
        unexpected: 'do not return model extras',
      } as SetDetection,
      {
        itemSlug: 'butterprint-444',
        confidence: 0.8,
        location: 'bottom bowl',
        visibleEvidence: 'turquoise print',
      },
      {
        itemSlug: 'spring-blossom-green-444',
        confidence: 0.49,
        location: 'low bowl',
        visibleEvidence: 'solid orange',
      },
      {
        itemSlug: 'invented-444',
        confidence: 0.99,
        location: 'unknown bowl',
        visibleEvidence: 'solid orange',
      },
      {
        itemSlug: 'butterprint-444',
        confidence: 1.1,
        location: 'invalid confidence',
        visibleEvidence: 'turquoise print',
      },
      {
        itemSlug: 'butterprint-444',
        confidence: 0.9,
        location: '   ',
        visibleEvidence: 'turquoise print',
      },
    ],
    new Set(['spring-blossom-green-444', 'butterprint-444']),
    new Map([
      ['spring-blossom-green-444', 'green and white'],
      ['butterprint-444', 'turquoise and white'],
    ]),
  );

  assert.deepEqual(resolved, {
    detections: [
      {
        itemSlug: 'butterprint-444',
        confidence: 0.9,
        location: 'top bowl',
        visibleEvidence: 'blue rim',
      },
      {
        itemSlug: 'butterprint-444',
        confidence: 0.8,
        location: 'bottom bowl',
        visibleEvidence: 'turquoise print',
      },
    ],
    contradicted: 1,
  });
});

test('the Gemini request pins patternId and modelNo to the catalog and sends the photos as inline JPEG data', async () => {
  let sent: any;
  const identifier = new Identifier('gemini-test-key', undefined, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return geminiReply([{ patternId: 'butterprint', modelNo: '444', confidence: 0.9, reasoning: 'turquoise farm print' }]);
  });

  const result = await identifier.identify({ photos: ['aGVsbG8='], hasBaseShot: true }, catalog);

  assert.deepEqual(result, {
    guesses: [{ itemSlug: 'butterprint-444', confidence: 0.9, reasoning: 'turquoise farm print' }],
    lowConfidence: false,
  });
  // patternId is deliberately NOT enum-pinned: Gemini rejects this catalog's full
  // pattern-id list (measured 2026-08-12), so the prompt's catalog block plus
  // resolveGuesses carry that constraint instead.
  assert.deepEqual(
    sent.generationConfig.responseSchema.properties.guesses.items.properties.patternId,
    { type: 'STRING' },
  );
  assert.deepEqual(
    sent.generationConfig.responseSchema.properties.guesses.items.properties.modelNo,
    { type: 'STRING', enum: ['444', '501'] },
  );
  assert.equal(sent.generationConfig.responseSchema.properties.guesses.items.properties.itemSlug, undefined);
  assert.deepEqual(sent.contents[0].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } });
  assert.match(sent.contents[0].parts[0].text, /A base photo is present/);
});

test('the catalog remains inside the byte-identical prompt prefix', async () => {
  const prompts: string[] = [];
  const identifier = new Identifier('gemini-test-key', undefined, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    prompts.push(body.contents[0].parts[0].text);
    return geminiReply([]);
  });

  await identifier.identify({ photos: ['aGVsbG8='], hasBaseShot: true }, catalog);
  await identifier.identify({ photos: ['aGVsbG8='], hasBaseShot: false }, catalog);

  const [basePrompt, noBasePrompt] = prompts;
  assert.ok(basePrompt);
  assert.ok(noBasePrompt);
  const baseSentence = 'A base photo is present. Read its embossed model number first and give it the highest evidentiary weight.';
  const noBaseSentence = 'No base photo is present. Lower confidence when the form or model number is uncertain.';
  const baseVariableAt = basePrompt.indexOf(baseSentence);
  const noBaseVariableAt = noBasePrompt.indexOf(noBaseSentence);
  const stablePrefix = basePrompt.slice(0, baseVariableAt);

  assert.equal(stablePrefix, noBasePrompt.slice(0, noBaseVariableAt));
  assert.match(stablePrefix, /Catalog:\n.*butterprint-501/s);
  assert.doesNotMatch(stablePrefix, /"provenance":/);
});

test('set identification sends a stable catalog prompt and resolves the Gemini detections', async () => {
  const sent: any[] = [];
  const identifier = new Identifier('gemini-test-key', undefined, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return geminiSetReply([
      {
        patternId: 'butterprint',
        modelNo: '444',
        confidence: 0.9,
        location: ' top bowl ',
        visibleEvidence: ' turquoise print and blue rim ',
      },
      {
        patternId: 'butterprint',
        modelNo: '501',
        confidence: 0.8,
        location: 'bottom dish',
        visibleEvidence: 'solid orange',
      },
    ]);
  });

  const result = await identifier.identifySet({ photo: 'cGhvdG8tb25l' }, catalog);
  await identifier.identifySet({ photo: 'cGhvdG8tdHdv' }, catalog);

  assert.deepEqual(result, {
    detections: [
      {
        itemSlug: 'butterprint-444',
        confidence: 0.9,
        location: 'top bowl',
        visibleEvidence: 'turquoise print and blue rim',
      },
    ],
    contradicted: 1,
    lowConfidence: false,
  });
  const schema = sent[0].generationConfig.responseSchema.properties.detections;
  assert.deepEqual(schema.items.properties.patternId, { type: 'STRING' });
  assert.deepEqual(schema.items.properties.modelNo.enum, ['444', '501']);
  assert.equal(schema.items.properties.itemSlug, undefined);
  assert.equal(schema.maxItems, 8);
  assert.equal(sent[0].generationConfig.maxOutputTokens, 8192);
  assert.deepEqual(sent[0].contents[0].parts[1], {
    inlineData: { mimeType: 'image/jpeg', data: 'cGhvdG8tb25l' },
  });
  assert.equal(sent[0].contents[0].parts[0].text, sent[1].contents[0].parts[0].text);
  assert.match(sent[0].contents[0].parts[0].text, /"colorway":"turquoise on white"/);
  assert.match(sent[0].contents[0].parts[0].text, /"dimensions":"4 x 3 in"/);
  assert.doesNotMatch(sent[0].contents[0].parts[0].text, /"provenance":/);
});

test('set identification short-circuits an empty catalog and otherwise requires Gemini', async () => {
  const identifier = new Identifier(undefined, 'anthropic-test-key', async () => {
    throw new Error('must not call a provider');
  });

  assert.deepEqual(
    await identifier.identifySet(
      { photo: 'cGhvdG8=' },
      { items: [], patterns: [], forms: [] },
    ),
    { detections: [], contradicted: 0, lowConfidence: true },
  );
  await assert.rejects(
    identifier.identifySet({ photo: 'cGhvdG8=' }, catalog),
    new Error('Set scanning requires GEMINI_API_KEY'),
  );
});

test('a pattern and model number combination outside the catalog never reaches the caller', async () => {
  const identifier = new Identifier('gemini-test-key', undefined, async () =>
    geminiReply([{ patternId: 'spring-blossom-green', modelNo: '501', confidence: 1, reasoning: 'invented combination' }]),
  );

  assert.deepEqual(await identifier.identify({ photos: ['aGVsbG8='], hasBaseShot: false }, catalog), {
    guesses: [],
    lowConfidence: true,
  });
});

test('an empty catalog short-circuits before any provider is needed', async () => {
  const identifier = new Identifier(undefined, undefined, async () => {
    throw new Error('must not call a provider');
  });

  assert.deepEqual(await identifier.identify({ photos: ['aGVsbG8='], hasBaseShot: false }, { items: [], patterns: [], forms: [] }), {
    guesses: [],
    lowConfidence: true,
  });
});
