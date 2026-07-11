import { useHandTracking } from '../vision/useHandTracking'
import { HAND_COLORS } from '../vision/drawing'
import { CameraStage } from './CameraStage'

/** Free practice: live hand tracking with FPS / latency stats. DTW scoring lands here next. */
export function PracticeView() {
  const { videoRef, canvasRef, status, error, stats, hands, start, stop } = useHandTracking()

  return (
    <section className="camera-card">
      <CameraStage
        videoRef={videoRef}
        canvasRef={canvasRef}
        status={status}
        error={error}
        onStart={() => void start()}
        idleHint="Practice signs in front of your camera with live hand tracking."
      />

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
