# Backend

Node 26 + Hono + built-in `node:sqlite`. JSON routes return `ApiResult<T>`.

## Run

```bash
npm start
npm run typecheck
node --import tsx --test src/*.test.ts src/**/*.test.ts
```

The default server is `http://localhost:8787`. It reads `../data/catalog.json`, stores
SQLite data in `data/catalog.sqlite`, and stores sanitized JPEGs in `data/photos/`.

## Environment

| Variable | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Identification and unknown-pattern photo descriptions | Uses `claude-opus-5`; missing key makes `/identify` return `upstream_failed`. |
| `SOLDCOMPS_API_KEY` | Sold price quotes | Primary source. Missing key makes the source unavailable. |
| `EBAY_APP_ID` | Active-listing fallback | eBay OAuth client ID. |
| `EBAY_CERT_ID` | Active-listing fallback | eBay OAuth client secret. Browse cannot authenticate with the App ID alone. |
| `SESSION_SECRET` | Sessions and authenticated routes | At least 32 bytes. |
| `GOOGLE_CLIENT_ID` | Google identity-token verification | Token audience. Provider JWKS signatures are verified. |
| `APPLE_CLIENT_ID` | Apple identity-token verification | Token audience/service ID. Provider JWKS signatures are verified. |
| `IMAGE_GEN_PROVIDER` | Optional placeholder generation | Only `openai` is implemented. Any other or missing value selects the null generator. |
| `IMAGE_GEN_API_KEY` | Optional placeholder generation | Used only when `IMAGE_GEN_PROVIDER=openai`. |
| `PORT` | Server binding | Defaults to `8787`. |
| `DATABASE_PATH` | SQLite location | Defaults to `backend/data/catalog.sqlite`. |
| `PHOTO_DIR` | Sanitized JPEG location | Defaults to `backend/data/photos/`. |
| `CATALOG_PATH` | Seed catalog location | Defaults to `data/catalog.json` at the repo root. |

Prices, including no-result lookups, are cached by item slug for seven days. SoldComps
is attempted first; eBay Browse active listings are used only when sold comps fail or
return no results. Transient upstream failures are not cached.

## Unfinished or constrained

- `app/src/api.ts` sends device-local `photoUris` to `/scans` and `/patterns/unknown`.
  The backend cannot read a phone-local URI. Consented scan storage and vision-written
  unknown-pattern descriptions work when that field contains a base64 JPEG; otherwise
  the scan is logged with `photoRef: null` and the submitted written description is used.
- Attributed uploads have no handle because the client sends none and auth deliberately
  stores no profile. They remain queued with `uploaderHandle: null`.
- Public-photo approval is represented in SQLite but there is no review/approval tool.
- Application-level rate limiting is not implemented. Rate-limit `/identify`, pricing,
  and unknown-pattern routes at the deployment gateway before exposing them publicly.
- Placeholder generation assumes OpenAI's `gpt-image-2` Images API. When unconfigured or
  when generation fails, the catalog entry is still created without placeholder art.
- Collection sync intentionally persists only `(user_id, item_slug, status, quantity)`.
  `condition`, `notes`, and `updatedAt` cannot round-trip under that privacy contract.
