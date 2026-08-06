# R26-SE-019 — Transformer-Based AI System for Real-Time Two-Way Deaf–Hearing Communication

SLIIT IT4010 final-year research project (Jan 2026 cohort), group of 4. Supervisor: Ms. Hansi De Silva. Co-supervisor: Ms. Ishara Weerathunga. External partner: The School for the Deaf, Ratmalana. Target language: Sri Lankan Sign Language (SSL).

## Who you're working with

**kvn = Ranathunga R A K N (IT22552860).** His component: **Interactive Sign Language Learning and Practice Module for hearing users** (Component 4). Strong in UI/UX, git, some backend/devops/AI integration; no mobile dev — keep everything web.

Teammates and their repos in this folder:

| Member | Component | Folder |
|---|---|---|
| Chamara (IT22076816) | Sign recognition → speech (transformer) | `sinhala-sign-language-translator/` |
| Malkith (IT22630834) | Speech → 3D avatar (Whisper ASR, Three.js, FastAPI; live at ssl-transformer.vercel.app) | `SSL-Transformer/` |
| Gimhan (IT22266996) | Sound awareness / SOS (TF.js CNN, 95.4% acc) | `soundguard-karindra/` |
| **kvn** | **Learning module (this is what we build)** | `learn-ssl-module/` |

## Current state (July 2026)

- PP1 (May) prototype in `learn-ssl-module/`: Python/OpenCV desktop demo — MediaPipe hand landmarks, normalisation, **static single-frame** pose comparison (Euclidean), colour-coded feedback, per-finger hints, CSV logging. Limits: no motion/trajectory, one hand, desktop-only, not integrated. kvn's PP1 was judged the weakest part; PP2 must be a step change.
- README there mentions `sign_learning_demo.py` but only `feedback_demo.py` is committed.
- Malkith's avatar has gloss JSONs: ME, YOU, NAME, WHAT, WHERE, CAN, YOUR (`SSL-Transformer/signs/`). Align kvn's first practice vocabulary with these to make the learn↔communicate integration demo trivial.

## Agreed PP2 plan (deadline ~end Aug 2026, ≈7 weeks from July 11)

Full scope-cut rationale: `PP2-Scope-Plan.docx` in the separate "Research" folder (OneDrive). Key decisions, already made — do not relitigate:

1. **Web app: React + MediaPipe Tasks Vision (in-browser).** Matches Malkith's web stack; no installs for demos/user testing. Small Python/FastAPI backend only if needed.
2. **Sign evaluation = DTW (Dynamic Time Warping) over normalised landmark sequences**, compared against reference recordings. This scores full motion (handshape, orientation, trajectory) with per-joint/per-frame deviations → drives specific corrective feedback. Crucially it makes the module **independent of Chamara's recognition engine** (integration later is additive, via a stubbed interface).
3. Reference data: the **team's shared Kaggle corpus**, `dckahawearachchi/sinhala-sign-language-dataset` (video) — the same one Chamara trained on and Malkith's avatar glosses come from. Processed to landmarks by our own converter; see HANDOFF-references-and-introductions.md. Team-recorded signs are **test attempts** for threshold calibration, not ground truth. School-for-the-Deaf recordings replace/extend both in the final phase.
   - Glosses (ME, YOU, NAME, …) are uppercase English **labels** for SSL signs — standard sign-linguistics notation, not English words. State this convention once in the report.
   - Phrases are scored sign-by-sign plus a phrase-level fluency metric; gloss order is inherited from Malkith's mapper, never invented. Continuous/co-articulated signing evaluation is explicit future work.
4. Deferred to Sep–Oct (final phase): full BKT + Q-learning curriculum (PP2 ships a heuristic mastery-weighted v1), K-means/PrefixSpan error mining (PP2 just logs errors), 4 of the 5 gamified scenarios (PP2 ships **Restaurant** only), 40-participant study (PP2 ships a 5–10 user pilot).

### Week-by-week

1–2. React app, in-browser MediaPipe capture, reference-recording tool, DTW scoring for ~10 signs
3–4. Feedback overlay + corrective text hints at ≤300 ms; per-sign accuracy logging; polished practice UI (kvn's strength — make it look great)
5. Learner model v1: mastery tracking, weighted practice selection, progress dashboard
6. Scenario simulation; vocabulary to 20–30 signs. **Scenario changed 1 Aug 2026: Restaurant → Social Gathering (Introductions)**, because Restaurant needs food/drink vocabulary we have no references for, while ME/YOU/NAME/WHAT/WHERE/CAN/YOUR is already a first-meeting conversation the avatar can perform. "Social Gathering" is one of the five proposal-approved scenarios, so this is a retarget, not a deviation.
7. Integrate into team platform, pilot test, measure latency/accuracy, PP2 slides

### Proposal targets to keep in sight

≥90% feedback accuracy vs expert judgment, ≤300 ms feedback latency, ≥20% learning gain after 10 sessions, SUS ≥70. Milestones: PP2 end Aug, user testing Sep–Oct, final report + viva Oct, paper by Dec 2026.

## Working conventions

- New work goes in `learn-ssl-module/`. It is a plain folder in this repo (flattened via git subtree in July 2026 — see HANDOFF-flatten-learn-ssl-module.md; if that file still exists, the flatten may not be done yet). One repo, normal commits, no submodule handling. Keep the PP1 Python demo intact for reference; build the web app alongside it (e.g., `learn-ssl-module/web/`).
- kvn is learning as he goes — explain architectural choices briefly rather than silently making them.
