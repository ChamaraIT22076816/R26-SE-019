# Brief for building the PP2 slide deck

**For: Claude Cowork (or whoever builds the .pptx).**
Written by Claude Code from the actual repository on 31 Aug 2026, the night
before the PP2 assessment.

Everything in this file that is stated as a number has been **verified against
the code or regenerated from it**, unless it sits in a block marked
`⚠ OWNER-SUPPLIED`. Do not add figures that are not here. If a slide needs a
number this brief does not give you, leave a `[TK]` placeholder rather than
inventing one — the panel is specifically probing metric provenance.

---

## 1. The assessment you are building for

| | |
|---|---|
| Event | IT4010 Research Project — **PP2 (Progress Presentation 2)** |
| Date | 1 Sep 2026 |
| Total | **45 minutes** |
| Presentation | **5 minutes**, delivered by **one team member chosen by the panel** |
| Demo + Q&A | 30 minutes |
| Marking | 10 minutes |

**The single most important design constraint:** the panel picks the presenter.
Any of the four must be able to deliver the whole deck cold. So:

- **Every slide needs speaker notes written as sentences the presenter can
  say**, not bullet reminders. Assume they have not rehearsed and did not build
  the component on screen.
- **No slide should require insider knowledge to explain.** If a slide can only
  be presented by its author, it is the wrong slide.
- Keep on-slide text minimal; put the explanation in the notes.
- 5 minutes ÷ 10 slides ≈ **30 seconds per slide**. Notes should be ~60–80
  words each. Write to that budget.

---

## 2. Project facts

| | |
|---|---|
| Project ID | **R26-SE-019** |
| Title | Transformer-Based AI System for Real-Time Two-Way Deaf–Hearing Communication |
| Product name | **සුවණ Suvana** (unified brand, agreed 23 Aug 2026) |
| Institution | SLIIT — IT4010 Research Project, Jan 2026 cohort |
| Supervisor | Ms. Hansi De Silva |
| Co-supervisor | Ms. Ishara Weerathunga |
| External partner | The School for the Deaf, Ratmalana |
| Target language | Sri Lankan Sign Language (**SSL**) |

**Naming rule for the deck:** inside Suvana there are **no sub-brands**. Sawana,
SignSpeak and SoundGuard are the members' own standalone project names and
should appear at most once, as a footnote. On slides, use descriptive module
names: **Recognise / Speak / Alert / Learn**.

### The team

| Member | ID | Component |
|---|---|---|
| Lahiru | IT22076816 | Sign recognition → Sinhala speech |
| Lithira | IT22630834 | Speech → 3D animated avatar + emotion recognition |
| Karindra | IT22266996 | Sound awareness & SOS alerts |
| **Ranathunga R A K N ("kvn")** | **IT22552860** | **Interactive sign-language learning & practice** |

---

## 3. The narrative arc (this is what makes the deck presentable cold)

The deck should tell one story, not four:

> Deaf–hearing communication breaks in **both directions**. A Deaf person signs
> and a hearing person does not understand; a hearing person speaks and a Deaf
> person cannot hear. Most existing systems solve one direction only.
> **Suvana closes the loop with four components** — one for each direction of
> live translation, one for ambient sound the user cannot hear, and one that
> reduces the need for translation at all by teaching hearing people to sign.

That last clause is the line that ties kvn's module into the project rather
than leaving it as a bolt-on. Use it.

---

## 4. Slide-by-slide plan

Ten slides. Content in the table; speaker notes drafted in §5.

| # | Slide | On-slide content | Visual |
|---|---|---|---|
| 1 | Title | Suvana · R26-SE-019 · four names + IDs · supervisors | Suvana logo (`learn-ssl-module/web/public/branding/suvana-mark.png`) |
| 2 | The problem | Communication breaks both ways; SSL is under-served by existing tools | One simple two-arrow diagram |
| 3 | System overview | Four modules around a shared shell | **Architecture diagram — build this, it is the slide the presenter leans on most** |
| 4 | Recognise (Lahiru) | Sign → Sinhala speech, 171 signs, in-browser capture → FastAPI → TF model | `model_accuracy_graph.png` (repo root) |
| 5 | Speak (Lithira) | Sinhala speech → gloss → 3D avatar, plus speaker-emotion recognition | Screenshot of his deployed app |
| 6 | Alert (Karindra) | Ambient sound classification → phone alert + SOS | Screenshot / phone mock |
| 7 | **Learn (kvn)** | Practise SSL in the browser, scored against real signers, corrective feedback | `figures/fig1-distance-distributions.png` |
| 8 | **Evaluation** | The four proposal targets, honestly staged | `figures/fig9-baseline-comparison.png` **and** `figures/fig6-scoring-cost.png` |
| 9 | Where we are / what's next | Timeline: PP2 → pilot Sep–Oct → final report + viva Oct → paper Dec | Simple timeline bar |
| 10 | AI use disclosure | Summary of the disclosure; full text is a separate document | Text only |

**Appendix slides (after the end slide; not part of the 5 minutes).** These
exist purely so the presenter can jump to a chart during the 30-minute Q&A.
Include all nine figures from `figures/`, one per slide, each with its title and
its one-line caption. Label them A1–A9. Also add an appendix slide for the
repeatability commands in §8.

---

## 5. Speaker notes — draft these into the deck

Written so a teammate who did not build the component can say them. Adjust the
voice, keep the substance.

**Slide 1 — Title.**
> "Good morning. We're group R26-SE-019, and our project is Suvana — a
> transformer-based system for real-time two-way communication between Deaf and
> hearing users in Sri Lankan Sign Language. I'll take you through the problem,
> our four components, and where our evaluation stands."

**Slide 2 — The problem.**
> "Communication between Deaf and hearing people breaks in both directions, and
> most tools only fix one of them. There's also very little technology built for
> Sri Lankan Sign Language specifically — most sign-language AI targets ASL.
> We're working with the School for the Deaf in Ratmalana to keep what we build
> grounded in how SSL is actually used."

**Slide 3 — System overview.**
> "Suvana has four components. Two handle live translation, one in each
> direction. A third covers ambient sound a Deaf user can't hear — a doorbell, a
> horn, an alarm. The fourth teaches hearing people to sign, which reduces the
> need for translation in the first place. They're separate services behind one
> product, so each can be developed and evaluated independently."

**Slide 4 — Recognise.**
> "The first component turns signing into Sinhala speech. The camera runs in the
> browser, landmarks go to a FastAPI service, and a TensorFlow model classifies
> the sign against 171 labels. The output is spoken aloud in Sinhala. This graph
> is the model's training and validation accuracy over 50 epochs."

**Slide 5 — Speak.**
> "The second component goes the other way: Sinhala speech in, a 3D avatar
> signing out. Speech recognition uses a fine-tuned Sinhala Whisper model, the
> text is mapped to SSL glosses, and the avatar performs them. It also
> classifies the speaker's emotion from the audio, so the delivery carries tone
> and not just words."

**Slide 6 — Alert.**
> "The third component is for sound the user can't hear. A convolutional network
> classifies ambient audio on the phone and raises an alert — and for urgent
> cases there's an SOS flow with location. It's a mobile app rather than a web
> app because it needs notifications, location and SMS."

**Slide 7 — Learn.**
> "The fourth component teaches hearing people to sign. You pick a sign, you see
> a reference from a real signer, you perform it to your webcam, and you get a
> score plus specific corrective feedback — which finger was wrong, whether you
> were too fast or too slow. Everything runs in the browser: hand tracking is
> MediaPipe, and the comparison is Dynamic Time Warping against reference
> recordings, so it doesn't depend on the recognition model at all."

**Slide 8 — Evaluation.** *(the most important 45 seconds — see §6)*
> "We set four targets in the proposal. Latency we can report now: the scoring
> stage runs in under two milliseconds against a 300-millisecond budget. For
> feedback quality, we calibrated the scorer against 557 recordings from a
> real-signer corpus. It separates a correct rendition from a different sign
> with an AUC of 0.74, against a majority baseline of 65 percent — and we're
> stating it that way deliberately, because raw accuracy on an imbalanced set
> flatters. The remaining two targets, learning gain and usability, need the
> pilot study, which starts in September."

**Slide 9 — What's next.**
> "PP2 closes the build phase. Next is the pilot study through September and
> October, which is what turns the last two targets into measurements. The final
> report and viva are in October, and we're targeting a paper by December."

**Slide 10 — AI use disclosure.**
> "We used AI coding assistants during development. The full disclosure is in
> our submission — in short: assistants were used for implementation,
> refactoring and documentation under our direction; the research design, the
> evaluation protocol and every reported figure are ours, and every figure in
> this deck is regenerated from the code by a script we can run in front of
> you."

---

## 6. Slide 8 in detail — the evaluation slide

This is the slide the panel is grading and the one most likely to draw a hard
question. **Get it right and be conservative.**

Use this table on the slide:

| Proposal target | Status | Figure |
|---|---|---|
| Feedback latency ≤ 300 ms | **Measured** (scoring stage) | median **1.7 ms**, p95 **3.8 ms** over 40 references |
| Feedback accuracy ≥ 90% vs expert | **Not yet measured** — proxy reported | AUC **0.744**; baseline 65.4% |
| Learning gain ≥ 20% after 10 sessions | Instrumented, needs the pilot | — |
| SUS ≥ 70 | Needs the pilot + questionnaire | — |

**Do not put "74.6% accuracy" on a slide on its own.** It is true but it is
misleading without its baseline, and the panel asking "compared to what?" is the
worst way for that to come out. `fig9-baseline-comparison.png` states it
correctly and turns the weakness into a display of rigour. Full reasoning in
[DEFENCE.md](DEFENCE.md) §2.

**Two claims that must not be blurred, on the slide or in the notes:**

1. **1.7 ms is the *scoring stage*, not end-to-end feedback latency.** It
   excludes landmark inference, React's commit and the browser's paint. The
   end-to-end figure is instrumented and shown live in the app's Progress tab,
   but it needs ~20 real attempts before its p95 is meaningful.
2. **The module *grades* a known sign; it does not *classify* an unknown one.**
   The separation figure describes the distance metric, not a classifier the
   product ships.

---

## 7. Assets

Everything below exists on disk right now.

| Asset | Path |
|---|---|
| Nine evaluation figures | `PP2-presentation/figures/fig1..fig9-*.png` |
| Raw measurements behind them | `PP2-presentation/data/raw-metrics.json` |
| Full test-suite log | `PP2-presentation/data/test-run.log` |
| Lahiru's model accuracy curve | `model_accuracy_graph.png` (repo root) |
| Suvana logo | `learn-ssl-module/web/public/branding/suvana-mark.png` |
| Palette | teal `#00776a`, soft teal `#00a693`, ink `#04201d`, rust `#c2410c`, grey `#5a6b68` |

The figures are already rendered in the Suvana palette at 200 dpi, so they sit
on a Suvana-themed slide without recolouring.

**Still needed from kvn** (leave placeholders if they do not arrive):
screenshots of the Learn module mid-attempt and of the Progress tab; a
screenshot of Lithira's deployed app; a SoundGuard screenshot.

---

## 8. Repeatability — put this on an appendix slide

The panel is explicitly probing repeatability. Every figure in the deck comes
from these three commands, in order:

```bash
npm --prefix learn-ssl-module/web test
```

```bash
cd learn-ssl-module/web; $env:EVAL_EXPORT=1; npx vitest run evaluation.export
```

```bash
learn-ssl-module/tools/venv/Scripts/python.exe PP2-presentation/make_figures.py
```

The strongest single sentence available on repeatability, and it is true:

> "The reports in the repository are regenerated by the test suite on every run.
> We re-ran them last night and the committed files did not change by a single
> character."

---

## 9. Things to get right, and one trap

- **Two datasets, two licences.** The Kaggle corpus (`dckahawearachchi/sinhala-sign-language-dataset`)
  is **CC0**. The Yohan Abhishek corpus is **CC BY-NC-SA 4.0 — non-commercial**.
  All evaluation figures come from the Yohan corpus. Attribute it on the slide.
  Datasets are never redistributed with the code.
- **Glosses are notation, not translation.** `ME`, `NAME`, `THANK_YOU` in caps
  are standard sign-linguistics labels for SSL signs, not English words. Say
  this once if a gloss appears on screen.
- **The trap:** the deck must not claim the 3D avatar poses are validated SSL.
  They were hand-authored in Blender by a hearing student. kvn's module
  explicitly rejected them as scoring references for that reason. If the avatar
  appears on a slide, it is illustration.

---

## 10. What is NOT ready — say it before you are asked

Being first to name a gap reads as rigour; being caught reads as the opposite.
Fold these into slide 9 rather than hiding them.

- **Zero pilot participants so far.** Two of four targets depend on the pilot.
- **No SUS questionnaire instrument exists yet.** It is the standard 10 items;
  it just has not been prepared.
- **No expert-graded learner attempts**, so the ≥90%-vs-expert target has a
  proxy and not a result.
- **Non-manual markers (face, head, body) are not scored** — the build tracks
  hands only, so its weight was reallocated. This is a stated deviation, not an
  oversight; see [DEFENCE.md](DEFENCE.md) §3.
- **Integration is a linked shell, not a merged product.** Deep integration is
  Sep–Oct work.
