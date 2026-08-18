import { useEffect, useMemo, useRef, useState } from 'react'
import { useHandTracking } from '../vision/useHandTracking'
import type { HandFrame, RecordingMeta, SignRecording } from '../vision/types'
import { toMeta } from '../vision/types'
import { listRecordings } from '../storage/recordingStore'
import { loadReferenceFrames, loadReferenceIndex } from '../storage/bundledReferences'
import { pickReferenceList } from '../storage/references'
import { categoriesIn, categoryOf } from '../data/categories'
import { glossLabel, matchesSearch, translationOf } from '../data/translations'
import { addAttempt, listAttempts } from '../learner/attemptLog'
import type { AttemptLogEntry } from '../learner/attemptLog'
import { suggestNext, summarizeAll } from '../learner/mastery'
import { scoreAttempt, topFingers } from '../scoring/score'
import type { ScoreResult } from '../scoring/score'
import { FINGER_LABEL } from '../scoring/landmarks'
import { useFeedbackLatency } from '../metrics/useFeedbackLatency'
import { CameraStage } from './CameraStage'
import { SkeletonPlayer } from './SkeletonPlayer'
import { ScoreBadge } from './ScoreBadge'
import { STACKED_LAYOUT, useMediaQuery } from './useMediaQuery'

const COUNTDOWN_S = 3

type Phase = 'idle' | 'countdown' | 'recording' | 'result'

/**
 * Graded practice: choose a sign, watch the reference, record an attempt, and
 * get a DTW match score with corrective hints and a side-by-side replay.
 */
export function PracticeView() {
  // The picker runs entirely on metadata — 220 KB for all 362 signs. Only the
  // selected sign's frames are fetched, because only it is replayed and scored.
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
  const [logFailed, setLogFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const phaseRef = useRef<Phase>('idle')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const selectedRef = useRef<RecordingMeta | null>(null)
  selectedRef.current = selected
  // Scoring needs the frames, not just the metadata, and finishRecording runs
  // outside React's render so it reads them through a ref.
  const referenceRef = useRef<SignRecording | null>(null)
  referenceRef.current = reference
  const framesRef = useRef<HandFrame[]>([])
  const startTsRef = useRef<number | null>(null)
  const countdownRef = useRef(0)
  const didPreselectRef = useRef(false)
  // Absolute capture time of the newest frame, kept before the buffer rewrites
  // timestamps to be take-relative. It is where the feedback-latency clock
  // starts — see metrics/latency.ts.
  const lastFrameAtRef = useRef<number | null>(null)

  // Act 1 is the commit that gets measured: final score, final hints, nothing
  // moving. Act 2 is everything expressive, released one frame later by
  // useFeedbackLatency once the sample has been taken. See its doc comment.
  const [revealArmed, setRevealArmed] = useState(false)
  const latency = useFeedbackLatency('practice', () => setRevealArmed(true))

  // Where the reference replay lives. Stacked (phone) it goes inside the camera
  // stage, so the learner can watch it and stay in frame at once; side by side
  // it stays in the panel, which already has room for it and its transport.
  const stacked = useMediaQuery(STACKED_LAYOUT)

  // Capture a bit longer than the reference so a slightly slower attempt fits.
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

  // Keep the suggestion in step with the log — it changes on load and after
  // every scored attempt.
  useEffect(() => {
    if (references.length === 0) return
    const next = suggestNext(summarizeAll(references.map((r) => r.gloss), entries))
    setSuggested(next)
    // Pre-select the suggestion once, so the learner can start straight away
    // without stealing their choice on later re-ranks.
    if (!didPreselectRef.current) {
      didPreselectRef.current = true
      setSelected((cur) => cur ?? references.find((r) => r.gloss === next) ?? null)
    }
  }, [references, entries])

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

    // Log the attempt: feeds mastery/suggestions now, error mining later.
    const entry: AttemptLogEntry = {
      id: att.id,
      gloss: reference.gloss,
      referenceId: reference.id,
      score: scored.score,
      worstFingers: topFingers(scored),
      createdAt: att.createdAt,
    }
    setLogFailed(false)
    addAttempt(entry).catch((e: unknown) => {
      // Never fail silently: a lost attempt means wrong mastery and progress.
      console.error('Failed to save attempt to the log', e)
      setLogFailed(true)
    })
    // The suggestion effect re-ranks off the new log.
    setEntries((prev) => [...prev, entry])
  }

  const noAttemptHands = result != null && result.hands.every((h) => h.missing)
  const inputsLocked = phase === 'countdown' || phase === 'recording'

  // The picker holds every reference (80+ once more of the dataset is
  // converted), so it is searchable and grouped rather than one flat list.
  const categories = useMemo(() => categoriesIn(references), [references])
  const visible = useMemo(() => {
    const needle = query.trim()
    return references.filter(
      (r) =>
        (category === null || categoryOf(r) === category) &&
        // Matches the gloss or its English meaning, so a learner can find
        // KANAWA by typing "eat".
        matchesSearch(r.gloss, needle),
    )
  }, [references, query, category])

  return (
    <div className="record-layout">
      <section className="camera-card">
        <CameraStage
          videoRef={tracking.videoRef}
          canvasRef={tracking.canvasRef}
          status={tracking.status}
          error={tracking.error}
          onStart={() => void tracking.start()}
          idleHint="Start the camera, choose a sign, and record your attempt."
          pip={
            stacked && reference && phase !== 'result' ? (
              <SkeletonPlayer
                frames={reference.frames}
                videoWidth={reference.videoWidth}
                videoHeight={reference.videoHeight}
              />
            ) : undefined
          }
        >
          {phase === 'countdown' && (
            <div className="countdown-overlay">
              <span>{count}</span>
            </div>
          )}
          {phase === 'recording' && (
            <>
              <div className="rec-badge">● REC {(elapsedMs / 1000).toFixed(1)} s</div>
              <div className="rec-progress">
                <div style={{ width: `${Math.min(elapsedMs / captureMs, 1) * 100}%` }} />
              </div>
            </>
          )}
        </CameraStage>

        <div className="camera-bar">
          {tracking.status === 'running' ? (
            <>
              <button
                className="btn btn-ghost"
                onClick={tracking.stop}
                disabled={phase === 'countdown' || phase === 'recording'}
              >
                Stop camera
              </button>
              {tracking.stats && (
                <span className="camera-stats">
                  {tracking.stats.fps.toFixed(0)} fps · {tracking.stats.inferenceMs.toFixed(1)} ms
                </span>
              )}
            </>
          ) : (
            <span className="camera-stats">Tracking runs entirely in your browser.</span>
          )}
        </div>
      </section>

      <aside className="record-panel" data-reveal={revealArmed ? 'on' : undefined}>
        {phase === 'result' && result ? (
          <>
            <h2>{selected?.gloss}</h2>
            <div className="result-top">
              <ScoreBadge score={result.score} />
              <ul className="hint-list">
                {result.hints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>

            {result.mirrored && (
              <p className="hint-text">
                Scored as a mirrored (left-dominant) rendition — that's a valid way to sign it.
              </p>
            )}
            {logFailed && (
              <p className="camera-error">
                This attempt couldn't be saved, so it won't count towards your progress.
              </p>
            )}

            {noAttemptHands ? (
              <p className="camera-error">
                No hands were tracked in your attempt — check your framing and lighting, then try
                again.
              </p>
            ) : (
              topFingers(result).length > 0 && (
                <div className="finger-chips">
                  {topFingers(result).map((f) => (
                    <span key={f} className="finger-chip">
                      {FINGER_LABEL[f]}
                    </span>
                  ))}
                </div>
              )
            )}

            <div className="compare-grid">
              <div>
                <p className="compare-label">Reference</p>
                {reference && (
                  <SkeletonPlayer
                    frames={reference.frames}
                    videoWidth={reference.videoWidth}
                    videoHeight={reference.videoHeight}
                  />
                )}
              </div>
              <div>
                <p className="compare-label">Your attempt</p>
                {attempt && (
                  <SkeletonPlayer
                    frames={attempt.frames}
                    videoWidth={attempt.videoWidth}
                    videoHeight={attempt.videoHeight}
                  />
                )}
              </div>
            </div>

            <div className="row-buttons panel-actions">
              <button className="btn" onClick={beginCountdown} disabled={tracking.status !== 'running'}>
                Try again
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setResult(null)
                  setAttempt(null)
                  setRevealArmed(false)
                  setPhase('idle')
                }}
              >
                Pick another sign
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Practice a sign</h2>
            {references.length === 0 ? (
              <p className="hint-text">
                No reference signs yet. Record some in the <strong>Record</strong> tab first —
                start with ME, YOU, NAME.
              </p>
            ) : (
              <>
                {suggested && (
                  <p className="hint-text">
                    Suggested next:{' '}
                    <button
                      className="link-button"
                      onClick={() => {
                        const next = references.find((r) => r.gloss === suggested)
                        if (next) setSelected(next)
                      }}
                      disabled={inputsLocked}
                      title="Jump to the suggested sign"
                    >
                      {suggested} ★
                    </button>
                  </p>
                )}

                <div className="picker-filters">
                  <input
                    type="search"
                    className="picker-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${references.length} signs…`}
                    disabled={inputsLocked}
                    aria-label="Search signs"
                  />
                  {categories.length > 1 && (
                    <div className="category-chips">
                      <button
                        className={category === null ? 'chip active' : 'chip'}
                        onClick={() => setCategory(null)}
                        disabled={inputsLocked}
                      >
                        All {references.length}
                      </button>
                      {categories.map((name) => (
                        <button
                          key={name}
                          className={category === name ? 'chip active' : 'chip'}
                          onClick={() => setCategory(name)}
                          disabled={inputsLocked}
                        >
                          {name} {references.filter((r) => categoryOf(r) === name).length}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {visible.length === 0 ? (
                  <p className="hint-text">No signs match “{query}”.</p>
                ) : (
                  <div className="gloss-chips gloss-chips-scroll">
                    {visible.map((r) => (
                      <button
                        key={r.id}
                        className={selected?.id === r.id ? 'chip active' : 'chip'}
                        onClick={() => setSelected(r)}
                        disabled={inputsLocked}
                        title={translationOf(r.gloss)}
                      >
                        {r.gloss === suggested ? `${r.gloss} ★` : r.gloss}
                      </button>
                    ))}
                  </div>
                )}

                {selected && (
                  <div className="reference-preview">
                    <p className="compare-label">Sign this: {glossLabel(selected.gloss)}</p>
                    {selected.provisional && (
                      <p className="provisional-note">
                        Provisional reference — recorded by the team to unblock development, not
                        verified SSL.
                      </p>
                    )}
                    {reference ? (
                      // Stacked, the player itself is in the camera stage — the
                      // gloss and the provisional note above stay here either way.
                      !stacked && (
                        <SkeletonPlayer
                          frames={reference.frames}
                          videoWidth={reference.videoWidth}
                          videoHeight={reference.videoHeight}
                        />
                      )
                    ) : refFailed ? (
                      <p className="camera-error">
                        Could not load this reference recording. Pick another sign, or check your
                        connection and select it again.
                      </p>
                    ) : (
                      <p className="hint-text">Loading reference…</p>
                    )}
                  </div>
                )}

                <p className="hint-text">
                  Watch the reference, then record yourself signing it. You'll get a match score
                  and tips on what to fix.
                </p>

                {/* Last in the panel so it can stick to the bottom of the
                    viewport on a phone, within thumb reach, instead of landing
                    hundreds of pixels below the fold. */}
                <div className="panel-actions">
                  {phase === 'countdown' ? (
                    <button className="btn btn-ghost" onClick={cancelCountdown}>
                      Cancel
                    </button>
                  ) : phase === 'recording' ? (
                    <button className="btn" onClick={finishRecording}>
                      Stop &amp; score
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={beginCountdown}
                      disabled={tracking.status !== 'running' || !reference}
                      title={
                        tracking.status !== 'running'
                          ? 'Start the camera first'
                          : !selected
                            ? 'Choose a sign first'
                            : refFailed
                              ? 'This reference could not be loaded'
                              : !reference
                                ? 'Loading the reference recording…'
                                : undefined
                      }
                    >
                      Record attempt
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
