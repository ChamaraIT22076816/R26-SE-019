# PP2 presentation pack

Assembled 31 August 2026, the night before the PP2 assessment, from commit
`2d85c78`. Covers **R26-SE-019 / Suvana**, with the evaluation material specific
to **kvn's Learn module (IT22552860)**.

## Start here

| Read this | If you are |
|---|---|
| [COWORK-BRIEF.md](COWORK-BRIEF.md) | **building the slide deck** — slide-by-slide plan, speaker notes, assets |
| [DEFENCE.md](DEFENCE.md) | **preparing for Q&A** — metric / dataset / methodology / repeatability + a question bank with answers |
| [EVALUATION.md](EVALUATION.md) | writing the report, or want the results with the figures inline |
| [EVIDENCE.md](EVIDENCE.md) | asked "where does this number come from?" or "can you reproduce it?" |
| [AI-USE-DISCLOSURE.md](AI-USE-DISCLOSURE.md) | submitting the AI declaration |

## The three things to know before walking in

1. **Lead with AUC 0.744 and the 65.4% baseline — never with a bare "74.6%".**
   The evaluation set is imbalanced 524:992, so raw accuracy flatters, and being
   asked "compared to what?" is the worst way for that to surface.
   `figures/fig9-baseline-comparison.png` states it correctly.
2. **1.8 ms is the *scoring stage*, not end-to-end feedback latency.** Never
   quote it as the answer to the 300 ms target without that qualifier.
3. **The module grades a known sign; it does not classify an unknown one.**
   Measured evidence: some distinct signs sit 0.135 apart while two takes of one
   sign typically sit 0.458 apart.

## Contents

```
COWORK-BRIEF.md          slide-by-slide brief for the deck builder
DEFENCE.md               justification + Q&A bank
EVALUATION.md            results report with figures inline
EVIDENCE.md              claim → source → reproduction command
AI-USE-DISCLOSURE.md     declaration of AI assistance
evidence-dossier.html    ← open this one in the demo room
dossier.template.html    its source (figures as __FIGn__ placeholders)
make_figures.py          plotting only; performs no measurement
build_dossier.py         inlines the figures into the dossier
data/raw-metrics.json    every measurement behind every figure
data/test-run.log        test-suite output + all 129 test names, 31 Aug 2026
figures/fig1..fig9       200 dpi PNG, Suvana palette
```

### The dossier

`evidence-dossier.html` is every figure with its provenance and **the sentence to
say when a panel asks about it**. It is fully self-contained — no network, no
external assets — so it opens from disk on any machine, which matters in a demo
room. Double-click it.

It is also published at
<https://claude.ai/code/artifact/6e869301-c5e2-4b08-b87f-d90ace577fee> — that
copy needs a login, so treat the local file as the one you rely on.

## Regenerating everything

```bash
npm --prefix learn-ssl-module/web test
```

```bash
cd learn-ssl-module/web; $env:EVAL_EXPORT=1; npx vitest run evaluation.export
```

```bash
learn-ssl-module/tools/venv/Scripts/python.exe PP2-presentation/make_figures.py
```

```bash
learn-ssl-module/tools/venv/Scripts/python.exe PP2-presentation/build_dossier.py
```

Roughly 20 seconds end to end. After step 1,
`git diff -- 'learn-ssl-module/web/*-report.md'` should come back empty — that is
the repeatability demonstration, and it is worth doing live.

## Outstanding before submission

- **Fix the stale figures in older docs** — `CLAUDE.md` and
  `HANDOFF-pp2-endgame.md` still say "362 files, 351 signs" (actually **501 /
  490**); `learn-ssl-module/web/README.md` still says 73.8% separation (actually
  **74.6%**). Full list in [EVIDENCE.md](EVIDENCE.md) §6.
- **Screenshots** — the Learn module mid-attempt, the score + hints, the
  Progress tab, a scenario summary. These need a real webcam and cannot be
  captured from an embedded browser.
- **Confirm the Introductions scenario coverage** — `DEMO.md` says 3/7, the
  handoff says 1/7. Restaurant is 5/5 either way and is the one to demo.
- **Teammate figures** — everything about the other three components in this
  pack is marked owner-supplied and unverified. See [EVIDENCE.md](EVIDENCE.md)
  §7 for two items Lahiru should be ready for.
