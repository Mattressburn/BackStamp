# store-2: Account deletion end to end

**State:** done
**Epic:** store in prd.md

## Goal

A signed-in user can delete their account from Settings. DELETE /account
removes every row keyed to the user (collection, scans plus scan_photos and
their JPEG files, photos they uploaded including approved shared rows plus
files, scan_usage) per the table in docs/2026-08-12-legal-research.md section 2.

## Touches

- backend/src/** (DELETE /account route, deletion logic, tests)
- app/src/api.ts (deleteAccount)
- app/src/app settings screen (destructive row, two-step confirm, sign-out on
  success)

## Out of scope

Sign in with Apple token revocation (store-3): deliberately deferred until
Apple sign-in is verified working on device, so a later failure can be
attributed. Session-token revocation: stateless signed claims stay valid until
exp by design; a deleted user's token sees an empty account (code comment
records this).

## Done checklist

- [x] The change itself
- [x] Tests or the one runnable check
- [x] Suites green, run by the orchestrator
- [x] prd.md story state flipped
- [x] Story id in the commit subject
