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
 * DTW comparison operate on — kept plain-JSON-serialisable on purpose so
 * sequences can be saved as reference recordings and replayed.
 */
export interface HandFrame {
  timestampMs: number
  hands: TrackedHand[]
}

/**
 * A recorded sign: a named sequence of frames with timestamps relative to
 * the recording start (first frame ≈ 0). We store raw image-normalised
 * landmarks — pose normalisation happens at comparison time, so the
 * normalisation strategy can evolve without re-recording references.
 */
export interface SignRecording {
  id: string
  /** Sign gloss, uppercase — e.g. "ME", aligned with the avatar's gloss names. */
  gloss: string
  /** Who performed it (team member for now; School for the Deaf later). */
  signer: string
  /** Where the recording came from. Dataset conversions set 'kaggle-dataset'. */
  source?: 'kaggle-dataset' | 'team-recording' | string
  /**
   * True for references that are not authoritative SSL — team members signing
   * to unblock development. CLAUDE.md is explicit that team recordings are test
   * attempts for calibration, not ground truth, so they are labelled wherever
   * they are shown and lose to a non-provisional reference for the same gloss.
   * Replaced by School-for-the-Deaf recordings in the final phase.
   */
  provisional?: boolean
  createdAt: string
  durationMs: number
  /** Average capture rate, frames per second. */
  fps: number
  /** Camera resolution the landmarks were captured at (for replay aspect). */
  videoWidth: number
  videoHeight: number
  frames: HandFrame[]
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

/** Share of frames in which at least one hand was tracked, 0–1. */
export function handCoverage(frames: HandFrame[]): number {
  if (frames.length === 0) return 0
  return frames.filter((f) => f.hands.length > 0).length / frames.length
}
