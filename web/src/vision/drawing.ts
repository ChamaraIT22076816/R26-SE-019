import { DrawingUtils, HandLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { TrackedHand } from './types'

export const HAND_COLORS: Record<string, string> = {
  Left: '#22d3ee',
  Right: '#a3e635',
}
const FALLBACK_COLOR = '#f472b6'

/**
 * Draws hand skeletons onto a canvas. Used by both the live camera overlay
 * and recording replay so the two renderings look identical. DrawingUtils
 * scales the normalised landmark coordinates to the canvas size itself.
 */
export function drawHands(drawer: DrawingUtils, hands: TrackedHand[]) {
  for (const hand of hands) {
    const color = HAND_COLORS[hand.handedness] ?? FALLBACK_COLOR
    // Our stored landmarks are {x,y,z}; DrawingUtils only reads those fields.
    const landmarks = hand.landmarks as NormalizedLandmark[]
    drawer.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color,
      lineWidth: 5,
    })
    drawer.drawLandmarks(landmarks, {
      color: '#0f172a',
      fillColor: color,
      lineWidth: 1,
      radius: 5,
    })
  }
}
