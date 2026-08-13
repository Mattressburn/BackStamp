/**
 * Backend client. Every network call in the app goes through here.
 *
 * A backend is not optional: the eBay credentials, the vision API key and the image
 * generation key cannot ship inside a mobile binary, where anyone can extract them.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  ApiResult,
  AuthProvider,
  CatalogResponse,
  IdentifyResponse,
  IdentifySetResponse,
  Item,
  ItemDetail,
  PhotoVisibility,
  PriceQuote,
  ScanQuota,
  Session,
  UserItem,
} from '@shared/types';
import { getInstallId } from '@/db';

const TOKEN_KEY = 'backstamp.session.token';

/**
 * Points at MRDockBox over the LAN in dev. Override with EXPO_PUBLIC_API_URL, which
 * is what EAS builds set to the Cloudflare Tunnel hostname.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://192.168.69.242:8787';

let cachedToken: string | null = null;

// expo-secure-store is backed by the iOS keychain and Android keystore and has no
// browser implementation. The web target is a layout preview only, so it runs signed
// out rather than falling back to localStorage, a session token in localStorage is
// readable by any script on the page, which is the whole thing SecureStore avoids.
const canPersistToken = Platform.OS !== 'web';

export async function getToken(): Promise<string | null> {
  if (!canPersistToken) return null;
  cachedToken ??= await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (!canPersistToken) return;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [token, installId] = await Promise.all([getToken(), getInstallId()]);
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Install-Id': installId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    if (res.status === 204) return { ok: true, data: null as T };
    const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (!body) {
      return { ok: false, error: `Bad response (${res.status})`, code: 'upstream_failed' };
    }
    return body;
  } catch (err) {
    // Offline is the expected case, not an exception. Callers queue and move on.
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? 'Request timed out' : 'No connection',
      code: 'upstream_failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- uploads

/**
 * Every camera file URI in this app becomes bytes on the wire here and nowhere else, so
 * the resize lives here rather than at each `takePictureAsync`. There are three capture
 * sites and this covers all of them.
 *
 * Phone cameras shoot about 12MP. Vision models bill an image by tiles, and 4032px buys
 * no accuracy over 1024 for reading a printed pattern or an embossed model number, so a
 * full-resolution upload is paying for pixels the model discards.
 *
 * Two bounds, because these are two different things. A photo the model reads is an
 * input. A photo contributed to the catalog is the artifact itself, so it keeps enough
 * resolution to stay worth looking at. A scan kept for training uses the model bound on
 * purpose: a stored example should be what the model actually saw, or replaying it later
 * measures a scan that never happened.
 *
 * ponytail: no guard against upscaling a source narrower than the bound, because every
 * source here is a camera capture at several megapixels. Add one if a gallery picker
 * lands.
 */
const MODEL_INPUT_MAX_WIDTH = 1024;
const CATALOG_PHOTO_MAX_WIDTH = 2048;
const UPLOAD_JPEG_QUALITY = 0.8;

async function encodeForUpload(uri: string, maxWidth: number): Promise<string> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: maxWidth }).renderAsync();
  const { base64 } = await image.saveAsync({
    base64: true,
    compress: UPLOAD_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  if (!base64) throw new Error('The photo could not be prepared for upload.');
  return base64;
}

// ---------------------------------------------------------------- identify

/**
 * Photos arrive as local file URIs from the camera and are converted to base64 here,
 * at the last possible moment. Holding base64 in state or in SQLite wastes several
 * megabytes per burst.
 */
export async function identify(
  photoUris: string[],
  hasBaseShot: boolean,
): Promise<ApiResult<IdentifyResponse>> {
  const photos = await Promise.all(
    photoUris.map((uri) => encodeForUpload(uri, MODEL_INPUT_MAX_WIDTH)),
  );
  return request<IdentifyResponse>('/identify', {
    method: 'POST',
    body: JSON.stringify({ photos, hasBaseShot }),
  });
}

export async function identifySet(photoUri: string): Promise<ApiResult<IdentifySetResponse>> {
  const photo = await encodeForUpload(photoUri, MODEL_INPUT_MAX_WIDTH);
  return request<IdentifySetResponse>('/identify/set', {
    method: 'POST',
    body: JSON.stringify({ photo }),
  });
}

export function getQuota(): Promise<ApiResult<ScanQuota>> {
  return request<ScanQuota>('/quota');
}

// ---------------------------------------------------------------- catalog

export function fetchCatalog(sinceVersion = 0): Promise<ApiResult<CatalogResponse>> {
  return request<CatalogResponse>(`/catalog?since=${sinceVersion}`);
}

export function fetchItem(slug: string): Promise<ApiResult<ItemDetail>> {
  return request<ItemDetail>(`/items/${encodeURIComponent(slug)}`);
}

export function submitKnownCombination(
  patternId: string,
  formId: string,
): Promise<ApiResult<Item>> {
  return request<Item>('/items', {
    method: 'POST',
    body: JSON.stringify({ patternId, formId }),
  });
}

/** Creates a catalog entry for a pattern nobody has catalogued yet. */
export async function submitUnknownPattern(input: {
  patternName: string;
  formId: string | null;
  description: string;
  photoUri: string | null;
  visibility: PhotoVisibility;
}): Promise<ApiResult<{ slug: string }>> {
  const { photoUri, ...rest } = input;
  // A private photo is never uploaded. The server writes the placeholder from the
  // description alone, so a photo marked private cannot leak into a public catalog
  // image by way of image-to-image generation.
  const photo =
    photoUri && input.visibility !== 'private'
      ? await encodeForUpload(photoUri, MODEL_INPUT_MAX_WIDTH)
      : null;
  return request<{ slug: string }>('/patterns/unknown', {
    method: 'POST',
    body: JSON.stringify({ ...rest, photo }),
  });
}

// ---------------------------------------------------------------- pricing

export function fetchPrice(slug: string): Promise<ApiResult<PriceQuote | null>> {
  return request<PriceQuote | null>(`/price/${encodeURIComponent(slug)}`);
}

/**
 * Collection totals need many quotes at once. The server caps a batch at 100 slugs, so
 * chunk here rather than in each caller, a collection larger than 100 items is the
 * normal case for anyone this app is built for, and a 400 on their shelf is not.
 */
const PRICE_BATCH_LIMIT = 100;

export async function fetchPrices(slugs: string[]): Promise<ApiResult<PriceQuote[]>> {
  const quotes: PriceQuote[] = [];
  for (let i = 0; i < slugs.length; i += PRICE_BATCH_LIMIT) {
    const chunk = slugs.slice(i, i + PRICE_BATCH_LIMIT);
    const result = await request<PriceQuote[]>('/price/batch', {
      method: 'POST',
      body: JSON.stringify({ slugs: chunk }),
    });
    // Partial failure loses the whole total rather than quietly under-reporting it.
    // A collection value that is silently too low is worse than one that says it failed.
    if (!result.ok) return result;
    quotes.push(...result.data);
  }
  return { ok: true, data: quotes };
}

// ---------------------------------------------------------------- scans

export async function logScan(input: {
  photoUris: string[];
  guesses: IdentifyResponse['guesses'];
  confirmedItemSlug: string | null;
  llmWasRight: boolean | null;
  consentedToTraining: boolean;
  hasBaseShot: boolean;
  source?: 'single' | 'set';
}): Promise<ApiResult<{ id: string }>> {
  const { photoUris, ...rest } = input;
  // The backend cannot read a phone-local file URI. Encode here, and only when the
  // user opted in, an un-consented scan sends no photo at all rather than sending
  // one the server is trusted to discard.
  const photos = input.consentedToTraining
    ? await Promise.all(photoUris.map((uri) => encodeForUpload(uri, MODEL_INPUT_MAX_WIDTH)))
    : [];
  return request<{ id: string }>('/scans', {
    method: 'POST',
    body: JSON.stringify({ ...rest, photos }),
  });
}

// ---------------------------------------------------------------- collection

export function pullCollection(): Promise<ApiResult<UserItem[]>> {
  return request<UserItem[]>('/collection');
}

export function pushCollection(items: UserItem[]): Promise<ApiResult<UserItem[]>> {
  return request<UserItem[]>('/collection', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

// ---------------------------------------------------------------- photos

/**
 * EXIF is stripped server side on ingest, before anything touches disk. Phone photos
 * carry GPS, and a public photo of a four-figure piece with the owner's home address
 * in the metadata defeats the entire point of the anonymous option.
 */
export async function uploadPhoto(input: {
  itemSlug: string;
  photoUri: string;
  visibility: PhotoVisibility;
  handle?: string;
}): Promise<ApiResult<{ id: string }>> {
  const base64 = await encodeForUpload(input.photoUri, CATALOG_PHOTO_MAX_WIDTH);
  const handle = input.handle?.trim();
  return request<{ id: string }>('/photos', {
    method: 'POST',
    body: JSON.stringify({
      itemSlug: input.itemSlug,
      visibility: input.visibility,
      photo: base64,
      ...(input.visibility === 'attributed' && handle ? { handle } : {}),
    }),
  });
}

// ---------------------------------------------------------------- auth

/**
 * Exchanges a provider identity token for our session. We store the provider's
 * subject and nothing else: no email, no name, no profile. Apple's private relay
 * works by default because we never ask for the address.
 */
export async function signIn(
  provider: AuthProvider,
  identityToken: string,
): Promise<ApiResult<Session>> {
  const result = await request<Session>('/auth/session', {
    method: 'POST',
    body: JSON.stringify({ provider, identityToken }),
  });
  if (result.ok) await setToken(result.data.token);
  return result;
}

export async function signOut(): Promise<void> {
  await setToken(null);
}

export function deleteAccount(): Promise<ApiResult<null>> {
  return request<null>('/account', { method: 'DELETE' });
}
