# Handoff: PP2 endgame (kvn's learning module)

Rewritten 19 Aug 2026. **~11 days to the PP2 deadline (end of August).**

Read `CLAUDE.md` first for project context, then `learn-ssl-module/web/README.md`
for how the module works, then `learn-ssl-module/web/UIUX-PLAN.md` for the UI
work that has just landed. This file covers only *where things stand and what is
left*.

---

## State: the build is done, the evaluation is not

That split is the whole picture. Every line of planned software is written,
deployed and verified. Three of the four proposal targets are still unmeasured,
and that is where the marks are.

| Area | Status |
|---|---|
| Web app, capture, recorder, library | Done |
| DTW scoring + per-finger corrective feedback | Done, constants fitted to data |
| Reference data — 362 files, 351 signs, 2 corpora | Done |
| Learner model v1 + progress dashboard | Done (BKT deferred by plan) |
| Scenarios — Restaurant 5/5 refs, Introductions 1/7 | Done for PP2 scope |
| Latency instrumentation | Done — **needs ~20 scored attempts to produce figures** |
| **UI/UX overhaul** | **Done.** Six phases, see `web/UIUX-PLAN.md` |
| **Deployment** | **Live on Vercel** |
| Pilot study | Tooling ready, **zero participants** |
| SUS instrument | **Does not exist** — nothing in the app collects it |
| Team integration | Not started |
| PP2 slides | Not started |

### Proposal targets

| Target | Status |
|---|---|
| ≤300 ms feedback latency | Instrumented end to end; the Study tab reports median/p95/% within target. **Needs ~20 attempts** before p95 stops reading *provisional*. Closest to done — about an hour of kvn's own signing. |
| ≥90% accuracy vs expert | **Not measured, and no code addresses it.** The 74.3% separation figure is a different claim — do not conflate them. Weakest target. |
| ≥20% learning gain | Needs the pilot. Attempts now carry a `sessionId`, so "after N sessions" is countable rather than inferred from clock gaps. |
| SUS ≥70 | Needs the pilot **and a questionnaire that does not yet exist**. |

---

## What to do next, in order

1. **Recruit pilot participants.** Critical path: two targets depend on it and
   recruiting has lead time nothing else can absorb. Even 5 gives real numbers.
2. **Prepare the SUS questionnaire** — the standard 10 items, on paper or a
   form, administered right after each session. No code required, but it does
   not exist yet.
3. **Produce the latency figures.** ~20 scored attempts in Practice, then read
   the Study tab. Turns "instrumented" into a result that can be quoted.
4. **Freeze the UI.** See below — a research constraint, not a preference.
5. **Integration + slides.** Integration depends on teammates.

### The UI is frozen from the first participant

SUS scores a *system*. If P01 rates one build and P05 another, the mean
describes nothing that exists, and with n=5–10 each participant is 10–20% of it.
Learning gain is worse: a mid-study UI change is indistinguishable from
learning, which confounds the thing the study measures.

Anything that changes the interaction or the number is frozen — scoring
constants, capture window, reference selection, what feedback is shown, and
adding reference recordings (which changes what `practiceNeed` ranks). Copy and
non-interactive styling are lower risk. If a blocker *must* be fixed mid-pilot,
fix it, then record the date and which participants fell either side, and report
it as a limitation.

**Pin participants to a specific Vercel deployment URL, not the moving
production alias**, so a later deploy cannot silently change what they use, and
tag the commit piloted from.

---

## Deploying

**Use the CLI. Do not try to import the repo.** Vercel's "Import Git Repository"
only lists repos the Vercel account *owns*; this repo belongs to Chamara and
collaborator access is not enough. The CLI uploads from disk and never touches
GitHub:

```bash
cd learn-ssl-module/web
npx vercel@latest login
npx vercel@latest --prod
```

Answer `./` for the directory and decline the build-settings prompt —
`vercel.json` already carries them. Note that `vercel.json` **cannot hold
comments**: a `"// note"` key failed schema validation on the first deploy. That
reasoning now lives in `web/README.md`.

---

## Loose ends

- **The pilot has no SUS instrument.** Biggest gap outside the pilot itself.
- **kvn's 7 recorded glosses were never committed.** They exist only in one
  browser's IndexedDB. Introductions therefore shows **1 of 7**; Restaurant runs
  5/5 on real-signer references and is the one to demo.
- **Video references are the agreed fix for reference legibility, deferred.**
  A landmark skeleton cannot convey palm orientation or handshape detail.
  Mitigations shipped (frame-relative stroke sizing, translucent palm,
  depth-sized joints), but kvn's decision is that the real fix arrives with his
  **own recordings made with a teacher at the School for the Deaf** — signer-
  validated references he owns, which would also be the first ones the app could
  present as authoritative rather than provisional. The 3D avatar was considered
  and **rejected**: 7 glosses against 358, hand-authored, unvalidated by a Deaf
  signer. Interim option if it becomes urgent: ship video for a 20–30 sign pilot
  vocabulary only. Source clips are **not in the repo** — the converter read them
  from a `--dataset` path on kvn's own disk.
- **Yohan dataset citation is incomplete** — `learn-ssl-module/tools/README.md`
  has a marked TODO for the source URL.
- **`.git` is ~130 MB** from old venv blobs. Purging rewrites shared history, so
  it needs Chamara's coordination. After PP2.

---

## Things that will bite you

- **The embedded browser blocks webcams and does not composite.** Camera flows
  cannot be verified there; CSS animations sit frozen at frame 0 and
  `scrollTop` is inert, so `getComputedStyle` returns a transition's *start*
  value rather than its target. Seek animations via `getAnimations()` and read
  transition targets with transitions disabled — otherwise you will spend an
  hour diagnosing bugs that do not exist. This happened twice.
- **Stale HMR errors look like real bugs.** After editing several modules the
  console fills with errors naming symbols that no longer exist. Restart the dev
  server and open a *fresh tab* before believing any of them.
- **kvn commits himself.** Never run `git commit`. Give a commit summary line
  and a point-form description in **two separate copyable blocks** — he uses
  GitHub Desktop. No `Co-Authored-By` trailer.
- **He uses PowerShell 5.1** — no `&&`. Use `;` with `if ($?) { }`.
- **Never invent SSL vocabulary, glosses, sentence order, or accuracy figures.**
  Anything needing a certified signer goes to the School for the Deaf,
  Ratmalana. Verified English meanings live in `web/src/data/translations.ts` —
  all 75 Sinhala transliterations are now covered, and the other 276 labels are
  already English words, so that gap is closed.
- **Two corpora, two licences.** `kaggle_*` is CC0; `yohan_*` is
  **CC BY-NC-SA 4.0 — non-commercial**. A test fails if a file lacks its licence.

---

## Health check before you start

```bash
cd learn-ssl-module/web
npm install
npm test        # 115 tests + 1 skipped should pass
npm run build
npm run lint
```

`npm run dev` regenerates `public/reference-index.json` via a `predev` hook.
Running `npx vite` directly skips it and the app loads with no references at all.

Delete this file once PP2 is submitted.
