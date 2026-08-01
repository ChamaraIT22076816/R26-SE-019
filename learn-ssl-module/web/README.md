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

## Team workflow: reference recordings

1. Open the **Record** tab, enter your name, pick a gloss (start with the seven
   avatar glosses: ME, YOU, NAME, WHAT, WHERE, CAN, YOUR).
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

## Scenario: Social Gathering (Introductions)

`src/scenario/` + `src/data/scenarios/` run a scripted conversation where each
turn asks for **one** sign, scored through the existing DTW path.

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

### Rubric, and one honest deviation

The proposal scores accuracy 40% / appropriateness 30% / fluency-timing 20% /
**non-manual markers 10%**. This build captures *hand landmarks only*, so
non-manual markers (facial expression, head and body movement) **cannot be
measured at all**. That 10% is folded into accuracy → **50 / 30 / 20**. The
deviation is stated in `src/scenario/rubric.ts` and shown in the scenario
summary UI, so it is visible to a reader rather than buried in code.

What each component actually measures — all three are proxies, documented as such:

| Component | Basis |
|---|---|
| Accuracy 50% | DTW match against the reference for that gloss. |
| Appropriateness 30% | Whether the attempt matches the requested gloss better than every *other* gloss in the library — i.e. did you sign the right thing. |
| Fluency & timing 20% | Pace vs the reference (symmetric in log-space; DTW deliberately ignores speed, so it is judged here). |

A component with no data (e.g. appropriateness when the library holds only one
sign) reports **n/a** and its weight is shared across the rest — never scored as
zero, which would be a silent penalty.

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
6. Real reference data from the public Kaggle SSL dataset (`tools/convert_references.py`)
7. Integration with the team platform; pilot test; PP2 slides
