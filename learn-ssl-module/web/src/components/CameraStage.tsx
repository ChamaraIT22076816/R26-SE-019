import type { ReactNode, RefObject } from 'react'
import type { TrackingStatus } from '../vision/useHandTracking'

interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  status: TrackingStatus
  error: string
  onStart: () => void
  idleHint: string
  /** Extra overlays rendered above the video (countdown, REC badge, …). */
  children?: ReactNode
}

/** Mirrored webcam view + landmark overlay canvas, shared by Practice and Record. */
export function CameraStage({
  videoRef,
  canvasRef,
  status,
  error,
  onStart,
  idleHint,
  children,
}: CameraStageProps) {
  return (
    <div className="camera-stage">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
      {children}
      {status !== 'running' && (
        <div className="camera-placeholder">
          {status === 'error' ? (
            <>
              <p className="camera-error">{error}</p>
              <button className="btn" onClick={onStart}>
                Try again
              </button>
            </>
          ) : (
            <>
              <p className="camera-hint">
                {status === 'starting' ? 'Loading hand tracker and camera…' : idleHint}
              </p>
              <button className="btn" onClick={onStart} disabled={status === 'starting'}>
                {status === 'starting' ? 'Starting…' : 'Start camera'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
