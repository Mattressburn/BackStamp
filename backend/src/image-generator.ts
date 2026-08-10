export interface ImageGenerator {
  generate(description: string): Promise<Buffer | null>;
}

interface ImageGeneratorEnv {
  IMAGE_GEN_PROVIDER?: string;
  IMAGE_GEN_API_KEY?: string;
}

interface ImageResponse {
  data?: Array<{ b64_json?: unknown }>;
}

class NullImageGenerator implements ImageGenerator {
  async generate(): Promise<null> {
    return null;
  }
}

class OpenAIImageGenerator implements ImageGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch,
  ) {}

  async generate(description: string): Promise<Buffer> {
    const response = await this.fetcher('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: `A clean catalog illustration of vintage ovenware: ${description}`,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'jpeg',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Image generation failed (${response.status})`);
    const body = (await response.json()) as ImageResponse;
    const encoded = body.data?.[0]?.b64_json;
    if (typeof encoded !== 'string') throw new Error('Image provider returned no JPEG');
    return Buffer.from(encoded, 'base64');
  }
}

// CONTRACT: IMAGE_GEN_PROVIDER=openai assumes OpenAI's gpt-image-2 Images API.
export function configuredImageGenerator(
  env: ImageGeneratorEnv = process.env,
  fetcher: typeof fetch = fetch,
): ImageGenerator {
  return env.IMAGE_GEN_PROVIDER === 'openai' && env.IMAGE_GEN_API_KEY
    ? new OpenAIImageGenerator(env.IMAGE_GEN_API_KEY, fetcher)
    : new NullImageGenerator();
}
