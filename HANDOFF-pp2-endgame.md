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
| UI/UX polish | **~40% — untouched since week 1** |
| Deployment | **Config written, never deployed** |
| Pilot study | **Export tooling ready, zero participants** |
| Team integration | **Not started** |
| PP2 slides | **Not started** |

### Proposal targets

| Target | Status |
|---|---|
| ≤300 ms feedback latency | Component figures only (~23 ms scoring, ~6 ms per score). **No formal end-to-end measurement.** |
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
3. **Formal end-to-end latency measurement** — closes a target that is currently
   only estimated. Instrument capture → landmark → score → feedback rendered.
   Claude offered to build this; it was not started.
4. **UI/UX polish** — kvn's strongest area, entirely unstyled since week 1, and
   the first thing an examiner sees. Highest visible impact per hour.
5. **Integration + slides.** Integration depends on teammates.

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
npm test        # 69 tests should pass
npm run build
npm run lint
```

Delete this file once PP2 is submitted.
