import { band } from '../scoring/band'

interface ScoreBadgeProps {
  score: number
  /**
   * Change against the learner's previous attempt at this same sign, or null
   * when this is the first one. Zero is meaningful and distinct from null.
   */
  delta?: number | null
  /** True when this attempt beats every earlier attempt at this sign. */
  best?: boolean
  /**
   * Drop the delta line entirely. For an aggregate score (a whole scenario's
   * average) "First attempt at this sign" is nonsense — it is not one sign.
   */
  hideDelta?: boolean
  /** Optional finger-by-finger accuracy breakdown */
  fingerBreakdown?: { name: string; accuracy: number }[]
}

/**
 * Circular progress ring showing a 0–100 sign-match score with Awwwards-tier visual craft.
 */
export function ScoreBadge({
  score,
  delta = null,
  best = false,
  hideDelta = false,
  fingerBreakdown = [],
}: ScoreBadgeProps) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100)
  const { klass, label } = band(score)

  const tierTitle =
    score >= 90
      ? 'Master Execution'
      : score >= 75
        ? 'Fluent Signing'
        : score >= 60
          ? 'Developing Form'
          : 'Refining Technique'

  return (
    <div className={`score-badge aww-score-badge ${klass}`}>
      <div className="aww-score-dial-wrap">
        <svg viewBox="0 0 120 120" width="148" height="148" className="aww-score-svg">
          <defs>
            <linearGradient id="scoreTealGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2dd4bf" />
              <stop offset="100%" stopColor="#00a693" />
            </linearGradient>
            <linearGradient id="scoreGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#daa520" />
              <stop offset="100%" stopColor="#2dd4bf" />
            </linearGradient>
            <linearGradient id="scoreLimeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a3e635" />
              <stop offset="100%" stopColor="#4d7c0f" />
            </linearGradient>
            <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <circle cx="60" cy="60" r={r} className="ring-track" />
          <circle
            cx="60"
            cy="60"
            r={r}
            className="ring-value"
            strokeDasharray={c}
            style={
              {
                '--ring-empty': c,
                '--ring-offset': offset,
              } as React.CSSProperties
            }
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="56" className="ring-score" dominantBaseline="central" textAnchor="middle">
            {score}
          </text>
          <text x="60" y="74" className="ring-sublabel" dominantBaseline="central" textAnchor="middle">
            MATCH
          </text>
        </svg>
      </div>

      <div className="aww-score-header-group">
        <span className="score-label aww-score-label">{tierTitle}</span>
        <span className="aww-score-subcaption">{label}</span>
      </div>

      {best && <span className="score-best aww-score-best">★ New Personal Best!</span>}

      {!hideDelta && (
        <span className="score-delta aww-score-delta">
          {delta === null
            ? 'First recorded attempt at this sign'
            : delta === 0
              ? 'Matched your previous benchmark'
              : delta > 0
                ? `+${delta} improvement from last take`
                : `${delta} delta from last take`}
        </span>
      )}

      {fingerBreakdown.length > 0 && (
        <div className="finger-precision-bars aww-finger-bars">
          <div className="aww-finger-bars-header">
            <span>JOINT PRECISION BREAKDOWN</span>
            <span>DTW ACCURACY</span>
          </div>
          {fingerBreakdown.map((item) => (
            <div className="f-bar-row" key={item.name}>
              <span className="f-bar-name">{item.name}</span>
              <div className="f-bar-track">
                <div
                  className={`f-bar-fill ${item.accuracy >= 85 ? 'fill-good' : item.accuracy >= 60 ? 'fill-mid' : 'fill-low'}`}
                  style={{ width: `${Math.min(100, Math.max(0, item.accuracy))}%` }}
                />
              </div>
              <span className="f-bar-pct">{item.accuracy}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
