import Anthropic from '@anthropic-ai/sdk';

import type { IdentifyRequest, IdentifyResponse, Item, Pattern, Form, ScanGuess } from '@shared/types.js';

const CONFIDENCE_FLOOR = 0.5;

/**
 * Item identification runs on Gemini. `describePattern` below and everything in
 * image-generator.ts stay on their own providers; only the scan path moved.
 *
 * The model is pinned rather than the `gemini-flash-lite-latest` alias, because the price is
 * part of the choice and an alias moves under us. `gemini-2.5-flash-lite` ($0.10 in / $0.40 out
 * per 1M tokens) was the intended target and is no longer available: as of 2026-08-10 its
 * `generateContent` returns 404 "no longer available to new users", though it still appears in
 * the models list. This is the cheapest lite model the API will actually serve, at $0.25 in /
 * $1.50 out. Thinking is off; these models bill thought as output tokens.
 *
 * PRIVACY, the reason this must never run on a free-tier key: Google's free tier permits using
 * submitted content to improve their products, and the paid tier does not (confirmed on
 * ai.google.dev/gemini-api/docs/pricing, 2026-08-10). This app strips EXIF server-side before
 * bytes touch disk and stores only an auth subject ID, so sending user photos through a
 * free-tier key would contradict its own privacy design. Bill the key.
 */
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
}

export function resolveGuesses(guesses: ScanGuess[], knownSlugs: ReadonlySet<string>): ScanGuess[] {
  const seen = new Set<string>();
  return guesses
    .filter(
      (guess) =>
        knownSlugs.has(guess.itemSlug) &&
        Number.isFinite(guess.confidence) &&
        guess.confidence >= CONFIDENCE_FLOOR,
    )
    .sort((a, b) => b.confidence - a.confidence)
    .filter((guess) => {
      if (seen.has(guess.itemSlug)) return false;
      seen.add(guess.itemSlug);
      return true;
    })
    .slice(0, 3);
}

function textContent(message: Anthropic.Messages.Message): string {
  const block = message.content.find((entry) => entry.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Vision model returned no text');
  return block.text;
}

function identifyPrompt(
  request: IdentifyRequest,
  catalog: { items: Item[]; patterns: Pattern[]; forms: Form[] },
): string {
  const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
  const forms = new Map(catalog.forms.map((form) => [form.id, form]));
  const choices = catalog.items.map((item) => ({
    slug: item.slug,
    pattern: patterns.get(item.patternId)?.name,
    modelNo: forms.get(item.formId)?.modelNo,
    form: forms.get(item.formId)?.shape,
  }));
  return [
    'Identify this vintage ovenware item using only the supplied catalog.',
    'The embossed base model number outranks pattern appearance. Curved glass, glare, fading, and partial pattern views make appearance less reliable.',
    request.hasBaseShot
      ? 'A base photo is present. Read its embossed model number first and give it the highest evidentiary weight.'
      : 'No base photo is present. Lower confidence when the form or model number is uncertain.',
    'Return at most three catalog slugs. Never invent a slug and never return a free-text item name.',
    `Catalog:\n${JSON.stringify(choices)}`,
  ].join('\n\n');
}

export class Identifier {
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly geminiKey = process.env.GEMINI_API_KEY,
    anthropicKey = process.env.ANTHROPIC_API_KEY,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
  }

  async identify(
    request: IdentifyRequest,
    catalog: { items: Item[]; patterns: Pattern[]; forms: Form[] },
  ): Promise<IdentifyResponse> {
    if (catalog.items.length === 0) return { guesses: [], lowConfidence: true };

    const slugs = catalog.items.map((item) => item.slug);
    const prompt = identifyPrompt(request, catalog);
    // .env.example is the contract: whichever key is set picks the provider, Gemini wins when
    // both are. Escalating a low-confidence Gemini scan to Anthropic would slot in here; it was
    // proposed and not approved, so it does not exist yet.
    let raw: ScanGuess[];
    if (this.geminiKey) raw = await this.geminiGuesses(prompt, request.photos, slugs, this.geminiKey);
    else if (this.anthropic) raw = await this.anthropicGuesses(prompt, request.photos, slugs);
    else throw new Error('No vision provider configured: set GEMINI_API_KEY or ANTHROPIC_API_KEY');

    // Second layer. The schema enum already makes an unknown slug unreachable, but this is the
    // guarantee that does not depend on a provider honouring its own structured-output contract.
    const guesses = resolveGuesses(raw, new Set(slugs));
    return { guesses, lowConfidence: guesses.length === 0 };
  }

  private async geminiGuesses(
    prompt: string,
    photos: string[],
    slugs: string[],
    apiKey: string,
  ): Promise<ScanGuess[]> {
    const response = await this.fetcher(GEMINI_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              ...photos.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          // Measured 2026-08-10, two separate runs. Reachability: with the slug list absent from
          // the prompt, naming only a pattern and form returned the right slug for catalog
          // indexes 378 (the last), 377, 300, 200 and 101, so all 379 values are live and the
          // list is not silently truncated. Enforcement: a prompt ordering an off-catalog slug
          // still produced a catalog one, and produced the invented slug once the enum was
          // removed. So an invented slug is unreachable here, and resolveGuesses is layer two.
          responseSchema: {
            type: 'OBJECT',
            properties: {
              guesses: {
                type: 'ARRAY',
                maxItems: 3,
                items: {
                  type: 'OBJECT',
                  properties: {
                    itemSlug: { type: 'STRING', enum: slugs },
                    confidence: { type: 'NUMBER' },
                    reasoning: { type: 'STRING' },
                  },
                  required: ['itemSlug', 'confidence', 'reasoning'],
                },
              },
            },
            required: ['guesses'],
          },
          // Off: thought counts as billed output, and this is a lookup against a supplied list.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Identification failed (${response.status})`);
    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
    if (typeof text !== 'string') throw new Error('Vision model returned no text');
    return (JSON.parse(text) as Pick<IdentifyResponse, 'guesses'>).guesses;
  }

  private async anthropicGuesses(prompt: string, photos: string[], slugs: string[]): Promise<ScanGuess[]> {
    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              guesses: {
                type: 'array',
                maxItems: 3,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    itemSlug: { type: 'string', enum: slugs },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    reasoning: { type: 'string' },
                  },
                  required: ['itemSlug', 'confidence', 'reasoning'],
                },
              },
            },
            required: ['guesses'],
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...photos.map((data) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
            })),
          ],
        },
      ],
    });
    return (JSON.parse(textContent(response)) as Pick<IdentifyResponse, 'guesses'>).guesses;
  }

  async describePattern(photo: string | null, suppliedDescription: string): Promise<string> {
    if (!this.anthropic || !photo) return suppliedDescription;
    const response = await this.anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4096,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { description: { type: 'string' } },
            required: ['description'],
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe only the printed pattern, colors, and vessel shape for a catalog illustrator. Do not mention the photo, setting, people, location, or identifying details.',
            },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: photo },
            },
          ],
        },
      ],
    });
    const parsed = JSON.parse(textContent(response)) as { description?: unknown };
    return typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim()
      : suppliedDescription;
  }
}
