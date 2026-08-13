# Backstamp backlog

Adopted 2026-08-12 from the acvs/rumil tracking system
(docs/2026-08-12-acvs-lessons.md), with its two scars deliberately avoided: this
file gets updated when stories ship (their prd drifted unmaintained for eleven
weeks), and session continuation documents live in docs/continuations/, never at
the repo root (theirs collected 68).

How it works: epics live here with Goal, Acceptance, Out of scope, and Stories.
A story gets its own file in docs/stories/ (copy TEMPLATE.md, name it
`<epic-tag>-<number>-<slug>.md`) when work on it starts, not before. Story ids
go in commit subjects. States: ready, in-progress, done, blocked.

## EPIC ck: The community knowledge engine

Full narrative: docs/2026-08-12-epic-community-knowledge.md ("I don't want your
data, I only want Pyrex knowledge and photos").

**Goal:** Backstamp becomes the reference the community maintains together:
crowd-sourced knowledge and photographs, checked before they become claims.

**Acceptance:** a collector can submit a photo, a combination, a correction, or
an observation; every submission is a claim carrying evidence; nothing reaches
the shared catalog without passing the checking bench; every published claim
wears its label.

**Out of scope:** the marketplace (a year out, minimum); any collection of
personal data beyond the opaque subject ID and a chosen handle; automatic
publication of anything.

**Stories:**
- ck-1 Submission lanes (photo exists; combination exists; correction and
  observation do not) [ready]
- ck-2 The checking bench (generalize the approval gate; evidence rules;
  return-with-reason) [ready]
- ck-3 Backstamp-era rules as catalog data (the Opal test) [ready]
- ck-4 Book ingestion through the digitizer (owner is acquiring the book)
  [blocked: book not yet in hand]
- ck-5 Contributor identity without personal data (handle plus accepted-claim
  count; trusted-reviewer role) [ready]
- ck-6 The one-breath privacy policy shipped in-app (draft exists at
  docs/legal/privacy-policy.md) [ready]

## EPIC store: App Store submission readiness

Source: docs/2026-08-12-legal-research.md (eight blocking items, B1 to B8).

**Goal:** Backstamp can be submitted to the App Store without a rejection on
review guidelines or an obligation the app cannot honor.

**Acceptance:** all eight blocking items closed; the privacy policy's every
claim is mechanically true.

**Out of scope:** marketplace-era terms; DMCA registered agent (complaint route
via report action suffices at launch scale).

**Stories:**
- store-1 Privacy policy and terms hosted and linked in-app (drafts exist in
  docs/legal/) [ready]
- store-2 Account deletion end to end: DELETE /account, collection, scans,
  photos including approved shared rows, on-disk files [ready]
- store-3 Sign in with Apple token revocation (authorization-code exchange at
  sign-in, revoke at deletion) [ready]
- store-4 UGC report, block, and published contact [ready]
- store-5 Privacy nutrition labels plus expo privacy manifest [ready]
- store-6 Verify production Gemini key is paid tier and record the evidence
  [ready]

## Field reports awaiting reproduction

- Scan tab "will not stay selected" (2026-08-12, on device). Full navigation
  trace found no unprompted navigation (scratchpad tab-bounce report, filed in
  the commit that carries this line). Structural suspect: piece pages are
  pushed outside the three registered native-tab routes; Expo documents that
  shape wants a nested Stack. Needs a device repro (which screen it lands on,
  what was tapped) before a causal fix.
