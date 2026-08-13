import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSignCapture } from '../vision/useSignCapture'
import type { CapturedTake } from '../vision/useSignCapture'
import type { SignRecording } from '../vision/types'
import { listRecordings } from '../storage/recordingStore'
import { loadBundledRecordings } from '../storage/bundledReferences'
import { pickReferences } from '../storage/references'
import { addAttempt } from '../learner/attemptLog'
import { topFingers } from '../scoring/score'
import { RUBRIC_BASIS, RUBRIC_LABEL, scoreTurn } from '../scenario/rubric'
import type { RubricComponent, TurnScore } from '../scenario/rubric'
import type { Scenario, ScenarioTurn } from '../scenario/types'
import { SCENARIOS } from '../data/scenarios'
import { CameraStage } from './CameraStage'
import { SkeletonPlayer } from './SkeletonPlayer'
import { ScoreBadge } from './ScoreBadge'

type Stage = 'intro' | 'playing' | 'summary'

interface TurnOutcome {
  turn: ScenarioTurn
  score: TurnScore
  attempt: SignRecording
}

const RUBRIC_ORDER: RubricComponent[] = ['accuracy', 'appropriateness', 'fluency']

function RubricBars({ score }: { score: TurnScore }) {
  return (
    <ul className="rubric-list">
      {RUBRIC_ORDER.map((key) => {
        const value = score.rubric[key]
        return (
          <li key={key} title={RUBRIC_BASIS[key]}>
            <span className="rubric-name">{RUBRIC_LABEL[key]}</span>
            <div className="rubric-bar">
              <div style={{ width: `${value ?? 0}%` }} className={value === null ? 'na' : ''} />
            </div>
            <span className="rubric-value">{value === null ? 'n/a' : value}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Runs a scripted conversation scenario: each turn asks for one sign, scores it
 * through the existing DTW path, and reports against the proposal's rubric.
 * Turns whose gloss has no reference recording yet are skipped rather than
 * blocking the scenario.
 */
export function ScenarioView() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const scenario: Scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]

  const [references, setReferences] = useState<Map<string, SignRecording>>(new Map())
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<Stage>('intro')
  const [index, setIndex] = useState(0)
  const [outcomes, setOutcomes] = useState<TurnOutcome[]>([])
  const [current, setCurrent] = useState<TurnScore | null>(null)

  useEffect(() => {
    void (async () => {
      const [local, bundled] = await Promise.all([listRecordings(), loadBundledRecordings()])
      setReferences(pickReferences([...local, ...bundled]))
      setLoading(false)
    })()
  }, [])

  // Only turns we have a reference for can be scored; the rest stay visible as
  // "reference pending" so the gap is obvious rather than silently dropped.
  const playable = useMemo(
    () => scenario.turns.filter((t) => references.has(t.gloss)),
    [scenario.turns, references],
  )
  const pending = scenario.turns.filter((t) => !references.has(t.gloss))

  const turn: ScenarioTurn | undefined = playable[index]
  const reference = turn ? references.get(turn.gloss) : undefined
  const captureMs = reference ? Math.max(reference.durationMs + 1500, 2500) : 3500

  // Appropriateness is judged against this scenario's own vocabulary — the
  // signs the learner could plausibly have confused this turn with — not the
  // whole library. See scoreTurn for why.
  const scenarioVocabulary = useMemo(() => {
    const glosses = new Set(scenario.turns.map((t) => t.gloss))
    return [...references.values()].filter((r) => glosses.has(r.gloss))
  }, [scenario.turns, references])

  const handleCaptured = useCallback(
    (take: CapturedTake) => {
      if (!turn || !reference) return
      const attempt: SignRecording = {
        id: crypto.randomUUID(),
        gloss: turn.gloss,
        signer: 'learner',
        createdAt: new Date().toISOString(),
        durationMs: take.durationMs,
        fps: Math.round((take.frames.length / take.durationMs) * 1000),
        videoWidth: take.videoWidth,
        videoHeight: take.videoHeight,
        frames: take.frames,
      }
      const score = scoreTurn(attempt, reference, scenarioVocabulary)
      setCurrent(score)
      setOutcomes((prev) => [...prev.filter((o) => o.turn.id !== turn.id), { turn, score, attempt }])

      // Log the DTW accuracy — not the rubric total — so "mastery" means the
      // same thing whether a sign was practised here or in the Practice tab.
      addAttempt({
        id: attempt.id,
        gloss: turn.gloss,
        referenceId: reference.id,
        score: score.detail.score,
        worstFingers: topFingers(score.detail),
        createdAt: attempt.createdAt,
      }).catch((e: unknown) => console.error('Failed to log scenario attempt', e))
    },
    [turn, reference, scenarioVocabulary],
  )

  const capture = useSignCapture(handleCaptured)
  const stopTracking = capture.tracking.stop

  // The camera stage only exists while playing, so leaving a turn would strand
  // a live MediaStream (camera light on) and a frame loop that cannot restart
  // when the video element remounts. Release it whenever we leave the turn view.
  useEffect(() => {
    if (stage !== 'playing') stopTracking()
  }, [stage, stopTracking])

  function startScenario() {
    setIndex(0)
    setOutcomes([])
    setCurrent(null)
    setStage('playing')
  }

  function nextTurn() {
    setCurrent(null)
    if (index + 1 >= playable.length) {
      setStage('summary')
    } else {
      setIndex(index + 1)
    }
  }

  // ---- intro ----------------------------------------------------------------
  if (stage === 'intro') {
    return (
      <section className="library-card">
        <div className="library-head">
          <h2>{scenario.title}</h2>
          <span className="library-count">{scenario.subtitle}</span>
        </div>

        {SCENARIOS.length > 1 && (
          <div className="gloss-chips">
            {SCENARIOS.map((s) => {
              const covered = s.turns.filter((t) => references.has(t.gloss)).length
              return (
                <button
                  key={s.id}
                  className={s.id === scenario.id ? 'chip active' : 'chip'}
                  onClick={() => {
                    // Results belong to the scenario they came from.
                    setScenarioId(s.id)
                    setIndex(0)
                    setOutcomes([])
                    setCurrent(null)
                  }}
                  title={`${covered} of ${s.turns.length} turns have a reference`}
                >
                  {s.title} {covered}/{s.turns.length}
                </button>
              )
            })}
          </div>
        )}

        <p className="hint-text">{scenario.description}</p>

        {loading ? (
          <p className="empty-state">Loading references…</p>
        ) : (
          <>
            <ol className="turn-preview">
              {scenario.turns.map((t) => (
                <li key={t.id} className={references.has(t.gloss) ? '' : 'pending'}>
                  <span className="rec-gloss">{t.gloss}</span>
                  <span className="turn-prompt">{t.prompt}</span>
                  {!references.has(t.gloss) && <em className="badge">reference pending</em>}
                </li>
              ))}
            </ol>

            <p className="hint-text">
              {playable.length} of {scenario.turns.length} turns have a reference recording.
              {pending.length > 0 && (
                <>
                  {' '}
                  Missing: <strong>{pending.map((t) => t.gloss).join(', ')}</strong> — record them
                  in the Record tab and they join the scenario automatically.
                </>
              )}
            </p>

            <div className="row-buttons">
              <button className="btn" onClick={startScenario} disabled={playable.length === 0}>
                {playable.length === 0 ? 'No references yet' : 'Start scenario'}
              </button>
            </div>
          </>
        )}

        <p className="draft-note">{scenario._draftNote}</p>
      </section>
    )
  }

  // ---- summary --------------------------------------------------------------
  if (stage === 'summary') {
    const total =
      outcomes.length > 0
        ? Math.round(outcomes.reduce((a, o) => a + o.score.rubric.total, 0) / outcomes.length)
        : 0
    const weakest = [...outcomes].sort((a, b) => a.score.rubric.total - b.score.rubric.total)[0]
    const anyUnmeasured = outcomes.some((o) => o.score.rubric.unmeasured.length > 0)

    return (
      <section className="library-card">
        <div className="library-head">
          <h2>Scenario complete</h2>
          <span className="library-count">{scenario.title}</span>
        </div>

        <div className="result-top">
          <ScoreBadge score={total} />
          <div>
            <p style={{ margin: 0 }}>
              You completed {outcomes.length} of {scenario.turns.length} turns.
            </p>
            {weakest && (
              <p style={{ margin: '6px 0 0' }}>
                Weakest sign: <strong>{weakest.turn.gloss}</strong> ({weakest.score.rubric.total})
              </p>
            )}
          </div>
        </div>

        <ul className="mastery-list">
          {outcomes.map((o) => (
            <li className="mastery-row" key={o.turn.id}>
              <span className="rec-gloss">{o.turn.gloss}</span>
              <div className="mastery-bar">
                <div style={{ width: `${o.score.rubric.total}%` }} />
              </div>
              <span className="mastery-pct">{o.score.rubric.total}</span>
              <span className="mastery-meta">
                {o.score.bestMatchGloss !== o.turn.gloss
                  ? `closest match: ${o.score.bestMatchGloss}`
                  : 'correct sign'}
              </span>
            </li>
          ))}
        </ul>

        <div className="rubric-note">
          <p className="rubric-note-head">
            <strong>How this is scored</strong>
          </p>
          <dl className="rubric-defs">
            <dt>Accuracy — 50%</dt>
            <dd>
              How closely your hand movement matches the reference recording of this sign,
              compared frame by frame with time warping.
            </dd>
            <dt>Appropriateness — 30%</dt>
            <dd>
              Whether you produced the sign that was asked for rather than a different one. Your
              attempt is also scored against every other sign in the library; if another sign
              matches better, this drops. It can only spot confusion with signs we hold
              references for.
            </dd>
            <dt>Fluency &amp; timing — 20%</dt>
            <dd>
              How close your pace was to the reference. Judged separately because the accuracy
              measure deliberately ignores speed, so signing slowly is not penalised twice.
            </dd>
          </dl>
          <p className="rubric-note-foot">
            <strong>Not scored: non-manual markers.</strong> The proposal allots 10% to facial
            expression and head/body movement. This build tracks hand landmarks only, so that
            signal is not captured and no score for it would be honest. Its 10% is reallocated
            to accuracy — hence 50 / 30 / 20 rather than the proposal's 40 / 30 / 20 / 10.
            Scoring it needs face and pose tracking, and is future work.
            {anyUnmeasured && (
              <>
                {' '}
                Components shown as &ldquo;n/a&rdquo; had no data for that turn; their weight was
                shared across the rest rather than counted as zero.
              </>
            )}
          </p>
        </div>

        <div className="row-buttons">
          <button className="btn" onClick={startScenario}>
            Run it again
          </button>
          <button className="btn btn-ghost" onClick={() => setStage('intro')}>
            Back to overview
          </button>
        </div>
      </section>
    )
  }

  // ---- playing --------------------------------------------------------------
  if (!turn || !reference) {
    return (
      <section className="library-card">
        <p className="empty-state">This turn has no reference recording.</p>
        <div className="row-buttons">
          <button className="btn" onClick={() => setStage('intro')}>
            Back to overview
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="record-layout">
      <section className="camera-card">
        <CameraStage
          videoRef={capture.tracking.videoRef}
          canvasRef={capture.tracking.canvasRef}
          status={capture.tracking.status}
          error={capture.tracking.error}
          onStart={() => void capture.tracking.start()}
          idleHint="Start the camera to take part in the conversation."
        >
          {capture.phase === 'countdown' && (
            <div className="countdown-overlay">
              <span>{capture.count}</span>
            </div>
          )}
          {capture.phase === 'recording' && (
            <>
              <div className="rec-badge">● REC {(capture.elapsedMs / 1000).toFixed(1)} s</div>
              <div className="rec-progress">
                <div style={{ width: `${Math.min(capture.elapsedMs / captureMs, 1) * 100}%` }} />
              </div>
            </>
          )}
        </CameraStage>
        <div className="camera-bar">
          <span className="camera-stats">
            Turn {index + 1} of {playable.length}
          </span>
          {capture.tracking.stats && (
            <span className="camera-stats">
              {capture.tracking.stats.fps.toFixed(0)} fps ·{' '}
              {capture.tracking.stats.inferenceMs.toFixed(1)} ms
            </span>
          )}
        </div>
      </section>

      <aside className="record-panel">
        <div className="turn-progress">
          {playable.map((t, i) => (
            <span key={t.id} className={i < index ? 'done' : i === index ? 'active' : ''} />
          ))}
        </div>

        <p className="partner-line">{turn.partnerLine}</p>
        <h2>Sign: {turn.gloss}</h2>
        <p className="hint-text">{turn.prompt}</p>

        {current ? (
          <>
            <div className="result-top">
              <ScoreBadge score={current.rubric.total} />
              <ul className="hint-list">
                {current.bestMatchGloss !== turn.gloss && (
                  <li>
                    That looked closer to <strong>{current.bestMatchGloss}</strong> than to{' '}
                    {turn.gloss}.
                  </li>
                )}
                {current.detail.hints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
            <RubricBars score={current} />
            <div className="row-buttons">
              <button className="btn" onClick={nextTurn}>
                {index + 1 >= playable.length ? 'See summary' : 'Next turn'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setCurrent(null)
                  capture.begin(captureMs)
                }}
                disabled={capture.tracking.status !== 'running'}
              >
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="reference-preview">
              <p className="compare-label">Reference</p>
              {reference.provisional && (
                <p className="provisional-note">
                  Provisional reference — a team stand-in, not verified SSL.
                </p>
              )}
              <SkeletonPlayer
                frames={reference.frames}
                videoWidth={reference.videoWidth}
                videoHeight={reference.videoHeight}
              />
            </div>
            {turn.hint && <p className="hint-text">💡 {turn.hint}</p>}
            {capture.phase === 'countdown' ? (
              <button className="btn btn-ghost" onClick={capture.cancel}>
                Cancel
              </button>
            ) : capture.phase === 'recording' ? (
              <button className="btn" onClick={capture.finish}>
                Stop &amp; score
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => capture.begin(captureMs)}
                disabled={capture.tracking.status !== 'running'}
                title={
                  capture.tracking.status !== 'running' ? 'Start the camera first' : undefined
                }
              >
                Sign it
              </button>
            )}
          </>
        )}

        <button className="btn btn-ghost" onClick={() => setStage('intro')}>
          Leave scenario
        </button>
      </aside>
    </div>
  )
}
