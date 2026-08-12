# Growing the catalog past CMoG, filed from real phone testing

Date: 2026-08-12, evening of the first hardware day. The user, after a perfect
3-for-3 Terra set scan: CMoG's library does not track everything. Promotional
pieces are missing, and so are the rare pieces that escaped the factory but are
known to collectors. The catalog needs a way to grow. Recorded here with the
constraints so next session starts from decisions, not archaeology.

## The measured accuracy trail so far (anecdotal, not the harness)

- First mixed stack: 3 of 4 right, wrong one repaired by hand.
- Terra full set: 3 of 3.
Real numbers come from the replay harness once labeled scans accumulate; these are
directional only.

## Sources beyond CMoG, each with its own rules

The CMoG lesson generalizes: facts are free to restate, prose and photographs are
not, and each source needs its own permission-shape read before anything is
fetched. Candidate sources collectors actually use: the standard printed
references (Rogove and Steinhauer's "Pyrex by Corning", the Pyrex Passion books),
community sites (PyrexLove, PyrexPotluck forums, collector wikis and Facebook
groups), and period primary sources (Corning trade catalogs, newspaper ads, which
are often public domain or thin-copyright and are the strongest evidence for
promotional pieces). Primary period advertising is likely the best fishing ground
for exactly the promotional items CMoG skips. No fetching from any of these
without an explicit judgment call recorded the way the CMoG one was.

## The data-model decision that gates all of it

Session 4 deliberately deferred a per-row provenance field, and this feature is
where that decision comes due. A catalog holding factory-documented items,
promotional one-offs, and collector-attested escapees in one table without saying
which is which would break the app's honesty rule the same way a bare price does.
Before bulk additions from any new source, `Item` (or `Pattern`) needs a
provenance notion: what kind of claim backs this row (factory record, period ad,
museum library, collector attestation), displayable wherever the entry renders.
This is a shared/types.ts and schema decision the user should sign off on.

## What already exists toward user additions

The scan flow's unknown-pattern path already creates a user-submitted pattern and
item (userSubmitted flag exists on Item). What does not exist: adding a new FORM
of a known pattern (Butterprint on an uncatalogued shape), editing or annotating
an existing entry, any moderation or review path for submissions beyond the photo
approval flag, and any provenance display. "Rare pieces that escaped the factory"
are exactly the case where collector attestation plus a photo is the only
evidence there will ever be, so the submission flow and the provenance field are
one feature, not two.

## Suggested order when this gets scheduled

1. Decide the provenance shape with the user (one enum on Item is probably
   enough; resist a sourcing table until measurement demands it).
2. Add-a-form-to-a-known-pattern in the scan and browse flows, provenance
   "collector attestation", quantity of evidence honest on screen.
3. Period-ad mining for promotional pieces (public-domain-leaning, best
   evidence-to-legal-risk ratio of every source listed).
4. Book and community sources only after their permission shape is read as
   carefully as CMoG's was.
