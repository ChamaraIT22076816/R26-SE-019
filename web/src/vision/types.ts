import type { HandLandmarkerResult } from '@mediapipe/tasks-vision'

/** One 3D point from MediaPipe. x/y are image-normalised to [0,1]; z is relative depth. */
export interface Landmark {
  x: number
  y: number
  z: number
}

/** A single detected hand in one video frame. */
export interface TrackedHand {
  /** Anatomical handedness as reported by the model. */
  handedness: 'Left' | 'Right'
  /** Model confidence in the handedness call, 0–1. */
  score: number
  /** 21 landmarks in MediaPipe hand order (0 = wrist). */
  landmarks: Landmark[]
}

/**
 * One frame of tracking output. This is the unit that sign recordings and
 * DTW comparison will operate on — kept plain-JSON-serialisable on purpose
 * so sequences can be saved as reference recordings and replayed.
 */
export interface HandFrame {
  timestampMs: number
  hands: TrackedHand[]
}

export function toHandFrame(result: HandLandmarkerResult, timestampMs: number): HandFrame {
  return {
    timestampMs,
    hands: result.landmarks.map((landmarks, i) => ({
      handedness: (result.handedness[i]?.[0]?.categoryName ?? 'Right') as 'Left' | 'Right',
      score: result.handedness[i]?.[0]?.score ?? 0,
      landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
    })),
  }
}
