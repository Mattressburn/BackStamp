import assert from 'node:assert/strict';
import test from 'node:test';

import { configuredImageGenerator } from './image-generator.js';

test('placeholder generation sends only the written description to the image provider', async () => {
  let requestBody: unknown;
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      created: 1_786_272_000,
      data: [{ b64_json: Buffer.from('generated jpeg').toString('base64') }],
    });
  };
  const generator = configuredImageGenerator(
    { IMAGE_GEN_PROVIDER: 'openai', IMAGE_GEN_API_KEY: 'test-key' },
    fetcher,
  );

  assert.deepEqual(await generator.generate('turquoise birds on milk-white glass'), Buffer.from('generated jpeg'));
  assert.deepEqual(requestBody, {
    model: 'gpt-image-2',
    prompt: 'A clean catalog illustration of vintage ovenware: turquoise birds on milk-white glass',
    size: '1024x1024',
    quality: 'medium',
    output_format: 'jpeg',
  });
});
