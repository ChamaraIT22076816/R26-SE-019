import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHandTracking } from '../vision/useHandTracking'
import type { HandFrame, RecordingMeta, SignRecording } from '../vision/types'
import { toMeta } from '../vision/types'
import { listRecordings } from '../storage/recordingStore'
import { loadReferenceFrames, loadReferenceIndex } from '../storage/bundledReferences'
import { pickReferenceList } from '../storage/references'
import { categoryOf } from '../data/categories'
import { glossLabel } from '../data/translations'
import { addAttempt, listAttempts } from '../learner/attemptLog'
import type { AttemptLogEntry } from '../learner/attemptLog'
import { summarizeAll } from '../learner/mastery'
import {
  buildSession,
  clearSession,
  isComplete,
  loadSession,
  markAttempted,
  saveSession,
} from '../learner/session'
import type { PracticeSession } from '../learner/session'
import { scoreAttempt, topFingers } from '../scoring/score'
import type { ScoreResult } from '../scoring/score'
import { FINGER_LABEL } from '../scoring/landmarks'
import { useFeedbackLatency } from '../metrics/useFeedbackLatency'
import { CameraStage } from './CameraStage'
import { SkeletonPlayer } from './SkeletonPlayer'
import { ScoreBadge } from './ScoreBadge'
import { CategorySignNavigator } from './CategorySignNavigator'

const COUNTDOWN_S = 3

type Phase = 'idle' | 'countdown' | 'recording' | 'result'

export function PracticeView() {
  const [references, setReferences] = useState<RecordingMeta[]>([])
  const [localRecs, setLocalRecs] = useState<SignRecording[]>([])
  const [selected, setSelected] = useState<RecordingMeta | null>(null)
  const [reference, setReference] = useState<SignRecording | null>(null)
  const [refFailed, setRefFailed] = useState(false)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [count, setCount] = useState(COUNTDOWN_S)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [result, setResult] = useState<ScoreResult | null>(null)
  const [attempt, setAttempt] = useState<SignRecording | null>(null)
  const [entries, setEntries] = useState<AttemptLogEntry[]>([])
  const [suggested, setSuggested] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [session, setSession] = useState<PracticeSession | null>(() => loadSession())

  const phaseRef = useRef<Phase>('idle')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const selectedRef = useRef<RecordingMeta | null>(null)
  selectedRef.current = selected
  const referenceRef = useRef<SignRecording | null>(null)
  referenceRef.current = reference
  const framesRef = useRef<HandFrame[]>([])
  const startTsRef = useRef<number | null>(null)
  const countdownRef = useRef(0)
  const retryRef = useRef<HTMLButtonElement>(null)
  const completeRef = useRef<HTMLHeadingElement>(null)
  const lastFrameAtRef = useRef<number | null>(null)

  const [revealArmed, setRevealArmed] = useState(false)
  const latency = useFeedbackLatency('practice', () => setRevealArmed(true))

  const captureMs = selected ? Math.max(selected.durationMs + 1500, 2500) : 3500

  const tracking = useHandTracking((frame) => {
    if (phaseRef.current !== 'recording') return
    if (startTsRef.current === null) startTsRef.current = frame.timestampMs
    const rel = frame.timestampMs - startTsRef.current
    lastFrameAtRef.current = frame.timestampMs
    framesRef.current.push({ ...frame, timestampMs: rel })
    setElapsedMs(rel)
    if (rel >= captureMs) finishRecording()
  })

  useEffect(() => {
    void (async () => {
      const [loc, index, log] = await Promise.all([
        listRecordings(),
        loadReferenceIndex(),
        listAttempts(),
      ])
      setLocalRecs(loc)
      setReferences(pickReferenceList([...loc.map(toMeta), ...index]))
      setEntries(log)
    })()
  }, [])

  // Fetch the frames for whichever sign is selected. A bundled reference comes
  // from public/references/ (cached module-side); the learner's own recordings
  // are already in memory from the initial IndexedDB read.
  useEffect(() => {
    setReference(null)
    setRefFailed(false)
    // A correction belongs to the sign it was given for.
    if (!selected) return
    let cancelled = false
    void (async () => {
      const full = selected.file
        ? await loadReferenceFrames(selected.file)
        : (localRecs.find((r) => r.id === selected.id) ?? null)
      if (cancelled) return
      if (full) setReference(full)
      else setRefFailed(true)
    })()
    return () => {
      cancelled = true
    }
  }, [selected, localRecs])

  // Category lookup for the practice ranking's tie-break. It only separates
  // signs the model rates equally — see buildSession.
  const categoryFor = useCallback(
    (gloss: string) => {
      const rec = references.find((r) => r.gloss === gloss)
      return rec ? categoryOf(rec) : 'Other'
    },
    [references],
  )

  // Keep the suggestion in step with the log — it changes on load and after
  // every scored attempt. Sourced from buildSession rather than suggestNext so
  // the sign named here is the one a session would actually open on.
  useEffect(() => {
    if (references.length === 0) return
    const summaries = summarizeAll(references.map((r) => r.gloss), entries)
    const next = buildSession(summaries, 1, new Date(), categoryFor)[0] ?? null
    setSuggested(next)
  }, [references, entries, categoryFor])

  // Abandon a take if the camera stops mid-recording.
  useEffect(() => {
    if (
      tracking.status !== 'running' &&
      (phaseRef.current === 'countdown' || phaseRef.current === 'recording')
    ) {
      window.clearInterval(countdownRef.current)
      setPhase('idle')
    }
  }, [tracking.status])

  useEffect(() => () => window.clearInterval(countdownRef.current), [])

  // Nothing consumes frames while a result is on screen, and inference is the
  // most expensive thing on the page. Handing that budget back is what lets the
  // score reveal animate smoothly on a low-end device. The camera stays live,
  // so resuming is instant.
  const { pause: pauseTracking, resume: resumeTracking } = tracking
  useEffect(() => {
    if (phase === 'result') pauseTracking()
    else resumeTracking()
  }, [phase, pauseTracking, resumeTracking])

  useEffect(() => {
    if (session) saveSession(session)
    else clearSession()
  }, [session])

  /** Leave the result view without touching the session. */
  function leaveResult() {
    setResult(null)
    setAttempt(null)
    setRevealArmed(false)
    setPhase('idle')
  }

  // Per-sign change over the session, from the log rather than anything the
  // session stores about how well it went.

  const sessionDone = session !== null && isComplete(session)

  /**
   * What a screen reader hears as the take progresses. None of this had any
   * non-visual representation: the countdown was a number painted over video,
   * the recording state a coloured badge, and the score an SVG.
   *
   * Deliberately derived from the phase rather than the frame clock, so it
   * changes a handful of times per attempt instead of thirty times a second —
   * a live region that updates per frame is unusable.
   */
  const liveMessage = useMemo(() => {
    if (phase === 'countdown') return `Get ready. Recording starts in ${COUNTDOWN_S} seconds.`
    if (phase === 'recording') return 'Recording. Sign now.'
    if (phase === 'result' && result) {
      const band =
        result.score >= 85 ? 'Great match' : result.score >= 60 ? 'Getting there' : 'Keep practising'
      const hint = result.hints[0] ? ` ${result.hints[0]}` : ''
      return `${selectedRef.current?.gloss ?? 'Sign'} scored ${result.score} out of 100. ${band}.${hint}`
    }
    return ''
  }, [phase, result])

  // The result panel replaces the picker wholesale, which leaves keyboard focus
  // on a button that no longer exists — a screen-reader user is stranded at the
  // document root. Put focus on the action they are most likely to want next.
  // preventScroll because on a phone the panel is below a sticky camera and
  // yanking it into view would undo that.
  useEffect(() => {
    if (phase === 'result') retryRef.current?.focus({ preventScroll: true })
  }, [phase])

  // The completion card replaces the picker in the same way, so focus needs the
  // same treatment — otherwise finishing a session drops you at the page top.
  useEffect(() => {
    if (sessionDone && phase === 'idle') completeRef.current?.focus({ preventScroll: true })
  }, [sessionDone, phase])

  function beginCountdown() {
    // Frames must be in hand before the take starts — there is nothing to score
    // against otherwise, and the countdown would strand the learner.
    if (tracking.status !== 'running' || !referenceRef.current) return
    setResult(null)
    setAttempt(null)
    setRevealArmed(false)
    setCount(COUNTDOWN_S)
    setPhase('countdown')
    countdownRef.current = window.setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          window.clearInterval(countdownRef.current)
          framesRef.current = []
          startTsRef.current = null
          lastFrameAtRef.current = null
          setElapsedMs(0)
          setPhase('recording')
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  function cancelCountdown() {
    window.clearInterval(countdownRef.current)
    setPhase('idle')
  }

  function finishRecording() {
    if (phaseRef.current !== 'recording') return
    const reference = referenceRef.current
    const frames = framesRef.current
    framesRef.current = []
    if (!reference) {
      setPhase('idle')
      return
    }
    const durationMs = Math.max(frames[frames.length - 1]?.timestampMs ?? 0, 1)
    const video = tracking.videoRef.current
    const att: SignRecording = {
      id: crypto.randomUUID(),
      gloss: reference.gloss,
      signer: 'learner',
      createdAt: new Date().toISOString(),
      durationMs,
      fps: Math.round((frames.length / durationMs) * 1000),
      videoWidth: video?.videoWidth || 1280,
      videoHeight: video?.videoHeight || 720,
      frames,
    }
    const captureAt = lastFrameAtRef.current
    const scoreStartAt = performance.now()
    const scored = scoreAttempt(att, reference)
    const scoreEndAt = performance.now()
    setAttempt(att)
    setResult(scored)
    // Survives the next retry, so the learner signs while reading the fix.
    setRevealArmed(false)
    setPhase('result')

    // A take with no frames has no capture instant to measure from, so it is
    // left unsampled rather than recorded as an implausibly fast one.
    if (captureAt !== null) {
      latency.arm(
        { captureAt, scoreStartAt, scoreEndAt },
        {
          id: att.id,
          gloss: reference.gloss,
          frameCount: frames.length,
          createdAt: att.createdAt,
        },
      )
    } else {
      // Nothing to measure, so nothing will release the reveal — do it here, or
      // this attempt's result would sit frozen in its pre-animation state.
      requestAnimationFrame(() => setRevealArmed(true))
    }

    // A take the tracker never saw a hand in is a capture failure, not a
    // performance. Recording it as a 0 would sink mastery and make the next
    // real attempt read as a huge jump "since your last try". Show the
    // framing guidance (the result view branches on this), but keep it out of
    // the log and don't count it toward the session.
    if (scored.hands.length > 0 && scored.hands.every((h) => h.missing)) return

    // One scored attempt completes a session sign, whatever the score.
    setSession((prev) => (prev ? markAttempted(prev, reference.gloss) : prev))

    // Log the attempt: feeds mastery/suggestions now, error mining later.
    const entry: AttemptLogEntry = {
      id: att.id,
      gloss: reference.gloss,
      referenceId: reference.id,
      score: scored.score,
      worstFingers: topFingers(scored),
      // Read before markAttempted runs, so an attempt that completes a session
      // is still attributed to it.
      sessionId: session?.id,
      createdAt: att.createdAt,
    }
    addAttempt(entry).catch((e: unknown) => {
      // Never fail silently: a lost attempt means wrong mastery and progress.
      console.error('Failed to save attempt to the log', e)
    })
    // The suggestion effect re-ranks off the new log.
    setEntries((prev) => [...prev, entry])
  }

  // A take the tracker never saw a hand in — a capture failure, not a 0/100
  // performance. `.every()` is true for an empty array, so guard the length.
  const noAttemptHands =
    result != null && result.hands.length > 0 && result.hands.every((h) => h.missing)

  // Finger feedback is shown once, as the Focus-on chips. The per-finger
  // "Check your X — its shape drifts" sentences are the same information in
  // prose, so they are filtered out of the notes here.
  const fingerFocus = result ? topFingers(result) : []
  const resultNotes = result ? result.hints.filter((h) => !h.startsWith('Check your ')) : []

  /**
   * How this attempt compares with the learner's own history for this sign.
   *
   * A bare score answers "how did I do" but not "am I getting better", which is
   * the question that keeps someone practising. The newest entry in the log is
   * this attempt — finishRecording appends it synchronously — so the one before
   * it is the comparison, and everything before that decides whether this is a
   * personal best.
   *
   * A linear scan of an in-memory array, and it runs on the frame
   * useFeedbackLatency measures: at pilot scale (tens to hundreds of attempts)
   * that is far below a frame budget, but it is the reason this is a plain
   * filter and not something that touches IndexedDB.
   */
  const progress = useMemo(() => {
    if (!result || !selected) return { delta: null as number | null, best: false }
    const forGloss = entries.filter((e) => e.gloss === selected.gloss)
const earlier = forGloss.slice(0, -1)
    if (earlier.length === 0) return { delta: null as number | null, best: false }
    const previous = earlier[earlier.length - 1].score
    const bestBefore = Math.max(...earlier.map((e) => e.score))
    return { delta: result.score - previous, best: result.score > bestBefore }
  }, [entries, result, selected])

  const [isBrowsing, setIsBrowsing] = useState(true)

  // If selected changes from outside or suggested, sync
  useEffect(() => {
    if (selected) setIsBrowsing(false)
  }, [selected])

  // Shared by both result states. "Try again" runs the countdown, which needs a
  // live camera — if it dropped, offer to turn it back on rather than a button
  // that silently does nothing. retryRef takes focus when the result appears.
  const resultActions = (
    <div className="aww-result-actions">
      {tracking.status === 'running' ? (
        <button ref={retryRef} className="btn massive" onClick={beginCountdown}>
          Try again
        </button>
      ) : (
        <button ref={retryRef} className="btn massive" onClick={() => void tracking.start()}>
          Turn on camera
        </button>
      )}
      <button
        className="btn ghost massive"
        onClick={() => {
          leaveResult()
          setIsBrowsing(true)
        }}
      >
        Choose another sign
      </button>
    </div>
  )

  return (
    <div className="aww-practice-env" data-phase={phase} data-picker-open={pickerOpen}>
      {/* HUD (Heads-Up Display) Bottom Center - Only visible when practicing an active sign */}
      {!isBrowsing && selected && phase !== 'result' && (
        <div className="aww-hud">
          {tracking.status !== 'running' ? (
            <button className="btn massive ghost" onClick={() => void tracking.start()}>
              Turn on Camera to Practice
            </button>
          ) : phase === 'idle' ? (
            <button className="btn massive" onClick={beginCountdown} disabled={!reference}>
              {reference ? 'Record Attempt' : 'Loading reference...'}
            </button>
          ) : phase === 'countdown' ? (
            <div className="aww-hud-countdown">
              <span>{count}</span>
              <button className="btn ghost massive" onClick={cancelCountdown}>Cancel</button>
            </div>
          ) : phase === 'recording' ? (
            <div className="aww-hud-recording">
              <span className="aww-rec-timer">
                <span className="aww-rec-dot" aria-hidden="true" />
                REC {(elapsedMs / 1000).toFixed(1)}s
              </span>
              <button className="btn massive aww-btn-stop" onClick={finishRecording}>
                Stop &amp; Score
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* The Split Screen */}
      <div className="aww-split-screen">
        
        {/* Left Pane: Target Reference or In-Pane Category & Sign Browser */}
        <div className="aww-pane aww-pane-left">
          {isBrowsing || !selected ? (
            <CategorySignNavigator
              references={references}
              suggested={suggested}
              selectedId={selected?.id}
              mode="practice"
              onSelect={(rec) => {
                setSelected(rec)
                setIsBrowsing(false)
              }}
            />
          ) : (
            <>
              <div className="aww-pane-header">
                <div>
                  <p className="aww-pane-label">Reference</p>
                  <h2 className="aww-pane-title">
                    {glossLabel(selected.gloss)}
                    {selected.gloss === suggested && (
                      <span className="badge cs-suggested-chip" style={{ marginLeft: '8px', verticalAlign: 'middle' }}>Suggested</span>
                    )}
                  </h2>
                </div>
                {phase !== 'result' && (
                  <div className="aww-pane-header-actions" style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn ghost" onClick={() => setIsBrowsing(true)}>← Categories</button>
                    <button className="btn ghost" onClick={() => setPickerOpen(true)}>Search</button>
                  </div>
                )}
              </div>
              
              <div className="aww-pane-content">
                {reference ? (
                  <SkeletonPlayer
                    frames={reference.frames}
                    videoWidth={reference.videoWidth}
                    videoHeight={reference.videoHeight}
                  />
                ) : refFailed ? (
                  <p className="camera-error">Could not load reference.</p>
                ) : (
                  <p className="hint-text">Loading...</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Pane: User Camera / Replay */}
        <div className="aww-pane aww-pane-right" data-camera-status={tracking.status}>
           <div className="aww-pane-header">
              <p className="aww-pane-label">You</p>
           </div>
           
           {/* Live Camera (Always mounted, hidden during replay overlay) */}
           <div className={`aww-camera-container ${phase === 'result' ? 'hidden' : ''}`}>
               <CameraStage
                 videoRef={tracking.videoRef}
                 canvasRef={tracking.canvasRef}
                 status={tracking.status}
                 error={tracking.error}
                 onStart={() => void tracking.start()}
                 idleHint=""
                 inferring={tracking.inferring}
               />
           </div>

           {/* Replay Overlay */}
           {phase === 'result' && attempt && (
               <div className="aww-replay-container">
                   <SkeletonPlayer frames={attempt.frames} videoWidth={attempt.videoWidth} videoHeight={attempt.videoHeight} />
               </div>
           )}
        </div>

        {/* Centre result: a capture failure and a scored attempt are different
            outcomes and get different panels. */}
        {phase === 'result' && result && (
          <div className="aww-result-overlay" data-reveal={revealArmed ? 'on' : undefined}>
            {noAttemptHands ? (
              <div className="aww-result-panel aww-result-nohands">
                <p className="pane-label">Couldn't see your hands</p>
                <p className="aww-result-lead">The tracker didn't pick up a hand in that take.</p>
                <p>Move back so your hands and shoulders are in frame, and make sure the room is well lit.</p>
                {resultActions}
              </div>
            ) : (
              <div className="aww-result-panel">
                <ScoreBadge score={result.score} delta={progress.delta} best={progress.best} />
                <div className="aww-result-feedback">
                  {result.score === 100 ? (
                    <p className="perfect-hint">Flawless match. Perfect execution.</p>
                  ) : (
                    <>
                      {resultNotes.map((h, i) => (
                        <p key={i}>{h}</p>
                      ))}
                      {fingerFocus.length > 0 && (
                        <div className="focus-block">
                          <p className="pane-label">Focus on</p>
                          <div className="finger-chips">
                            {fingerFocus.map((f) => (
                              <span key={f} className="finger-chip">
                                {FINGER_LABEL[f]}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {resultActions}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Command Palette Modal for choosing a sign */}
      <div className={`aww-picker-modal ${pickerOpen ? 'open' : ''}`}>
        <div className="aww-picker-backdrop" onClick={() => setPickerOpen(false)} />
        <div className="aww-picker-content">
          <CategorySignNavigator
            references={references}
            suggested={suggested}
            selectedId={selected?.id}
            mode="practice"
            isModal={true}
            onSelect={(rec) => {
              setSelected(rec)
              setPickerOpen(false)
            }}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      </div>
      
      {/* Session Logic / Hidden items */}
      <p className="sr-only" role="status">{liveMessage}</p>
    </div>
  )
}
