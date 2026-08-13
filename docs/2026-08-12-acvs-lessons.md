# The acvs rumil repo: tracking system and lessons for Backstamp

## Where the repo is

Found locally on the first hunt step: `/home/mattressburrn/Documents/Projects/acvs-customer-support-chat-gateway` (git repo, remote `jraburm_jcplc/acvs-customer-support-chat-gateway`). "rumil" is the product name (rumil = ccure-brain = ccerebro): an internal JCI support-intelligence RAG tool, FastAPI + Next.js, deployed via Docker Compose on a VM. A sibling directory `/home/mattressburrn/Documents/Projects/acvs-ragmod` holds parallel worktrees (`45a-prompt-cache-prefix` through `45i-structured-outputs` plus `integration`) used to build Epic 45 stories concurrently. No SSH or MRDockBox search was needed.

## The tracking system: BMAD artifacts without the framework

The repo adopted the BMAD method's artifact discipline (epics + stories) with none of the CLI tooling. Everything lives in `docs/bmad/`:

```
docs/bmad/
  README.md          how-to for the directory (start work, file a story, blocked protocol)
  CLAUDE.md          the method conventions; loaded when working in any backlog file
  project-brief.md   one-page rollup, updated only on direction changes
  prd.md             epic-shaped backlog, one section per epic (207 KB, the active source of truth)
  stories/
    _TEMPLATE.md     copy this to file a story
    <257 story files>
```

### The pieces

1. **`prd.md`** holds one section per epic: Goal, Acceptance Criteria, Out of Scope, and a Stories list linking child story files. Status legend on every epic heading: active, ready, not yet ready, done, blocked, retired/superseded. It explicitly superseded a flat `ROADMAP.md` punch list.

2. **`stories/<id>.md`** is the unit of execution. Naming: `<epic-tag>-<epic-number><story-letter>-<slug>.md`, for example `corp-1c-content-filter-policy-cutover.md`, `case-command-42b-case-briefing-backend.md`. Letters a/b/c within an epic; digits for follow-up sub-stories (`pg-18i1-header-fuzziness-tweak`). Epic-level stubs are `<tag>-<num>-epic.md`. 257 files, prefixes grouped by theme (redesign 67, case 19, admin 16, licensing 14, and so on).

3. **States:** ready / in-progress / done / blocked, plus Owner (session id or "unclaimed"), Created date, Estimate, Priority (P0..P3). Blocked stories are never deleted; the blocker note is the value.

4. **The Touches contract** is the distinctive part. Every story declares `OWNS exclusively` (files only this session edits) and `OFF-LIMITS` (files sibling active stories own). It exists because multiple Claude sessions run in parallel against the repo; Touches turns "don't step on the other Claude" into an explicit lockfile. When two stories must share a file, comment-marker pairs delimit each session's insertion region.

5. **The wave model:** stories within an epic group into waves by file ownership. Wave 1 = disjoint files, fired in parallel; Wave 2 = depends on Wave 1 deliverables; Wave 3 = sequential cross-cutting polish. Rule: if two stories want to be parallel but touch the same file outside a marker block, merge them into one story.

6. **The audit-first pattern:** for an epic spanning many surfaces, Wave 0 is a single read-only audit session that walks every surface and files one story per surface as a doc-only PR, then implementation waves fire. `admin-20-zero-audit.md` produced 14 stories this way; a redesign audit produced 20.

7. **Linkage to code:** commit and PR subjects carry the story id or issue number (`feat(chat): 42g radar/queue "Ask rumil" deep-links...`, `fix(snowflake): ... (RS-01/RS-02, epic #573 phase 1) (#579)`). The status flip records the date and optionally the merge SHA on the Status line. Done checklist on every story: PR merged, tests green, deploy checks, CLAUDE.md session log entry, PRD registration.

8. **Tooling:**
   - `.claude/commands/epic-ship.md` + `scripts/epic-ship.py`: a slash command that lists all stories matching an epic prefix as a JSON manifest, then dispatches one isolated-worktree subagent per story in parallel, with a scope lock ("read the story file but do NOT edit it; implement only its acceptance criteria") and prod-DB guardrails baked into every subagent prompt.
   - `scripts/project_dashboard.py`: builds a single self-contained HTML dashboard from GitHub issues + BMAD files, parsing provenance and gating from formulaic prose with regexes rather than a model.

9. **Judgment rules for when to file a story** (from `docs/bmad/CLAUDE.md`): file one for multi-file changes, anything adding an env var / column / feature flag, anything touching schema, architecture decisions whose "why" future-you will want, and bugs worth more than an hour. Skip stories for one-off scripts, sub-15-minute hotfixes, and small refactors.

### The template, verbatim (`docs/bmad/stories/_TEMPLATE.md`)

```markdown
# Story: <slug-matching-the-filename>

**Epic:** <epic name from prd.md>
**Status:** ready / in-progress / done / blocked
**Owner:** <session id, human name, or "unclaimed">
**Created:** YYYY-MM-DD

## Touches

List every file or directory this story will modify. Other sessions/agents must not modify these while status is `in-progress`. If your scope expands, update this list.

- `path/to/file.py`
- `path/to/component.tsx`

## Context

2-3 sentences a fresh agent (or future-you) can pick up cold. What's the situation, what's the goal, what's the constraint?

## Acceptance criteria

- [ ] Specific, checkable outcome 1
- [ ] Specific, checkable outcome 2
- [ ] Tests added / updated where relevant

## Out of scope

The thing that prevents scope creep. Explicit "we are NOT doing X in this story; X is its own story."

- Item not covered here
- Item deferred to <other-story-id>

## Dev notes

(Populated as work progresses. Decisions made, dead ends hit, why we chose X over Y. Future-you will thank present-you.)

## QA notes

(Optional. Test plan, edge cases worth validating, smoke commands.)

## Done

- [ ] PR merged
- [ ] Tests green
- [ ] Deploy/post-deploy checks complete, if this story requires production rollout
- [ ] CLAUDE.md session log entry appended
- [ ] Status flipped to `done` here
```

(Note: the template's headers omit Estimate and Priority, but the canonical shape in `docs/bmad/CLAUDE.md` includes them and real stories carry them.)

### A real completed story, verbatim (`docs/bmad/stories/atlassian-creds-36i.md`)

```markdown
# 36i — Feature-flag flip + migration runbook

**Epic:** 36 (Tiered Atlassian Credentials)
**Status:** done
**Depends on:** 36a-36h (all shipped)

---

## What shipped

1. **Migration runbook** at `docs/security/MIGRATION_RUNBOOK.md`
   - Pre-flight checklist (operator + [name redacted] + 2 L3s have tokens, validator has run)
   - Step-by-step `az containerapp update` flag flip procedure
   - Smoke test protocol (3 scenarios)
   - Rollback procedure (single env var revert, no data migration)
   - Environment variables reference table
   - Key rotation guide (generate + prepend + update)
   - Post-flip behavior comparison table
   - Known limitations (v1)

2. **Feature flag already wired** (shipped in 36b/36f):
   - `WRITE_REQUIRES_PERSONAL_TOKEN` in `api/settings.py` (defaults to `false`)
   - `require_personal_token()` in `api/atlassian_creds.py` checks the flag
   - `api/sr_draft_routes.py` enforces 412 when flag is ON and user has no token

## Acceptance criteria

- [x] Runbook documents pre-flight checklist
- [x] Runbook documents flag flip procedure (ACA env var)
- [x] Runbook documents smoke test protocol
- [x] Runbook documents rollback procedure
- [x] Runbook documents env var reference
- [x] Runbook documents key rotation steps
- [x] Feature flag defaults to OFF (safe default)
- [x] Flag flip requires NO code change, NO data migration

## Deviations

None — this is a pure documentation story.
```

(That trailing dash in "None — this is..." is in the original file; new Backstamp writing should not use em dashes.)

## What it does well, compared to Backstamp

Backstamp today: root `CLAUDE.md` (dense, good), `AGENTS.md`, `README.md`, a flat `docs/` with dated probe notes and `docs/superpowers/specs/`, and work state carried mostly in CLAUDE.md prose plus session memory. It works at Backstamp's current size, but there is no unit of work smaller than "the session" and no place where scope, acceptance, and out-of-scope live per feature.

Worth copying from rumil:

1. **Layered doc ownership with explicit routing.** Root `CLAUDE.md` is orientation only; `api/CLAUDE.md`, `ccerebro/CLAUDE.md`, `store/CLAUDE.md`, `docs/bmad/CLAUDE.md` each own their domain, and a "What lives where" table in the BMAD CLAUDE.md maps every concern to its file. Backstamp already splits app/backend/shared; per-directory CLAUDE.md files with a routing table would stop the root CLAUDE.md from absorbing everything (it is already dense enough that rules get buried).

2. **AGENTS.md as enforced process, not vibes.** rumil's AGENTS.md states the golden path as numbered rules, each carrying the dated incident that created it ("on 2026-07-30, 37 individually-green PRs produced a red main"). Backstamp's AGENTS.md covers ownership and build; adding the process rules with their evidence lines is the same move Backstamp's CLAUDE.md already makes for design rules.

3. **Out of scope as a first-class section.** rumil's own docs call it "often the most useful section," and reading real stories confirms it: it is where scope creep dies and where "X is its own story" gets recorded. Backstamp specs have design reasoning but not this.

4. **The audit annotation convention.** When the prd drifted, they did not rewrite epic bodies; every reconciled epic got a dated blockquote: filed status vs actual status, evidence with confidence labels (MEASURED / READ / TITLE-ONLY / UNVERIFIED, with the exact probe that would settle an unverified claim), and action. Backstamp already uses measured-vs-claimed language in its catalog; this is the same discipline applied to the backlog.

5. **A "Retired: do not re-litigate" table** in root CLAUDE.md (axis + why). Backstamp buries retirements in prose ("The old reasoning here is dead, measured 2026-08-11..."). A dedicated table is easier to check before re-opening a settled question.

6. **`docs/investigations/` with dated, issue-numbered files** for audit-style findings, instead of leaving them in session logs.

7. **Story-id-in-commit-subject convention.** Cheap, and it makes `git log --grep 42g` a complete history of a feature.

## Mistakes and lessons (do not repeat these)

1. **68 `AI_Continuation_Document-*.md` files sitting in the repo root**, plus a stray `TASK_HANDOFF-*.md` and `AI_ReviewBoard_Brief-*.md`. Session handoff docs were committed at top level, twice a day at peak, and never moved. The repo root listing is unusable without filtering. Backstamp already commits session continuation docs ("Add session 5 continuation document"); give them a directory (`docs/sessions/` or similar) from day one or they will pile up exactly like this.

2. **Backlog drift, then an expensive rescue.** `prd.md` went unmaintained from 2026-05-08 to 2026-07-27 while the code pivoted (Azure retired, features deleted). The header of the current prd admits it "drifted badly" with header-vs-Status self-contradictions inside single epics. Fixing it took a dedicated evidence-gathering audit pass across every epic. Lesson: the status flip must be part of the ship ritual (their Done checklist encodes this), because a backlog that is 80 percent stale is worse than none; sessions trusted stale statuses.

3. **Tracking-artifact succession scars.** `ROADMAP.md` superseded by `prd.md`; `docs/DOC_ROADMAP.md` now stamped HISTORICAL; `TODO-entra-cutover.md` living at the repo root outside the story system; and newer epics (#573) tracked as GitHub issues while old ones live in BMAD files, requiring `project_dashboard.py` to stitch the two together. Each successor kept the corpse around with a supersession note (good), but the count of parallel "where is the truth" files is the cost of adopting systems incrementally. Backstamp should pick one home for work tracking and route everything there from the start.

4. **Built-but-never-used subsystems.** RAPTOR hierarchical retrieval shipped feature-flagged, defaulted off everywhere, and its summary tree was never built (0 nodes in every environment); deleted as dead code two months later. The pgvector case-embedding pipeline (`api/db_pgvector.py`, worker, schema) was retired unused. The Entra SSO backend shipped complete while the frontend stayed a stub whose sign-in button alerts "Entra sign-in is not wired up yet"; the epic sat blocked with its unblocking path gone. Lesson: do not build the second half of a feature before the first half has a user; dark-shipped code that nothing turns on is deletion debt.

5. **Whole epics invalidated by a platform pivot.** Epics 1-3 and the cutover-* story family (13+ files) target Azure Container Apps, which was fully retired. The stories remain on disk as dead weight, marked retired rather than deleted so the record survives, but a third of Tier 1-3 roadmap prose is now annotations explaining why the body text is wrong. Lesson for Backstamp: keep epic bodies short and put volatile platform detail in stories, so a pivot invalidates small files, not the spine document.

6. **The empty-table incident** (from the session log): `support_cases` was empty in production for three months because the case corpus depended on two manual scripts invoked by nothing, while the feature that queried it silently returned nothing on every request. The generalizable lesson, stated in their own log: the write path had zero test coverage, and a pipeline that only runs when a human remembers is not a pipeline. Backstamp's equivalent risk is the catalog seed and sync paths.

7. **Naming drift.** rumil = ccure-brain = ccerebro = acvs-customer-support-chat-gateway; every doc has to open with the alias chain. Backstamp already solved this correctly (name lives only in `shared/branding.ts`; repo dir deliberately unrenamed). Keep it solved.

## Recommendation for Backstamp: adopt adapted, about a third of it

Backstamp is one developer with mostly serial sessions; rumil's system is engineered for N parallel Claude sessions on a production repo. Adopt the artifact shapes, skip the concurrency machinery until it is needed.

Take now:
- `docs/backlog/` (or `docs/bmad/`) with a short epics file (Goal / Acceptance / Out of scope / Stories per epic, status emoji legend) and a `stories/` directory using the `_TEMPLATE.md` above minus the Touches section. The Context / Acceptance criteria / Out of scope / Dev notes / Done-checklist shape is the value.
- The story-id filename convention (`scan-3b-exif-strip-verify.md`) and story ids in commit subjects.
- The Done checklist including "status flipped here," to prevent the drift that cost rumil an audit epic.
- A home for continuation documents that is not the repo root.
- The Retired table and the audit annotation convention (Backstamp already writes measured-vs-claimed evidence; this gives it a fixed format).

Defer until Backstamp actually runs parallel sessions: the Touches contract, wave model, marker pairs, alpha-ordering rules, and `/epic-ship` orchestration. They solve a collision problem Backstamp does not have yet; adopting them now is ceremony. If parallel sessions start, lift `docs/bmad/CLAUDE.md` nearly verbatim, since it is the distilled version of lessons that cost rumil real incidents.

Skip entirely: running a second tracker (GitHub issues) alongside the files; rumil needed a dashboard script to reunify what splitting created.
