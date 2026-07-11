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
3. In **Library**, use **Export** to download the JSON and send it to kvn.
4. Committed references go in `public/references/` + an entry in
   `public/references/manifest.json` — they then ship bundled for everyone.

Recordings store only landmark coordinates (~200 KB per sign), never video, so
they're safe to commit and share.

## Roadmap (PP2)

1. ~~In-browser hand tracking~~ ✅
2. ~~Reference-recording tool (landmark sequences saved/shared as JSON)~~ ✅
3. DTW scoring of practice attempts vs references + corrective feedback
4. Learner model v1 (mastery tracking, weighted practice selection) + dashboard
5. Restaurant scenario; integration with the team platform
