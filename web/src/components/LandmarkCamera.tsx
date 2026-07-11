import { useCallback, useEffect, useRef, useState } from 'react'
import { DrawingUtils, HandLandmarker } from '@mediapipe/tasks-vision'
import { createHandLandmarker } from '../vision/handTracker'
import { toHandFrame } from '../vision/types'
import type { TrackedHand } from '../vision/types'
import './LandmarkCamera.css'

type Status = 'idle' | 'starting' | 'running' | 'error'

interface Stats {
  fps: number
  inferenceMs: number
  width: number
  height: number
}

const HAND_COLORS: Record<string, string> = {
  Left: '#22d3ee',
  Right: '#a3e635',
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
        return 'Camera permission was denied. Allow camera access in the browser and try again.'
      case 'NotFoundError':
        return 'No camera was found on this device.'
      case 'NotReadableError':
        return 'The camera is already in use by another application.'
    }
  }
  return e instanceof Error ? e.message : 'Something went wrong while starting the camera.'
}

export function LandmarkCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const drawerRef = useRef<DrawingUtils | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const emaRef = useRef({ fps: 0, inferenceMs: 0, lastFrameAt: 0, lastUiPush: 0 })

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [hands, setHands] = useState<TrackedHand[]>([])

  const processFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const landmarker = landmarkerRef.current
    if (!video || !canvas || !landmarker) return

    // Only run inference when the camera has produced a new frame.
    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      const t0 = performance.now()
      const result = landmarker.detectForVideo(video, t0)
      const t1 = performance.now()

      const ctx = canvas.getContext('2d')
      if (ctx) {
        if (!drawerRef.current) drawerRef.current = new DrawingUtils(ctx)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        result.landmarks.forEach((landmarks, i) => {
          const label = result.handedness[i]?.[0]?.categoryName ?? 'Unknown'
          const color = HAND_COLORS[label] ?? '#f472b6'
          drawerRef.current!.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
            color,
            lineWidth: 5,
          })
          drawerRef.current!.drawLandmarks(landmarks, {
            color: '#0f172a',
            fillColor: color,
            lineWidth: 1,
            radius: 5,
          })
        })
      }

      // Smoothed stats; pushed to React state at ~4 Hz to avoid re-render churn.
      const ema = emaRef.current
      if (ema.lastFrameAt > 0) {
        const instFps = 1000 / (t0 - ema.lastFrameAt)
        ema.fps = ema.fps === 0 ? instFps : ema.fps * 0.9 + instFps * 0.1
      }
      ema.lastFrameAt = t0
      const inferenceMs = t1 - t0
      ema.inferenceMs = ema.inferenceMs === 0 ? inferenceMs : ema.inferenceMs * 0.9 + inferenceMs * 0.1

      if (t1 - ema.lastUiPush > 250) {
        ema.lastUiPush = t1
        setStats({
          fps: ema.fps,
          inferenceMs: ema.inferenceMs,
          width: video.videoWidth,
          height: video.videoHeight,
        })
        setHands(toHandFrame(result, t0).hands)
      }
    }

    rafRef.current = requestAnimationFrame(processFrame)
  }, [])

  const start = useCallback(async () => {
    setStatus('starting')
    setError('')

    // Kick off model init and camera permission in parallel — together they
    // dominate startup time. The landmarker is cached on the ref even when
    // the camera fails, so a retry doesn't reload the runtime and model.
    const landmarkerPromise = landmarkerRef.current
      ? Promise.resolve(landmarkerRef.current)
      : createHandLandmarker().then((lm) => (landmarkerRef.current = lm))

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      landmarkerRef.current = await landmarkerPromise
      streamRef.current = stream

      const video = videoRef.current
      if (!video) throw new Error('Video element is not mounted.')
      video.srcObject = stream
      await video.play()

      lastVideoTimeRef.current = -1
      emaRef.current = { fps: 0, inferenceMs: 0, lastFrameAt: 0, lastUiPush: 0 }
      setStatus('running')
      rafRef.current = requestAnimationFrame(processFrame)
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      landmarkerPromise.catch(() => {}) // camera may have failed first; don't leave an unhandled rejection
      setError(describeError(e))
      setStatus('error')
    }
  }, [processFrame])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setStatus('idle')
    setStats(null)
    setHands([])
  }, [])

  // Release camera and model on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      drawerRef.current = null
    }
  }, [])

  return (
    <section className="camera-card">
      <div className="camera-stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {status !== 'running' && (
          <div className="camera-placeholder">
            {status === 'error' ? (
              <>
                <p className="camera-error">{error}</p>
                <button className="btn" onClick={start}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <p className="camera-hint">
                  {status === 'starting'
                    ? 'Loading hand tracker and camera…'
                    : 'Practice signs in front of your camera with live hand tracking.'}
                </p>
                <button className="btn" onClick={start} disabled={status === 'starting'}>
                  {status === 'starting' ? 'Starting…' : 'Start camera'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="camera-bar">
        {status === 'running' ? (
          <>
            <button className="btn btn-ghost" onClick={stop}>
              Stop
            </button>
            <div className="hand-chips">
              {hands.length === 0 ? (
                <span className="hand-chip hand-chip-empty">No hands in view</span>
              ) : (
                hands.map((hand) => (
                  <span
                    key={hand.handedness}
                    className="hand-chip"
                    style={{ color: HAND_COLORS[hand.handedness] }}
                  >
                    {hand.handedness} · {(hand.score * 100).toFixed(0)}%
                  </span>
                ))
              )}
            </div>
            {stats && (
              <span className="camera-stats">
                {stats.fps.toFixed(0)} fps · {stats.inferenceMs.toFixed(1)} ms inference ·{' '}
                {stats.width}×{stats.height}
              </span>
            )}
          </>
        ) : (
          <span className="camera-stats">Camera off — tracking runs entirely in your browser.</span>
        )}
      </div>
    </section>
  )
}
