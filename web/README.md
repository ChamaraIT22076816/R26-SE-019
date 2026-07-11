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
- `src/components/LandmarkCamera.tsx` — webcam capture + per-frame landmark detection
  + mirrored canvas overlay, with live FPS / inference-latency stats (we track these
  from day 1 because of the ≤300 ms feedback-latency target).

## Roadmap (PP2)

1. ~~In-browser hand tracking~~ ✅
2. Reference-recording tool (save landmark sequences for 20–30 signs as JSON)
3. DTW scoring of practice attempts vs references + corrective feedback
4. Learner model v1 (mastery tracking, weighted practice selection) + dashboard
5. Restaurant scenario; integration with the team platform
