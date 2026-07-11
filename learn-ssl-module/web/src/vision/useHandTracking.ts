import { useCallback, useEffect, useRef, useState } from 'react'
import { DrawingUtils } from '@mediapipe/tasks-vision'
import { getHandLandmarker } from './handTracker'
import { drawHands } from './drawing'
import { toHandFrame } from './types'
import type { HandFrame, TrackedHand } from './types'

export type TrackingStatus = 'idle' | 'starting' | 'running' | 'error'

export interface TrackingStats {
  fps: number
  inferenceMs: number
  width: number
  height: number
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

/**
 * Owns the webcam stream + per-frame hand detection + skeleton overlay.
 * Views subscribe to frames via `onFrame` (e.g. the recorder buffers them).
 * The heavy landmarker itself is shared app-wide (see handTracker.ts).
 */
export function useHandTracking(onFrame?: (frame: HandFrame) => void) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawerRef = useRef<DrawingUtils | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const emaRef = useRef({ fps: 0, inferenceMs: 0, lastFrameAt: 0, lastUiPush: 0 })
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  const [status, setStatus] = useState<TrackingStatus>('idle')
  const [error, setError] = useState('')
  const [stats, setStats] = useState<TrackingStats | null>(null)
  const [hands, setHands] = useState<TrackedHand[]>([])

  const processFrame = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const landmarker = await getHandLandmarker()

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
      const frame = toHandFrame(result, t0)

      const ctx = canvas.getContext('2d')
      if (ctx) {
        if (!drawerRef.current) drawerRef.current = new DrawingUtils(ctx)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        drawHands(drawerRef.current, frame.hands)
      }

      onFrameRef.current?.(frame)

      // Smoothed stats; pushed to React state at ~4 Hz to avoid re-render churn.
      const ema = emaRef.current
      if (ema.lastFrameAt > 0) {
        const instFps = 1000 / (t0 - ema.lastFrameAt)
        ema.fps = ema.fps === 0 ? instFps : ema.fps * 0.9 + instFps * 0.1
      }
      ema.lastFrameAt = t0
      const inferenceMs = t1 - t0
      ema.inferenceMs =
        ema.inferenceMs === 0 ? inferenceMs : ema.inferenceMs * 0.9 + inferenceMs * 0.1

      if (t1 - ema.lastUiPush > 250) {
        ema.lastUiPush = t1
        setStats({
          fps: ema.fps,
          inferenceMs: ema.inferenceMs,
          width: video.videoWidth,
          height: video.videoHeight,
        })
        setHands(frame.hands)
      }
    }

    rafRef.current = requestAnimationFrame(() => void processFrame())
  }, [])

  const start = useCallback(async () => {
    setStatus('starting')
    setError('')

    // Kick off model init and camera permission in parallel — together they
    // dominate startup time. The landmarker stays cached across attempts.
    const landmarkerPromise = getHandLandmarker()

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      await landmarkerPromise
      streamRef.current = stream

      const video = videoRef.current
      if (!video) throw new Error('Video element is not mounted.')
      video.srcObject = stream
      await video.play()

      lastVideoTimeRef.current = -1
      emaRef.current = { fps: 0, inferenceMs: 0, lastFrameAt: 0, lastUiPush: 0 }
      setStatus('running')
      rafRef.current = requestAnimationFrame(() => void processFrame())
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      landmarkerPromise.catch(() => {}) // camera may have failed first; silence the pair
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

  // Release the camera on unmount. The landmarker is shared, so it stays up.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      drawerRef.current = null
    }
  }, [])

  return { videoRef, canvasRef, status, error, stats, hands, start, stop }
}
