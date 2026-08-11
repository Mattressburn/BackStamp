import assert from 'node:assert/strict';
import test from 'node:test';

import { Identifier, resolveGuesses } from './identify.js';

const catalog = {
  items: [
    { slug: 'butterprint-444', patternId: 'butterprint', formId: '444-cinderella', rarity: 'rare' as const, ebayQuery: '', userSubmitted: false },
    { slug: 'butterprint-501', patternId: 'butterprint', formId: '501-fridge', rarity: 'common' as const, ebayQuery: '', userSubmitted: false },
  ],
  patterns: [
    { id: 'butterprint', name: 'Butterprint', yearsStart: 1957, yearsEnd: 1968, colorway: 'turquoise on white', rarity: 'rare' as const, notes: null },
  ],
  forms: [
    { id: '444-cinderella', modelNo: '444', family: 'cinderella-bowl' as const, shape: 'Cinderella bowl', capacityQt: 4, dimensions: null },
    { id: '501-fridge', modelNo: '501', family: 'refrigerator-dish' as const, shape: 'Refrigerator dish', capacityQt: 1.5, dimensions: null },
  ],
};

const geminiReply = (guesses: unknown) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ guesses }) }] } }] });

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

test('the Gemini request pins itemSlug to the catalog and sends the photos as inline JPEG data', async () => {
  let sent: any;
  const identifier = new Identifier('gemini-test-key', undefined, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return geminiReply([{ itemSlug: 'butterprint-444', confidence: 0.9, reasoning: 'turquoise farm print' }]);
  });

  const result = await identifier.identify({ photos: ['aGVsbG8='], hasBaseShot: true }, catalog);

  assert.deepEqual(result, {
    guesses: [{ itemSlug: 'butterprint-444', confidence: 0.9, reasoning: 'turquoise farm print' }],
    lowConfidence: false,
  });
  assert.deepEqual(
    sent.generationConfig.responseSchema.properties.guesses.items.properties.itemSlug,
    { type: 'STRING', enum: ['butterprint-444', 'butterprint-501'] },
  );
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
});

test('a slug outside the catalog never reaches the caller even if the model emits one', async () => {
  const identifier = new Identifier('gemini-test-key', undefined, async () =>
    geminiReply([{ itemSlug: 'millennium-falcon-9999', confidence: 1, reasoning: 'invented' }]),
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
