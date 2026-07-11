import { useEffect, useRef, useState } from 'react'
import { DrawingUtils } from '@mediapipe/tasks-vision'
import { drawHands } from '../vision/drawing'
import type { HandFrame } from '../vision/types'

interface SkeletonPlayerProps {
  frames: HandFrame[]
  videoWidth: number
  videoHeight: number
  /** Mirror like the live self-view (default) so learners can imitate directly. */
  mirrored?: boolean
}

/** Replays a recorded landmark sequence on a canvas — no video involved. */
export function SkeletonPlayer({
  frames,
  videoWidth,
  videoHeight,
  mirrored = true,
}: SkeletonPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0) // playback position while paused / at seek
  const lastTRef = useRef(0)
  const lastUiPushRef = useRef(0)
  const renderAtRef = useRef<(t: number) => void>(() => {})

  const [playing, setPlaying] = useState(true)
  const [timeMs, setTimeMs] = useState(0)
  const durationMs = Math.max(frames[frames.length - 1]?.timestampMs ?? 0, 1)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const drawer = new DrawingUtils(ctx)

    let idx = 0
    const renderAt = (t: number) => {
      if (frames[idx] && frames[idx].timestampMs > t) idx = 0 // looped back
      while (idx + 1 < frames.length && frames[idx + 1].timestampMs <= t) idx++
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const frame = frames[idx]
      if (frame) drawHands(drawer, frame.hands)
      lastTRef.current = t
    }
    renderAtRef.current = renderAt

    if (!playing) {
      renderAt(offsetRef.current)
      return
    }

    startedAtRef.current = performance.now() - offsetRef.current
    // Paint immediately: rAF is suspended in hidden/occluded tabs, and the
    // first frame should be visible as soon as the player mounts.
    renderAt(offsetRef.current % durationMs)
    const loop = () => {
      const t = (performance.now() - startedAtRef.current) % durationMs
      renderAt(t)
      if (performance.now() - lastUiPushRef.current > 100) {
        lastUiPushRef.current = performance.now()
        setTimeMs(t)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, frames, durationMs])

  function togglePlay() {
    if (playing) offsetRef.current = lastTRef.current
    setPlaying(!playing)
  }

  function seek(t: number) {
    offsetRef.current = t
    if (playing) {
      startedAtRef.current = performance.now() - t
    } else {
      renderAtRef.current(t)
    }
    setTimeMs(t)
  }

  return (
    <div className="skeleton-player">
      <canvas
        ref={canvasRef}
        width={videoWidth}
        height={videoHeight}
        className={mirrored ? 'mirrored' : undefined}
      />
      <div className="player-controls">
        <button className="btn btn-ghost" onClick={togglePlay}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          value={Math.round(timeMs)}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="player-time">
          {(timeMs / 1000).toFixed(1)} / {(durationMs / 1000).toFixed(1)} s
        </span>
      </div>
    </div>
  )
}
