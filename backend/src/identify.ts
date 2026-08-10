import Anthropic from '@anthropic-ai/sdk';

import type { IdentifyRequest, IdentifyResponse, Item, Pattern, Form, ScanGuess } from '@shared/types.js';

const CONFIDENCE_FLOOR = 0.5;

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

export class Identifier {
  private readonly client: Anthropic | null;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async identify(
    request: IdentifyRequest,
    catalog: { items: Item[]; patterns: Pattern[]; forms: Form[] },
  ): Promise<IdentifyResponse> {
    if (catalog.items.length === 0) return { guesses: [], lowConfidence: true };
    if (!this.client) throw new Error('ANTHROPIC_API_KEY is not configured');

    const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
    const forms = new Map(catalog.forms.map((form) => [form.id, form]));
    const choices = catalog.items.map((item) => ({
      slug: item.slug,
      pattern: patterns.get(item.patternId)?.name,
      modelNo: forms.get(item.formId)?.modelNo,
      form: forms.get(item.formId)?.shape,
    }));
    const prompt = [
      'Identify this vintage ovenware item using only the supplied catalog.',
      'The embossed base model number outranks pattern appearance. Curved glass, glare, fading, and partial pattern views make appearance less reliable.',
      request.hasBaseShot
        ? 'A base photo is present. Read its embossed model number first and give it the highest evidentiary weight.'
        : 'No base photo is present. Lower confidence when the form or model number is uncertain.',
      'Return at most three catalog slugs. Never invent a slug and never return a free-text item name.',
      `Catalog:\n${JSON.stringify(choices)}`,
    ].join('\n\n');
    const response = await this.client.messages.create({
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
                    itemSlug: { type: 'string', enum: catalog.items.map((item) => item.slug) },
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
            ...request.photos.map((data) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
            })),
          ],
        },
      ],
    });
    const parsed = JSON.parse(textContent(response)) as Pick<IdentifyResponse, 'guesses'>;
    const guesses = resolveGuesses(parsed.guesses, new Set(catalog.items.map((item) => item.slug)));
    return { guesses, lowConfidence: guesses.length === 0 };
  }

  async describePattern(photo: string | null, suppliedDescription: string): Promise<string> {
    if (!this.client || !photo) return suppliedDescription;
    const response = await this.client.messages.create({
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
