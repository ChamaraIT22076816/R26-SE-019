# SSL Learn — web app (PP2)

Interactive Sri Lankan Sign Language learning & practice module (R26-SE-019, Component 4).
React + Vite + TypeScript, with MediaPipe Tasks Vision running fully in the browser —
no video ever leaves the user's device.

## Run it

```bash
npm install   # also copies the MediaPipe WASM runtime into public/wasm (postinstall)
npm run dev   # http://localhost:5173
```

Requires a webcam. `npm run build` produces a static `dist/` deployable anywhere
(e.g. Vercel, same as the team's SSL-Transformer app).

## How it fits together

- `src/vision/handTracker.ts` — creates the MediaPipe `HandLandmarker` (VIDEO mode,
  2 hands, GPU delegate with CPU fallback). The WASM runtime and the model are served
  from **our own origin** (`public/wasm`, `public/models`) so demos don't depend on a
  CDN: `public/wasm` is regenerated from `node_modules` on every install by
  `scripts/copy-wasm.mjs`.
- `src/vision/types.ts` — `HandFrame` / `TrackedHand`: the plain-JSON frame format that
  the upcoming reference-recording tool and DTW comparison will operate on.
- `src/vision/useHandTracking.ts` — React hook owning the webcam stream, per-frame
  detection, skeleton overlay, and FPS / inference-latency stats (tracked from day 1
  because of the ≤300 ms feedback-latency target). Views subscribe to frames via a
  callback; the recorder buffers them.
- `src/components/` — `PracticeView` (live tracking), `RecordView` (countdown →
  record → review → save), `LibraryView` (replay / export / import / delete),
  `SkeletonPlayer` (replays recordings from landmarks alone — no video is stored).
- `src/storage/recordingStore.ts` — recordings persist in IndexedDB.

## Reference recordings

References ship bundled in `public/references/` (listed in `manifest.json`) and
come from two sources, kept distinguishable by a `source` field:

1. **The team's Kaggle corpus** (`source: "kaggle-dataset"`) — real SSL signers,
   converted to landmarks by `../tools/convert_references.py`. See
   `../tools/README.md` for the dataset, its CC0 licence, and conversion rules.
2. **Team recordings** (`source: "team-recording"`, `provisional: true`) — made
   in the Record tab. Per CLAUDE.md these are *test attempts for calibration,
   not ground truth*, so they are:
   - **labelled everywhere they appear** — an amber *provisional* badge in the
     Library and a warning above the reference in Practice and Scenario;
   - **outranked automatically**: `src/storage/references.ts` always prefers a
     non-provisional reference for the same gloss, whatever the dates. Drop in a
     School-for-the-Deaf recording later and it takes over with no deletions.

`src/scoring/references.test.ts` validates every bundled reference on each
`npm test`: manifest matches disk, 21 landmarks per hand, provenance present,
hands tracked in most frames, and — the important one — each reference scores a
perfect 100 against itself and strictly less against any other sign.

### Team workflow: recording your own

Only needed for glosses the dataset does not cover — currently the seven the
Introductions scenario needs: **ME, YOU, NAME, WHAT, WHERE, CAN, YOUR**.

For a usable reference: fill the frame from roughly the waist up, keep both
hands inside it for the whole sign, use even front lighting and a plain
background, and perform the sign once at a natural pace. The review screen
reports hand-tracking coverage — re-record anything below ~90%.

1. Open the **Record** tab, enter your name, pick a gloss.
2. Record → review the replay → **Save to library**.
3. In **Library**, hit **Export all for repo** — it downloads every recording
   plus a `manifest.json`.
4. Move those files into `public/references/` and commit. They then ship bundled
   with the app, so the whole team (and any demo machine) gets the same
   reference set.

Recordings store only landmark coordinates (~200 KB per sign), never video, so
they're safe to commit and share.

> Until you do step 3–4, your recordings live **only in your own browser's
> IndexedDB** — a cache clear loses them and nobody else can see them.

## Sign scoring (DTW)

`src/scoring/` compares a practice attempt to a reference recording:

- `normalize.ts` — turns each hand into per-frame features split into a
  **handshape** block (21 landmarks made wrist-relative and scaled by hand
  size → invariant to position and camera distance) and a **trajectory** block
  (the wrist path, centred and scaled → captures how the hand moves). Includes
  aspect-ratio correction so distances aren't distorted by the 16:9 frame.
- `dtw.ts` — classic dynamic time warping; aligns two sequences in time so
  attempts signed faster/slower than the reference still match.
- `score.ts` — `scoreAttempt(attempt, reference)` → overall 0–100 score,
  per-hand breakdown, per-landmark deviations mapped to fingers, and corrective
  hints. Handles one- and two-handed signs.

**Handedness.** Every attempt is scored twice — as performed and mirrored — and
the better result wins (`result.mirrored` says which). Sign languages let the
signer choose their dominant hand, so a left-dominant learner performing a
right-handed reference is signing *correctly* and must not be scored as a
missing hand.

Tested with `npm test` (vitest): self-match → 100; invariant to translation,
zoom, signing speed and capture resolution; discriminates wrong handshapes and
trajectories; points feedback at the finger that deviates.

> **Calibration TODO:** the distance→score anchors (`D_PERFECT`, `D_ZERO` in
> `score.ts`) and the shape/trajectory weights are provisional. Calibrate them
> against real reference recordings + expert judgement for the ≥90%-accuracy
> target.

## Learner model v1 (heuristic)

`src/learner/` tracks the learner and picks what to practise next:

- `attemptLog.ts` — every scored attempt is persisted (gloss, score, worst
  fingers, timestamp; no frames). This log is also the input the deferred
  error-mining work (K-means/PrefixSpan, Sep–Oct) will consume.
- `mastery.ts` — per-sign mastery as a recency-weighted score average (newest
  attempt counts half), banded New / Learning / Improving / Mastered
  (mastered needs ≥ 3 attempts). Practice selection ranks signs by
  *need* = unseen first, then weakness (75%) + staleness (25%, full after
  5 days). Deliberately simple and explainable; BKT + RL replaces it in the
  final phase without changing the attempt log.

The Practice tab logs every attempt and pre-selects the suggested sign (★);
the Progress tab shows summary tiles and per-sign mastery, weakest first.

## Scenarios

`src/scenario/` + `src/data/scenarios/` run a scripted conversation where each
turn asks for **one** sign, scored through the existing DTW path. Two of the
five proposal-approved scenarios ship:

| Scenario | Turns | Reference source |
|---|---|---|
| **Social Gathering (Introductions)** | 7 (ME, YOU, NAME, WHAT, WHERE, CAN, YOUR) | Team recordings — *provisional*. Aligned with Malkith's avatar glosses, so this is the integration demo. |
| **Restaurant** | 5 (KANAWA, BONAWA, 500, MILADII GANNAWA, BILPATHA) | Kaggle corpus — **real signers**. Demo this when reference quality matters. |

Verified end to end: with the Restaurant vocabulary loaded, a correct
performance scores 100 and performing a *different* sign from the same scenario
scores 33 or below with appropriateness 0 and the confusion named — including
the visually similar KANAWA/BONAWA pair. ~9 ms per turn.

- **Data-driven.** A scenario is a JSON file listing turns
  (`partnerLine`, `prompt`, `gloss`, `hint`). Adding another of the five
  proposal-approved scenarios means authoring JSON and listing it in
  `src/data/scenarios/index.ts` — no engine changes.
- **Graceful degradation.** Turns whose gloss has no reference recording are
  shown as *reference pending* and skipped, so the scenario runs with partial
  vocabulary and grows automatically as references land.
- **No silo.** Every turn logs to the same `attemptLog` as the Practice tab, so
  mastery and the progress dashboard cover scenario work too. The logged score
  is the **DTW accuracy**, not the rubric total, so "mastery" means one thing
  everywhere.

### Rubric — what is measured, and one honest deviation

*This section is written to be quotable in the report and defensible in a viva.*

The proposal scores each turn on four components: accuracy 40%,
appropriateness 30%, fluency-timing 20%, **non-manual markers 10%**. The
proposal names the components but does not define how to compute them, so the
definitions below are ours and are stated explicitly rather than implied.

**Deviation: non-manual markers are not scored.** They are facial expression,
head tilt and body movement — linguistically meaningful in SSL, but this build
tracks **hand landmarks only** (MediaPipe HandLandmarker, 21 points per hand).
The signal simply is not captured, so any number reported for it would be
fabricated. Their 10% is reallocated to accuracy, giving **50 / 30 / 20**.
Scoring non-manual markers requires face/pose landmarks and is named as future
work. The deviation is stated in `src/scenario/rubric.ts` and rendered in the
scenario summary UI, so a reader meets it without reading the source.

| Component | Weight | Operational definition | Known limitation |
|---|---|---|---|
| **Accuracy** | 50% | DTW distance between the attempt and the reference recording for that gloss, over wrist-normalised hand landmarks, mapped to 0–100. | Depends on reference quality; the distance→score anchors are not yet calibrated (see Calibration TODO above). |
| **Appropriateness** | 30% | *Did the learner produce the requested sign rather than a different one?* The attempt is scored against every **other** gloss in the library; the score reflects how far the requested gloss beats the best competitor. A tie scores 50. | A **closed-set** judgement: it can only detect confusion with signs we hold references for. It cannot detect a sign outside the library, and it grows sharper as the library grows. |
| **Fluency & timing** | 20% | Ratio of attempt duration to reference duration, symmetric in log space so twice-too-fast and twice-too-slow are penalised equally. Full marks within ±25% of reference pace. | Whole-clip pace only. It does not assess rhythm *within* a sign, or holds and transitions. |

Two design points worth stating explicitly:

1. **Fluency is a separate axis because DTW deliberately discards speed.** Time
   warping is what lets a slow learner still score well on accuracy; pace is
   therefore judged on its own rather than being invisible.
2. **Unmeasurable ≠ zero.** If a component has no data — appropriateness when
   the library holds a single sign, fluency when a take has no duration — it
   reports **n/a** and its weight is redistributed across the remaining
   components. Scoring it 0 would be a silent penalty for a gap in our data
   rather than a fault in the learner's signing.

> The conversational order in `introductions.json` is a **draft pending
> validation by an SSL teacher** (School for the Deaf, Ratmalana). Each turn
> asks for a single gloss; the surrounding text is English context, never a
> claim about SSL word order.

## Roadmap (PP2)

1. ~~In-browser hand tracking~~ ✅
2. ~~Reference-recording tool (landmark sequences saved/shared as JSON)~~ ✅
3. ~~DTW scoring of practice attempts vs references + corrective feedback~~ ✅
4. ~~Learner model v1 (mastery tracking, weighted practice selection) + dashboard~~ ✅
5. ~~Social Gathering (Introductions) scenario~~ ✅ *(retargeted from Restaurant —
   see the handoff; Restaurant needs food/drink vocabulary we have no references for)*
6. ~~Real reference data from the team's Kaggle corpus~~ ✅ *(80 signs from real
   signers: 25 A–Z fingerspelling + 55 verbs — well past the 20–30 target, and
   56 of them two-handed, which exercises the two-handed scoring path with real
   data)*
7. Integration with the team platform; pilot test; PP2 slides

### Open items

- **The Introductions scenario has no references, and cannot get them from this
  dataset.** Confirmed against the complete corpus: no standalone clips for
  ME/YOU/NAME/WHAT/WHERE/CAN/YOUR — they occur only inside sentence clips, and
  segmenting those is scoped as future work. The scenario degrades gracefully
  meanwhile, but needs a decision on its vocabulary source.
- **Practice chips need grouping.** The tab lists all 80 references as a flat
  chip list. It needs a category filter or search before the remaining
  categories (numbers, months, everyday words — ~66 more clips) are converted.
- **Verb glosses are Sinhala transliterations** (`KANAWA`, `BONAWA`), taken from
  the dataset's own filenames. English translations need a human who reads
  Sinhala; add them as a display field, never by guessing. **The Restaurant
  scenario's turn text assumes KANAWA=eat, BONAWA=drink, BILPATHA=bill,
  MILADII GANNAWA=buy — unverified, flagged in the script's `_draftNote`.**
