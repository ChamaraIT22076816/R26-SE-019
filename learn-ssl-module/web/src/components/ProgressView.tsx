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
import { pickReferenceList } from '../storage/references'
import { toMeta } from '../vision/types'
import { categoryOf, categoriesIn } from '../data/categories'

const ACTIVITY_DAYS = 14
// The full 490-sign catalogue is Practice's job. Progress shows only the few
// signs the learner model rates as most worth drilling right now, and a
// breadth read on the categories.
const FOCUS_COUNT = 6
const REVIEW_COUNT = 4
// A practised sign needs a real amount of work before it earns a spot in
// "Review" — otherwise a sign mastered yesterday shows up asking to be redone.
const REVIEW_NEED_MIN = 0.3
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

/** One row of "Practise next" / "Review": gloss, meaning, level, a stat line,
 *  and the single action that opens Practice on this sign. */
function SignRow({
  s,
  index,
  animate,
  onPractise,
}: {
  s: GlossMastery
  index: number
  animate: boolean
  onPractise?: (gloss?: string) => void
}) {
  const meaning = translationOf(s.gloss)
  return (
    <li
      className="aww-focus-row"
      style={animate ? ({ '--i': index } as React.CSSProperties) : undefined}
    >
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
      {onPractise && (
        <button type="button" className="btn aww-focus-go" onClick={() => onPractise(s.gloss)}>
          Practise
        </button>
      )}
    </li>
  )
}

export function ProgressView({
  onPractise,
}: {
  /** Open the Practice tab. With a gloss, land straight on that sign; without
   *  one, just switch tabs. */
  onPractise?: (gloss?: string) => void
}) {
  const [summaries, setSummaries] = useState<GlossMastery[]>([])
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map())
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  const [attemptCount, setAttemptCount] = useState(0)
  const [avgRecent, setAvgRecent] = useState<number | null>(null)
  const [activity, setActivity] = useState<DayBucket[]>([])
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)

  const [showAllCategories, setShowAllCategories] = useState(false)

  // Gate the row stagger the way Hero.tsx does — the token layer already
  // collapses durations under reduced motion, but this drops the transform
  // offset entirely so nothing sits off its mark waiting for a delay to clear.
  const [animate] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    void (async () => {
      const [loc, bun, log] = await Promise.all([
        listRecordings(),
        loadReferenceIndex(),
        listAttempts(),
      ])
      // The same one-per-gloss list Practice builds, so "35 / 494" here and
      // "494 signs" there can never disagree (see hero-copy-must-match-build).
      const refs = pickReferenceList([...loc.map(toMeta), ...bun])
      const glosses = refs.map((r) => r.gloss)

      const cMap = new Map<string, string>()
      for (const r of refs) {
        cMap.set(r.gloss, categoryOf(r))
      }
      setCategoryMap(cMap)
      setAvailableCategories(categoriesIn(refs))

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

  // Signs already tried that the model still rates as needing work — the strand
  // "Practise next" leaves out while it is busy introducing new vocabulary.
  // Same practiceNeed ranking, just filtered to attempts > 0.
  const review = useMemo(() => {
    const now = new Date()
    const inFocus = new Set(focus.map((s) => s.gloss))
    return summaries
      .filter(
        (s) =>
          s.attempts > 0 && !inFocus.has(s.gloss) && practiceNeed(s, now) >= REVIEW_NEED_MIN,
      )
      .sort((a, b) => practiceNeed(b, now) - practiceNeed(a, now))
      .slice(0, REVIEW_COUNT)
  }, [summaries, focus])

  // One breadth row per category: how many of its signs have been attempted.
  // Ordered by signs practised (most-worked categories first), then by size.
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
      .sort((a, b) => b.done - a.done || b.total - a.total || a.cat.localeCompare(b.cat))
  }, [summaries, availableCategories, categoryMap])

  const visibleCoverage = showAllCategories ? coverage : coverage.slice(0, CATEGORY_PREVIEW)

  return (
    <section className="aww-progress-view">
      <div className="aww-progress-header">
        <h1 className="aww-progress-title">Your Progress</h1>
        <p className="aww-progress-sub">Every attempt is scored and logged in this browser.</p>
      </div>

      {loading ? (
        <div className="aww-progress-skeleton" aria-hidden="true">
          <div className="sk-bar sk-band" />
          <div className="sk-bar sk-head" />
          <div className="sk-bar sk-row" />
          <div className="sk-bar sk-row" />
          <div className="sk-bar sk-row" />
        </div>
      ) : summaries.length === 0 ? (
        <div className="aww-progress-empty">
          <h2>No sign data loaded.</h2>
          <p>
            The reference recordings did not load, so there is nothing to track yet. A
            reload usually fixes it.
          </p>
        </div>
      ) : (
        <div className="aww-progress-content">

          {attemptCount === 0 ? (
            /* First run: the stat band would be four zeros and the heatmap a
               blank grid. Say so plainly and point at the list below. */
            <div className="aww-progress-firstrun">
              <h2>Nothing logged yet.</h2>
              <p>
                Practise a sign and this page fills in — a mastery estimate for every
                sign, a daily streak, an activity heatmap.
              </p>
            </div>
          ) : (
            <>
              {/* 1. Stat band — one row of numbers, echoing the hero's stats strip */}
              <div className="aww-progress-stats">
                <div className="lstat-pill">
                  <span className="lstat-val">
                    {practised}
                    <span className="lstat-of"> / {summaries.length}</span>
                  </span>
                  <span className="lstat-lbl">Practised</span>
                </div>
                <div className="lstat-sep" aria-hidden="true" />
                <div className="lstat-pill">
                  <span className="lstat-val">{mastered}</span>
                  <span className="lstat-lbl">Mastered</span>
                </div>
                <div className="lstat-sep" aria-hidden="true" />
                <div className="lstat-pill">
                  <span className="lstat-val">{streak}</span>
                  <span className="lstat-lbl">Day streak</span>
                </div>
                <div className="lstat-sep" aria-hidden="true" />
                <div className="lstat-pill">
                  <span className="lstat-val">{avgRecent ?? '—'}</span>
                  <span className="lstat-lbl">Recent average</span>
                </div>
              </div>

              {/* 2. Activity — full width, its own section */}
              <section className="aww-activity" aria-labelledby="aww-activity-h">
                <div className="aww-activity-head">
                  <h2 id="aww-activity-h">Activity</h2>
                  <span className="aww-activity-total">
                    {activity.reduce((n, d) => n + d.attempts, 0)} attempts · last{' '}
                    {ACTIVITY_DAYS} days
                  </span>
                </div>
                <div
                  className="aww-heatmap"
                  role="img"
                  aria-label={`Practice activity over the last ${ACTIVITY_DAYS} days`}
                >
                  {activity.map((d) => {
                    const peak = Math.max(...activity.map((x) => x.attempts), 1)
                    const intensity = d.attempts > 0 ? 0.2 + 0.8 * (d.attempts / peak) : 0
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
                {/* role="img" makes the grid opaque to a screen reader; this is
                    the same 14 days in a form it can read. The wrapper div (not
                    the table) carries .sr-only — overflow-clipping a bare table
                    is unreliable. */}
                <div className="sr-only">
                  <table>
                    <caption>Practice attempts per day, last {ACTIVITY_DAYS} days</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Attempts</th>
                        <th scope="col">Average score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.map((d) => (
                        <tr key={d.date}>
                          <td>{d.date}</td>
                          <td>{d.attempts}</td>
                          <td>{d.avgScore ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* 3. Practise next — the model's ranking, not a catalogue */}
          <section className="aww-focus" aria-labelledby="aww-focus-h">
            <div className="aww-focus-head">
              <h2 id="aww-focus-h">Practise next</h2>
              {onPractise && (
                <button type="button" className="aww-inline-link" onClick={() => onPractise()}>
                  See all signs in Practice
                </button>
              )}
            </div>

            <ol className={`aww-focus-list${animate ? ' is-animated' : ''}`}>
              {focus.map((s, i) => (
                <SignRow key={s.gloss} s={s} index={i} animate={animate} onPractise={onPractise} />
              ))}
            </ol>
          </section>

          {/* 3b. Review — practised signs the model still wants worked on, which
              "Practise next" skips while it introduces new vocabulary. */}
          {review.length > 0 && (
            <section className="aww-focus" aria-labelledby="aww-review-h">
              <div className="aww-focus-head">
                <h2 id="aww-review-h">Review</h2>
              </div>
              <ol className={`aww-focus-list${animate ? ' is-animated' : ''}`}>
                {review.map((s, i) => (
                  <SignRow
                    key={s.gloss}
                    s={s}
                    index={i}
                    animate={animate}
                    onPractise={onPractise}
                  />
                ))}
              </ol>
            </section>
          )}

          {/* 4. Coverage by category — a breadth read, not a drill-down.
              Hidden on first run: 20 empty bars say nothing. */}
          {attemptCount > 0 && coverage.length > 0 && (
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
