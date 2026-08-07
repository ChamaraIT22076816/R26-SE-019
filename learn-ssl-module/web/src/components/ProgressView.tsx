import { useEffect, useState } from 'react'
import { listAttempts } from '../learner/attemptLog'
import { practiceNeed, summarizeAll } from '../learner/mastery'
import type { GlossMastery, MasteryLevel } from '../learner/mastery'
import { listRecordings } from '../storage/recordingStore'
import { loadBundledRecordings } from '../storage/bundledReferences'

const LEVEL_LABEL: Record<MasteryLevel, string> = {
  new: 'New',
  learning: 'Learning',
  improving: 'Improving',
  mastered: 'Mastered',
}

function relativeDay(iso: string | null): string {
  if (!iso) return 'not yet'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Tiny trend line of recent scores (0–100). Values are in the row as text;
 *  this is redundant visual encoding, so it stays minimal by design. */
function Sparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null
  const w = 72
  const h = 24
  const pad = 3
  const step = (w - pad * 2) / (scores.length - 1)
  const points = scores
    .map(
      (s, i) =>
        `${(pad + i * step).toFixed(1)},${(h - pad - (s / 100) * (h - pad * 2)).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label={`Recent scores: ${scores.join(', ')}`}
    >
      <title>{`Recent scores: ${scores.join(' → ')}`}</title>
      <polyline points={points} />
    </svg>
  )
}

/** Mastery dashboard: summary tiles + per-sign progress, weakest first. */
export function ProgressView() {
  const [summaries, setSummaries] = useState<GlossMastery[]>([])
  const [attemptCount, setAttemptCount] = useState(0)
  const [avgRecent, setAvgRecent] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const [loc, bun, log] = await Promise.all([
        listRecordings(),
        loadBundledRecordings(),
        listAttempts(),
      ])
      const glosses = [...loc, ...bun].map((r) => r.gloss)
      const now = new Date()
      setSummaries(
        summarizeAll(glosses, log).sort((a, b) => practiceNeed(b, now) - practiceNeed(a, now)),
      )
      setAttemptCount(log.length)
      const recent = log.slice(-10)
      setAvgRecent(
        recent.length > 0
          ? Math.round(recent.reduce((acc, e) => acc + e.score, 0) / recent.length)
          : null,
      )
      setLoading(false)
    })()
  }, [])

  const practised = summaries.filter((s) => s.attempts > 0).length
  const mastered = summaries.filter((s) => s.level === 'mastered').length

  return (
    <section className="library-card">
      <div className="library-head">
        <h2>Progress</h2>
        <span className="library-count">sorted by what needs practice</span>
      </div>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : summaries.length === 0 ? (
        <p className="empty-state">
          No vocabulary yet — record reference signs in the <strong>Record</strong> tab first.
        </p>
      ) : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-value">
                {practised}
                <em>/{summaries.length}</em>
              </span>
              <span className="stat-label">signs practised</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{attemptCount}</span>
              <span className="stat-label">total attempts</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{avgRecent ?? '—'}</span>
              <span className="stat-label">avg of last 10 scores</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{mastered}</span>
              <span className="stat-label">signs mastered</span>
            </div>
          </div>

          {attemptCount === 0 ? (
            <p className="empty-state">
              Your progress appears here after your first scored attempt in the{' '}
              <strong>Practice</strong> tab.
            </p>
          ) : (
            <ul className="mastery-list">
              {summaries.map((s) => (
                <li className="mastery-row" key={s.gloss}>
                  <span className="rec-gloss">{s.gloss}</span>
                  <span className={`level-chip ${s.level}`}>{LEVEL_LABEL[s.level]}</span>
                  <div className="mastery-bar" title={`Mastery ${(s.mastery * 100).toFixed(0)}%`}>
                    <div style={{ width: `${Math.round(s.mastery * 100)}%` }} />
                  </div>
                  <span className="mastery-pct">{Math.round(s.mastery * 100)}%</span>
                  <Sparkline scores={s.recentScores} />
                  <span className="mastery-meta">
                    {s.attempts === 0
                      ? 'no attempts yet'
                      : `${s.attempts} attempt${s.attempts === 1 ? '' : 's'} · last ${relativeDay(s.lastPracticedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
