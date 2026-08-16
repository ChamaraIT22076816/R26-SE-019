# Handoff: PP2 endgame (kvn's learning module)

Written 16 Aug 2026. **~2 weeks to the PP2 deadline (end of August).**

Read `CLAUDE.md` first for project context, then `learn-ssl-module/web/README.md`
for how the module works. This file covers only *where things stand and what is
left*.

---

## State: ~65% of PP2

The split matters more than the number: **the build is ~90% done, the evaluation
is ~10% done.** Three of the four proposal targets are unmeasured, and that is
where the marks are.

| Area | Status |
|---|---|
| Web app (5 tabs), capture, recorder, library | Done |
| DTW scoring + per-finger corrective feedback | Done, constants fitted to data |
| Reference data — 363 files, 351 signs, 2 corpora | Done |
| Learner model v1 + progress dashboard | Done (BKT deferred by plan) |
| Scenarios — Restaurant (5/5 real refs), Introductions (0/7) | Done for PP2 scope |
| Latency instrumentation + reporting | Done — **needs one camera session to produce numbers** |
| UI/UX | Design system was already complete; responsive + a11y defects fixed. Aesthetic pass is kvn's call |
| Deployment | **Config written, never deployed** |
| Pilot study | **Export tooling ready, zero participants** |
| Team integration | **Not started** |
| PP2 slides | **Not started** |

### Proposal targets

| Target | Status |
|---|---|
| ≤300 ms feedback latency | **Instrumented end to end.** Every scored attempt times itself; Progress tab reports median/p95/% within target, and the pilot export carries it per attempt. Scoring stage measured in CI (`web/latency-report.md`). Needs a camera session to produce the figures. |
| ≥90% accuracy vs expert | **Not measured.** 74.3% separation exists on a stand-in task — a different claim, do not conflate them. |
| ≥20% learning gain | **Not measured** — needs the pilot |
| SUS ≥70 | **Not measured** — needs the pilot |

---

## What to do next, in order

1. **Deploy to Vercel.** Only kvn can do this; it blocks the pilot. Root
   Directory → `learn-ssl-module/web`; everything else is in `vercel.json`.
   Deploying cannot modify the repo — Vercel only reads it.
2. **Recruit pilot participants.** Critical path: two targets depend on it and
   recruiting has lead time. Even 5 participants yields real SUS and
   learning-gain numbers. Flow is in `web/README.md` → *Running a pilot session*
   (participant code → Progress tab → Export results as CSV/JSON).
3. ~~Formal end-to-end latency measurement~~ **Built.** What remains is a
   **10-minute camera session** — see the checklist below. Nobody has run the
   app with a webcam since it was instrumented, so the figures are still empty.
4. **UI/UX aesthetic pass** — kvn's call. The design system turned out to be
   complete, not absent as this file previously claimed; the defects found
   (mobile tab overflow, no keyboard focus ring, no `aria-current`, stale header
   copy) are fixed. What is left is taste, and needs eyes on a screen.
5. **Integration + slides.** Integration depends on teammates.

### Camera checklist (10 minutes, produces the latency numbers)

The embedded browser used during development blocks webcams, so none of this
could be verified there. Everything downstream of the camera *was* verified
synthetically — the store, the summary maths, the panel and the export were all
driven end to end with injected data and checked against hand-computed values.

1. `npm run dev`, open <http://localhost:5173>, **Practice** tab, start camera.
2. Record ~20 attempts across a few signs. 20 is the threshold at which the
   panel stops labelling its 95th percentile *provisional*.
3. Run a **Scenario** (Restaurant) too — scenario turns cost more, because
   appropriateness scores the attempt against each competing sign.
4. **Progress** tab → read the Feedback latency panel.
5. Export CSV/JSON; the latency columns should be populated for every attempt.

If a figure looks wrong, the thing to check first is `trackingMs`: it includes
landmark inference on the final frame, so on a slow machine it is the stage
that moves.

---

## Loose ends

- **kvn's 7 recorded glosses were never committed.** They exist only in his
  browser's IndexedDB, exported as `*_unknown.json` (signer field was blank —
  the Record tab now requires it). Until they land in
  `web/public/references/`, the Introductions scenario shows **0 of 7**.
  Either commit them or drop that scenario and demo Restaurant, which runs
  5/5 on real-signer references.
- **Yohan dataset citation is incomplete** — the download had no README, so only
  the author's name is known. `learn-ssl-module/tools/README.md` has a marked
  TODO for the source URL.
- **`.git` is ~130 MB** from old venv blobs in history. Purging rewrites shared
  history, so it needs Chamara's coordination. After PP2, not now.

---

## Things that will bite you

- **The embedded browser blocks webcams.** Camera flows cannot be verified
  there. Verify everything else synthetically (inject into IndexedDB, count
  painted canvas pixels, import modules directly), and give kvn a short manual
  checklist for the camera parts.
- **kvn commits himself.** Never run `git commit`; finish an increment and say
  "this is the commit point".
- **He uses PowerShell 5.1** — no `&&`. Use `;` with `if ($?) { }`.
- **Never invent SSL vocabulary, glosses, sentence order, or accuracy figures.**
  Anything needing a certified signer goes to the School for the Deaf,
  Ratmalana. Verb glosses are Sinhala transliterations; verified English
  meanings live in `web/src/data/translations.ts` and were filled in by kvn.
- **The converter venv** is `learn-ssl-module/tools/venv` (gitignored). Recreate
  with `python -m venv venv` + `pip install -r requirements.txt` if missing.
- **Two corpora, two licences.** `kaggle_*` is CC0; `yohan_*` is
  **CC BY-NC-SA 4.0 — non-commercial**. Every file records its own licence and a
  test fails if one doesn't. See `web/public/references/LICENSES.md`.

---

## Health check before you start

```bash
cd learn-ssl-module/web
npm install
npm test        # 89 tests should pass
npm run build
npm run lint
```

`npm test` used to fail 1 of 69 here: the corpus grid-search tests run for
seconds and vitest's default timeout is 5. That reads as a broken scorer rather
than a slow laptop, so `vitest.config.ts` now sets an explicit `testTimeout`.

Delete this file once PP2 is submitted.
