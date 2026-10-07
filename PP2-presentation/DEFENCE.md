# Defending the Learn module at PP2

Metric selection · dataset choice · methodology · repeatability — plus a
question bank with answers.

Scope: **kvn's component (IT22552860)**, the interactive SSL learning and
practice module. Written 31 Aug 2026 from the code as it stands.

Every figure quoted here was regenerated tonight and agrees with the reports
committed in the repository. Provenance for each one is in
[EVIDENCE.md](EVIDENCE.md).

---

## 0. The thirty-second version

If you are asked one question and have one answer:

> "The module grades how well a learner performed a sign they were asked to
> perform. It compares their hand-landmark sequence to a reference recording by
> a real signer using Dynamic Time Warping, and maps the distance to a 0–100
> score on a scale fitted to 557 recordings from that corpus. On that corpus a
> correct rendition scores 28.7 points higher than a different sign on average,
> with an ROC AUC of 0.744. We are explicit that this is a *grader*, not a
> classifier, and that the ≥90%-against-expert target in our proposal is not yet
> measured — it needs learner attempts graded by an SSL teacher, which is the
> pilot."

Everything below expands one part of that.

---

## 1. Why DTW, and not a neural classifier

**The question behind the question:** "your project is titled *transformer-based*
— why is your component not a transformer?"

**Answer.** The component's job is not recognition. Recognition is Lahiru's
component and it *is* a learned model. This component has to answer a different
question: *given that the learner was asked for `THANK_YOU`, how well did they
perform it, and what specifically was wrong?* Four reasons DTW is the right tool
for that:

1. **It produces localisable error, not a label.** DTW yields an alignment path,
   so the deviation can be attributed to a specific joint at a specific moment.
   That is what makes "your ring finger is too extended" possible. A classifier
   returns a class and a confidence; neither can be turned into a corrective
   hint without inventing the explanation.
2. **It is invariant to speed by construction.** A learner signs slowly. Time
   warping absorbs that, so a slow-but-correct attempt is not punished for being
   slow. (Pace is then judged separately and deliberately — see §3.)
3. **It needs no training data per sign.** One reference recording is enough to
   score a sign. A learned scorer would need labelled *learner* attempts — the
   exact data that does not exist for SSL, and the thing the pilot is meant to
   start producing.
4. **It decouples this component from the rest of the project.** The learning
   module works whether or not the recognition model is finished, and
   integration later is additive through a stubbed interface. That was a
   deliberate risk-management decision at PP2 scoping.

**Concede cleanly:** DTW is not the final answer. Once expert-graded learner
attempts exist, a learned scorer trained on them is the obvious successor, and
the attempt log is already recording what it would need.

---

## 2. Metric selection

### 2.1 What is measured, and why each

| Metric | Why it, and not something else |
|---|---|
| **Normalised DTW distance** | The primitive everything else derives from. Normalised by hand size so it is invariant to camera distance, and wrist-relative so it is invariant to where in frame the learner stands. |
| **ROC AUC** | Threshold-free, and **insensitive to class imbalance** — which this evaluation has (524 positive / 992 negative). It is the honest headline. |
| **Separation accuracy at the best single threshold** | Reported because it is directly interpretable, always **alongside its baseline**. On its own it flatters. |
| **Balanced accuracy** | Reported to show what the imbalance was hiding. |
| **Score gap (0–100)** | The operational metric — the thing the learner actually sees. 28.7 points. |
| **Scoring cost (ms)** | The half of the ≤300 ms target measurable without a camera or a participant. |

### 2.2 The imbalance problem, stated before you are asked

**This is the sharpest question available to the panel. Get there first.**

The evaluation set has 524 positives and 992 negatives, so:

| | |
|---|---|
| Majority-class baseline ("always say *different sign*") | **65.4%** |
| Best single-threshold accuracy | **74.6%** |
| **Improvement over baseline** | **+9.2 points** |
| Balanced accuracy at that threshold | **65.4%** |
| **ROC AUC** | **0.744** |

At the best-accuracy threshold, TPR is 0.357 and FPR is 0.048 — the optimum
buys accuracy by rejecting, which is what an imbalanced set rewards.

**The answer:** *the product never applies a threshold.* There is no classifier
in the shipped system. The threshold exists only as an evaluation device for
characterising the distance metric's discriminative power. What ships is the
continuous map from distance to a 0–100 score, and on that axis:

- correct rendition — mean **56.7**, median 60
- different sign — mean **28.0**, median 24
- **28.7-point gap**; 60% of correct renditions score ≥ 50, against 21% of
  different signs.

`fig9-baseline-comparison.png` puts the baseline on the slide, and
`fig8-score-separation.png` shows the operational separation. Present both.

### 2.3 Why the separation figure is not the ≥90% target

The proposal target is **≥90% feedback accuracy against expert judgment**. The
74.6% figure measures something else — whether a correct rendition can be told
apart from a different sign. **They must not be conflated,** and the repository
says so in three places independently (`calibration-report.md`,
`score.ts`, `README.md`).

The ≥90% target requires learner attempts graded by an SSL teacher. Those do not
exist yet. That is a gap, it is named, and closing it is the pilot's job.

---

## 3. Methodology choices

### 3.1 The corpus labels itself — no annotation was invented

The reference corpus contains several takes of each sign by the same signer.
That gives labels for free:

- two takes of **the same** sign = a correct rendition performed twice (positive)
- takes of **different** signs = a wrong-sign attempt (negative)

No human annotation is involved and none is claimed. This is what makes the
calibration honest at PP2 scale: the alternative would have been to guess
thresholds, which is exactly what the previous constants did.

**The limitation, stated on the report itself:** every take is by *one fluent
signer*, so this measures the natural variation of a **correct** rendition —
narrower than a learner's would be. Thresholds derived here are **optimistic**.

### 3.2 Constants are fitted, and one fitted value was deliberately rejected

`W_SHAPE` / `W_TRAJ` weight handshape against movement. They were originally
0.7/0.3 by assumption. A grid search over 11 weightings on 24 signs measured
them (`fig3-weight-sweep.png`):

- separation rises **monotonically** with `W_SHAPE`
- the **maximum is 78.6% at `W_SHAPE` = 1.0** — i.e. discarding movement entirely
- **the shipped value is 0.8, scoring 74.2%**

**We did not take the maximum, on purpose.** The search optimises *"is this the
same sign?"*, a classification objective. The scorer's job is to *grade a known
sign*. Movement is a phonological parameter of SSL — a learner with the right
handshape and the wrong movement has made a real error, and a scorer blind to
movement would award them full marks.

This is the strongest single item in the defence: it is a documented case of
**declining a metric improvement because the metric was not the goal**. If you
get one open-ended "tell us about a design decision" question, tell this one.

Two further changes were tried and reverted, both recorded:

| Change | Effect | Verdict |
|---|---|---|
| Sequence-stable hand-size scaling | 73.7% → 73.4% | No effect; reverted |
| Trajectory as velocity instead of position | 73.5% → **75.5%** | **Reverted despite winning** — a unit test showed a learner moving in entirely the wrong direction still scored 100 |
| `W_SHAPE` = 1.0 | **78.6%**, the maximum | Rejected, as above |

### 3.3 The score scale is fitted, and the previous scale was wrong

`D_PERFECT` = 0.22 and `D_ZERO` = 0.77 are the **p10 and p90 of the measured
correct-rendition distribution**. So the best tenth of correct renditions score
100 and the worst tenth score 0 (`fig4-score-scale.png`).

The previous values were 0.05 / 0.35, chosen before any data existed. `D_ZERO`
sat *below* the median correct rendition — **a genuinely correct attempt scored
zero.** Say this if asked what calibration changed; it is a concrete
before-and-after and it demonstrates the calibration was necessary rather than
ceremonial.

### 3.4 A grader, not a classifier — and the evidence for that distinction

Over 1,766 distinct-sign pairs from 60 bundled references, the closest sit at
distance **0.135** (`30` vs `40`), **0.140** (`BALANAWA` vs `C`), **0.157**
(`200000` vs `300000`). The median distance between two takes of the *same* sign
is **0.458**.

So some genuinely different signs are closer together than two correct takes of
one sign typically are. A high score is therefore **not** proof the right sign
was made (`fig7-confusable-pairs.png`).

This is why "appropriateness" in the scenario rubric compares only within a
scenario's small vocabulary rather than across all 490 references — a bounded
closed-set judgement that is meaningful, instead of an open-set one that would
not be.

### 3.5 One honest deviation from the proposal: non-manual markers

The proposal scores a scenario turn as accuracy 40% / appropriateness 30% /
fluency-timing 20% / **non-manual markers 10%**.

**Non-manual markers are not scored.** They are facial expression, head tilt and
body movement — linguistically meaningful in SSL, but this build tracks **hand
landmarks only** (MediaPipe HandLandmarker, 21 points per hand). The signal is
not captured, so any number reported for it would be fabricated. The 10% is
reallocated to accuracy, giving **50 / 30 / 20**.

The deviation is written into the source, rendered in the app's own scenario
summary, and documented in the README. Scoring non-manual markers needs face and
pose landmarks and is named as future work.

A related honesty rule in the rubric: **unmeasurable ≠ zero.** If a component
has no data, it reports *n/a* and its weight is redistributed. Scoring it zero
would penalise the learner for a gap in our data.

### 3.6 Latency — an operational definition, erring in the safe direction

The clock starts at **capture of the final frame of the attempt** — the earliest
instant the system could know the sign was finished — and stops when the
**corrective feedback has been painted**.

**Excluded because JavaScript cannot observe them:** the camera's own
sensor→browser delay, and the display's response time after painting. So every
figure is a *software pipeline* latency and is quoted as such, never as
glass-to-glass.

The measurement **errs high** in two places, which is the safe direction for an
"under 300 ms" claim: the take ends on whichever frame arrived last (charging up
to one frame interval, ~33 ms at 30 fps), and the paint mark is taken at the
frame boundary *after* the paint.

Samples taken while the tab is backgrounded are discarded, because
`requestAnimationFrame` is throttled there and the number would measure the tab
being hidden rather than the app being slow.

**Two figures, never interchangeable:**

| Figure | What it is | Status |
|---|---|---|
| **1.7 ms median / 3.8 ms p95** | *Scoring stage only*, 40 references, Node on a dev machine | Measured, reproducible on demand |
| End-to-end feedback latency | The full path in a participant's browser | Instrumented; needs ~20 real attempts before its p95 means anything |

---

## 4. Dataset choice

### 4.1 What was used

| Corpus | Role | Licence | Count |
|---|---|---|---|
| **Yohan Abhishek** SSL video dataset | Calibration + most references | **CC BY-NC-SA 4.0 — non-commercial** | 360 references; 557 calibration takes over 33 signs |
| **Kaggle** `dckahawearachchi/sinhala-sign-language-dataset` | References | **CC0 1.0** | 141 references |
| | | **Total shipped** | **501 recordings, 490 distinct glosses** |

A test fails if a reference file lacks its licence record. Datasets themselves
are never redistributed with the code — only landmark sequences derived from
them, which are what the app needs.

### 4.2 Why these and not something else

1. **They are the team's shared corpora.** The Kaggle set is the one Lahiru
   trained the recognition model on and the one Lithira's glosses derive from.
   Using the same source keeps the four components talking about the same signs.
2. **They are real SSL, performed by real signers.** The alternative available
   in-project was the 3D avatar's pose data — and that was **assessed and
   rejected**: 7 glosses against 490, hand-authored in Blender by a hearing
   student, never validated by a Deaf signer. Using it as scoring ground truth
   would have made every downstream figure meaningless.
3. **Public and citable**, so the evaluation is repeatable outside this laptop.

### 4.3 The limitations, stated first

- **One signer in the calibration corpus.** The measured spread is the natural
  variation of one fluent person, not of a population, and certainly not of
  learners. Every derived constant is therefore **optimistic**. This is on the
  generated report itself, not just in prose.
- **No Deaf-validated references yet.** The agreed fix is kvn's own recordings
  made with a teacher at the School for the Deaf — signer-validated references
  the project owns, and the first the app could present as authoritative.
- **Team-recorded signs are test attempts, not ground truth.** They exist for
  threshold calibration only.
- **Landmark skeletons are hard to read as a reference.** A skeleton cannot
  convey palm orientation or fine handshape. Mitigations shipped (frame-relative
  stroke sizing, translucent palm, depth-sized joints); the real fix is video
  references, deferred with a reason.

---

## 5. Repeatability

The panel asked for this by name. It is the module's strongest area.

### 5.1 Reports are generated, never typed

`calibration-report.md`, `weight-fit-report.md` and `latency-report.md` each
carry the line *"Generated by ... Do not edit by hand."* and are written by the
test that measures them. There is no path by which a quoted figure and the code
that produced it can disagree.

### 5.2 It was re-run tonight and nothing changed

The full suite was re-run on 31 Aug 2026: **129 passed, 2 skipped (131), across
17 files, ~5 s.** Afterwards:

```bash
git diff --stat -- 'learn-ssl-module/web/*-report.md'
```

came back **empty** — every regenerated report was byte-identical to the
committed one. That is the check to run and show, because it isolates the
reports from unrelated work in the tree.

*(Both skips are deliberate opt-ins, not failures: the raw-data exporter and one
index test that runs only in the opposite condition. See §5.5 for the one skip
that can mislead you.)*

That is the sentence to say out loud: *we re-ran the evaluation last night and
the committed numbers did not move by a character.* Log:
[`data/test-run.log`](data/test-run.log).

### 5.3 The figures cannot drift from the code

The chart script performs **no measurement**. It reads
`data/raw-metrics.json`, which is written by a test that calls **the same
`scoreAttempt()` the deployed app calls**. Each block of that exporter
reproduces the sampling protocol of an existing test verbatim, so the plotted
numbers must agree with the committed reports — and they do, to three decimals.

### 5.4 A deliberate anti-drift decision worth mentioning

`latency-report.md` used to regenerate on **every** test run. The consequence
showed up in the git history: the file was modified by eight consecutive
commits, including a theme change and a repo restructure — none of which touched
scoring. A published research figure was drifting by a millisecond or two per
commit from ambient CPU load, carried along by unrelated work where no reviewer
would think to question it.

It now regenerates only when explicitly asked (`BENCH_WRITE=1`), on an otherwise
idle machine, and stamps the date it was produced. The assertions still run
every time, so a genuine regression still fails the suite.

This is a good answer to *"how do you know your numbers are stable?"* — the
answer is that we caught them being unstable and fixed the cause.

### 5.5 Reproduce it in front of the panel

```bash
npm --prefix learn-ssl-module/web test
```

```bash
cd learn-ssl-module/web; $env:EVAL_EXPORT=1; npx vitest run evaluation.export
```

```bash
learn-ssl-module/tools/venv/Scripts/python.exe PP2-presentation/make_figures.py
```

**One caveat to know before you offer this.** The 557 calibration takes are
*derived data* and are **gitignored**. On a machine without them, the
calibration tests `describe.skip` — they go **silently green rather than red**.
So a passing suite on a fresh clone does not prove the calibration ran. Check
the corpus count printed in `calibration-report.md`. The takes are archived
outside git (`learn-calibration-takes.zip`, 3.4 MB) and the committed reports
preserve the numbers either way.

If asked why derived data is not committed: it is 15 MB of regenerable output,
and the repository's history is already carrying ~130 MB of old binary blobs
that need purging.

---

## 6. Question bank

### On metrics

**"Why is your accuracy only 74%?"**
> It is 74.6% against a majority baseline of 65.4%, so the gain is 9.2 points —
> and I'd rather state it that way than quote the raw number. But the more
> important point is that this figure characterises the distance metric, not the
> product: the module never applies a threshold. It shows a graded score, and on
> that scale correct renditions average 28.7 points higher than different signs.

**"Why accuracy and not F1 / precision / recall?"**
> Because the imbalance makes any single-threshold metric misleading on its own,
> so the headline is AUC at 0.744, which is threshold-free. We report accuracy
> alongside its baseline and balanced accuracy so the imbalance is visible
> rather than hidden. At the best-accuracy threshold TPR is 0.36 and FPR 0.05 —
> that operating point is in the deck.

**"What is your ground truth?"**
> The corpus labels itself: two takes of one sign by the same signer are a
> correct rendition performed twice; takes of different signs are a wrong-sign
> attempt. No human annotation is involved and we don't claim any. For the
> proposal's ≥90%-against-expert target we need learner attempts graded by an
> SSL teacher, and we don't have those yet.

**"Have you met your proposal targets?"**
> One of four is measured. Latency: yes for the scoring stage, well inside
> budget. Feedback accuracy against expert: not measured — we report a proxy and
> we're explicit that it's a different claim. Learning gain and SUS both need the
> pilot, which starts in September; the SUS instrument itself still has to be
> prepared.

### On the dataset

**"One signer — isn't that a problem?"**
> Yes, and it's stated on the generated report itself. It means we measured the
> natural variation of a correct rendition, which is narrower than a learner's,
> so every constant we fitted is optimistic. It's enough to establish where the
> score scale should sit; it's not enough to substantiate a grading-accuracy
> claim.

**"Why not use the 3D avatar's sign data?"**
> We assessed it and rejected it. It's 7 glosses against our 490, hand-authored
> in Blender by a hearing student, and never validated by a Deaf signer. Using it
> as scoring ground truth would have invalidated everything downstream. It stays
> as illustration.

**"How do you handle the licences?"**
> Two corpora, two licences. The Kaggle set is CC0; the Yohan set is CC BY-NC-SA
> 4.0, which is non-commercial — that constrains what the project can become and
> we've recorded it. A test fails if a reference file is missing its licence
> record, and we ship landmark sequences rather than redistributing video.

### On methodology

**"Why DTW and not a transformer?"** → §1.

**"Your grid search found 78.6% and you shipped 74.2%. Why?"**
> Because the search optimises the wrong objective. It asks "is this the same
> sign?"; our scorer grades a known sign. The maximum is at zero movement weight,
> and movement is a phonological parameter of SSL — a scorer blind to it would
> give full marks to a learner with the right handshape and the wrong movement.
> We took the measured gain up to 0.8 and stopped.

**"Isn't 1.7 ms suspiciously fast for a 300 ms budget?"**
> It's the scoring stage only — DTW between the finished attempt and the
> reference. It excludes landmark inference, React's commit and the browser's
> paint, and it runs in Node rather than a participant's browser. We measure the
> full path live in the app and report it in the Progress tab; that's the figure
> that answers the 300 ms target, and it needs about 20 real attempts before its
> 95th percentile means anything.

**"Why is non-manual marker scoring missing?"**
> We track hand landmarks only, so the signal isn't captured, and reporting a
> number for it would be fabricating one. We reallocated its 10% to accuracy and
> documented the deviation in the source, in the README and in the app's own UI.
> Adding it needs face and pose landmarks and it's named as future work.

### On repeatability

**"Could we reproduce your numbers?"** → §5.5, then offer to run it live.

**"How do we know the numbers in your report match your code?"**
> The reports are written by the tests that measure them and are marked "do not
> edit by hand". We re-ran the whole suite last night and the committed files
> didn't change by a character. The charts are plotted from a JSON export
> produced by the same scoring function the deployed app calls — the plotting
> script does no measurement of its own.

### The uncomfortable ones — answer straight

**"How many pilot participants have you run?"**
> None yet. The tooling, the attempt log, the export and the latency instrument
> are all ready, and the study runs through September and October. It's the
> critical path for two of our four targets and we're not going to pretend
> otherwise.

**"Has any Deaf person used or validated this?"**
> Not yet — and that's the most significant limitation. We have the partnership
> with the School for the Deaf, Ratmalana, and the plan is references recorded
> with a teacher there, which would also be the first references the app could
> present as authoritative rather than provisional. Right now we're a hearing
> team building from public corpora, and we've been careful not to invent
> vocabulary, glosses or sentence order anywhere in the system.

**"What would you do differently?"**
> Start the pilot earlier. The build finished on schedule and the evaluation
> didn't, because recruitment has lead time nothing else can absorb. Second,
> record our own references with a signer sooner — reference quality bounds
> everything the scorer can do, and we discovered that late.
