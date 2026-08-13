# biz-1: Scan metering

**State:** done
**Epic:** biz in prd.md

## Goal

The backend enforces the 25-free-scans-per-month tier and the app shows the
meter. One completed identify call (single or set, any photo count) consumes one
scan; errored calls consume nothing; an exhausted meter returns 429
`quota_exhausted` and the app explains when it resets. Model:
docs/2026-08-13-pricing-model.md.

## Touches

- backend/src/** (usage table, quota check in both identify routes, GET /quota)
- app/src/api.ts (install-id header, getQuota)
- app/src/db.ts (persisted install id)
- app/src/features/scan/** (meter display, exhausted state)
- shared/types.ts already carries ScanQuota (added by the orchestrator; agents
  do not edit it)

## Out of scope

Credit packs and IAP (biz-2), purchase copy (biz-3), any subscription, any
change to what the identify pipeline does with photos.

## Done checklist

- [x] The change itself
- [x] Tests or the one runnable check
- [x] Suites green, run by the orchestrator
- [x] prd.md story state flipped
- [x] Story id in the commit subject
