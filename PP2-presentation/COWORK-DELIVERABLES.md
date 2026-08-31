# What Cowork built, and what still needs your hands

Built 31 Aug 2026 from `COWORK-BRIEF.md`, `DEFENCE.md`, `EVALUATION.md`,
`EVIDENCE.md` and `data/raw-metrics.json`. Every number was re-derived from
`raw-metrics.json` before it went onto a slide.

## The deliverables

| File | What it is |
|---|---|
| `Suvana-PP2-R26-SE-019.pptx` | The deck. 10 slides for the 5 minutes, an end slide, then 13 appendix slides (A1–A9 = the nine figures, A10 repeatability, A11 datasets/licences, A12 hard questions, A13 every number). **Every slide carries speaker notes written as sentences to say out loud.** The ten main notes total 684 words ≈ 5 minutes. |
| `Suvana-PP2-presenter-card.pdf` | Two A4 pages, designed to survive black-and-white printing. Front: the ten slides in one line each, the three things to land, the five things never to say, the numbers to know cold. Back: 14-question bank, a map from question → appendix slide, and the reproduce-live commands. **Print four.** |
| `metrics-primer.html` | Self-contained study page for kvn: every metric explained from zero (DTW, normalised distance, positive/negative pairs, threshold, TPR/FPR, ROC, AUC, baseline, balanced accuracy, median/p95, percentile anchors, score gap), then all nine figures with "what it proves / what it does not prove / say this", the four targets, the hard questions, and a ten-question self-test. Includes an interactive threshold slider that demonstrates why raw accuracy flatters under imbalance. Opens from disk, no network. Also published as a Claude artifact. |
| `AI-Use-Disclosure-IT22552860.docx` / `.pdf` | `AI-USE-DISCLOSURE.md` as a submittable document, with a signature line. |
| `Suvana-PP2-panel-qa.pdf` | `PANEL-QA.md` typeset for print: 11 pages, A4, black-and-white safe. Page 1 is an index of all 24 questions with page numbers and a ⚠ flag on the five weak spots. Spoken answers are set as grey serif panels, presenter guidance as thin-ruled notes, weak spots as boxed callouts. **Rehearsal and backup — not the in-room cheat sheet.** Rebuild with `python3 build_panelqa.py` (needs node + playwright + poppler; see the script header). |

## Two things the verification pass caught and fixed

1. **The latency figures disagreed between the chart and the report.**
   `fig6-scoring-cost.png` is plotted from `data/raw-metrics.json`, which holds
   the **31 Aug re-run**: median **1.7 ms**, p95 **3.8 ms**. The committed
   `latency-report.md` holds the earlier, more conservative run: median
   **1.8 ms**, p95 **12.6 ms**, max 21.5 ms.
   `COWORK-BRIEF.md` §6 says to put 1.7 / 3.8 on slide 8; the pack README says
   to quote the committed conservative pair. **The deck quotes 1.8 / 12.6**
   everywhere, and appendix A9 states the discrepancy explicitly rather than
   leaving a slide caption contradicting the chart printed above it. Same
   median, different tail — tail timing tracks CPU contention, not the
   algorithm. This is now a strength rather than a trap.

2. **33 signs vs 32.** The figures' own captions say *32 signs / 557 takes*;
   the prose in the pack says *33 signs*. Both are right — 33 on disk, 32
   usable, because one sign has a single take and so cannot form a positive
   pair. Everything Cowork produced now says "33 signs (32 usable)" so nothing
   contradicts a chart.

## Flagged, not changed — `PANEL-QA.md`

The PDF is a typesetting job only; nothing in the markdown was rewritten. Two
things noticed while setting it, for you to decide on:

1. **§7 says "557 calibration takes over 33 signs".** True, but the figures'
   own captions say *32 signs / 557 takes* — 33 on disk, 32 usable, because one
   sign has a single take. The deck, the card and the primer all say
   "33 signs (32 usable)". `PANEL-QA.md` is the only document that doesn't.
2. **The intro says the ⚠ marks are where "the honest answer is 'we haven't done
   that'".** Three of the five are that; §7's is a licence constraint and §10's
   is "be honest if pushed on `?mode=author`". The marker still means "handle
   with care", so nothing misleads — the intro sentence is just narrower than
   the marker's actual use.

Neither is an error. Both are one-line edits if you want them, and the PDF
rebuilds from the markdown in about fifteen seconds.

## Still needs you — before you walk in

- [ ] **Open the deck on the presentation laptop and check slide 1.** The
      Sinhala "සුවණ" is set in Nirmala UI. It renders on Windows; if that
      machine substitutes, delete that one text box — the wordmark below it
      reads "Suvana" and the slide still works.
- [ ] **Print four presenter cards** (two sides, A4). One each. The 11-page
      panel Q&A is a reading document — one printed copy in the bag is enough.
- [ ] **Sign and date the disclosure** — there is a line for it on page 3.
- [ ] **Read the metrics primer once, tonight**, and do the ten self-test
      questions out loud. That is the part the supervisors asked for.
- [ ] **Slides 4, 5 and 6 are written from the brief's owner-supplied notes**
      and are unverified. Ask Lahiru to confirm "171 signs" and the model's
      accuracy graph; ask Lithira to confirm the Whisper/gloss/avatar
      pipeline wording; ask Karindra to confirm the sound classes and the SOS
      flow. Any of them can be corrected in two minutes.
- [ ] **Optional, cosmetic:** on `fig3-weight-sweep.png` the annotation leader
      line crosses the word "discarded". Only worth regenerating if you are
      re-running `make_figures.py` anyway.
- [ ] **Screenshots were skipped by choice** — slide 7 uses `fig1` and the
      Learn module is shown live in the 30-minute demo instead.

## Regenerating

The deck, the card and the primer are all generated from scripts, the same way
the figures are. If a figure changes, the deliverables must be rebuilt from it
— they embed the PNGs rather than linking them.
