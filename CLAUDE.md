# R26-SE-019 — Transformer-Based AI System for Real-Time Two-Way Deaf–Hearing Communication

SLIIT IT4010 final-year research project (Jan 2026 cohort), group of 4. Supervisor: Ms. Hansi De Silva. Co-supervisor: Ms. Ishara Weerathunga. External partner: The School for the Deaf, Ratmalana. Target language: Sri Lankan Sign Language (SSL).

Unified product name, decided 23 Aug 2026: **සුවණ Suvana**. kvn owns the branding — colour palette and logos are already made.

## Who you're working with

**kvn = Ranathunga R A K N (IT22552860).** His component: **Interactive Sign Language Learning and Practice Module for hearing users** (Component 4). Strong in UI/UX, git, some backend/devops/AI integration; no mobile dev — keep everything web.

Teammates go by different names in older docs, commit history and the repo name. Confirmed by kvn 23 Aug 2026: **Chamara = Lahiru** (one person — hence the repo owner `ChamaraIT22076816`), **Malkith = Lithira**, **Gimhan = Karindra**. Use the names below:

| Member | Component | Where it lives |
|---|---|---|
| Lahiru (IT22076816) | Sign recognition → speech (transformer), branded **සවන Sawana** | `sinhala_sign_language_recognition/` (committed 23 Aug 2026) |
| Lithira (IT22630834) | Speech → 3D animated avatar **+ emotion recognition** (Whisper ASR, Three.js; live at ssl-transformer.vercel.app), branded **SignSpeak** | **His own separate repo** (URL TBD — get it from him). `SSL-Transformer/` here is a stale May 2026 placeholder |
| Karindra (IT22266996) | Sound awareness / SOS (Expo/React Native mobile app + small Python backend; TF.js CNN, 95.4% acc), branded **SoundGuard** | `soundguard-karindra/` |
| **kvn** | **Learning module — deliberately unbranded until Suvana integration (this is what we build)** | `learn-ssl-module/` |

## Current state (Aug 2026)

- **kvn's PP2 build is done and deployed on Vercel; the evaluation is not.** See `HANDOFF-pp2-endgame.md` for what remains (pilot, SUS instrument, latency figures, integration, slides) and the UI-freeze rule once the pilot starts.
- PP1 (May) prototype remains in `learn-ssl-module/` for reference: Python/OpenCV desktop demo — MediaPipe hand landmarks, static single-frame Euclidean comparison, per-finger hints. kvn's PP1 was judged the weakest part; PP2 was the step change. (Its README mentions `sign_learning_demo.py` but only `feedback_demo.py` is committed.)
- The `SSL-Transformer/` folder (`index.html`, `character.fbx`, `signs/*.json`) is **not Lithira's current component** — his real work, including the emotion-recognition addition, lives in his own repo and must be mirrored in for integration. The gloss JSONs there (ME, YOU, NAME, WHAT, WHERE, CAN, YOUR) seeded kvn's first practice vocabulary.
  - **Correction (6 Aug 2026):** those avatar poses are `"source": "Blender manual pose"` — hand-authored by a hearing student, **not** derived from the Kaggle corpus and not validated by a Deaf signer. Illustration only, never scoring ground truth; kvn's module ultimately rejected the avatar as reference material (see HANDOFF-pp2-endgame.md).
  - Lithira's FastAPI backend runs on Colab behind an ngrok URL that changes every session. **Never make a demo depend on it** — commit any avatar assets we need.
- Lahiru's app was Flask + OpenCV MJPEG (`/video_feed`) + SocketIO with a server-side webcam and no JSON API, and was out of scope for PP2. **Update (23 Aug 2026):** a rewrite landed in this repo — `sinhala_sign_language_recognition/` with a FastAPI backend, static frontend and ~52 MB of TensorFlow models. Before integrating, verify the webcam is captured **browser-side** (frames/landmarks sent to the API); server-side capture only works on localhost.

## Suvana integration plan (agreed 23 Aug 2026)

Two parallel integrations, converging to one product for the final evaluation:

- **Lahiru** continues integrating in this team repo (`ChamaraIT22076816/R26-SE-019`) his way.
- **kvn** builds the unified Suvana-branded version in a new repo, **`kavindu-rakn/Suvana`** — a **fresh `git init` with selectively copied working trees, never a duplicate of this repo** (this repo's `.git` is ~199 MB of old venv/dataset blobs). Exclude `.git`, `node_modules`, venvs and datasets; keep licence files (the Yohan corpus is CC BY-NC-SA, non-commercial). Do **not** copy the stale `SSL-Transformer/` folder — take Lithira's component from his real repo as a working-tree snapshot, recording which commit it came from. No git submodules.
- Architecture: **one monorepo, three deployables.** A React web shell (kvn's learn module plus routes serving Lithira's and Lahiru's web frontends); the Python services (Lahiru's recognition API, Lithira's ASR, and emotion recognition if it proves server-side) behind one reverse-proxied domain under `/api/*`; SoundGuard stays a companion Expo app under Suvana branding — it is genuinely mobile (SMS SOS, location, notifications) and is not webified.
- Integrate at the **contract (HTTP) level** — never rewrite a teammate's stack. Datasets never ship and never enter the Suvana repo; large assets (TF models, `character.fbx`) stay server-side or lazy-load per route.
- Deep integration is Sep–Oct work. PP2 gets at most a thin branded shell linking the deployed modules. **Rebranding kvn's module changes its UI — do it before the first pilot participant or after the last, never mid-pilot.**

## Agreed PP2 plan (deadline ~end Aug 2026, ≈7 weeks from July 11)

Full scope-cut rationale: `PP2-Scope-Plan.docx` in the separate "Research" folder (OneDrive). Key decisions, already made — do not relitigate:

1. **Web app: React + MediaPipe Tasks Vision (in-browser).** Matches Lithira's web stack; no installs for demos/user testing. Small Python/FastAPI backend only if needed.
2. **Sign evaluation = DTW (Dynamic Time Warping) over normalised landmark sequences**, compared against reference recordings. This scores full motion (handshape, orientation, trajectory) with per-joint/per-frame deviations → drives specific corrective feedback. Crucially it makes the module **independent of Lahiru's recognition engine** (integration later is additive, via a stubbed interface).
3. Reference data: the **team's shared Kaggle corpus**, `dckahawearachchi/sinhala-sign-language-dataset` (video) — the same one Lahiru trained on and Lithira's avatar glosses come from. Processed to landmarks by our own converter; see HANDOFF-references-and-introductions.md. Team-recorded signs are **test attempts** for threshold calibration, not ground truth. School-for-the-Deaf recordings replace/extend both in the final phase.
   - Glosses (ME, YOU, NAME, …) are uppercase English **labels** for SSL signs — standard sign-linguistics notation, not English words. State this convention once in the report.
   - Phrases are scored sign-by-sign plus a phrase-level fluency metric; gloss order is inherited from Lithira's mapper, never invented. Continuous/co-articulated signing evaluation is explicit future work.
4. Deferred to Sep–Oct (final phase): full BKT + Q-learning curriculum (PP2 ships a heuristic mastery-weighted v1), K-means/PrefixSpan error mining (PP2 just logs errors), 4 of the 5 gamified scenarios (PP2 ships **Restaurant** only), 40-participant study (PP2 ships a 5–10 user pilot).

### Week-by-week

1–2. React app, in-browser MediaPipe capture, reference-recording tool, DTW scoring for ~10 signs
3–4. Feedback overlay + corrective text hints at ≤300 ms; per-sign accuracy logging; polished practice UI (kvn's strength — make it look great)
5. Learner model v1: mastery tracking, weighted practice selection, progress dashboard
6. Scenario simulation; vocabulary to 20–30 signs. **Scenario changed 1 Aug 2026: Restaurant → Social Gathering (Introductions)**, because Restaurant needs food/drink vocabulary we have no references for, while ME/YOU/NAME/WHAT/WHERE/CAN/YOUR is already a first-meeting conversation the avatar can perform. "Social Gathering" is one of the five proposal-approved scenarios, so this is a retarget, not a deviation. (In the end Restaurant shipped with 5/5 real-signer references and Introductions 1/7 — see HANDOFF-pp2-endgame.md; Restaurant is the one to demo.)
7. Integrate into team platform, pilot test, measure latency/accuracy, PP2 slides

### Proposal targets to keep in sight

≥90% feedback accuracy vs expert judgment, ≤300 ms feedback latency, ≥20% learning gain after 10 sessions, SUS ≥70. Milestones: PP2 end Aug, user testing Sep–Oct, final report + viva Oct, paper by Dec 2026.

## Working conventions

- New work goes in `learn-ssl-module/`. It is a plain folder in this repo (flattened from a nested repo via git subtree, July 2026 — done). One repo, normal commits, no submodule handling. Keep the PP1 Python demo intact for reference; the web app lives alongside it in `learn-ssl-module/web/`.
- **kvn commits himself — never run `git commit`.** Flag a "commit point" instead, with the summary line and a point-form description in two separate copyable blocks (he uses GitHub Desktop; no `Co-Authored-By` trailer).
- kvn is learning as he goes — explain architectural choices briefly rather than silently making them.
