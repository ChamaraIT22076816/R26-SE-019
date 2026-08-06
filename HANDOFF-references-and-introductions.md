# Handoff: real reference data + Introductions scenario

Written 1 Aug 2026 after a planning session with kvn in Cowork. Two tasks, independent — can be done in either order or in parallel. Task 1 unblocks calibration and the pilot; Task 2 is Week 6 of the PP2 plan, retargeted.

Read `CLAUDE.md` first for project context.

---

## Decision that changed: Restaurant → Introductions

The PP2 scope doc said the Week 6 scenario would be **Restaurant**. It is now **Introductions** (a first-meeting conversation).

Why: Restaurant needs food/drink/price signs that do not exist in our reference set, and inventing SSL glosses is not acceptable. The seven seed glosses we already have — ME, YOU, NAME, WHAT, WHERE, CAN, YOUR — are exactly a first-meeting exchange, Malkith's avatar can already perform every one of them, and it needs zero new vocabulary.

This is **not** a deviation from the approved proposal: "Social Gathering — casual conversation" is one of the five approved scenarios, and Introductions is a scoped instance of it. Refer to it in code and slides as the **Social Gathering (Introductions)** scenario so it maps cleanly to the proposal.

---

## Task 1 — Build real references from a public SSL video dataset

**Goal:** replace the empty `web/public/references/manifest.json` (`{"files": []}`) with reference sequences derived from real SSL signers, for as many of the seven seed glosses as the dataset covers.

### Source

**Decision (revised 1 Aug 2026):** use the **same dataset both teammates already use** —
`https://www.kaggle.com/datasets/dckahawearachchi/sinhala-sign-language-dataset` ("Sinhala Sign Language Video Dataset"). Chamara trained on it and Malkith's avatar glosses come from it. Sharing one corpus means "correct" means the same thing across all three components, and removes regional-variation mismatch at integration. An earlier draft of this handoff said to pick an independent dataset — that is superseded.

It is a **video** dataset, so landmark extraction is part of this task. Do not expect a preprocessed `.npz`. kvn supplies the local path; do not download anything yourself.

`sinhala-sign-language-translator/src/kaggle_data_loader.py` (Chamara's, sibling folder — **read only, never modify**) is a working video→landmark pipeline. Use it as a reference implementation for the extraction pattern. Note its per-frame layout, in case kvn later supplies data in that form:

| Segment | Landmarks | Values | Slice |
|---|---|---|---|
| Pose | 33 × (x,y,z,visibility) | 132 | `[0:132]` |
| Left hand | 21 × (x,y,z) | 63 | `[132:195]` |
| Right hand | 21 × (x,y,z) | 63 | `[195:258]` |

Our app uses **hand landmarks only** — discard pose either way.

### Steps

1. **Confirm the dataset is on disk** and ask kvn for its name, URL and licence before processing. Do not download anything yourself. Record the licence in `learn-ssl-module/tools/README.md` and confirm that committing *derived landmark JSON* is permitted; if unclear, flag it to kvn rather than committing.
2. **Check vocabulary coverage.** List the dataset's labels and map them to `SEED_GLOSSES` (`web/src/data/glosses.ts`). Labels may be Sinhala or transliterated, so mapping may not be exact — propose a mapping and have kvn confirm it; never guess a gloss silently. Report coverage before converting. Partial coverage is fine; the remainder gets recorded manually.
3. **Write the converter** at `learn-ssl-module/tools/convert_references.py` (new `tools/` folder; plain Python, argparse, deps limited to numpy/opencv/mediapipe):
   - Input: dataset root + the confirmed label mapping. Output: one JSON per gloss into `web/public/references/`, plus a regenerated `manifest.json` matching the exact shape the app already expects.
   - Extract hand landmarks per frame with MediaPipe; keep sequences at their natural length (DTW handles variable length — do not force-resample to 30 frames unless the app's scorer requires it).
   - If a gloss has multiple example videos, pick one clean take per gloss for PP2 and note the others for later multi-reference work.
   - **Match the app's format and normalisation exactly.** Locate the existing normalisation and reference-export code in `web/src/` (used by `RecordView` / the DTW scorer) and mirror it — same wrist-centring, same scale divisor, same handedness/mirroring convention as the recent "Fix mirrored signing" fix. If the app's normalisation lives in TS only, factor the constants into one place and document them in the converter so the two cannot drift.
   - Record provenance in each file: source dataset name, label, signer id if available, and `"source": "kaggle-dataset"` so these are distinguishable from browser-recorded ones.
4. **Verify numerically, not by eye.** Feed a converted reference back through the DTW scorer against itself — self-similarity must score ~perfect. Then score two different glosses against each other and confirm a clearly worse score. Add this as a test alongside the existing `learner/*.test.ts` suite (or a Python equivalent if simpler).
5. **Do not delete or overwrite** any references kvn recorded in the browser. If a gloss exists from both sources, keep both and let the manifest carry the `source` field.
6. Commit converted references to git — they are small JSON and must be in the repo for demos.

### Acceptance

`npm run dev`, open Practice, and every covered gloss loads a real reference and scores a live attempt. Report to kvn: which glosses are covered, which still need recording, and the self-similarity numbers.

---

## Task 2 — Social Gathering (Introductions) scenario

**Goal:** a data-driven scenario engine plus one authored script, reusing the existing DTW scoring path.

### Design constraints

- **Data-driven.** The engine reads a JSON script; adding scenario #2 later must mean authoring JSON, not writing code. Put the script at `web/src/data/scenarios/introductions.json`.
- **Only the seven seed glosses.** Never invent an SSL gloss, and never invent multi-sign SSL sentences — SSL word order is not English and none of us can validate it. Each turn prompts **one** gloss, with English context text around it.
- **Graceful degradation.** If a turn's gloss has no reference yet, skip it with a visible "reference pending" state rather than crashing. The scenario must run today even with partial coverage from Task 1.

### Turn shape

Each turn: a partner line (English context text, optional avatar gloss to play), the single gloss the learner must produce, and a hint.

### Phrases — scope this carefully

The scenario must cover short **phrases**, not only isolated words, but note the linguistic constraint: real signing co-articulates, so a fluent phrase does **not** equal its word references concatenated. Do not attempt continuous-signing segmentation.

For PP2:

- A phrase is an ordered list of glosses. The learner produces them **one at a time**, each scored by the existing DTW path against its word reference.
- Add a **phrase-level fluency metric**: inter-sign transition time and total phrase duration, surfaced alongside per-sign accuracy. This satisfies the proposal's "fluency, timing" criteria without solving continuous recognition.
- **3–5 phrases only**, built from the seven seed glosses.
- **Word order is inherited, not invented.** Take gloss ordering from Malkith's speech→gloss mapper (`SSL-Transformer/`, read-only) so the learning module and the avatar agree. If his mapper does not cover a phrase, leave it out rather than guessing.
- Header comment on the script file: `// Draft phrase set — gloss order inherited from SSL-Transformer's mapper; pending validation by an SSL teacher (School for the Deaf, Ratmalana).`
- Add a short "Limitations" note in `web/README.md`: signs are evaluated individually; connected/continuous signing evaluation is future work.

Also check during Task 1 whether the dataset contains any **sentence-level** clips. If it does, report it to kvn — it is a stretch goal, not PP2 scope.

### Scoring

The proposal specifies accuracy 40% / appropriateness 30% / fluency-timing 20% / non-manual markers 10%. **We capture hands only, so non-manual markers cannot be scored.** Redistribute that 10% into accuracy and record the deviation in a comment and in the scenario summary UI — an examiner asking "how do you score facial expression?" must get an honest answer, not a fabricated number.

### Acceptance

A learner can run the scenario start to finish, each turn scored by the existing DTW path, ending on a summary screen (per-turn scores, total, weakest sign). Attempts flow into the existing `attemptLog` / mastery model — no separate silo.

---

## Guardrails (both tasks)

- Do not modify teammates' folders (`sinhala-sign-language-translator/`, `SSL-Transformer/`, `soundguard-karindra/`). Read only.
- Do not invent SSL vocabulary, glosses, sentence order, or accuracy figures.
- Keep the PP1 Python demo (`learn-ssl-module/feedback_demo.py`) intact.
- Small, reviewable commits; keep the test suite green.
- Ask kvn before adding any new runtime dependency.
- Delete this handoff file once both tasks are done and kvn confirms.
