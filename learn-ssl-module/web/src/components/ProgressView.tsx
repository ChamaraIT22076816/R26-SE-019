import { useEffect, useState, useMemo } from 'react'
import { listAttempts } from '../learner/attemptLog'
import { currentStreak, dailyActivity } from '../learner/activity'
import type { DayBucket } from '../learner/activity'
import { practiceNeed, summarizeAll } from '../learner/mastery'
import type { GlossMastery, MasteryLevel } from '../learner/mastery'
import { buildSession } from '../learner/session'
import { translationOf } from '../data/translations'
import { listRecordings } from '../storage/recordingStore'
import { loadReferenceIndex } from '../storage/bundledReferences'
import { categoryOf, categoriesIn } from '../data/categories'

const ACTIVITY_DAYS = 14
// The full 490-sign catalogue is Practice's job. Progress shows only the few
// signs the learner model rates as most worth drilling right now, and a
// breadth read on the categories.
const FOCUS_COUNT = 6
const CATEGORY_PREVIEW = 6

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

export function ProgressView({ onOpenPractice }: { onOpenPractice?: () => void }) {
  const [summaries, setSummaries] = useState<GlossMastery[]>([])
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map())
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  const [attemptCount, setAttemptCount] = useState(0)
  const [avgRecent, setAvgRecent] = useState<number | null>(null)
  const [activity, setActivity] = useState<DayBucket[]>([])
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)

  const [showAllCategories, setShowAllCategories] = useState(false)

  useEffect(() => {
    void (async () => {
      const [loc, bun, log] = await Promise.all([
        listRecordings(),
        loadReferenceIndex(),
        listAttempts(),
      ])
      const allRefs = [...loc, ...bun]
      const glosses = allRefs.map((r) => r.gloss)
      
      const cMap = new Map<string, string>()
      for (const r of allRefs) {
          cMap.set(r.gloss, categoryOf(r))
      }
      setCategoryMap(cMap)
      setAvailableCategories(categoriesIn(allRefs))

      const now = new Date()
      setSummaries(
        summarizeAll(glosses, log).sort((a, b) => practiceNeed(b, now) - practiceNeed(a, now)),
      )
      setAttemptCount(log.length)
      setActivity(dailyActivity(log, ACTIVITY_DAYS, now))
      setStreak(currentStreak(log, now))
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
  const overallMastery = summaries.length > 0 ? (practised / summaries.length) * 100 : 0
  const cScore = Math.max(0, 100 - overallMastery)

  // The same policy PracticeView uses to fill a session — practiceNeed ranking,
  // with the category-aware tie-break that keeps a fresh learner off a run of
  // "1, 100, 1000, …". So this list is literally what "Practise" would queue.
  const focus = useMemo(() => {
    if (summaries.length === 0) return []
    const byGloss = new Map(summaries.map((s) => [s.gloss, s]))
    return buildSession(
      summaries,
      FOCUS_COUNT,
      new Date(),
      (g) => categoryMap.get(g) ?? 'Other',
    )
      .map((g) => byGloss.get(g))
      .filter((s): s is GlossMastery => s !== undefined)
  }, [summaries, categoryMap])

  // One breadth row per category: how many of its signs have been attempted.
  const coverage = useMemo(() => {
    return availableCategories
      .map((cat) => {
        const inCat = summaries.filter((s) => (categoryMap.get(s.gloss) ?? 'Other') === cat)
        return {
          cat,
          done: inCat.filter((s) => s.attempts > 0).length,
          total: inCat.length,
        }
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.done / b.total - a.done / a.total || b.total - a.total)
  }, [summaries, availableCategories, categoryMap])

  const visibleCoverage = showAllCategories ? coverage : coverage.slice(0, CATEGORY_PREVIEW)

  return (
    <section className="aww-progress-view">
      <div className="aww-progress-header">
        <h1 className="aww-progress-title">Your Progress</h1>
        <p className="aww-progress-sub">Every attempt is scored and logged in this browser.</p>
      </div>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : summaries.length === 0 ? (
        <p className="empty-state">No reference signs are loaded yet.</p>
      ) : (
        <div className="aww-progress-content">
          
          {/* 1. Bento Box Analytics Header */}
          <div className="aww-bento-grid">
            
            {/* Practised Ring */}
            <div className="aww-bento-card aww-bento-mastery">
              <h3>Signs practised</h3>
              <div className="aww-radial-progress" style={{ '--progress': `${overallMastery}%` } as React.CSSProperties}>
                 <svg viewBox="0 0 120 120">
                   <circle cx="60" cy="60" r="54" className="bg" />
                   <circle cx="60" cy="60" r="54" className="fg" strokeDasharray="339.29" strokeDashoffset={339.29 * (cScore / 100)} />
                 </svg>
                 <div className="aww-radial-content">
                   <span className="val">{practised}</span>
                   <span className="lbl">/ {summaries.length}</span>
                 </div>
              </div>
              <p>{mastered} signs fully mastered</p>
            </div>

            {/* Stats Column */}
            <div className="aww-bento-stats-col">
               <div className="aww-bento-card aww-bento-streak">
                 <h3>Current Streak</h3>
                 <div className="aww-streak-display">
                    <svg
                      className="streak-fire"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 3c.5 3-1.5 4.5-1.5 4.5S9 6 8.5 4.5C6.5 6.5 5 9 5 12a7 7 0 0 0 14 0c0-3.5-2.5-5.5-2.5-5.5s.5 2-.5 3.5c-.5-3-4-4-4-7Z" />
                    </svg>
                    <span className="streak-val">{streak}</span>
                    <span className="streak-lbl">{streak === 1 ? 'Day' : 'Days'}</span>
                 </div>
               </div>
               
               <div className="aww-bento-card aww-bento-avg">
                 <h3>Recent Average</h3>
                 <div className="aww-avg-display">
                    <span className="avg-val">{avgRecent ?? '—'}</span>
                    <span className="avg-lbl">/ 100</span>
                 </div>
                 <p className="stat-sub">Based on last 10 attempts</p>
               </div>
            </div>

            {/* Activity Heatmap */}
            {attemptCount > 0 && (
                <div className="aww-bento-card aww-bento-activity">
                  <div className="activity-header-flex">
                    <h3>Activity Heatmap</h3>
                    <span className="activity-total">{activity.reduce((n, d) => n + d.attempts, 0)} attempts</span>
                  </div>
                  <p className="stat-sub" style={{marginBottom: '16px'}}>Last {ACTIVITY_DAYS} days</p>
                  
                  <div className="aww-heatmap" role="img" aria-label="Activity heatmap">
                    {activity.map((d) => {
                      const peak = Math.max(...activity.map((x) => x.attempts), 1)
                      const intensity = d.attempts > 0 ? 0.2 + (0.8 * (d.attempts / peak)) : 0
                      return (
                        <div
                          key={d.date}
                          className="aww-heatmap-day"
                          style={{ '--intensity': intensity } as React.CSSProperties}
                          title={
                            d.attempts === 0
                              ? `${d.date}: no practice`
                              : `${d.date}: ${d.attempts} attempt${d.attempts === 1 ? '' : 's'}, avg ${d.avgScore}`
                          }
                        />
                      )
                    })}
                  </div>
                </div>
            )}
          </div>

          {/* 2. Practise next — the model's ranking, not a catalogue */}
          <section className="aww-focus" aria-labelledby="aww-focus-h">
            <div className="aww-focus-head">
              <h2 id="aww-focus-h">Practise next</h2>
              {onOpenPractice && (
                <button type="button" className="aww-inline-link" onClick={onOpenPractice}>
                  See all signs in Practice
                </button>
              )}
            </div>

            <ol className="aww-focus-list">
              {focus.map((s) => {
                const meaning = translationOf(s.gloss)
                return (
                  <li className="aww-focus-row" key={s.gloss}>
                    <div className="aww-focus-main">
                      <span className="aww-focus-gloss">{s.gloss}</span>
                      {meaning && <span className="aww-focus-meaning">{meaning}</span>}
                    </div>
                    <span className={`level-chip ${s.level}`}>{LEVEL_LABEL[s.level]}</span>
                    <span className="aww-focus-stat">
                      {s.attempts === 0
                        ? 'Not started'
                        : `${Math.round(s.mastery * 100)}% · ${s.attempts} attempt${
                            s.attempts === 1 ? '' : 's'
                          } · ${relativeDay(s.lastPracticedAt)}`}
                    </span>
                    {onOpenPractice && (
                      <button type="button" className="btn aww-focus-go" onClick={onOpenPractice}>
                        Practise
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>

          {/* 3. Coverage by category — a breadth read, not a drill-down */}
          {coverage.length > 0 && (
            <section className="aww-coverage" aria-labelledby="aww-coverage-h">
              <h2 id="aww-coverage-h">Coverage by category</h2>
              <ul className="aww-coverage-list">
                {visibleCoverage.map((r) => (
                  <li className="aww-coverage-row" key={r.cat}>
                    <span className="aww-coverage-name">{r.cat}</span>
                    <span className="aww-coverage-count">
                      {r.done} / {r.total}
                    </span>
                    <div className="aww-coverage-track">
                      <div
                        className="aww-coverage-fill"
                        style={{ width: `${(r.done / r.total) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {coverage.length > CATEGORY_PREVIEW && (
                <button
                  type="button"
                  className="aww-inline-link aww-coverage-more"
                  onClick={() => setShowAllCategories((v) => !v)}
                >
                  {showAllCategories ? 'Show fewer' : `Show all ${coverage.length} categories`}
                </button>
              )}
            </section>
          )}

        </div>
      )}
    </section>
  )
}
