import type { TrackedHand } from './types'

export const HAND_COLORS: Record<string, string> = {
  Left: '#22d3ee',
  Right: '#a3e635',
}
const FALLBACK_COLOR = '#f472b6'

const JOINT_RADIUS = 5
const BONE_WIDTH = 5
const JOINT_OUTLINE = '#0f172a'

/**
 * MediaPipe's hand skeleton topology, inlined from
 * `HandLandmarker.HAND_CONNECTIONS`. Kept here so that drawing a skeleton does
 * not pull in @mediapipe/tasks-vision: importing it for this alone cost 135 KB
 * (40 KB gzip) in the initial bundle, because the reference preview renders on
 * first paint even for a learner who never starts the camera.
 *
 * drawing.test.ts asserts this stays identical to MediaPipe's own list, so an
 * upstream change cannot silently desync it.
 */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // little + palm edge
]

/**
 * Draws hand skeletons onto a canvas. Used by both the live camera overlay
 * and recording replay so the two renderings look identical. Landmarks are
 * image-normalised, so they are scaled to the canvas's backing store here.
 */
export function drawHands(ctx: CanvasRenderingContext2D, hands: TrackedHand[]) {
  const { width, height } = ctx.canvas
  for (const hand of hands) {
    const color = HAND_COLORS[hand.handedness] ?? FALLBACK_COLOR
    const pts = hand.landmarks

    // Each bone and each joint is stroked on its own, rather than batched into
    // one Path2D per hand. That is deliberate, and both halves were measured:
    // batching changes 27% of the inked pixels, because overlapping antialiased
    // edges composite once instead of once per shape, and it is also *slower*
    // here (0.022 ms vs 0.017 ms per frame) since Path2D setup costs more than
    // the draw calls it saves on paths this small. Drawing shape-by-shape is
    // pixel-identical to the MediaPipe DrawingUtils output this replaced —
    // which is what makes the swap safe on the overlay learners correct against.
    ctx.strokeStyle = color
    ctx.lineWidth = BONE_WIDTH
    for (const [from, to] of HAND_CONNECTIONS) {
      const a = pts[from]
      const b = pts[to]
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(a.x * width, a.y * height)
      ctx.lineTo(b.x * width, b.y * height)
      ctx.stroke()
    }

    ctx.fillStyle = color
    ctx.strokeStyle = JOINT_OUTLINE
    ctx.lineWidth = 1
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x * width, p.y * height, JOINT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
}
