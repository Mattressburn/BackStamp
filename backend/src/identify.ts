import Anthropic from '@anthropic-ai/sdk';

import { colorsContradict } from '@shared/colorways.js';
import type {
  Form,
  IdentifyRequest,
  IdentifyResponse,
  IdentifySetRequest,
  IdentifySetResponse,
  Item,
  Pattern,
  ScanGuess,
  SetDetection,
} from '@shared/types.js';

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

type GeminiGuess = Omit<ScanGuess, 'itemSlug'> & { patternId: string; modelNo: string };
type GeminiSetDetection = Omit<SetDetection, 'itemSlug'> & { patternId: string; modelNo: string };

function geminiItemSlug(
  patternId: string,
  modelNo: string,
  knownSlugs: ReadonlySet<string>,
): string {
  patternId = patternId.trim().toLowerCase();
  if (knownSlugs.has(patternId)) return patternId;
  const modelSuffix = `-${modelNo}`;
  if (patternId.endsWith(modelSuffix)) patternId = patternId.slice(0, -modelSuffix.length);
  return `${patternId}-${modelNo}`;
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

export function resolveSetDetections(
  detections: SetDetection[],
  knownSlugs: ReadonlySet<string>,
  colorwayBySlug: ReadonlyMap<string, string | null>,
): { detections: SetDetection[]; contradicted: number } {
  const resolved: SetDetection[] = [];
  let contradicted = 0;

  for (const row of detections) {
    if (
      !row
      || typeof row !== 'object'
      || typeof row.itemSlug !== 'string'
      || !knownSlugs.has(row.itemSlug)
      || typeof row.confidence !== 'number'
      || !Number.isFinite(row.confidence)
      || row.confidence < 0
      || row.confidence > 1
      || typeof row.location !== 'string'
      || !row.location.trim()
      || typeof row.visibleEvidence !== 'string'
      || !row.visibleEvidence.trim()
    ) continue;

    const detection: SetDetection = {
      itemSlug: row.itemSlug.trim(),
      confidence: row.confidence,
      location: row.location.trim(),
      visibleEvidence: row.visibleEvidence.trim(),
    };
    if (detection.confidence < CONFIDENCE_FLOOR) continue;

    // Fifth honest-output enforcer, alongside PriceFigure, the swatch mark, the AI badge,
    // and the pattern/model enums plus resolveGuesses.
    if (colorsContradict(detection.visibleEvidence, colorwayBySlug.get(detection.itemSlug))) {
      contradicted += 1;
      continue;
    }
    // Physical duplicates stay as separate rows in the model's order.
    resolved.push(detection);
  }

  return { detections: resolved, contradicted };
}

function textContent(message: Anthropic.Messages.Message): string {
  const block = message.content.find((entry) => entry.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Vision model returned no text');
  return block.text;
}

// This order is load-bearing for prefix caching. Keep fixed instructions and the catalog
// before request-derived text so the large catalog prefix stays byte-identical across calls.
function identifyPrompt(
  request: IdentifyRequest,
  catalog: { items: Item[]; patterns: Pattern[]; forms: Form[] },
): string {
  const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
  const forms = new Map(catalog.forms.map((form) => [form.id, form]));
  // Cache guard: provenance has no identification value and must not enter this catalog JSON.
  const choices = catalog.items.map((item) => ({
    slug: item.slug,
    pattern: patterns.get(item.patternId)?.name,
    modelNo: forms.get(item.formId)?.modelNo,
    form: forms.get(item.formId)?.shape,
  }));
  return [
    'Identify this vintage ovenware item using only the supplied catalog.',
    'The embossed base model number outranks pattern appearance. Curved glass, glare, fading, and partial pattern views make appearance less reliable.',
    'Return at most three catalog pattern ID and model number pairs. The pattern ID never includes the model number. Never invent either and never return a free-text item name.',
    `Catalog:\n${JSON.stringify(choices)}`,
    request.hasBaseShot
      ? 'A base photo is present. Read its embossed model number first and give it the highest evidentiary weight.'
      : 'No base photo is present. Lower confidence when the form or model number is uncertain.',
  ].join('\n\n');
}

function identifySetPrompt(catalog: { items: Item[]; patterns: Pattern[]; forms: Form[] }): string {
  const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
  const forms = new Map(catalog.forms.map((form) => [form.id, form]));
  // Cache guard: provenance has no identification value and must not enter this catalog JSON.
  const choices = catalog.items.map((item) => {
    const pattern = patterns.get(item.patternId);
    const form = forms.get(item.formId);
    return {
      slug: item.slug,
      pattern: pattern?.name,
      colorway: pattern?.colorway,
      modelNo: form?.modelNo,
      form: form?.shape,
      dimensions: form?.dimensions,
    };
  });

  return [
    'The photo shows one nested set or one small group of vintage Pyrex filling the frame. Identify each visible piece using only the supplied catalog.',
    'A catalog item is pattern AND form. Match both. Relative size within a nested stack is legitimate form evidence, and visibleEvidence must say when it is used.',
    'Do not assume a complete nesting set is present. A stack may hold any subset of a set, and duplicates exist. The pieces in one stack are not necessarily the same pattern; judge each piece on its own print. Report one detection per piece whose rim or body is actually visible, and no others. Never infer hidden pieces.',
    'Abstention outranks recall. Emit a row only when visible evidence supports both the pattern and the form. Emit nothing for non-Pyrex objects. The pattern ID never includes the model number. Never invent a pattern ID or model number.',
    'For location, describe where a person finds the piece in the frame. For visibleEvidence, state only what is visible in this photo, including the piece\'s actual colors. Describe what a printed design actually depicts in plain words, such as balloons, a band of eight pointed stars, or trees in framed panels. Never write a catalog pattern name inside visibleEvidence.',
    `Catalog:\n${JSON.stringify(choices)}`,
    'One photo follows. No base photo is present and no model number is visible. Never claim a base mark as evidence.',
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
    const knownSlugs = new Set(slugs);
    const prompt = identifyPrompt(request, catalog);
    // .env.example is the contract: whichever key is set picks the provider, Gemini wins when
    // both are. Escalating a low-confidence Gemini scan to Anthropic would slot in here; it was
    // proposed and not approved, so it does not exist yet.
    let raw: ScanGuess[];
    if (this.geminiKey) {
      const patternIds = [...new Set(catalog.patterns.map((pattern) => pattern.id))];
      const modelNos = [...new Set(catalog.forms.map((form) => form.modelNo))];
      raw = await this.geminiGuesses(
        prompt,
        request.photos,
        patternIds,
        modelNos,
        knownSlugs,
        this.geminiKey,
      );
    } else if (this.anthropic) raw = await this.anthropicGuesses(prompt, request.photos, slugs);
    else throw new Error('No vision provider configured: set GEMINI_API_KEY or ANTHROPIC_API_KEY');

    // Second layer. The schema enums constrain each component; this drops invented combinations
    // without depending on a provider honouring its own structured-output contract.
    const guesses = resolveGuesses(raw, knownSlugs);
    return { guesses, lowConfidence: guesses.length === 0 };
  }

  async identifySet(
    request: IdentifySetRequest,
    catalog: { items: Item[]; patterns: Pattern[]; forms: Form[] },
  ): Promise<IdentifySetResponse> {
    if (catalog.items.length === 0) {
      return { detections: [], contradicted: 0, lowConfidence: true };
    }
    // ponytail: Add an Anthropic fallback only if Gemini-only availability becomes a measured problem.
    if (!this.geminiKey) throw new Error('Set scanning requires GEMINI_API_KEY');

    const slugs = catalog.items.map((item) => item.slug);
    const knownSlugs = new Set(slugs);
    const patternIds = [...new Set(catalog.patterns.map((pattern) => pattern.id))];
    const modelNos = [...new Set(catalog.forms.map((form) => form.modelNo))];
    const raw = await this.geminiSetDetections(
      identifySetPrompt(catalog),
      request.photo,
      patternIds,
      modelNos,
      knownSlugs,
      this.geminiKey,
    );
    const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
    const colorwayBySlug = new Map(
      catalog.items.map((item) => [item.slug, patterns.get(item.patternId)?.colorway ?? null]),
    );
    const resolved = resolveSetDetections(raw, knownSlugs, colorwayBySlug);
    return { ...resolved, lowConfidence: resolved.detections.length === 0 };
  }

  private async geminiGuesses(
    prompt: string,
    photos: string[],
    patternIds: string[],
    modelNos: string[],
    knownSlugs: ReadonlySet<string>,
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
          // Measured 2026-08-12: Gemini accepts 560 enum values but rejects 580. Pattern IDs and
          // model numbers stay in separate enums; resolveGuesses remains layer two and rejects
          // invented pattern/model combinations.
          responseSchema: {
            type: 'OBJECT',
            properties: {
              guesses: {
                type: 'ARRAY',
                maxItems: 3,
                items: {
                  type: 'OBJECT',
                  properties: {
                    // Free-form on purpose: Gemini 400s on this catalog's full pattern-id list in an
                    // enum (measured 2026-08-12: halves pass, the union fails; count, bytes, and
                    // duplicates all ruled out). The catalog block in the prompt names every valid
                    // id and resolveGuesses drops inventions, the same second layer that always
                    // backed the slug enum. modelNo keeps its enum; 87 values never tripped it.
                    patternId: { type: 'STRING' },
                    modelNo: { type: 'STRING', enum: modelNos },
                    confidence: { type: 'NUMBER' },
                    reasoning: { type: 'STRING' },
                  },
                  required: ['patternId', 'modelNo', 'confidence', 'reasoning'],
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
    return (JSON.parse(text) as { guesses: GeminiGuess[] }).guesses.map(
      ({ patternId, modelNo, ...guess }) => ({
        ...guess,
        itemSlug: geminiItemSlug(patternId, modelNo, knownSlugs),
      }),
    );
  }

  private async geminiSetDetections(
    prompt: string,
    photo: string,
    patternIds: string[],
    modelNos: string[],
    knownSlugs: ReadonlySet<string>,
    apiKey: string,
  ): Promise<SetDetection[]> {
    const response = await this.fetcher(GEMINI_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: photo } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              detections: {
                type: 'ARRAY',
                maxItems: 8,
                items: {
                  type: 'OBJECT',
                  properties: {
                    // Free-form on purpose: Gemini 400s on this catalog's full pattern-id list in an
                    // enum (measured 2026-08-12: halves pass, the union fails; count, bytes, and
                    // duplicates all ruled out). The catalog block in the prompt names every valid
                    // id and resolveGuesses drops inventions, the same second layer that always
                    // backed the slug enum. modelNo keeps its enum; 87 values never tripped it.
                    patternId: { type: 'STRING' },
                    modelNo: { type: 'STRING', enum: modelNos },
                    confidence: { type: 'NUMBER' },
                    location: { type: 'STRING' },
                    visibleEvidence: { type: 'STRING' },
                  },
                  required: ['patternId', 'modelNo', 'confidence', 'location', 'visibleEvidence'],
                },
              },
            },
            required: ['detections'],
          },
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Set identification failed (${response.status})`);
    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
    if (typeof text !== 'string') throw new Error('Vision model returned no text');
    return (JSON.parse(text) as { detections: GeminiSetDetection[] }).detections.map(
      ({ patternId, modelNo, ...detection }) => ({
        ...detection,
        itemSlug: geminiItemSlug(patternId, modelNo, knownSlugs),
      }),
    );
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
