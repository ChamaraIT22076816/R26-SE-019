# Demo runbook

How to run all four components locally. Paths assume the repo is at
`C:/Users/User/Documents/R26-SE-019` — adjust if it moves.

## Start — two terminals

**1. Recognition.** Serves the landing page *and* its APIs. Everything else is
linked from it, so this one comes first.

```
sinhala_sign_language_recognition/.venv/Scripts/python.exe -m uvicorn --app-dir sinhala_sign_language_recognition webapp.server:app --host 127.0.0.1 --port 8000
```

Wait for `Application startup complete`, and check the line above it says
**`Loaded 171 gesture labels`**. If it says `0`, see Troubleshooting.

**2. Learn module.** Must be on port **5173** — the landing page looks for it there.

```
npm --prefix learn-ssl-module/web run dev
```

Then open **http://localhost:8000**.

## What to show

| Where | What | Notes |
|---|---|---|
| Landing → **Launch** | Sign → speech, live camera | Says the sign aloud in Sinhala |
| Landing → **Launch SSL Learn** | Practice, scored against real signers | Use the **Restaurant** scenario |
| `localhost:5173/?mode=author` | Record / Library / Study tabs | Reference recorder + latency figures |
| Landing → **Launch SignSpeak** | Lithira's deployment | See status below |
| Landing → AI assistant (bottom-right) | Q&A over all 171 signs | Needs a free Groq or Gemini key |

Scenario coverage: **Restaurant 5/5** references, **Introductions 3/7**. Demo Restaurant.

## Status — what works today

| Component | State |
|---|---|
| Recognition (Lahiru) | **Working.** 171 signs, Sinhala labels, speech output |
| Learn (kvn) | **Working.** Local on 5173, and deployed at learn-ssl-module.vercel.app |
| SignSpeak (Lithira) | **UI only.** Page loads; translation needs his Colab/ngrok backend, which is down |
| SoundGuard (Karindra) | **Not demoable.** Needs a dev-build APK; Expo Go cannot run it (custom native modules). The QR button will produce a URL that goes nowhere |

Say this up front rather than discovering it on the projector.

## Troubleshooting

**`Loaded 0 gesture labels`** — `data/processed/labels.npy` is missing (it is
gitignored, so it never arrives with a clone). Get it from Lahiru, drop it in
`sinhala_sign_language_recognition/data/processed/`, restart.

**Learn links open the wrong app, or go to Vercel instead of localhost** — the
landing page only switches to the local Learn module if port 5173 is serving
*that* app. Anything else on 5173 (e.g. the Suvana shell) is correctly ignored.
Stop it and start Learn there.

**Learn loads with no signs** — `npm run dev` regenerates the reference index
via a `predev` hook. Running `npx vite` directly skips it.

**`UnicodeEncodeError` from `build_sinhala_labels.py`** — Windows console is
cp1252. Run it as `python -X utf8 webapp/build_sinhala_labels.py`.

## First-time setup on a new machine

Python 3.11 (TensorFlow 2.13 and MediaPipe 0.10.7 publish no wheels above it):

```
winget install --id Python.Python.3.11 -e
py -3.11 -m venv sinhala_sign_language_recognition/.venv
```

`requirements.txt` cannot be installed in one pass: TensorFlow pins
`typing-extensions<4.6.0`, FastAPI needs `>=4.8.0`. Install the ML stack first,
then the web layer — TensorFlow runs fine above its stated ceiling. Skip
`playsound`; it is never imported and its sdist is broken.

```
grep -viE '^(playsound|fastapi|uvicorn|websockets)' sinhala_sign_language_recognition/requirements.txt > /tmp/pass1.txt
sinhala_sign_language_recognition/.venv/Scripts/python.exe -m pip install -r /tmp/pass1.txt
sinhala_sign_language_recognition/.venv/Scripts/python.exe -m pip install "fastapi==0.141.1" "uvicorn[standard]==0.52.1" "websockets==16.1.1"
```

The conflict warning on the second command is expected.

Then get `labels.npy` from Lahiru (see Troubleshooting), generate the Sinhala
labels, and install the Learn module's dependencies:

```
sinhala_sign_language_recognition/.venv/Scripts/python.exe -X utf8 sinhala_sign_language_recognition/webapp/build_sinhala_labels.py
npm --prefix learn-ssl-module/web install
```

`build_sinhala_labels.py` needs network access and takes a few minutes.
