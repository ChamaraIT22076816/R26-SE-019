import type { HandFrame, SignRecording } from '../vision/types'
import { dtw } from './dtw'
import { extractHandFeatures, handednessesIn } from './normalize'
import type { FrameFeature, HandFeatureSequence } from './normalize'
import { FINGER_LABEL, LANDMARK_FINGER, NUM_LANDMARKS } from './landmarks'
import type { Finger } from './landmarks'

// --- tunables -------------------------------------------------------------
// How much handshape vs. trajectory contribute to the per-frame distance.
// Handshape is the stronger cue for most signs, so it's weighted higher.
const W_SHAPE = 0.7
const W_TRAJ = 0.3

// Map the average per-frame distance `d` (in hand-size units) to a 0–100
// score with two linear anchor points: d ≤ D_PERFECT scores 100, d ≥ D_ZERO
// scores 0. PROVISIONAL — these must be calibrated against real reference
// recordings + expert judgement (the ≥90%-accuracy study). Self-comparison
// gives d = 0 → 100 regardless of the anchors, which is the invariant we test.
const D_PERFECT = 0.05
const D_ZERO = 0.35

// A hand the reference expects but the learner never showed: heavy penalty.
const MISSING_HAND_SCORE = 0

// A finger is only worth a corrective hint if its average deviation (in
// hand-size units) exceeds this — otherwise a near-perfect attempt would still
// be told to "fix" fingers that are essentially correct.
const HINT_MIN_DEVIATION = 0.1

export interface JointDeviation {
  landmark: number
  finger: Finger
  /** Average positional deviation at this joint, in hand-size units. */
  deviation: number
}

export interface HandScore {
  handedness: 'Left' | 'Right'
  score: number
  normalizedDistance: number
  /** Per-landmark average deviation along the alignment (length 21). */
  perLandmark: number[]
  /** True if the reference used this hand but the attempt never showed it. */
  missing: boolean
}

export interface ScoreResult {
  /** Overall 0–100, frame-weighted average of the per-hand scores. */
  score: number
  hands: HandScore[]
  /** Worst joints across all hands, most deviant first — feeds feedback text. */
  worstJoints: JointDeviation[]
  /** Human-readable corrective hints, most important first. */
  hints: string[]
}

/** Root-mean-square distance between two equal-length vectors. */
function rms(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum / a.length)
}

/** Per-frame distance = weighted RMS of the shape block + the trajectory block. */
function frameDistance(a: FrameFeature, b: FrameFeature): number {
  return W_SHAPE * rms(a.shape, b.shape) + W_TRAJ * rms(a.traj, b.traj)
}

function distanceToScore(d: number): number {
  if (d <= D_PERFECT) return 100
  if (d >= D_ZERO) return 0
  return Math.round((1 - (d - D_PERFECT) / (D_ZERO - D_PERFECT)) * 100)
}

/** Per-landmark deviation (shape block only) averaged over the alignment path. */
function perLandmarkDeviation(
  attempt: FrameFeature[],
  reference: FrameFeature[],
  path: Array<[number, number]>,
): number[] {
  const totals = new Array(NUM_LANDMARKS).fill(0)
  for (const [ai, ri] of path) {
    const sa = attempt[ai].shape
    const sr = reference[ri].shape
    for (let k = 0; k < NUM_LANDMARKS; k++) {
      const dx = sa[k * 3] - sr[k * 3]
      const dy = sa[k * 3 + 1] - sr[k * 3 + 1]
      const dz = sa[k * 3 + 2] - sr[k * 3 + 2]
      totals[k] += Math.hypot(dx, dy, dz)
    }
  }
  return totals.map((t) => t / Math.max(path.length, 1))
}

function scoreHand(attempt: HandFeatureSequence, reference: HandFeatureSequence): HandScore {
  if (attempt.frames.length === 0) {
    return {
      handedness: reference.handedness,
      score: MISSING_HAND_SCORE,
      normalizedDistance: Infinity,
      perLandmark: new Array(NUM_LANDMARKS).fill(Infinity),
      missing: true,
    }
  }
  const result = dtw(attempt.frames.length, reference.frames.length, (i, j) =>
    frameDistance(attempt.frames[i], reference.frames[j]),
  )
  return {
    handedness: reference.handedness,
    score: distanceToScore(result.normalizedDistance),
    normalizedDistance: result.normalizedDistance,
    perLandmark: perLandmarkDeviation(attempt.frames, reference.frames, result.path),
    missing: false,
  }
}

function buildHints(hands: HandScore[], worstJoints: JointDeviation[]): string[] {
  const hints: string[] = []
  const twoHanded = hands.length > 1

  for (const hand of hands) {
    if (hand.missing) {
      hints.push(`Use your ${hand.handedness.toLowerCase()} hand too — this sign is two-handed.`)
    }
  }

  // Group the worst joints by finger so we don't repeat "index finger" 4 times,
  // and only mention fingers that are meaningfully off.
  const byFinger = new Map<string, JointDeviation>()
  for (const j of worstJoints) {
    if (j.finger === 'wrist' || j.deviation <= HINT_MIN_DEVIATION) continue
    if (!byFinger.has(j.finger)) byFinger.set(j.finger, j)
  }
  for (const dev of [...byFinger.values()].slice(0, 2)) {
    hints.push(`Check your ${FINGER_LABEL[dev.finger]} — its shape drifts from the reference.`)
  }

  if (hints.length === 0) {
    hints.push(
      twoHanded
        ? 'Close match — both hands are tracking the reference well.'
        : 'Close match — keep the same handshape and pace.',
    )
  }
  return hints
}

/**
 * Score a practice attempt against a reference recording of the same sign.
 * Both are run through the identical normalisation pipeline (each with its own
 * capture resolution), then aligned per hand with DTW.
 */
export function scoreAttempt(attempt: SignRecording, reference: SignRecording): ScoreResult {
  const refHands = handednessesIn(reference.frames)

  const hands: HandScore[] = []
  for (const handedness of refHands) {
    const ref = extractHandFeatures(
      reference.frames,
      handedness,
      reference.videoWidth,
      reference.videoHeight,
    )
    if (ref.frames.length === 0) continue // reference didn't really track this hand
    const att = extractHandFeatures(
      attempt.frames,
      handedness,
      attempt.videoWidth,
      attempt.videoHeight,
    )
    hands.push(scoreHand(att, ref))
  }

  if (hands.length === 0) {
    return { score: 0, hands: [], worstJoints: [], hints: ['No hands were tracked in the reference.'] }
  }

  // Overall score weighted by how many reference frames each hand appears in,
  // so the dominant hand in the sign matters more.
  const refFrameCount = (handedness: 'Left' | 'Right') =>
    reference.frames.filter((f: HandFrame) => f.hands.some((h) => h.handedness === handedness)).length
  const weights = hands.map((h) => Math.max(refFrameCount(h.handedness), 1))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const score = Math.round(
    hands.reduce((acc, h, idx) => acc + h.score * weights[idx], 0) / totalWeight,
  )

  // Collect per-joint deviations across all present hands, worst first.
  const worstJoints: JointDeviation[] = []
  for (const hand of hands) {
    if (hand.missing) continue
    hand.perLandmark.forEach((deviation, landmark) => {
      worstJoints.push({ landmark, finger: LANDMARK_FINGER[landmark], deviation })
    })
  }
  worstJoints.sort((a, b) => b.deviation - a.deviation)

  return { score, hands, worstJoints, hints: buildHints(hands, worstJoints) }
}
