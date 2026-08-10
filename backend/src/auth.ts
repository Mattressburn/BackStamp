import { createHmac, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';

import type { AuthProvider, Session } from '@shared/types.js';

interface IdentityHeader {
  alg?: unknown;
  kid?: unknown;
}

interface IdentityClaims {
  aud?: unknown;
  exp?: unknown;
  iss?: unknown;
  sub?: unknown;
}

interface SessionClaims {
  exp: number;
  provider: AuthProvider;
  userId: string;
}

interface JwkSet {
  keys?: JsonWebKey[];
}

const providers: Record<
  AuthProvider,
  { audienceEnv: 'GOOGLE_CLIENT_ID' | 'APPLE_CLIENT_ID'; issuers: ReadonlySet<string>; jwksUrl: string }
> = {
  google: {
    audienceEnv: 'GOOGLE_CLIENT_ID',
    issuers: new Set(['accounts.google.com', 'https://accounts.google.com']),
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    audienceEnv: 'APPLE_CLIENT_ID',
    issuers: new Set(['https://appleid.apple.com']),
    jwksUrl: 'https://appleid.apple.com/auth/keys',
  },
} as const;

const jwksCache = new Map<AuthProvider, { expiresAt: number; keys: JsonWebKey[] }>();

export class IdentityTokenError extends Error {
  constructor(
    readonly kind: 'configuration' | 'invalid' | 'upstream',
    message: string,
  ) {
    super(message);
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function signature(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

function validSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes');
  }
}

export function createSession(
  provider: AuthProvider,
  subject: string,
  secret: string,
  expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
): Session {
  validSecret(secret);
  const claims: SessionClaims = { exp: expiresAt, provider, userId: `${provider}:${subject}` };
  const payload = encode(claims);
  return {
    userId: claims.userId,
    provider,
    token: `${payload}.${signature(payload, secret).toString('base64url')}`,
  };
}

export function verifySession(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Omit<Session, 'token'> | null {
  try {
    validSecret(secret);
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) return null;
    const expected = signature(payload, secret);
    const supplied = Buffer.from(suppliedSignature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    const claims = decode<SessionClaims>(payload);
    if (
      claims.exp <= now ||
      (claims.provider !== 'google' && claims.provider !== 'apple') ||
      claims.userId.length === 0
    ) {
      return null;
    }
    return { userId: claims.userId, provider: claims.provider };
  } catch {
    return null;
  }
}

async function providerKeys(
  provider: AuthProvider,
  fetcher: typeof fetch,
  refresh = false,
): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(provider);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  let response: Response;
  try {
    response = await fetcher(providers[provider].jwksUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new IdentityTokenError('upstream', `${provider} identity keys unavailable`);
  }
  if (!response.ok) {
    throw new IdentityTokenError('upstream', `${provider} identity keys unavailable`);
  }
  let body: JwkSet;
  try {
    body = (await response.json()) as JwkSet;
  } catch {
    throw new IdentityTokenError('upstream', `${provider} returned invalid identity keys`);
  }
  if (!Array.isArray(body.keys)) {
    throw new IdentityTokenError('upstream', `${provider} returned invalid identity keys`);
  }
  jwksCache.set(provider, { expiresAt: Date.now() + 60 * 60 * 1000, keys: body.keys });
  return body.keys;
}

export async function verifyIdentityToken(
  provider: AuthProvider,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra) {
    throw new IdentityTokenError('invalid', 'Malformed identity token');
  }

  let header: IdentityHeader;
  let claims: IdentityClaims;
  try {
    header = decode<IdentityHeader>(encodedHeader);
    claims = decode<IdentityClaims>(encodedClaims);
  } catch {
    throw new IdentityTokenError('invalid', 'Malformed identity token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new IdentityTokenError('invalid', 'Unsupported identity token');
  }

  const providerConfig = providers[provider];
  const audience = env[providerConfig.audienceEnv];
  if (!audience) {
    throw new IdentityTokenError('configuration', `${providerConfig.audienceEnv} is not configured`);
  }
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
  if (
    !Array.isArray(audiences) ||
    !audiences.includes(audience) ||
    typeof claims.iss !== 'string' ||
    !providerConfig.issuers.has(claims.iss) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= Math.floor(Date.now() / 1000) ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0
  ) {
    throw new IdentityTokenError('invalid', 'Invalid identity token claims');
  }

  let key = (await providerKeys(provider, fetcher)).find((candidate) => candidate.kid === header.kid);
  if (!key) {
    key = (await providerKeys(provider, fetcher, true)).find((candidate) => candidate.kid === header.kid);
  }
  if (!key) throw new IdentityTokenError('invalid', 'Identity signing key not found');
  let valid: boolean;
  try {
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ format: 'jwk', key }),
      Buffer.from(encodedSignature, 'base64url'),
    );
  } catch {
    throw new IdentityTokenError('upstream', 'Identity provider returned an invalid signing key');
  }
  if (!valid) throw new IdentityTokenError('invalid', 'Invalid identity token signature');
  return claims.sub;
}
