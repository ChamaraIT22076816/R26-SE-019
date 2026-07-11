import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

// Both the WASM runtime and the model are served from our own origin
// (vite.config.ts copies the wasm; the model lives in public/models/),
// so practice sessions never depend on CDN availability.
const WASM_DIR = '/wasm'
const MODEL_PATH = '/models/hand_landmarker.task'

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR)
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      // GPU when WebGL is available; MediaPipe falls back to CPU otherwise.
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
}
